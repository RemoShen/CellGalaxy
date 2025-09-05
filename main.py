import shutil
from fastapi import FastAPI, File, UploadFile, HTTPException, Query, Body, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, StreamingResponse, FileResponse
import uvicorn
import os
import zipfile
import pandas as pd
import numpy as np
import io
import math
import json
import hashlib
from typing import Optional, List, Dict
from pydantic import BaseModel, Field
from PIL import Image
import zarr
try:
    from numcodecs import blosc as _blosc
    _blosc.set_nthreads(max(1, os.cpu_count() or 1))
except Exception:
    pass
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

# =========================
# 配置
# =========================
DATA_DIR = "public"
# 将缓存目录移出 public，避免前端开发服务器监听导致的整页刷新
CACHE_DIR = os.path.join(os.getcwd(), ".cache")
ZARR_DIR = os.path.join(DATA_DIR, "output.zarr")
DEFAULT_TILE = 16

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(CACHE_DIR, exist_ok=True)

# =========================
# FastAPI 应用
# =========================
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/output.zarr", StaticFiles(directory=ZARR_DIR, check_dir=False), name="zarr_data")
# 单独挂载缓存路径到 /public/cache，但物理目录不在 public 下，避免触发前端 HMR 刷新
app.mount("/public/cache", StaticFiles(directory=CACHE_DIR, check_dir=False), name="cache_files")
app.mount("/public", StaticFiles(directory=DATA_DIR, check_dir=False), name="public_files")

# =========================
# 核心工具函数
# =========================
# 进程级 Zarr 句柄缓存与线程池
_IMG = None
_IMG_LOCK = threading.Lock()
_EXECUTOR = ThreadPoolExecutor(max_workers=max(2, (os.cpu_count() or 4)))
_PREWARM_SET = set()  # {(channel, tile)} 标记正在预热，避免重复

def open_zarr():
    global _IMG
    if _IMG is not None:
        return _IMG
    with _IMG_LOCK:
        if _IMG is None:
            if not os.path.isdir(ZARR_DIR):
                raise RuntimeError(f"Zarr 目录不存在: {ZARR_DIR}")
            _IMG = zarr.open_array(ZARR_DIR, mode="r")
    return _IMG

def stable_label(idx: int, num_classes: int = 11) -> int:
    h = hashlib.sha1(str(idx).encode("utf-8")).hexdigest()
    return int(h[:8], 16) % num_classes

def meta_from_img(img):
    if img.ndim != 4:
        raise RuntimeError(f"期望 Zarr 形状 [C,N,H,W]，实际 {img.shape}")
    C, N, H, W = img.shape
    chunks = img.chunks
    if chunks is None:
        raise RuntimeError("Zarr 数组必须是分块的")
    n_per_chunk = chunks[1]
    n_chunks = math.ceil(N / n_per_chunk)
    return C, N, H, W, chunks, n_chunks, n_per_chunk

def grid_for_count(n_items: int):
    cols = int(math.ceil(math.sqrt(n_items))) if n_items > 0 else 1
    rows = int(math.ceil(n_items / cols)) if n_items > 0 else 1
    return rows, cols

# =========================
# 缓存路径助手（单通道：固定路径）
# =========================
def single_cache_path(channel: int, chunk_id: int, tile: int) -> str:
    ch_dir = os.path.join(CACHE_DIR, f"ch{int(channel)}", f"tile_{int(tile)}")
    os.makedirs(ch_dir, exist_ok=True)
    return os.path.join(ch_dir, f"chunk_{int(chunk_id)}.png")

# =========================
# 数据模型
# =========================
class CompositeSpec(BaseModel):
    method: str = Field("weighted_mean", description='"mean"|"max"|"weighted_mean"')
    weights: Dict[int, float] = Field(default_factory=dict)
    colors: Dict[int, List[float]] = Field(default_factory=dict)
    alphas: Dict[int, float] = Field(default_factory=dict)

class AtlasRequest(BaseModel):
    channels: List[int]
    composite: CompositeSpec = Field(default_factory=CompositeSpec)
    tile: int = DEFAULT_TILE

# =========================
# 图像处理函数
# =========================
def norm01(x: np.ndarray, lo: float, hi: float, gamma: float = 1.0) -> np.ndarray:
    den = max(hi - lo, 1e-8)
    t = (x.astype(np.float32) - lo) / den
    t = np.clip(t, 0.0, 1.0)
    if gamma != 1.0:
        t = np.power(t, 1.0 / float(gamma), where=t > 0.0, out=t)
    return t

