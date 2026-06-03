# Hemeroby-index Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the GRANULAR hemeroby index (human-disturbance intensity, 1 km, EPSG:3035, ordinal classes 1–7) to the map as a discrete 7-class categorical layer that is visible by default.

**Architecture:** Generalize the existing `scripts/tile_raster.py` so any single-band GeoTIFF can be tiled into the gridviz parquet format (parameterized column / resampling / nodata / source CRS). Add a `kind: "categorical"` branch to the renderer in `src/main.js` (value→colour lookup, class-label tooltip, swatch-list legend) alongside the untouched continuous path. Register the new layer as one config object in `src/layers.js`.

**Tech Stack:** Python (rasterio, pygridmap, pyarrow) for tiling; vanilla ES modules + gridviz / gridviz-parquet + Vite for the web map.

**Testing note:** This repo has no unit-test harness (no test runner in `package.json`, no pytest config). Following the existing project pattern, each task is verified by running concrete commands and inspecting their output, and the end-to-end behaviour is verified in the browser via Playwright MCP. "Verify" steps below are real commands with expected output, not unit tests.

**Reference spec:** `specs/2026-06-03-hemeroby-layer-design.md`

---

## File Structure

- **Modify** `scripts/tile_raster.py` — generalize the tiler with CLI flags; keep the existing landscape-attractiveness invocation working.
- **Create (generated, committed)** `public/data/hemeroby/{1000,2000,5000,10000}m/` — parquet tiles + `info.json` per resolution (produced by running the tiler; `.gitignore` keeps `public/data/` tracked on purpose).
- **Commit (source, for reproducibility)** `data/GRANULAR-hemeroby_index/` — the provided source dataset; committed because, unlike the attractiveness layer, it has no public download URL yet.
- **Modify** `src/layers.js` — add the `hemeroby` layer entry; flip `landscape_attractiveness` to `defaultVisible: false`.
- **Modify** `src/main.js` — add the categorical color/tooltip/legend path; extract a `buildLegendCard()` helper.
- **Regenerate (committed)** `docs/` — `npm run build` output that GitHub Pages serves.

No CSS changes: the categorical legend reuses the existing `.legend-classes` / `.sw` / `.v` / `.lbl` rules in `src/style.css` (confirmed present).

---

## Task 1: Create the Python environment

**Files:** none committed (`.venv/` is git-ignored).

- [ ] **Step 1: Create a venv and install the tiling dependencies**

rasterio's binary wheels bundle their own GDAL/PROJ, which sidesteps the currently-broken Homebrew GDAL.

```bash
cd /Volumes/ext1/GitHub/granular
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r scripts/requirements.txt
```

- [ ] **Step 2: Verify rasterio imports with a working GDAL**

Run:

```bash
.venv/bin/python -c "import rasterio, pyarrow; from pygridmap import gridtiler_raster; print('rasterio', rasterio.__version__, '| GDAL', rasterio.__gdal_version__)"
```

Expected: a line like `rasterio 1.x.x | GDAL 3.x.x` with no `dyld`/import errors.

(No commit — environment only.)

---

## Task 2: Generalize the tiler

**Files:**
- Modify: `scripts/tile_raster.py` (full replacement below)

- [ ] **Step 1: Replace `scripts/tile_raster.py` with the parameterized version**

