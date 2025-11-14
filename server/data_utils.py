import json
import os
from typing import Any, List, Dict

import numpy as np
import pandas as pd

from .config import DATA_DIR, ZARR_DIR
from .zarr_utils import open_zarr, meta_from_img, stable_label


def _to_native(val: Any) -> Any:
    """convert numpy/pandas scalar to native Python type, for JSON serialization"""
    try:
        import numpy as _np

        if isinstance(val, (_np.generic,)):
            return val.item()
    except Exception:
        pass
    if isinstance(val, (pd.Timestamp,)):
        return val.isoformat()
    if isinstance(val, (float, int, str, bool)) or val is None:
        return val
    try:
        return json.loads(json.dumps(val))
    except Exception:
        return str(val)


def _parse_col_descriptor(name: str):
    """parse descriptor from column name, e.g. 'CD3 (marker: T cells)'"""
    s = str(name or "").strip()
    desc = None
    base = s
    if "(" in s and ")" in s and s.rfind("(") < s.rfind(")"):
        l = s.rfind("(")
        r = s.rfind(")")
        desc = s[l + 1 : r].strip()
        base = s[:l].strip()
    return base if base else s, (desc or None)


def _is_categorical(desc: str, series: pd.Series) -> bool:
    """infer if the column is categorical based on description and data type"""
    if desc and ":" in desc:
        return True
    try:
        from pandas.api import types as ptypes

        if ptypes.is_numeric_dtype(series):
            return False
    except Exception:
        pass
    return True


def generate_raw_json(raw_csv_path: str, out_path: str) -> None:
    """read raw CSV and write array JSON to `out_path`.

    output format:
      [ {"schema": [{name, rawName, type, description}]}, {"id":.., "raw": {...}}, ... ]
    """
    if not os.path.exists(raw_csv_path):
        return
    df = pd.read_csv(raw_csv_path)
    cols = list(df.columns)
    id_col = "id" if "id" in cols else ("ID" if "ID" in cols else None)

    # build schema
    schema = []
    for c in cols:
        if c == id_col:
            continue
        base, desc = _parse_col_descriptor(c)
        ctype = "categorical" if _is_categorical(desc, df[c]) else "numeric"
        schema.append(
            {
                "name": base,
                "rawName": c,
                "type": ctype,
                "description": desc or "",
            }
        )

    items: List[Dict[str, Any]] = []
    for idx, row in df.iterrows():
        rid = (
            int(_to_native(row[id_col]))
            if id_col is not None and not pd.isna(row[id_col])
            else int(idx)
        )
        raw_map = {}
        for c in cols:
            if c == id_col:
                continue
            raw_map[c] = _to_native(row[c])
        items.append({"id": rid, "raw": raw_map})

    data = [{"schema": schema}] + items
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def process_coord_row(row: pd.Series, idx: int, n_per_chunk: int) -> Dict[str, Any]:
    """process a single coordinate row"""
    x_raw = float(row.get("X_centroid", 0))
    y_raw = float(row.get("Y_centroid", 0))
    return {
        "id": idx,
        "chunk_id": int(idx // n_per_chunk),
        "local_index": int(idx % n_per_chunk),
        "raw": {"x": x_raw, "y": y_raw, "z": 0},
        "umap2d": {
            "x": float(row.get("umap2_x", x_raw)),
            "y": float(row.get("umap2_y", y_raw)),
            "z": 0,
        },
        "umap3d": {
            "x": float(row.get("umap3_x", x_raw)),
            "y": float(row.get("umap3_y", y_raw)),
            "z": float(row.get("umap3_z", 0)),
        },
        "label": int(row.get("label", stable_label(idx))),
    }


def get_channel_info(df: pd.DataFrame, img=None):
    """extract channel information from DataFrame / Zarr"""
    columns = list(df.columns)
    channel_columns = columns[9:]  # columns after the 9th are channels
    channels = []
    for i, col_name in enumerate(channel_columns):
        # prefer Zarr image statistics pixel range, otherwise fallback to DataFrame numeric range
        if img is not None:
            channel_data = img[i, :, :, :]
            sorted_pixels = np.sort(channel_data.flatten())
            total_pixels = len(sorted_pixels)
            min_idx = 0
            max_idx = total_pixels - 1
            min_value = float(sorted_pixels[min_idx])
            max_value = float(sorted_pixels[max_idx])
        else:
            series = df[col_name]
            min_value = float(series.min())
            max_value = float(series.max())
        channels.append(
            {
                "id": i,
                "name": col_name,
                "column_index": i + 9,
                "pixel_value_range": {"min": min_value, "max": max_value},
            }
        )
    return channels


async def generate_json_files() -> None:
    """generate coords.json and channel_info.json from data.csv"""
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
                print(f"Zarr read failed: {str(e)}")
        if img is not None:
            C, N, H, W, chunks, n_chunks, n_per_chunk = meta_from_img(img)
            N = min(len(df), N)
        else:
            N = len(df)
            n_per_chunk = 1
            n_chunks = N
        coords = [process_coord_row(df.iloc[idx], idx, n_per_chunk) for idx in range(N)]
        channels = get_channel_info(df, img)
        with open(os.path.join(DATA_DIR, "coords.json"), "w", encoding="utf-8") as f:
            json.dump(coords, f, ensure_ascii=False, indent=2)
        with open(
            os.path.join(DATA_DIR, "channel_info.json"), "w", encoding="utf-8"
        ) as f:
            json.dump(
                {"channels": channels, "total_channels": len(channels)},
                f,
                ensure_ascii=False,
                indent=2,
            )
        print(
            f"Generated JSON files: coords.json ({len(coords)} points), "
            f"channel_info.json ({len(channels)} channels)"
        )
    except Exception as e:
        print(f"Generated JSON files failed: {str(e)}")


__all__ = [
    "generate_raw_json",
    "process_coord_row",
    "get_channel_info",
    "generate_json_files",
]


