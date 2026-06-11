# Rural-typology layer — design

Date: 2026-06-11
Status: approved

## Goal

Add a third gridviz layer to the map: the **GRANULAR Typology of Rural Europe**
(Nordregio, GRANULAR 2026) — a territorial typology that refines the DEGURBA
rural classes into six Level-3 classes. It is rendered as a **discrete 6-class
categorical** map and becomes the default-visible layer; the existing hemeroby
and landscape-attractiveness layers remain available but unchecked on load.

## Source data

- File: `data/GRANULAR Typology of Rural Europe/Rural Typology.tif`
- Provenance: developed by Nordregio in the GRANULAR project (Horizon Europe,
  grant 101061068). K-means clustering on six indicators (topography, landscape
  modification, built environment, population dynamics, accessibility to urban
  areas) applied independently within each DEGURBA rural Level-2 class. See the
  dataset's `README.txt` and `legend.txt` alongside the GeoTIFF.
- CRS: **EPSG:3035** (ETRS89-extended / LAEA Europe) — confirmed from the file.
  Already the webmap CRS, so the tiler's reproject step degenerates to a
  resample at the target cell size (no datum change).
- dtype: `uint16`; resolution: 1 km cells.
- NoData: `65535` (read from the file via `--src-nodata auto`).
- Values: the GRANULAR Level-3 `CODE`, one of
  `3111, 3112, 3121, 3122, 3131, 3132`. Only DEGURBA rural cells are classified,
  so ~18% of the European grid is valid (the layer is intentionally sparse).

The six classes form a 3×2 structure — three settlement types, each split into a
peri-rural and a peri-urban variant:

| Code | Short term | Group |
|-----:|------------|-------|
| 3111 | Open rural cells | Open cells · peri-rural |
| 3112 | Open rural cells in peri-urban areas | Open cells · peri-urban |
| 3121 | Rural settlements in peri-rural areas | Settlements · peri-rural |
| 3122 | Rural settlements in peri-urban areas | Settlements · peri-urban |
| 3131 | Rural towns in peri-rural areas | Towns · peri-rural |
| 3132 | Rural towns in peri-urban areas | Towns · peri-urban |

## Approach

Reuse the existing pipeline and categorical renderer wholesale — the same
generalization that the hemeroby layer introduced (see
`specs/2026-06-03-hemeroby-layer-design.md`). No new tiling code; one tiny,
backward-compatible renderer knob (`showCode`, below). The work is: generate
tiles, register a layer, regenerate `docs/`.

Rejected alternatives:
- Remapping the 4-digit codes to a 1–6 ordinal during tiling — loses fidelity to
  the source `CODE` in the published parquet for no UI benefit.
- A bespoke renderer for this layer — the categorical path already covers it.

## Changes

### 1. Tile generation — existing pipeline, no code change

```
python scripts/tile_raster.py \
  --source "data/GRANULAR Typology of Rural Europe/Rural Typology.tif" \
  --resolutions 1000 2000 5000 10000 \
  --column typology \
  --resampling mode \
  --src-nodata auto \
  --out public/data/rural_typology
```

- `--resampling mode` (majority class) keeps codes valid in the coarser pyramid
  levels; `_round3` yields integer-valued floats (e.g. `3121.0`).
- `--src-nodata auto` reads `65535` from the GeoTIFF.

Output: `public/data/rural_typology/{1000,2000,5000,10000}m/` — parquet tiles
plus an `info.json` per resolution. Tiles are committed to git (as with the
other layers) so the Pages workflow needn't re-run Python.

### 2. `src/layers.js` — register the new layer

Add a `rural_typology` entry:

- `id: "rural_typology"`, `title: "Rural typology"`,
  `subtitle: "GRANULAR Typology of Rural Europe — Nordregio (GRANULAR, 2026)"`.
- `kind: "categorical"`, `column: "typology"`.
- `resolutions`: the four `data/rural_typology/<res>m/` URLs.
- `categories: [{ v, label, color } × 6]` — codes above as `v`, short terms as
  `label`, palette below.
- `showCode: false` (see §3).
- `unit`, `description`, `resolutionLabel`, `source`
  (`https://cordis.europa.eu/project/id/101061068`), and `defaultVisible: true`.

Flip `hemeroby` to `defaultVisible: false`. (`landscape_attractiveness` is
already `false`.) Result: exactly one opaque raster on load.

Palette — 3 hues × 2 shades (peri-rural lighter, peri-urban darker), tuned for
the light GISCO Positron basemap:

| Code | Color |
|-----:|-------|
| 3111 | `#9fcf6e` |
| 3112 | `#2e7d32` |
| 3121 | `#c9a8e0` |
| 3122 | `#855bb0` |

(312x revised from teal to purple per partner feedback — blues read too close
to water/DEGURBA conventions; yellow was ruled out as it clashes with DEGURBA
urban-centre maps and the 313x ambers.)
| 3131 | `#f3b24d` |
| 3132 | `#bf5a1b` |

### 3. `src/main.js` — `showCode` knob for categorical layers

The faithful raster values are 4-digit GRANULAR codes, but the user wants short
terms to lead the UI. Add one optional, backward-compatible flag so the
categorical renderer can suppress the numeric chip/prefix:

- `cfg.showCode` defaults to `true` (so the hemeroby layer's `1`–`7` chips and
  `"3 — Semi-natural…"` tooltips are unchanged).
- When `false`:
  - **Tooltip:** show `<strong>title</strong><br/>${label}` (short term only),
    omitting the `${v} — ` prefix.
  - **Legend:** render `swatch + label` only, omitting the `.v` code chip.

No other rendering changes; the continuous path is untouched. The data keeps the
true codes (color LUT keys on them; the codes remain in the parquet for anyone
inspecting the tiles).

## Verification

- Confirm `info.json` + ≥1 parquet tile exist for each of the four resolutions;
  spot-check that emitted values are within `{3111,3112,3121,3122,3131,3132}`.
- `npm run dev` (port 8765): rural typology renders in 6 discrete colors; the
  legend lists the six short-term classes with no code chips; tooltips show the
  short term only; the sidebar toggle works; hemeroby and attractiveness are off
  on first load. Capture a screenshot.
- `npm run build` to regenerate the committed `docs/` so the new tiles ship.

## Out of scope

- Re-styling the hemeroby or landscape-attractiveness layers.
- Opacity / blend controls for overlapping layers.
- Basemap, projection, or view-extent changes.
