import os
import shutil


DATA_DIR = "public"

# cache directory (outside of DATA_DIR)
CACHE_DIR = os.path.join(os.getcwd(), ".cache")

# zarr root directory
ZARR_DIR = os.path.join(DATA_DIR, "output.zarr")

# default tile size, will be overridden by Zarr metadata when available
DEFAULT_TILE = 16


os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(CACHE_DIR, exist_ok=True)


def remove_path(path: str) -> None:
    """remove file or directory, silently fail on error"""
    try:
        if os.path.isdir(path):
            shutil.rmtree(path)
        elif os.path.exists(path):
            os.remove(path)
    except FileNotFoundError:
        # ignore if already deleted
        pass
    except Exception as exc:
        # print but don't raise, to avoid affecting main flow
        print(f"failed to remove {path}: {exc}")


def clear_cache_dir() -> None:
    """clear cache directory and recreate it"""
    if os.path.isdir(CACHE_DIR):
        shutil.rmtree(CACHE_DIR)
    os.makedirs(CACHE_DIR, exist_ok=True)


