import os
from typing import Dict

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from .config import DATA_DIR, ZARR_DIR
from .zarr_utils import open_zarr, meta_from_img


router = APIRouter()


@router.post("/llm/compute_cluster_channel_avg")
def compute_cluster_channel_avg() -> Dict[str, object]:
    """
    Read from the public directory:
      - output.zarr (shape [C, N, H, W])
      - data.csv (must contain column 'clustering')
      - channel_list.csv (must contain channel_id, channel_name)
    Compute average intensity per cluster for each channel and save to public/cluster_channel_avg.csv.
    Chunk size is read from Zarr metadata (use chunk size along the N dimension).
    """
    try:
        csv_path = os.path.join(DATA_DIR, "data.csv")
        channels_csv = os.path.join(DATA_DIR, "channel_list.csv")
        out_csv = os.path.join(DATA_DIR, "cluster_channel_avg.csv")

        if not os.path.isdir(ZARR_DIR):
            raise FileNotFoundError(f"Zarr directory does not exist: {ZARR_DIR}")
        if not os.path.exists(csv_path):
            raise FileNotFoundError("public/data.csv not found")
        if not os.path.exists(channels_csv):
            raise FileNotFoundError("public/channel_list.csv not found")

        # Remove existing output if present
        try:
            if os.path.exists(out_csv):
                os.remove(out_csv)
        except Exception:
            pass

        # 1) clustering series
        df = pd.read_csv(csv_path, usecols=["clustering"])
        clustering = df["clustering"].to_numpy()
        n_cells = clustering.shape[0]

        # 2) open zarr, read metadata and chunk size
        img = open_zarr()
        C, N, H, W, chunks, n_chunks, n_per_chunk = meta_from_img(img)
        if N != n_cells:
            raise ValueError(f"Zarr N={N} does not match data.csv rows N={n_cells}")

        # 3) prepare clusters
        unique_clusters = np.sort(np.unique(clustering))
        n_clusters = unique_clusters.shape[0]
        cluster_to_idx = {cl: i for i, cl in enumerate(unique_clusters)}

        # Use float64 accumulation to avoid overflow
        sum_pixels_per_cluster_channel = np.zeros((n_clusters, C), dtype=np.float64)
        num_pixels_per_cluster = np.zeros(n_clusters, dtype=np.int64)
        total_pixels_per_image = int(H) * int(W)

        # 4) iterate by N-dimension chunk
        for start in range(0, N, n_per_chunk):
            end = min(start + n_per_chunk, N)
            slc = slice(start, end)
            chunk_clusters = clustering[slc]
            # read (C, M, H, W)
            chunk_data = np.asarray(img[:, slc, :, :])
            # accumulate for clusters appearing in this chunk
            for cl in np.unique(chunk_clusters):
                mask = chunk_clusters == cl
                if not np.any(mask):
                    continue
                idx_cluster = cluster_to_idx[int(cl)]
                selected = chunk_data[:, mask, :, :]
                sum_per_channel = selected.sum(axis=(1, 2, 3))
                sum_pixels_per_cluster_channel[idx_cluster] += sum_per_channel
                num_pixels_per_cluster[idx_cluster] += int(mask.sum()) * total_pixels_per_image

        # 5) averages
        avg_per_cluster_channel = sum_pixels_per_cluster_channel / num_pixels_per_cluster[:, None]

        # 6) column names from channel_list.csv
        ch_df = pd.read_csv(channels_csv)
        ch_df = ch_df.sort_values("channel_id")
        channel_names = ch_df["channel_name"].tolist()
        if len(channel_names) != C:
            raise ValueError(f"Number of channels in channel_list.csv ({len(channel_names)}) "
                             f"does not match channels in Zarr ({C})")

        out_df = pd.DataFrame(avg_per_cluster_channel, columns=channel_names)
        out_df.insert(0, "cluster_id", unique_clusters)
        out_df.insert(0, "level_id", 0)  # single level for now
        out_df.to_csv(out_csv, index=False)

        return JSONResponse(
            {
                "message": "ok",
                "output": os.path.relpath(out_csv, DATA_DIR),
                "n_clusters": int(n_clusters),
                "n_channels": int(C),
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Computation failed: {e}")


