# Rural-typology Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the GRANULAR Typology of Rural Europe (1 km, EPSG:3035, six Level-3 class codes 3111–3132) to the map as a discrete 6-class categorical layer that is visible by default.

**Architecture:** Reuse the already-generalized `scripts/tile_raster.py` unchanged (`--column typology --resampling mode --src-nodata auto`). Register the layer as one config object in `src/layers.js`. Add a single backward-compatible `showCode` flag to the existing categorical path in `src/main.js` so short-term labels lead the legend/tooltip while the parquet keeps the faithful 4-digit codes.

**Tech Stack:** Python (rasterio, pygridmap, pyarrow) for tiling; vanilla ES modules + gridviz / gridviz-parquet + Vite for the web map.

**Testing note:** This repo has no unit-test harness (no test runner in `package.json`, no pytest config). Following the existing project pattern, each task is verified by running concrete commands and inspecting their output, and the end-to-end behaviour is verified in the browser via Playwright MCP. "Verify" steps below are real commands with expected output, not unit tests.

**Reference spec:** `specs/2026-06-11-rural-typology-layer-design.md`

---

## File Structure

- **Reuse (no change)** `scripts/tile_raster.py` — already parameterized by the hemeroby work; this layer needs no tiler change.
- **Create (generated, committed)** `public/data/rural_typology/{1000,2000,5000,10000}m/` — parquet tiles + `info.json` per resolution (produced by running the tiler).
- **Commit (source, for reproducibility)** `data/GRANULAR Typology of Rural Europe/` — the provided source dataset; committed because, like the hemeroby source, it has no public download URL wired into the tiler. `.DS_Store` is git-ignored.
- **Modify** `src/layers.js` — add the `rural_typology` layer entry; flip `hemeroby` to `defaultVisible: false`.
- **Modify** `src/main.js` — add the optional `showCode` flag to the categorical tooltip + legend (default `true`, so hemeroby is unchanged).
- **Regenerate (committed)** `docs/` — `npm run build` output that GitHub Pages serves.

No CSS changes: the categorical legend reuses the existing `.legend-classes` / `.sw` / `.v` / `.lbl` rules in `src/style.css`.

---

## Task 1: Verify the Python environment

**Files:** none committed (`.venv/` is git-ignored).

- [ ] **Step 1: Confirm rasterio/pyarrow/pygridmap import with a working GDAL**

The venv already exists from the hemeroby work. If `.venv/` is missing, recreate it with `python3 -m venv .venv && .venv/bin/pip install -r scripts/requirements.txt`.

Run:

```bash
cd /Volumes/ext1/GitHub/granular
.venv/bin/python -c "import rasterio, pyarrow; from pygridmap import gridtiler_raster; print('rasterio', rasterio.__version__, '| GDAL', rasterio.__gdal_version__)"
```

Expected: a line like `rasterio 1.5.0 | GDAL 3.x.x` with no `dyld`/import errors.

(No commit — environment only.)

---

## Task 2: Inspect the source raster (decision gate)

**Files:** none (read-only).

- [ ] **Step 1: Print the source CRS, resolution, nodata, and unique values**

Run:

```bash
.venv/bin/python - <<'PY'
import rasterio, numpy as np
p = "data/GRANULAR Typology of Rural Europe/Rural Typology.tif"
with rasterio.open(p) as s:
    print("CRS:", s.crs)
    print("size:", s.width, "x", s.height, "| res:", s.res)
    print("dtype:", s.dtypes[0], "| nodata:", s.nodata)
    a = s.read(1, masked=True)
    print("unique:", np.unique(a.compressed()))
PY
```

Expected: `CRS: EPSG:3035`, `res: (1000.0, 1000.0)`, `dtype: uint16 | nodata: 65535.0`, and `unique: [3111 3112 3121 3122 3131 3132]`.

- [ ] **Step 2: Confirm the assumptions hold**

Checklist (all should be true per the spec/README):
- CRS is EPSG:3035 → no `--src-crs` override needed.
- `nodata` is a concrete value (`65535.0`) → `--src-nodata auto` picks it up.
- unique values are exactly the six codes `{3111,3112,3121,3122,3131,3132}`.

If any assumption is violated (unexpected CRS, missing nodata, or values outside the six codes), stop and reconcile with the spec before tiling.

(No commit — read-only.)

---

## Task 3: Generate and commit the rural-typology tiles

**Files:**
- Create: `public/data/rural_typology/{1000,2000,5000,10000}m/` (parquet + `info.json`)
- Add: `data/GRANULAR Typology of Rural Europe/` (source dataset)

