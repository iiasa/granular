"""Tile a single-band GeoTIFF into the gridviz tiled-grid format.

Originally written for the landscape-attractiveness layer; now parameterized so
any single-band raster can be tiled. Steps:

  1. (Optional) download the source GeoTIFF from Zenodo if no --source is given.
  2. Reproject/resample to EPSG:3035 (LAEA Europe) at each target resolution,
     snapped to a multiple-of-resolution origin so tiles align cleanly. When the
     source is already EPSG:3035 this is just a resample to the target cell size.
  3. For each resolution, emit a tiled-grid directory (one parquet/CSV per tile
     + info.json) consumable by gridviz TiledGrid.

Examples:
    # Landscape attractiveness (downloads from Zenodo, continuous, averaged):
    python scripts/tile_raster.py \
        --resolutions 1000 2000 5000 10000 --format parquet \
        --out public/data/landscape_attractiveness

    # Hemeroby index (local source, categorical, majority-class downsampling):
    python scripts/tile_raster.py \
        --source data/GRANULAR-hemeroby_index/data/EU_hemeroby_index_2018_V2.tif \
        --resolutions 1000 2000 5000 10000 \
        --column hemeroby --resampling mode --src-nodata auto \
        --out public/data/hemeroby
"""

from __future__ import annotations

import argparse
import sys
import tempfile
import urllib.request
from pathlib import Path

import rasterio
from rasterio.enums import Resampling
from rasterio.warp import calculate_default_transform, reproject
from pygridmap import gridtiler_raster

ZENODO_URL = (
    "https://zenodo.org/records/18618619/files/"
    "landscape_attractiveness.tif?download=1"
)
TARGET_CRS = "EPSG:3035"

# Emitted nodata sentinel. Always finite and outside every layer's value range,
# so pygridmap's equality-based masking works even when the *source* nodata is
# NaN. Cells equal to this are dropped from the tiles, so the value never
# actually appears in the output.
OUT_NODATA = -9999.0

# Resampling methods we expose. `average` suits continuous fields; `mode`
# (majority class) keeps categorical/ordinal rasters valid when downsampled;
# `near` is a fast nearest-neighbour fallback.
RESAMPLING = {
    "average": Resampling.average,
    "mode": Resampling.mode,
    "near": Resampling.nearest,
}


def _round3(value):
    """modif_fun for tiling_raster — kept at module scope so it's picklable when
    pygridmap spawns a worker pool. Receives a scalar pixel value. 3 decimals is
    plenty for both continuous fields and integer class rasters (mode resampling
    yields integer-valued floats, e.g. 4.0)."""
    return round(float(value), 3)


def _parse_src_nodata(text: str):
    """CLI parser for --src-nodata. Accepts a float, the keyword "nan", or
    "auto" (read the value from the source raster's metadata)."""
    if text == "auto":
        return "auto"
    return float(text)  # also parses "nan"/"inf"


def download(dest: Path) -> Path:
    if dest.exists():
        print(f"[skip] source exists: {dest}")
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"[download] {ZENODO_URL} -> {dest}")
    urllib.request.urlretrieve(ZENODO_URL, dest)
    return dest


def reproject_to_3035(
    src_path: Path,
    dst_path: Path,
    resolution_m: float,
    src_nodata: float,
    resampling: Resampling,
    src_crs: str | None,
) -> None:
    """Reproject + resample to EPSG:3035 at the requested cell size, snapped to a
    multiple-of-resolution origin so tiles align cleanly. When the source is
    already EPSG:3035 this degenerates to a pure resample (no datum change).
    Destination nodata is OUT_NODATA regardless of the source sentinel."""
    with rasterio.open(src_path) as src:
        source_crs = src_crs or src.crs
        transform, width, height = calculate_default_transform(
            source_crs,
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
            nodata=OUT_NODATA,
            compress="deflate",
        )
        # Intermediate TIFFs are written untiled (gridviz reads the tiled-grid
        # output, not this scratch file).
        profile.pop("blockxsize", None)
        profile.pop("blockysize", None)
        profile["tiled"] = False
        dst_path.parent.mkdir(parents=True, exist_ok=True)
        with rasterio.open(dst_path, "w", **profile) as dst:
            reproject(
                source=rasterio.band(src, 1),
                destination=rasterio.band(dst, 1),
                src_transform=src.transform,
                src_crs=source_crs,
                dst_transform=transform,
                dst_crs=TARGET_CRS,
                src_nodata=src_nodata,
                dst_nodata=OUT_NODATA,
                resampling=resampling,
            )


def tile_one_resolution(
    reprojected_tif: Path,
    out_root: Path,
    resolution_m: int,
    fmt: str,
    tile_size_cell: int,
    column: str,
) -> None:
    """Emit tiled grid files under out_root/<resolution>m/."""
    out_dir = out_root / f"{resolution_m}m"
    out_dir.mkdir(parents=True, exist_ok=True)

    rasters = {
        column: {
            "file": str(reprojected_tif),
            "band": 1,
            "no_data_values": [OUT_NODATA],
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
    ap = argparse.ArgumentParser(
        description="Tile a single-band GeoTIFF into the gridviz tiled-grid "
                    "format (EPSG:3035).")
    ap.add_argument("--resolutions", nargs="+", type=int,
                    default=[1000, 2000, 5000, 10000],
                    help="Target resolutions in meters (multi-res pyramid).")
    ap.add_argument("--format", choices=["csv", "parquet"], default="parquet")
    ap.add_argument("--tile-size-cell", type=int, default=128)
    ap.add_argument("--out", default="public/data/landscape_attractiveness")
    ap.add_argument("--source", default=None,
                    help="Local source .tif (skip the Zenodo download).")
    ap.add_argument("--column", default="attr",
                    help="Column name emitted in the tiles.")
    ap.add_argument("--resampling", choices=list(RESAMPLING), default="average",
                    help="Resampling for reprojection and downsampling.")
    ap.add_argument("--src-nodata", type=_parse_src_nodata, default=-99.0,
                    metavar="VALUE",
                    help="Source NoData: a number, 'nan', or 'auto' to read it "
                         "from the source raster (default: -99).")
    ap.add_argument("--src-crs", default=None,
                    help="Override the source CRS (default: read from the file).")
    args = ap.parse_args()

    out_root = Path(args.out).resolve()
    out_root.mkdir(parents=True, exist_ok=True)

    src_tif = Path(args.source) if args.source else download(
        Path(tempfile.gettempdir()) / "landscape_attractiveness.tif"
    )

    if args.src_nodata == "auto":
        with rasterio.open(src_tif) as src:
            src_nodata = src.nodata
        if src_nodata is None:
            print("[error] --src-nodata auto, but the source has no NoData set; "
                  "pass an explicit --src-nodata value.", file=sys.stderr)
            return 2
        print(f"[info] using source NoData = {src_nodata}")
    else:
        src_nodata = args.src_nodata

    resampling = RESAMPLING[args.resampling]

    with tempfile.TemporaryDirectory() as tmp:
        for res in args.resolutions:
            reproj = Path(tmp) / f"reprojected_{res}m.tif"
            print(f"\n=== {res}m ===")
            reproject_to_3035(src_tif, reproj, res, src_nodata, resampling,
                              args.src_crs)
            tile_one_resolution(reproj, out_root, res, args.format,
                                args.tile_size_cell, args.column)

    print("\nDone. Add each resolution directory as a TiledGrid in src/layers.js.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
