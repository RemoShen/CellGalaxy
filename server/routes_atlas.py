from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Body, Request, Response
from fastapi.responses import FileResponse
import os
from .models import AtlasRequest
from .zarr_utils import (
    open_zarr,
    meta_from_img,
    grid_for_count,
    get_default_tile,
    single_cache_path,
    _render_and_cache_atlas,
    _prewarm_channel_async,
)


router = APIRouter()


@router.get("/atlas_uv/{chunk_id}")
def atlas_uv(chunk_id: int, tile: Optional[int] = Query(None)):
    img = open_zarr()
    C, N, H, W, chunks, n_chunks, n_per_chunk = meta_from_img(img)
    if not (0 <= chunk_id < n_chunks):
        raise HTTPException(status_code=404, detail="chunk_id out of range")
    effective_tile = int(tile) if tile is not None else get_default_tile()
    rows, cols = grid_for_count(n_per_chunk)
    width = cols * effective_tile
    height = rows * effective_tile
    uvs = []
    for i in range(n_per_chunk):
        gindex = chunk_id * n_per_chunk + i
        if gindex >= N:
            break
        r = i // cols
        c = i % cols
        x0 = c * effective_tile
        y0 = r * effective_tile
        x1 = x0 + effective_tile
        y1 = y0 + effective_tile
        uvs.append(
            {
                "local_index": int(i),
                "u0": x0 / width,
                "v0": y0 / height,
                "u1": x1 / width,
                "v1": y1 / height,
            }
        )
    return {
        "tile": int(effective_tile),
        "cols": int(cols),
        "rows": int(rows),
        "width": int(width),
        "height": int(height),
        "uv": uvs,
    }


@router.post("/atlas/{chunk_id}")
def atlas(chunk_id: int, req: AtlasRequest = Body(...)):
    img = open_zarr()
    C, N, H, W, chunks, n_chunks, n_per_chunk = meta_from_img(img)
    chans = sorted(set(int(c) for c in req.channels))
    if len(chans) != 1:
        raise HTTPException(
            status_code=400,
            detail="Only single-channel is supported. Use GET /atlas/{chunk_id}?channel=..",
        )
    ch = chans[0]
    if not (0 <= ch < C):
        raise HTTPException(
            status_code=400, detail=f"channel {ch} out of range [0,{C-1}]"
        )

    tile = int(req.tile) if req.tile is not None else get_default_tile()

    # single-channel fixed cache path
    cache_path = single_cache_path(ch, chunk_id, tile)
    etag = f"ch{ch}-chunk{chunk_id}-tile{tile}"
    if os.path.exists(cache_path):
        headers = {"Cache-Control": "public, max-age=604800", "ETag": etag}
        return FileResponse(cache_path, media_type="image/png", headers=headers)

    # render and cache
    _render_and_cache_atlas(img, ch, chunk_id, tile)
    try:
        print(f"Saved atlas cache: {cache_path}")
    except Exception:
        pass
    # prewarm other chunks of the same channel
    _prewarm_channel_async(ch, tile)
    headers = {"Cache-Control": "public, max-age=604800", "ETag": etag}
    return FileResponse(cache_path, media_type="image/png", headers=headers)


@router.get("/atlas/{chunk_id}")
def atlas_get(
    chunk_id: int,
    channel: int = Query(...),
    tile: Optional[int] = Query(None),
    request: Request = None,
):
    img = open_zarr()
    C, N, H, W, chunks, n_chunks, n_per_chunk = meta_from_img(img)
    if not (0 <= channel < C):
        raise HTTPException(
            status_code=400, detail=f"channel {channel} out of range [0,{C-1}]"
        )
    if not (0 <= chunk_id < n_chunks):
        raise HTTPException(status_code=404, detail="chunk_id out of range")

    effective_tile = int(tile) if tile is not None else get_default_tile()
    chans = [int(channel)]
    cache_path = single_cache_path(chans[0], chunk_id, effective_tile)
    etag = f"ch{chans[0]}-chunk{chunk_id}-tile{effective_tile}"

    if os.path.exists(cache_path):
        if request is not None:
            inm = request.headers.get("if-none-match")
            if inm and inm.strip('"') == etag:
                return Response(status_code=304)
        headers = {"Cache-Control": "public, max-age=604800", "ETag": etag}
        return FileResponse(cache_path, media_type="image/png", headers=headers)

    _render_and_cache_atlas(img, chans[0], chunk_id, effective_tile)
    try:
        print(f"Saved atlas cache: {cache_path}")
    except Exception:
        pass
    _prewarm_channel_async(chans[0], effective_tile)
    headers = {"Cache-Control": "public, max-age=604800", "ETag": etag}
    return FileResponse(cache_path, media_type="image/png", headers=headers)


@router.post("/prewarm")
def prewarm(channel: int = Query(...), tile: Optional[int] = Query(None)):
    img = open_zarr()
    C, N, H, W, chunks, n_chunks, n_per_chunk = meta_from_img(img)
    if not (0 <= channel < C):
        raise HTTPException(
            status_code=400, detail=f"channel {channel} out of range [0,{C-1}]"
        )
    effective_tile = int(tile) if tile is not None else get_default_tile()
    _prewarm_channel_async(int(channel), effective_tile)
    return {
        "status": "ok",
        "message": "prewarm started",
        "channel": int(channel),
        "tile": int(effective_tile),
    }