def tiles_to_atlas(rgba_tiles: np.ndarray, tile: int) -> Image.Image:
    M, H, W, _ = rgba_tiles.shape
    rows, cols = grid_for_count(M)
    atlas_h = rows * tile
    atlas_w = cols * tile

    atlas = np.zeros((atlas_h, atlas_w, 4), dtype=np.float32)
    idx = 0
    for r in range(rows):
        r0 = r * tile
        for c in range(cols):
            if idx >= M: break
            c0 = c * tile
            atlas[r0:r0+tile, c0:c0+tile, :] = rgba_tiles[idx]
            idx += 1
    atlas = (atlas * 255.0 + 0.5).astype(np.uint8)
    return Image.fromarray(atlas, mode="RGBA")


# =========================
# 生成与预热辅助
# =========================
def _generate_single_channel_mask(img, ch: int, slc: slice) -> np.ndarray:
    data = np.asarray(img[[ch], slc, :, :], dtype=np.float32)
    if data.ndim == 3:
        data = data[np.newaxis, ...]
    if data.ndim != 4:
        raise RuntimeError(f"Unexpected data ndim: {data.ndim}")
    t = norm01(data[0], 0.0, 65535.0, 1.0)
    gray = t
    alpha = t
    mask = np.stack([gray, gray, gray, np.clip(alpha, 0.0, 1.0)], axis=-1)
    return mask

def _render_and_cache_atlas(img, ch: int, chunk_id: int, tile: int) -> str:
    C, N, H, W, chunks, n_chunks, n_per_chunk = meta_from_img(img)
    if not (0 <= ch < C):
        raise RuntimeError(f"channel {ch} out of range [0,{C-1}]")
    if not (0 <= chunk_id < n_chunks):
        raise RuntimeError("chunk_id out of range")
    cache_path = single_cache_path(ch, chunk_id, int(tile))
    if os.path.exists(cache_path):
        return cache_path
    start = chunk_id * n_per_chunk
    end = min(start + n_per_chunk, N)
    slc = slice(start, end)
    mask = _generate_single_channel_mask(img, ch, slc)
    atlas_img = tiles_to_atlas(mask, tile=int(tile))
    buf = io.BytesIO()
    atlas_img.save(buf, format="PNG", compress_level=1)
    data_bytes = buf.getvalue()
    with open(cache_path, "wb") as f:
        f.write(data_bytes)
    return cache_path

def _prewarm_channel_async(ch: int, tile: int):
    """后台预热指定通道/瓦片大小的所有 chunk（若未存在缓存则生成）。"""
    key = (int(ch), int(tile))
    if key in _PREWARM_SET:
        return
    _PREWARM_SET.add(key)
    def _task():
        try:
            img = open_zarr()
            C, N, H, W, chunks, n_chunks, n_per_chunk = meta_from_img(img)
            futures = []
            for cid in range(n_chunks):
                cp = single_cache_path(ch, cid, int(tile))
                if os.path.exists(cp):
                    continue
                futures.append(_EXECUTOR.submit(_render_and_cache_atlas, img, ch, cid, tile))
            for fut in as_completed(futures):
                try:
                    fut.result()
                except Exception as e:
                    try:
                        print(f"prewarm task error: {e}")
                    except Exception:
                        pass
        finally:
            _PREWARM_SET.discard(key)
    _EXECUTOR.submit(_task)

# =========================
# 数据生成函数
# =========================
def get_channel_info(df: pd.DataFrame, img=None):
    columns = list(df.columns)
    channel_columns = columns[9:] #9到最后一个column
    channels = []
    for i, col_name in enumerate(channel_columns):
        channel_data = img[i, :, :, :]
        sorted_pixels = np.sort(channel_data.flatten())
        total_pixels = len(sorted_pixels)
        min_idx = int(0.05 * total_pixels)
        max_idx = int(0.95 * total_pixels)
        min_value = float(sorted_pixels[min_idx])
        max_value = float(sorted_pixels[max_idx])
        channels.append({
            'id': i,
            'name': col_name,
            'column_index': i + 9,
            'pixel_value_range': {'min': min_value, 'max': max_value}
        })
    return channels

