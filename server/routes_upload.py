from typing import Optional

import os
import zipfile

from fastapi import APIRouter, File, UploadFile, HTTPException, Request

from .config import DATA_DIR, ZARR_DIR, remove_path
from .zarr_utils import reset_zarr_handle
from .data_utils import generate_json_files, generate_raw_json


router = APIRouter()


@router.api_route("/upload/{file_type}", methods=["POST", "DELETE"])
async def upload_or_delete(
    file_type: str, request: Request, file: UploadFile | None = File(None)
):
    if file_type not in ["zarr", "csv", "raw"]:
        raise HTTPException(status_code=400, detail="Unsupported file type")

    # delete file
    if request.method == "DELETE":
        if file_type == "zarr":
            remove_path(ZARR_DIR)
            reset_zarr_handle()
            return {"message": "Zarr data cleared"}

        if file_type == "csv":
            remove_path(os.path.join(DATA_DIR, "data.csv"))
            remove_path(os.path.join(DATA_DIR, "coords.json"))
            remove_path(os.path.join(DATA_DIR, "channel_info.json"))
            return {"message": "CSV data cleared"}

        if file_type == "raw":
            remove_path(os.path.join(DATA_DIR, "raw.csv"))
            remove_path(os.path.join(DATA_DIR, "raw.json"))
            return {"message": "Raw CSV data cleared"}

    # upload file
    if file is None:
        raise HTTPException(status_code=400, detail="No file provided")

    file_path = os.path.join(
        DATA_DIR,
        file.filename
        if file_type == "zarr"
        else ("raw.csv" if file_type == "raw" else "data.csv"),
    )
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
        try:
            generate_raw_json(
                os.path.join(DATA_DIR, "raw.csv"),
                os.path.join(DATA_DIR, "raw.json"),
            )
        except Exception as e:
            raise HTTPException(
                status_code=500, detail=f"Failed to generate raw.json: {e}"
            )

    return {"message": f"{file.filename} uploaded successfully"}



