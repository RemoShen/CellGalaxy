from typing import Optional

import os
import zipfile

from fastapi import APIRouter, File, UploadFile, HTTPException, Request

from .config import DATA_DIR, ZARR_DIR, remove_path
from .zarr_utils import reset_zarr_handle
from .data_utils import generate_json_files, generate_raw_json


router = APIRouter()


def _csv_paths() -> tuple[str, str, str]:
    return (
        os.path.join(DATA_DIR, "data.csv"),
        os.path.join(DATA_DIR, "coords.json"),
        os.path.join(DATA_DIR, "channel_info.json"),
    )


def _raw_paths() -> tuple[str, str]:
    return (
        os.path.join(DATA_DIR, "raw.csv"),
        os.path.join(DATA_DIR, "raw.json"),
    )

def _feat_path() -> str:
    return os.path.join(DATA_DIR, "features.npy")


@router.api_route("/upload/{file_type}", methods=["POST", "DELETE"])
async def upload_or_delete(
    file_type: str, request: Request, file: UploadFile | None = File(None)
):
    if file_type not in ["zarr", "csv", "raw", "feat"]:
        raise HTTPException(status_code=400, detail="Unsupported file type")

    # delete file
    if request.method == "DELETE":
        if file_type == "zarr":
            remove_path(ZARR_DIR)
            reset_zarr_handle()
            return {"message": "Zarr data cleared"}

        if file_type == "csv":
            data_csv, coords_json, channel_json = _csv_paths()
            remove_path(data_csv)
            remove_path(coords_json)
            remove_path(channel_json)
            return {"message": "CSV data cleared"}

        if file_type == "raw":
            raw_csv, raw_json = _raw_paths()
            remove_path(raw_csv)
            remove_path(raw_json)
            return {"message": "Raw CSV data cleared"}
        
        if file_type == "feat":
            remove_path(_feat_path())
            return {"message": "Features cleared"}

    # upload file
    if file is None:
        raise HTTPException(status_code=400, detail="No file provided")

    target_name = (
        file.filename
        if file_type == "zarr"
        else (
            "raw.csv"
            if file_type == "raw"
            else ("features.npy" if file_type == "feat" else "data.csv")
        )
    )
    file_path = os.path.join(DATA_DIR, target_name)

    with open(file_path, "wb") as f:
        content = await file.read()
        f.write(content)

    if file_type == "zarr":
        # unzip and reset Zarr
        remove_path(ZARR_DIR)
        with zipfile.ZipFile(file_path, "r") as zip_ref:
            zip_ref.extractall(DATA_DIR)
        os.remove(file_path)
        reset_zarr_handle()
    elif file_type == "csv":
        await generate_json_files()
    elif file_type == "raw":
        raw_csv, raw_json = _raw_paths()
        try:
            generate_raw_json(raw_csv, raw_json)
        except Exception as e:
            raise HTTPException(
                status_code=500, detail=f"Failed to generate raw.json: {e}"
            )
    elif file_type == "feat":
        # no post-processing for features
        pass

    return {"message": f"{file.filename} uploaded successfully"}