- [ ] **Step 1: Tile the rural-typology raster**

Note the quoted source path — it contains spaces.

```bash
.venv/bin/python scripts/tile_raster.py \
  --source "data/GRANULAR Typology of Rural Europe/Rural Typology.tif" \
  --resolutions 1000 2000 5000 10000 \
  --column typology --resampling mode --src-nodata auto \
  --out public/data/rural_typology
```

Expected: `[info] using source NoData = 65535.0`, per-resolution `=== Nm ===` sections, and `[ok] wrote tiles -> .../rural_typology/Nm` for 1000/2000/5000/10000, with no traceback.

- [ ] **Step 2: Verify the output structure and value set**

```bash
echo "--- info.json present per resolution ---"
ls public/data/rural_typology/*/info.json
echo "--- one tile's columns + distinct values ---"
.venv/bin/python - <<'PY'
import glob, pyarrow.parquet as pq, pyarrow.compute as pc
f = sorted(glob.glob("public/data/rural_typology/1000m/**/*.parquet", recursive=True))[0]
t = pq.read_table(f)
print("tile:", f)
print("columns:", t.column_names)
print("distinct typology:", sorted(set(pc.unique(t.column("typology")).to_pylist())))
PY
```

Expected: four `info.json` paths; columns include `typology` (plus the grid's `x`/`y`); distinct values are a subset of `{3111.0, 3112.0, 3121.0, 3122.0, 3131.0, 3132.0}`.

- [ ] **Step 3: Commit the tiles and the source dataset**

`.DS_Store` is git-ignored, so adding the whole source folder is safe.

```bash
git add public/data/rural_typology "data/GRANULAR Typology of Rural Europe"
git commit -m "$(printf 'Add tiled GRANULAR rural-typology data (1/2/5/10 km, EPSG:3035)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 4: Register the rural-typology layer

**Files:**
- Modify: `src/layers.js`

- [ ] **Step 1: Flip the hemeroby default and append the new entry**

In `src/layers.js`, change the existing `hemeroby` entry's `defaultVisible: true` to `defaultVisible: false`. Then add the new object as a third array element, immediately after the `hemeroby` entry's closing `},` and before the closing `];`:

```js
  {
    id: "rural_typology",
    title: "Rural typology",
    subtitle: "GRANULAR Typology of Rural Europe — Nordregio (GRANULAR, 2026)",
    // Discrete classification: each GRANULAR Level-3 code maps to a fixed colour.
    kind: "categorical",
    // 4-digit GRANULAR codes are the raster's native values; the legend/tooltip
    // lead with the short term instead, so suppress the numeric code chip.
    showCode: false,
    resolutions: [
      { res: 10000, url: "data/rural_typology/10000m/" },
      { res: 5000,  url: "data/rural_typology/5000m/" },
      { res: 2000,  url: "data/rural_typology/2000m/" },
      { res: 1000,  url: "data/rural_typology/1000m/" },
    ],
    column: "typology",
    // Three settlement types (open cells / settlements / towns), each split into
    // a peri-rural (lighter) and a peri-urban (darker) variant — 3 hues × 2 shades.
    categories: [
      { v: 3111, label: "Open rural cells",                       color: "#9fcf6e" },
      { v: 3112, label: "Open rural cells in peri-urban areas",   color: "#2e7d32" },
      { v: 3121, label: "Rural settlements in peri-rural areas",  color: "#6fc3c0" },
      { v: 3122, label: "Rural settlements in peri-urban areas",  color: "#1f7a86" },
      { v: 3131, label: "Rural towns in peri-rural areas",        color: "#f3b24d" },
      { v: 3132, label: "Rural towns in peri-urban areas",        color: "#bf5a1b" },
    ],
    unit: "GRANULAR Level-3 rural class",
    description:
      "Territorial typology of rural Europe (GRANULAR Level 3), refining the " +
      "DEGURBA rural classes by K-means clustering on topography, landscape " +
      "modification, built environment, population dynamics and accessibility " +
      "to urban areas. Covers DEGURBA rural cells only.",
    resolutionLabel: "1 km cells · pyramid to 10 km",
    source: {
      label: "Nordregio — GRANULAR (Horizon Europe 101061068)",
      href: "https://cordis.europa.eu/project/id/101061068",
    },
    defaultVisible: true,
  },
```

- [ ] **Step 2: Verify the module parses**

```bash
node --check src/layers.js && echo "layers.js OK"
```

Expected: `layers.js OK` (no syntax error).

- [ ] **Step 3: Commit**

```bash
git add src/layers.js
git commit -m "$(printf 'Register rural-typology layer; default hemeroby off\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 5: Add the `showCode` knob to the categorical renderer

