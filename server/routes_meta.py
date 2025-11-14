import os

import pandas as pd
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from .config import DATA_DIR, ZARR_DIR
from .data_utils import get_channel_info, process_coord_row
from .zarr_utils import open_zarr, meta_from_img, grid_for_count, get_default_tile


router = APIRouter()


@router.get("/upload/status")
async def upload_status():
    has_zarr = False
    if os.path.isdir(ZARR_DIR):
        try:
            has_zarr = any(os.scandir(ZARR_DIR))
        except Exception:
            has_zarr = True
    csv_path = os.path.join(DATA_DIR, "data.csv")
    return {
        "zarr": has_zarr,
        "csv": os.path.exists(csv_path),
        "raw": os.path.exists(os.path.join(DATA_DIR, "raw.csv"))
        and os.path.exists(os.path.join(DATA_DIR, "raw.json")),
    }


@router.get("/channels")
async def get_channels():
    csv_path = os.path.join(DATA_DIR, "data.csv")
    if not os.path.exists(csv_path):
        return {"channels": [], "total_channels": 0}
    try:
        df = pd.read_csv(csv_path)
        # try to load zarr image for more precise pixel range estimation
        img = None
        if os.path.isdir(ZARR_DIR):
            try:
                img = open_zarr()
            except Exception:
                img = None
        channels = get_channel_info(df, img)
        return {"channels": channels, "total_channels": len(channels)}
    except Exception:
        return {"channels": [], "total_channels": 0}


@router.get("/meta")
def meta():
    if not os.path.isdir(ZARR_DIR):
        return {"error": "No data loaded", "message": "Please upload zarr data first"}
    try:
        img = open_zarr()
        C, N, H, W, chunks, n_chunks, n_per_chunk = meta_from_img(img)
        rows, cols = grid_for_count(n_per_chunk)
        tile = get_default_tile()
        atlas_w = cols * tile
        atlas_h = rows * tile
        return {
            "C": int(C),
            "N": int(N),
            "H": int(H),
            "W": int(W),
            "dtype": str(img.dtype),
            "chunks": tuple(int(x) for x in img.chunks),
            "n_chunks": int(n_chunks),
            "n_per_chunk": int(n_per_chunk),
            "atlas": {
                "tile": int(tile),
                "cols": int(cols),
                "rows": int(rows),
                "width": int(atlas_w),
                "height": int(atlas_h),
            },
        }
    except Exception as e:
        return {"error": "Failed to load data", "message": str(e)}


@router.get("/coords")
def coords(limit: int | None = Query(None)):
    csv_path = os.path.join(DATA_DIR, "data.csv")
    if not os.path.exists(csv_path):
        return JSONResponse([])
    try:
        df = pd.read_csv(csv_path)
        img = open_zarr()
        C, N, H, W, chunks, n_chunks, n_per_chunk = meta_from_img(img)
        N = min(len(df), N)
        total = N if limit is None else min(N, int(limit))

        out = [
            process_coord_row(df.iloc[idx], idx, n_per_chunk) for idx in range(total)
        ]
        return JSONResponse(out)
    except Exception:
        return JSONResponse([])



