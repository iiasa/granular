# Hemeroby-index layer — design

Date: 2026-06-03
Status: approved

## Goal

Add a second gridviz layer to the map: the **hemeroby index** (degree of human
alteration of land cover) for Europe. It is rendered as a **discrete 7-class
categorical** map and becomes the default-visible layer; the existing
landscape-attractiveness layer remains available but unchecked on load.

## Source data

- File: `data/GRANULAR-hemeroby_index/data/EU_hemeroby_index_2018_V2.tif`
- Provenance: derived from CORINE Land Cover 2018, reclassified to a hemeroby
  index and resampled onto the EUROSTAT DEGURBA 1 km grid (see
  `data/GRANULAR-hemeroby_index/docs/hemeroby.R`).
- CRS: EPSG:3035 (LAEA Europe) — the DEGURBA grid CRS; to be confirmed against
  the file during implementation. If the source CRS differs, the tiler
  reprojects to EPSG:3035.
- Resolution: 1 km cells.
- Values: ordinal integer classes 1–7 (nodata = NA in the source; the exact
  nodata sentinel is read from the GeoTIFF during tiling).

Class meanings (1 = most natural, 7 = most artificial):

| Value | Class | Description |
|------:|-------|-------------|
| 1 | Ahemerob | Natural |
| 2 | Oligohemerob | Near-natural |
| 3 | Mesohemerob | Semi-natural |
| 4 | β-euhemerob | Moderate agriculture |
| 5 | α-euhemerob | Intensive agriculture |
| 6 | Polyhemerob | Mixed artificial |
| 7 | Metahemerob | Artificial surfaces |

## Approach

Generalize the existing tiling pipeline and extend the existing layer renderer
with a categorical path, rather than duplicating either. One pipeline, one
renderer, two layer *kinds* (continuous and categorical).

Rejected alternatives: duplicating `tile_raster.py` for hemeroby (drift-prone);
a separate hard-coded renderer for the discrete layer (splits the layer system).

## Changes

### 1. `scripts/tile_raster.py` — generalize (keep the existing command working)

Add CLI flags, all with backward-compatible defaults so the original
landscape-attractiveness invocation is unchanged:

- `--column` (default `attr`) — emitted column name.
- `--resampling {average,mode,near}` (default `average`) — resampling used both
  for reprojection and for building the coarser pyramid levels.
- `--nodata` (optional float) — if omitted, read from the source raster.
- `--src-crs` (optional) — if omitted, use the source raster's own CRS.

Behaviour notes:

- When the source is already EPSG:3035, the reproject step degenerates to a
  resample-to-target-resolution with a snapped origin (no datum change).
- Categorical layers use `--resampling mode` and round emitted values to
  integers, so downsampled cells remain valid classes. (Implementation detail:
  provide a picklable module-level integer-rounding `modif_fun`, selected when
  decimals = 0, so it survives pygridmap's worker spawn.)

### 2. Tile generation

Build a throwaway Python venv from `scripts/requirements.txt`. rasterio's wheels
bundle their own GDAL/PROJ, which sidesteps the currently-broken Homebrew GDAL.
Then run:

```
python scripts/tile_raster.py \
  --source data/GRANULAR-hemeroby_index/data/EU_hemeroby_index_2018_V2.tif \
  --resolutions 1000 2000 5000 10000 \
  --column hemeroby \
  --resampling mode \
  --out public/data/hemeroby
```

Output: `public/data/hemeroby/{1000,2000,5000,10000}m/` — parquet tiles plus an
`info.json` per resolution.

### 3. `src/layers.js` — register the new layer

Add a `hemeroby` entry:

- `kind: "categorical"`
- `column: "hemeroby"`
- `resolutions`: the four `public/data/hemeroby/<res>m/` URLs (referenced as
  `data/hemeroby/<res>m/`, matching the existing layer's URL style).
- `categories: [{ v, label, color } × 7]` — the table above, with the palette
  below.
- `defaultVisible: true`.

Flip the existing `landscape_attractiveness` entry to `defaultVisible: false`.

Proposed palette (green = natural → red = artificial; tunable live in-app):

| Value | Color |
|------:|-------|
| 1 | `#1a7a3a` |
| 2 | `#5aa84a` |
| 3 | `#9ecb5a` |
| 4 | `#e8d24a` |
| 5 | `#f0a23b` |
| 6 | `#e0662e` |
| 7 | `#b51d2a` |

### 4. `src/main.js` — add the categorical rendering path

The existing continuous path (ramp, gradient legend) is untouched. For
`kind === "categorical"`:

- **Color:** a value→color lookup built from `categories` (`Math.round` the
  cell value, clamp/miss → not drawn), instead of `makeRamp`.
- **Tooltip (`cellInfoHTML`):** show `"<v> — <label>"`, e.g. `3 — Semi-natural`,
  instead of a 2-decimal number.
- **Legend:** render the swatch list directly from `categories`, reusing the
  existing `.legend-classes` / `.sw` / `.v` / `.lbl` CSS, and skip the gradient
  bar and axis. Extract a small `buildLegendCard()` helper so the continuous and
  categorical legend shapes each read cleanly.

## Verification

- Confirm `info.json` + at least one parquet tile exist for each of the four
  resolutions; spot-check that emitted values fall in 1–7.
- `npm run dev` (port 8765), load the map and confirm: hemeroby renders in 7
  discrete colors; the legend shows the class list; tooltips show class labels;
  the sidebar toggle works; attractiveness is off on first load. Capture a
  screenshot via Playwright MCP.
- `npm run build` to regenerate `docs/` (which is the deployed site and the
  committed home of the existing layer's tiles), so the new tiles ship too.

## Out of scope

- Re-styling the existing landscape-attractiveness layer.
- Opacity / blend controls for overlapping layers.
- Basemap, projection, or view-extent changes.
