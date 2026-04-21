"""Tile the landscape-attractiveness GeoTIFF into the gridviz tiled-grid format.

Steps:
  1. Download the source GeoTIFF from Zenodo (if not already local).
  2. Reproject from EPSG:4647 (ETRS89 / UTM 32N) to EPSG:3035 (LAEA Europe),
     the de-facto CRS for pan-European gridded datasets.
  3. For each target resolution, resample and emit a `tiled grid` directory
     (one CSV/parquet per tile + info.json) consumable by gridviz TiledGrid.

Run:
    python scripts/tile_raster.py \
        --resolutions 1000 2000 5000 10000 \
        --format parquet \
        --out data/landscape_attractiveness
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
import urllib.request
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import calculate_default_transform, reproject
from pygridmap import gridtiler_raster

ZENODO_URL = (
    "https://zenodo.org/records/18618619/files/"
    "landscape_attractiveness.tif?download=1"
)
SRC_CRS = "EPSG:4647"
TARGET_CRS = "EPSG:3035"
NODATA = -99.0
ATTR_NAME = "attr"  # column name in the emitted tiles


def _round3(value):
    """modif_fun for tiling_raster — kept at module scope so it's picklable
    when pygridmap spawns a worker pool. Receives a scalar pixel value."""
    return round(float(value), 3)


def download(dest: Path) -> Path:
    if dest.exists():
        print(f"[skip] source exists: {dest}")
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"[download] {ZENODO_URL} -> {dest}")
    urllib.request.urlretrieve(ZENODO_URL, dest)
    return dest


def reproject_to_3035(src_path: Path, dst_path: Path, resolution_m: float) -> Path:
    """Reproject + resample to EPSG:3035 at the requested cell size, snapped to
    a multiple-of-resolution origin so tiles align cleanly."""
    with rasterio.open(src_path) as src:
        transform, width, height = calculate_default_transform(
            src.crs,
            TARGET_CRS,
            src.width,
            src.height,
            *src.bounds,
            resolution=resolution_m,
        )
        # snap origin so the grid aligns with (0,0) + k*resolution
        a, b, c, d, e, f = (transform.a, transform.b, transform.c,
                            transform.d, transform.e, transform.f)
        c = round(c / resolution_m) * resolution_m
        f = round(f / resolution_m) * resolution_m
        transform = rasterio.Affine(a, b, c, d, e, f)

        profile = src.profile.copy()
        profile.update(
            crs=TARGET_CRS,
            transform=transform,
            width=width,
            height=height,
            nodata=NODATA,
            compress="deflate",
        )
        # Intermediate TIFFs are written untiled — tile_size isn't a multiple
        # of 16 in general and gridviz reads from the tiled-grid output, not
        # this scratch file.
        profile.pop("blockxsize", None)
        profile.pop("blockysize", None)
        profile["tiled"] = False
        dst_path.parent.mkdir(parents=True, exist_ok=True)
        with rasterio.open(dst_path, "w", **profile) as dst:
            reproject(
                source=rasterio.band(src, 1),
                destination=rasterio.band(dst, 1),
                src_transform=src.transform,
                src_crs=src.crs,
                dst_transform=transform,
                dst_crs=TARGET_CRS,
                src_nodata=NODATA,
                dst_nodata=NODATA,
                resampling=Resampling.average,
            )
    return dst_path


def tile_one_resolution(
    reprojected_tif: Path,
    out_root: Path,
    resolution_m: int,
    fmt: str,
    tile_size_cell: int,
) -> None:
    """Emit tiled grid files under out_root/<resolution>m/."""
    out_dir = out_root / f"{resolution_m}m"
    out_dir.mkdir(parents=True, exist_ok=True)

    # modif_fun operates on scalar values (not cells) and rounds to keep
    # parquet payloads small. NoData is handled by pygridmap via src.meta.
    rasters = {
        ATTR_NAME: {
            "file": str(reprojected_tif),
            "band": 1,
            "no_data_values": [NODATA],
        }
    }
    gridtiler_raster.tiling_raster(
        rasters=rasters,
        output_folder=str(out_dir),
        crs="3035",
        tile_size_cell=tile_size_cell,
        format=fmt,
        modif_fun=_round3,
        verbose=True,
    )
    print(f"[ok] wrote tiles -> {out_dir}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--resolutions",
        nargs="+",
        type=int,
        default=[1000, 2000, 5000, 10000],
        help="Target resolutions in meters (multi-res pyramid).",
    )
    ap.add_argument("--format", choices=["csv", "parquet"], default="parquet")
    ap.add_argument("--tile-size-cell", type=int, default=128)
    ap.add_argument("--out", default="public/data/landscape_attractiveness")
    ap.add_argument("--source", default=None, help="Local source .tif (skip download)")
    args = ap.parse_args()

    out_root = Path(args.out).resolve()
    out_root.mkdir(parents=True, exist_ok=True)

    src_tif = Path(args.source) if args.source else download(
        Path(tempfile.gettempdir()) / "landscape_attractiveness.tif"
    )

    with tempfile.TemporaryDirectory() as tmp:
        for res in args.resolutions:
            reproj = Path(tmp) / f"reprojected_{res}m.tif"
            print(f"\n=== {res}m ===")
            reproject_to_3035(src_tif, reproj, res)
            tile_one_resolution(
                reproj, out_root, res, args.format, args.tile_size_cell
            )

    print("\nDone. Add each resolution directory as a TiledGrid in src/layers.js.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