Key changes vs. the original: new `--column`, `--resampling`, `--src-nodata` (accepts a number, `nan`, or `auto` to read the file's own nodata), and `--src-crs` flags; resampling is selectable (used for both reprojection and downsampling); the emitted nodata is a fixed finite sentinel so masking works even when the source nodata is `NaN`; when the source is already EPSG:3035 the reproject step is a pure resample. Defaults reproduce the original landscape-attractiveness behaviour. Unused `os`/`numpy` imports and the dead `SRC_CRS` constant are dropped.

```python
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
```

- [ ] **Step 2: Verify the script parses and exposes the new flags**

Run:

```bash
.venv/bin/python scripts/tile_raster.py --help
```

Expected: usage text listing `--column`, `--resampling {average,mode,near}`, `--src-nodata`, and `--src-crs`, with no syntax/import errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/tile_raster.py
git commit -m "$(printf 'Generalize tile_raster.py for any single-band GeoTIFF\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 3: Inspect the source raster (decision gate)

**Files:** none (read-only).

- [ ] **Step 1: Print the source CRS, resolution, nodata, and value range**

Run:

```bash
.venv/bin/python - <<'PY'
import rasterio, numpy as np
p = "data/GRANULAR-hemeroby_index/data/EU_hemeroby_index_2018_V2.tif"
with rasterio.open(p) as s:
    print("CRS:", s.crs)
    print("size:", s.width, "x", s.height, "| res:", s.res)
    print("dtype:", s.dtypes[0], "| nodata:", s.nodata)
    a = s.read(1, masked=True)
    print("min/max:", float(a.min()), float(a.max()))
    print("unique:", np.unique(a.compressed())[:15])
PY
```

Expected: `CRS: EPSG:3035`, `res: (1000.0, 1000.0)`, integer dtype, a defined `nodata`, and unique values within `1..7`.

- [ ] **Step 2: Confirm the assumptions hold**

Checklist (all should be true, per the spec/README):
- CRS is EPSG:3035 → no `--src-crs` override needed.
- `nodata` is a concrete value (e.g. `0`, `255`, or `nan`) → `--src-nodata auto` will pick it up. If and only if `nodata` prints as `None`, the tiler errors; in that case pass an explicit `--src-nodata <value-outside-1..7>` in Task 4 (the source has no real data outside 1–7, so any out-of-range sentinel works).
- min/max within `1..7`.

If any assumption is violated (e.g. unexpected CRS or values outside 1–7), stop and reconcile with the spec before tiling.

(No commit — read-only.)

---

## Task 4: Generate and commit the hemeroby tiles

**Files:**
- Create: `public/data/hemeroby/{1000,2000,5000,10000}m/` (parquet + `info.json`)
- Add: `data/GRANULAR-hemeroby_index/` (source dataset)

- [ ] **Step 1: Tile the hemeroby raster**

Run (uses the `nodata` confirmed in Task 3 via `auto`):

```bash
.venv/bin/python scripts/tile_raster.py \
  --source data/GRANULAR-hemeroby_index/data/EU_hemeroby_index_2018_V2.tif \
  --resolutions 1000 2000 5000 10000 \
  --column hemeroby --resampling mode --src-nodata auto \
  --out public/data/hemeroby
```

Expected: per-resolution `=== Nm ===` sections and `[ok] wrote tiles -> .../hemeroby/Nm` for 1000/2000/5000/10000, no traceback.

- [ ] **Step 2: Verify the output structure and value range**

Run:

```bash
echo "--- info.json present per resolution ---"
ls public/data/hemeroby/*/info.json
echo "--- one tile's columns + value range ---"
.venv/bin/python - <<'PY'
import glob, pyarrow.parquet as pq, pyarrow.compute as pc
f = sorted(glob.glob("public/data/hemeroby/1000m/**/*.parquet", recursive=True))[0]
t = pq.read_table(f)
print("tile:", f)
print("columns:", t.column_names)
col = t.column("hemeroby")
print("min/max:", pc.min(col).as_py(), pc.max(col).as_py())
PY
```

Expected: four `info.json` paths; columns include `hemeroby` (plus the grid's `x`/`y`); min/max within `1..7`.

- [ ] **Step 3: Commit the tiles and the source dataset**

The source is committed for reproducibility because it has no public download URL yet (unlike the Zenodo-hosted attractiveness source). `data/.DS_Store` is git-ignored.

```bash
git add public/data/hemeroby data/GRANULAR-hemeroby_index
git commit -m "$(printf 'Add tiled hemeroby-index data (1/2/5/10 km, EPSG:3035)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 5: Register the hemeroby layer

**Files:**
- Modify: `src/layers.js`

- [ ] **Step 1: Add the hemeroby entry and flip the attractiveness default**

In `src/layers.js`, change the existing landscape-attractiveness entry's last property from `defaultVisible: true` to `defaultVisible: false`, then add the new object as a second array element. The full `layers` array becomes:

```js
export const layers = [
  {
    id: "landscape_attractiveness",
    title: "Landscape attractiveness",
    subtitle: "Roth et al. (2021) model extended pan-Europe — IIASA, 2024",
    // Multi-resolution pyramid: pixel/cell sizes (m) and URL to each info.json.
    // The order matters — gridviz picks the finest resolution that yields
    // >= minPixelsPerCell screen pixels.
    resolutions: [
      { res: 10000, url: "data/landscape_attractiveness/10000m/" },
      { res: 5000,  url: "data/landscape_attractiveness/5000m/" },
      { res: 2000,  url: "data/landscape_attractiveness/2000m/" },
      { res: 1000,  url: "data/landscape_attractiveness/1000m/" },
    ],
    column: "attr",
    valueDomain: [0, 6], // model output range
    // Sequential palette: low (muted tan) -> high (rich teal/green)
    palette: ["#4a3b2a", "#7a6a3a", "#a89447", "#8ec07c", "#5fbf8f", "#2a9d8f", "#1a6b5a"],
    unit: "Perceived attractiveness rating (0–6)",
    // Ordinal class anchors from the model documentation — rendered below
    // the gradient so users can map colours to concrete categories.
    classes: [
      { v: 0, label: "Not very aesthetic" },
      { v: 1, label: "Low" },
      { v: 2, label: "Moderately low" },
      { v: 3, label: "Moderate" },
      { v: 4, label: "Moderately high" },
      { v: 5, label: "High" },
      { v: 6, label: "Very naturally aesthetic" },
    ],
    resolutionLabel: "1 km cells · pyramid to 10 km",
    source: {
      label: "Hofer, M. (IIASA, 2024) — CC-BY 4.0",
      href: "https://doi.org/10.5281/zenodo.18618619",
    },
    defaultVisible: false,
  },
  {
    id: "hemeroby",
    title: "Hemeroby index",
    subtitle: "Human disturbance intensity, 2018 — GRANULAR (Berchoux, 2026)",
    // Discrete classification: each integer value maps to a fixed colour.
    kind: "categorical",
    resolutions: [
      { res: 10000, url: "data/hemeroby/10000m/" },
      { res: 5000,  url: "data/hemeroby/5000m/" },
      { res: 2000,  url: "data/hemeroby/2000m/" },
      { res: 1000,  url: "data/hemeroby/1000m/" },
    ],
    column: "hemeroby",
    // 1 = most natural … 7 = most artificial. Green -> red "naturalness" ramp.
    categories: [
      { v: 1, label: "Natural (Ahemerob)",                  color: "#1a7a3a" },
      { v: 2, label: "Near-natural (Oligohemerob)",         color: "#5aa84a" },
      { v: 3, label: "Semi-natural (Mesohemerob)",          color: "#9ecb5a" },
      { v: 4, label: "Moderate agriculture (β-euhemerob)",  color: "#e8d24a" },
      { v: 5, label: "Intensive agriculture (α-euhemerob)", color: "#f0a23b" },
      { v: 6, label: "Mixed artificial (Polyhemerob)",      color: "#e0662e" },
      { v: 7, label: "Artificial surfaces (Metahemerob)",   color: "#b51d2a" },
    ],
    unit: "Hemeroby class (1 natural – 7 artificial)",
    description:
      "Degree of human alteration of land cover, from 1 (natural) to 7 " +
      "(artificial), derived from CORINE Land Cover 2018 on the EUROSTAT 1 km grid.",
    resolutionLabel: "1 km cells · pyramid to 10 km",
    source: {
      label: "Berchoux, T. — GRANULAR (Horizon Europe 101061068)",
      href: "https://cordis.europa.eu/project/id/101061068",
    },
    defaultVisible: true,
  },
];
```

- [ ] **Step 2: Verify the module parses**

Run:

```bash
node --check src/layers.js && echo "layers.js OK"
```

Expected: `layers.js OK` (no syntax error).

- [ ] **Step 3: Commit**

```bash
git add src/layers.js
git commit -m "$(printf 'Register hemeroby layer; default attractiveness off\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 6: Add the categorical rendering path

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: Add a categorical color builder next to `makeRamp`**

Insert this function in `src/main.js` immediately after the `makeRamp` function (after its closing `}` on the line before the `// Embed mode:` comment, around line 36):

```js
// For categorical layers: map an integer class value to its fixed colour.
// Values with no matching class (or NaN/undefined) return null so the cell
// isn't drawn.
function makeCategoricalColor(categories) {
  const lut = new Map(categories.map((c) => [c.v, c.color]));
  return (value) => {
    if (value == null || Number.isNaN(+value)) return null;
    return lut.get(Math.round(+value)) ?? null;
  };
}
```

- [ ] **Step 2: Branch the per-layer color + tooltip on `kind`**

Replace the layer-building block — from `for (const cfg of layerConfigs) {` through its closing `}` and `state.set(cfg.id, entry);` (the original lines 149–176) — with:

```js
for (const cfg of layerConfigs) {
  const isCategorical = cfg.kind === "categorical";
  // Categorical layers use a fixed value->colour lookup; continuous layers use
  // a clamped gradient ramp.
  const colorFor = isCategorical
    ? makeCategoricalColor(cfg.categories)
    : makeRamp(cfg.valueDomain, cfg.palette);
  const style = new ShapeColorSizeStyle({
    color: (cell) => colorFor(cell[cfg.column]),
  });

  // MultiResolutionDataset picks the right TiledGrid for the current zoom.
  // Its selection logic walks `resolutions` ascending — finest to coarsest.
  const sorted = cfg.resolutions.slice().sort((a, b) => a.res - b.res);
  const mrd = new MultiResolutionDataset(
    sorted.map((r) => r.res),
    sorted.map((r) => new TiledParquetGrid(map, r.url)),
  );

  // gridviz expects `visible` as a (zoom) => boolean predicate. We track the
  // user's toggle on our own state object and have the predicate read it.
  const entry = { cfg, style, colorFor, enabled: cfg.defaultVisible !== false };
  entry.layer = new GridLayer(mrd, [style], {
    minPixelsPerCell: 2,
    visible: () => entry.enabled,
    cellInfoHTML: (cell) => {
      const v = cell[cfg.column];
      if (v == null || Number.isNaN(+v)) return null;
      if (isCategorical) {
        const cat = cfg.categories.find((c) => c.v === Math.round(+v));
        return `<strong>${cfg.title}</strong><br/>${
          cat ? `${cat.v} — ${cat.label}` : (+v).toFixed(0)}`;
      }
      return `<strong>${cfg.title}</strong><br/>${(+v).toFixed(2)}`;
    },
  });
  state.set(cfg.id, entry);
}
```

- [ ] **Step 3: Extract `buildLegendCard()` and add the categorical legend**

Replace the entire sidebar-UI block — from `// Sidebar UI — checkboxes to toggle each configured layer.` through the end of its `for` loop's closing `}` (the original lines 180–237), but **keep** the final `map.redraw();` line — with the following. This moves legend construction into a helper that branches on `kind`; the continuous branch is the original gradient legend (now reading `s.colorFor` instead of `s.ramp`).

```js
// Build the legend card for one layer. Continuous layers get a gradient bar
// with optional ordinal class anchors; categorical layers get a list of class
// swatches. Reuses the .legend-classes/.sw/.v/.lbl styles for both.
function buildLegendCard(s) {
  const { cfg } = s;
  const legend = document.createElement("div");
  legend.className = "legend-card";

  const source = cfg.source
    ? `<a href="${cfg.source.href}" target="_blank" rel="noopener">${cfg.source.label}</a>`
    : "";
  const meta = `
    <div class="legend-meta">
      ${cfg.resolutionLabel ? `<span>${cfg.resolutionLabel}</span>` : ""}
      ${source}
    </div>`;
  const desc = cfg.description
    ? `<p class="legend-desc">${cfg.description}</p>` : "";

  if (cfg.kind === "categorical") {
    const items = cfg.categories.map((c) => `
      <li>
        <span class="sw" style="background:${c.color}"></span>
        <span class="v">${c.v}</span>
        <span class="lbl">${c.label}</span>
      </li>`).join("");
    legend.innerHTML = `
      <div class="legend-title">${cfg.title}</div>
      <div class="legend-sub">${cfg.unit ?? ""}</div>
      <ul class="legend-classes">${items}</ul>
      ${desc}
      ${meta}`;
    return legend;
  }

  // Continuous: gradient swatch + optional ordinal class anchors.
  const stops = cfg.palette.map((c, i) =>
    `${c} ${(i / (cfg.palette.length - 1) * 100).toFixed(0)}%`).join(",");
  const [vmin, vmax] = cfg.valueDomain;
  const classTicks = (cfg.classes ?? []).map((cls) => `
      <li>
        <span class="sw" style="background:${s.colorFor(cls.v)}"></span>
        <span class="v">${cls.v}</span>
        <span class="lbl">${cls.label}</span>
      </li>`).join("");
  legend.innerHTML = `
    <div class="legend-title">${cfg.title}</div>
    <div class="legend-sub">${cfg.unit ?? ""}</div>
    <div class="legend-bar" style="background:linear-gradient(to right,${stops})"></div>
    <div class="legend-axis">
      <span>${vmin}</span><span>${vmax}</span>
    </div>
    ${classTicks ? `<ul class="legend-classes">${classTicks}</ul>` : ""}
    ${desc}
    ${meta}`;
  return legend;
}

// Sidebar UI — checkboxes to toggle each configured layer, plus a legend card.
const toggles = document.getElementById("layer-toggles");
const legendContainer = document.getElementById("legend");
for (const [id, s] of state) {
  const row = document.createElement("div");
  row.className = "layer-row";
  row.innerHTML = `
    <input type="checkbox" id="chk-${id}" ${s.enabled ? "checked" : ""}/>
    <label for="chk-${id}">
      <strong>${s.cfg.title}</strong>
      <small>${s.cfg.subtitle ?? ""}</small>
    </label>
  `;
  row.querySelector("input").addEventListener("change", (e) => {
    s.enabled = e.target.checked;
    map.redraw();
  });
  toggles.appendChild(row);

  legendContainer.appendChild(buildLegendCard(s));
}
```

- [ ] **Step 4: Verify the module parses**

Run:

```bash
node --check src/main.js && echo "main.js OK"
```

Expected: `main.js OK` (no syntax error).

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "$(printf 'Render categorical layers with class colours + swatch legend\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 7: Verify end-to-end in the browser

**Files:** none (verification).

- [ ] **Step 1: Start the dev server**

Run (in the background):

```bash
npm run dev
```

Expected: Vite serves on `http://127.0.0.1:8765/` (port from `vite.config.js`).

- [ ] **Step 2: Drive the page with Playwright MCP**

Using the Playwright MCP tools:
1. `browser_navigate` to `http://127.0.0.1:8765/`.
2. `browser_snapshot` and confirm in the accessibility tree:
   - The **Hemeroby index** checkbox (`#chk-hemeroby`) is **checked**.
   - The **Landscape attractiveness** checkbox (`#chk-landscape_attractiveness`) is **unchecked**.
   - The legend shows the seven class labels (`Natural (Ahemerob)` … `Artificial surfaces (Metahemerob)`) with no gradient bar for the hemeroby card.
3. `browser_take_screenshot` (full page) and visually confirm the map renders Europe in the seven discrete hemeroby colours over the Positron basemap.
4. Optionally hover a land cell and confirm the tooltip reads like `Hemeroby index` / `3 — Semi-natural`.

Expected: all assertions hold; the screenshot shows a discrete categorical map. If the map is blank, check the browser console (`browser_console_messages`) for tile-fetch 404s against `data/hemeroby/<res>m/` and reconcile the URLs/output paths.

- [ ] **Step 3: Stop the dev server**

Stop the background `npm run dev` process.

(No commit — verification.)

---

## Task 8: Build and commit the deployed site

**Files:**
- Regenerate: `docs/` (committed Vite output served by GitHub Pages)

- [ ] **Step 1: Build**

`emptyOutDir: true` wipes and regenerates `docs/`; the spec/plan live in `specs/` and `plans/` so they are unaffected.

```bash
npm run build
```

Expected: a successful Vite build into `docs/`.

- [ ] **Step 2: Verify the new tiles and built entry shipped**

Run:

```bash
ls docs/data/hemeroby/*/info.json && test -f docs/index.html && echo "build OK"
```

Expected: four `info.json` paths under `docs/data/hemeroby/` and `build OK`.

- [ ] **Step 3: Commit**

```bash
git add docs
git commit -m "$(printf 'Build docs/ with hemeroby layer\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Done

Branch `add-hemeroby-layer` now contains: a generalized tiler, the committed hemeroby tiles + source, the registered categorical layer, the categorical renderer, and a rebuilt `docs/`. Open a PR to `main` when verification (Task 7) passes.