async def generate_json_files():
    csv_path = os.path.join(DATA_DIR, "data.csv")
    if not os.path.exists(csv_path):
        return
    try:
        df = pd.read_csv(csv_path)
        img = None
        if os.path.isdir(ZARR_DIR):
            try:
                img = open_zarr()
            except Exception as e:
                print(f"Zarr读取失败: {str(e)}")
        if img is not None:
            C, N, H, W, chunks, n_chunks, n_per_chunk = meta_from_img(img)
            N = min(len(df), N)
        else:
            N = len(df)
            n_per_chunk = 1
            n_chunks = N
        coords = []
        for idx in range(N):
            x_raw = float(df.iloc[idx].get('X_centroid', 0))
            y_raw = float(df.iloc[idx].get('Y_centroid', 0))
            x_umap2d = float(df.iloc[idx].get('umap2_x', x_raw))
            y_umap2d = float(df.iloc[idx].get('umap2_y', y_raw))
            x_umap3d = float(df.iloc[idx].get('umap3_x', x_raw))
            y_umap3d = float(df.iloc[idx].get('umap3_y', y_raw))
            z_umap3d = float(df.iloc[idx].get('umap3_z', 0))
            chunk_id = idx // n_per_chunk if 'n_per_chunk' in locals() else 0
            local_index = idx % n_per_chunk if 'n_per_chunk' in locals() else idx
            coords.append({
                "id": idx, 
                "chunk_id": int(chunk_id), 
                "local_index": int(local_index),
                "raw": {"x": x_raw, "y": y_raw, "z": 0},
                "umap2d": {"x": x_umap2d, "y": y_umap2d, "z": 0},
                "umap3d": {"x": x_umap3d, "y": y_umap3d, "z": z_umap3d},
                "label": int(df.iloc[idx].get('label', stable_label(idx)))
            })
        channels = get_channel_info(df, img)
        with open(os.path.join(DATA_DIR, "coords.json"), 'w', encoding='utf-8') as f:
            json.dump(coords, f, ensure_ascii=False, indent=2)
        with open(os.path.join(DATA_DIR, "channel_info.json"), 'w', encoding='utf-8') as f:
            json.dump({"channels": channels, "total_channels": len(channels)}, f, ensure_ascii=False, indent=2)
        print(f"已生成JSON文件: coords.json ({len(coords)} 个点), channel_info.json ({len(channels)} 个channel)")
    except Exception as e:
        print(f"生成JSON文件失败: {str(e)}")

# =========================
# API 端点
# =========================
@app.get("/")
async def root():
    return {"message": "API is running"}

@app.post("/upload/{file_type}")
async def upload_files(file_type: str, file: UploadFile = File(...)):
    if file_type not in ["zarr", "csv"]:
        raise HTTPException(status_code=400, detail="不支持的文件类型")
    file_path = os.path.join(DATA_DIR, file.filename if file_type == "zarr" else "data.csv")
    with open(file_path, "wb") as f:
        content = await file.read()
        f.write(content)
    if file_type == "zarr":
        with zipfile.ZipFile(file_path, 'r') as zip_ref:
            zip_ref.extractall(DATA_DIR)
        os.remove(file_path)
    elif file_type == "csv":
        await generate_json_files()
    return {"message": f"{file.filename} 上传成功"}

@app.get("/channels")
async def get_channels():
    csv_path = os.path.join(DATA_DIR, "data.csv")
    if not os.path.exists(csv_path):
        return {"channels": [], "total_channels": 0}
    try:
        df = pd.read_csv(csv_path)
        channels = get_channel_info(df)
        return {"channels": channels, "total_channels": len(channels)}
    except Exception as e:
        return {"channels": [], "total_channels": 0}

@app.get("/meta")
def meta():
    if not os.path.isdir(ZARR_DIR):
        return {"error": "No data loaded", "message": "Please upload zarr data first"}
    try:
        img = open_zarr()
        C, N, H, W, chunks, n_chunks, n_per_chunk = meta_from_img(img)
        rows, cols = grid_for_count(n_per_chunk)
        atlas_w = cols * DEFAULT_TILE
        atlas_h = rows * DEFAULT_TILE
        return {
            "C": int(C), "N": int(N), "H": int(H), "W": int(W),
            "dtype": str(img.dtype),
            "chunks": tuple(int(x) for x in img.chunks),
            "n_chunks": int(n_chunks), "n_per_chunk": int(n_per_chunk),
            "atlas": {"tile": DEFAULT_TILE, "cols": int(cols), "rows": int(rows), "width": int(atlas_w), "height": int(atlas_h)}
        }
    except Exception as e:
        return {"error": "Failed to load data", "message": str(e)}