**Files:**
- Modify: `src/main.js`

The categorical tooltip and legend currently always show the numeric value (`${cat.v} — …` in the tooltip, a `.v` chip in the legend). Gate both on `cfg.showCode`, defaulting to `true` so the hemeroby layer (codes 1–7) is unchanged.

- [ ] **Step 1: Make the categorical tooltip respect `showCode`**

In `src/main.js`, find the categorical branch inside `cellInfoHTML` (currently):

```js
      if (isCategorical) {
        const cat = cfg.categories.find((c) => c.v === Math.round(+v));
        return `<strong>${cfg.title}</strong><br/>${
          cat ? `${cat.v} — ${cat.label}` : (+v).toFixed(0)}`;
      }
```

Replace it with:

```js
      if (isCategorical) {
        const cat = cfg.categories.find((c) => c.v === Math.round(+v));
        // showCode defaults to true: show "<code> — <label>". When false, lead
        // with the label alone (the 4-digit GRANULAR codes would just clutter).
        const text = cat
          ? (cfg.showCode === false ? cat.label : `${cat.v} — ${cat.label}`)
          : (+v).toFixed(0);
        return `<strong>${cfg.title}</strong><br/>${text}`;
      }
```

- [ ] **Step 2: Make the categorical legend respect `showCode`**

In `buildLegendCard`, find the categorical branch (currently):

```js
  if (cfg.kind === "categorical") {
    const items = cfg.categories.map((c) => `
      <li>
        <span class="sw" style="background:${c.color}"></span>
        <span class="v">${c.v}</span>
        <span class="lbl">${c.label}</span>
      </li>`).join("");
```

Replace it with:

```js
  if (cfg.kind === "categorical") {
    // showCode defaults to true; when false, omit the numeric class chip so the
    // legend reads as swatch + short term only.
    const items = cfg.categories.map((c) => `
      <li>
        <span class="sw" style="background:${c.color}"></span>
        ${cfg.showCode === false ? "" : `<span class="v">${c.v}</span>`}
        <span class="lbl">${c.label}</span>
      </li>`).join("");
```

- [ ] **Step 3: Verify the module parses**

```bash
node --check src/main.js && echo "main.js OK"
```

Expected: `main.js OK` (no syntax error).

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "$(printf 'Add showCode flag to suppress numeric class chip/prefix\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 6: Verify end-to-end in the browser

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
   - The **Rural typology** checkbox (`#chk-rural_typology`) is **checked**.
   - The **Hemeroby index** checkbox (`#chk-hemeroby`) is **unchecked**.
   - The **Landscape attractiveness** checkbox (`#chk-landscape_attractiveness`) is **unchecked**.
   - The rural-typology legend lists the six short terms (`Open rural cells` … `Rural towns in peri-urban areas`) with **no numeric code chips** and no gradient bar.
3. `browser_take_screenshot` (full page) and visually confirm the map renders rural Europe in the six discrete typology colours (green / teal / amber pairs) over the Positron basemap — coverage is sparse (rural cells only), which is expected.
4. Hover a classified cell and confirm the tooltip reads like `Rural typology` / `Rural settlements in peri-rural areas` (short term only, no code).

Expected: all assertions hold. If the map is blank, check `browser_console_messages` for tile-fetch 404s against `data/rural_typology/<res>m/` and reconcile the URLs/output paths.

- [ ] **Step 3: Stop the dev server**

Stop the background `npm run dev` process.

(No commit — verification.)

---

## Task 7: Build and commit the deployed site

**Files:**
- Regenerate: `docs/` (committed Vite output served by GitHub Pages)

- [ ] **Step 1: Build**

`emptyOutDir: true` wipes and regenerates `docs/`; the spec/plan live in `specs/` and `plans/` so they are unaffected.

```bash
npm run build
```

Expected: a successful Vite build into `docs/`.

- [ ] **Step 2: Verify the new tiles and built entry shipped**

```bash
ls docs/data/rural_typology/*/info.json && test -f docs/index.html && echo "build OK"
```

Expected: four `info.json` paths under `docs/data/rural_typology/` and `build OK`.

- [ ] **Step 3: Commit**

```bash
git add docs
git commit -m "$(printf 'Build docs/ with rural-typology layer\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Done

Branch `rural-typology-layer` now contains: the committed rural-typology tiles + source, the registered categorical layer with `showCode: false`, the `showCode` renderer knob, and a rebuilt `docs/`. Open a PR to `main` when verification (Task 6) passes.
