from fastapi import FastAPI, File, UploadFile, HTTPException, Query, Body
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

# =========================
# 配置
# =========================
DATA_DIR = "public"
# 将缓存目录移出 public，避免前端开发服务器监测到文件变更导致页面不断刷新
# 例如 Vite/CRA 会 watch public 目录下的文件并触发 HMR/full reload
CACHE_DIR = os.path.join(".cache", "atlas")
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
app.mount("/public", StaticFiles(directory=DATA_DIR, check_dir=False), name="public_files")

# =========================
# 核心工具函数
# =========================
def open_zarr():
    if not os.path.isdir(ZARR_DIR):
        raise RuntimeError(f"Zarr 目录不存在: {ZARR_DIR}")
    return zarr.open_array(ZARR_DIR, mode="r")

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
# 数据生成函数
# =========================
def get_channel_info(df: pd.DataFrame, img=None):
    columns = list(df.columns)
    channel_columns = columns[9:-7]
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
        raise HTTPException(status_code=404, detail="data.csv 文件不存在")
    df = pd.read_csv(csv_path)
    channels = get_channel_info(df)
    return {"channels": channels, "total_channels": len(channels)}

@app.get("/meta")
def meta():
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

@app.get("/coords")
def coords(limit: Optional[int] = Query(None)):
    if not os.path.exists(os.path.join(DATA_DIR, "data.csv")):
        raise HTTPException(status_code=404, detail="data.csv 文件不存在")
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
    输出 mask atlas (灰度+alpha)，前端用 getColor 染色
    """
    img = open_zarr()
    C, N, H, W, chunks, n_chunks, n_per_chunk = meta_from_img(img)
    chans = sorted(set(int(c) for c in req.channels))
    for c in chans:
        if not (0 <= c < C):
            raise HTTPException(status_code=400, detail=f"channel {c} out of range [0,{C-1}]")
    if len(chans) == 0:
        raise HTTPException(status_code=400, detail="channels must be non-empty")

    cache_payload = {"chunk_id": chunk_id, "channels": chans, "tile": req.tile, "mode": "mask"}
    cache_key = hashlib.sha1(json.dumps(cache_payload, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    cache_path = os.path.join(CACHE_DIR, f"{cache_key}.png")
    if os.path.exists(cache_path):
        headers = {"Cache-Control": "public, max-age=86400", "ETag": cache_key}
        return FileResponse(cache_path, media_type="image/png", headers=headers)

    start = chunk_id * n_per_chunk
    end = min(start + n_per_chunk, N)
    slc = slice(start, end)
    data = np.asarray(img[chans, slc, :, :], dtype=np.float32)
    K, M, Hx, Wx = data.shape

    # 归一化
    t_list = []
    for k in range(K):
        t_list.append(norm01(data[k], data[k].min(), data[k].max(), 1.0))
    t_stack = np.stack(t_list, axis=0)

    # 灰度 + alpha = 平均
    gray = np.mean(t_stack, axis=0)
    alpha = np.mean(t_stack, axis=0)
    mask = np.stack([gray, gray, gray, np.clip(alpha, 0.0, 1.0)], axis=-1)

    atlas_img = tiles_to_atlas(mask, tile=int(req.tile))

    buf = io.BytesIO()
    atlas_img.save(buf, format="PNG")
    data_bytes = buf.getvalue()
    with open(cache_path, "wb") as f:
        f.write(data_bytes)
    headers = {"Cache-Control": "public, max-age=86400", "ETag": cache_key}
    return StreamingResponse(io.BytesIO(data_bytes), media_type="image/png", headers=headers)

# =========================
# 启动
# =========================
if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