@app.get("/coords")
def coords(limit: Optional[int] = Query(None)):
    if not os.path.exists(os.path.join(DATA_DIR, "data.csv")):
        return JSONResponse([])
    try:
        df = pd.read_csv(os.path.join(DATA_DIR, "data.csv"))
        img = open_zarr()
        C, N, H, W, chunks, n_chunks, n_per_chunk = meta_from_img(img)
        N = min(len(df), N)
        out = []
        total = N if limit is None else min(N, int(limit))
        for idx in range(total):
            x_raw = float(df.iloc[idx].get('X_centroid', 0))
            y_raw = float(df.iloc[idx].get('Y_centroid', 0))
            x_umap2d = float(df.iloc[idx].get('umap2_x', x_raw))
            y_umap2d = float(df.iloc[idx].get('umap2_y', y_raw))
            x_umap3d = float(df.iloc[idx].get('umap3_x', x_raw))
            y_umap3d = float(df.iloc[idx].get('umap3_y', y_raw))
            z_umap3d = float(df.iloc[idx].get('umap3_z', 0))
            chunk_id = idx // n_per_chunk
            local_index = idx % n_per_chunk
            out.append({
                "id": idx, 
                "chunk_id": int(chunk_id), 
                "local_index": int(local_index),
                "raw": {"x": x_raw, "y": y_raw, "z": 0},
                "umap2d": {"x": x_umap2d, "y": y_umap2d, "z": 0},
                "umap3d": {"x": x_umap3d, "y": y_umap3d, "z": z_umap3d},
                "label": int(df.iloc[idx].get('label', stable_label(idx)))
            })
        return JSONResponse(out)
    except Exception as e:
        return JSONResponse([])

@app.get("/atlas_uv/{chunk_id}")
def atlas_uv(chunk_id: int, tile: int = Query(DEFAULT_TILE)):
    img = open_zarr()
    C, N, H, W, chunks, n_chunks, n_per_chunk = meta_from_img(img)
    if not (0 <= chunk_id < n_chunks):
        raise HTTPException(status_code=404, detail="chunk_id out of range")
    rows, cols = grid_for_count(n_per_chunk)
    width = cols * tile
    height = rows * tile
    uvs = []
    for i in range(n_per_chunk):
        gindex = chunk_id * n_per_chunk + i
        if gindex >= N:
            break
        r = i // cols; c = i % cols
        x0 = c * tile; y0 = r * tile
        x1 = x0 + tile; y1 = y0 + tile
        uvs.append({
            "local_index": int(i),
            "u0": x0 / width, "v0": y0 / height,
            "u1": x1 / width, "v1": y1 / height
        })
    return {
        "tile": int(tile),
        "cols": int(cols),
        "rows": int(rows),
        "width": int(width),
        "height": int(height),
        "uv": uvs
    }

@app.post("/atlas/{chunk_id}")
def atlas(chunk_id: int, req: AtlasRequest = Body(...)):
    """
    单通道灰度 atlas（灰度+alpha 同灰度），归一化固定 [0, 65535]。
    前端负责通道叠加与着色。
    """
    img = open_zarr()
    C, N, H, W, chunks, n_chunks, n_per_chunk = meta_from_img(img)
    chans = sorted(set(int(c) for c in req.channels))
    if len(chans) != 1:
        raise HTTPException(status_code=400, detail="Only single-channel is supported. Use GET /atlas/{chunk_id}?channel=..")
    ch = chans[0]
    if not (0 <= ch < C):
        raise HTTPException(status_code=400, detail=f"channel {ch} out of range [0,{C-1}]")

    # 单通道固定缓存路径
    cache_path = single_cache_path(ch, chunk_id, int(req.tile))
    etag = f"ch{ch}-chunk{chunk_id}-tile{int(req.tile)}"
    if os.path.exists(cache_path):
        headers = {"Cache-Control": "public, max-age=604800", "ETag": etag}
        return FileResponse(cache_path, media_type="image/png", headers=headers)

    # 渲染并缓存（可命中则直接返回文件）
    _render_and_cache_atlas(img, ch, chunk_id, int(req.tile))
    try:
        print(f"Saved atlas cache: {cache_path}")
    except Exception:
        pass
    # 后台预热同通道的其它 chunk
    _prewarm_channel_async(ch, int(req.tile))
    headers = {"Cache-Control": "public, max-age=604800", "ETag": etag}
    # 以 FileResponse 返还磁盘缓存（便于浏览器缓存与传输）
    return FileResponse(cache_path, media_type="image/png", headers=headers)

@app.get("/atlas/{chunk_id}")
def atlas_get(chunk_id: int, channel: int = Query(...), tile: int = Query(DEFAULT_TILE), request: Request = None):
    """
    单通道灰度 atlas 的 GET 版本，便于浏览器/代理缓存。
    等价于 POST /atlas/{chunk_id}，body {channels:[channel], tile}。
    """
    img = open_zarr()
    C, N, H, W, chunks, n_chunks, n_per_chunk = meta_from_img(img)
    if not (0 <= channel < C):
        raise HTTPException(status_code=400, detail=f"channel {channel} out of range [0,{C-1}]")
    if not (0 <= chunk_id < n_chunks):
        raise HTTPException(status_code=404, detail="chunk_id out of range")

    chans = [int(channel)]
    cache_path = single_cache_path(chans[0], chunk_id, int(tile))
    etag = f"ch{chans[0]}-chunk{chunk_id}-tile{int(tile)}"

    # 条件请求：仅当磁盘上已有文件且 ETag 匹配时返回 304
    if os.path.exists(cache_path):
        if request is not None:
            inm = request.headers.get("if-none-match")
            if inm and inm.strip('"') == etag:
                return Response(status_code=304)
        headers = {"Cache-Control": "public, max-age=604800", "ETag": etag}
        return FileResponse(cache_path, media_type="image/png", headers=headers)

    # 渲染并缓存（若缓存命中则跳过）
    _render_and_cache_atlas(img, chans[0], chunk_id, int(tile))
    try:
        print(f"Saved atlas cache: {cache_path}")
    except Exception:
        pass
    # 后台预热同通道的其它 chunk
    _prewarm_channel_async(chans[0], int(tile))
    headers = {"Cache-Control": "public, max-age=604800", "ETag": etag}
    return FileResponse(cache_path, media_type="image/png", headers=headers)

@app.post("/prewarm")
def prewarm(channel: int = Query(...), tile: int = Query(DEFAULT_TILE)):
    """触发后台预热：为指定通道与瓦片大小生成所有 chunk 的缓存。"""
    img = open_zarr()
    C, N, H, W, chunks, n_chunks, n_per_chunk = meta_from_img(img)
    if not (0 <= channel < C):
        raise HTTPException(status_code=400, detail=f"channel {channel} out of range [0,{C-1}]")
    _prewarm_channel_async(int(channel), int(tile))
    return {"status": "ok", "message": "prewarm started", "channel": int(channel), "tile": int(tile)}

# =========================
# 启动
# =========================
if __name__ == "__main__":
    # #每次启动服务器先把.cache目录删除
    # if os.path.exists(CACHE_DIR):
    #     shutil.rmtree(CACHE_DIR)
    # os.makedirs(CACHE_DIR, exist_ok=True)
    # #每次启动服务器先把data.csv文件删除
    # if os.path.exists(os.path.join(DATA_DIR, "data.csv")):
    #     os.remove(os.path.join(DATA_DIR, "data.csv"))
    # #每次启动服务器先把coords.json文件删除
    # if os.path.exists(os.path.join(DATA_DIR, "coords.json")):
    #     os.remove(os.path.join(DATA_DIR, "coords.json"))
    # #每次启动服务器先把channel_info.json文件删除
    # if os.path.exists(os.path.join(DATA_DIR, "channel_info.json")):
    #     os.remove(os.path.join(DATA_DIR, "channel_info.json"))
    # #每次启动服务器先把output.zarr目录删除
    # if os.path.exists(os.path.join(DATA_DIR, "output.zarr")):
    #     shutil.rmtree(os.path.join(DATA_DIR, "output.zarr"))    
    uvicorn.run(app, host="0.0.0.0", port=8000)
