# GRANULAR webmap

A static webmap for [GRANULAR](https://platform.ruralgranular.eu/) built with
[gridviz](https://github.com/eurostat/gridviz). First layer is the
**Landscape Attractiveness** raster from IIASA
([Zenodo 18618619](https://zenodo.org/records/18618619)); the project is
structured so further pan-European gridded layers can be added by dropping
tiles into `public/data/` and appending to `src/layers.js`.

Published at **https://antosubash.github.io/granular/**.

## Layout

```
.
├── index.html              # Vite entry point
├── vite.config.js          # base path = /granular/ for GH Pages
├── src/
│   ├── main.js             # map init, layer wiring, sidebar UI
│   ├── layers.js           # layer registry — edit this to add new layers
│   └── style.css
├── public/data/            # tiles (served as-is by Vite → copied to dist/)
├── scripts/
│   ├── tile_raster.py      # TIF → EPSG:3035 → gridviz tiled-grid format
│   └── requirements.txt
└── .github/workflows/
    └── deploy.yml          # build + publish to GitHub Pages
```

## 1. Generate tiles from the GeoTIFF

The source raster is ETRS89 / UTM 32N (EPSG:4647) at 1 km. The script
reprojects it to EPSG:3035 (LAEA Europe, the Eurostat standard) and emits a
multi-resolution pyramid — each resolution becomes its own `TiledGrid`.

```bash
uv venv && source .venv/bin/activate
uv pip install -r scripts/requirements.txt

python scripts/tile_raster.py \
    --resolutions 1000 2000 5000 10000 \
    --format parquet
# → public/data/landscape_attractiveness/{1000m,2000m,5000m,10000m}/
```

Tiles are checked into git (small enough) so the GH Pages workflow doesn't
have to re-run the Python pipeline. Re-run the script only when the source
dataset changes.

## 2. Run locally

```bash
npm install
npm run dev
# open http://127.0.0.1:8765
```

`npm run build` produces `dist/` with the base path pinned to `/granular/`
(override with `VITE_BASE=/ npm run build` for a custom domain).

## 3. Add more layers

1. Produce tiles with the same pipeline under
   `public/data/<your-layer>/<res>m/`.
2. Append an entry to `src/layers.js`:

   ```js
   {
     id: "my_layer",
     title: "My layer",
     resolutions: [{ res: 5000, url: "data/my_layer/5000m/" }, ...],
     column: "value",
     valueDomain: [0, 100],
     palette: ["#...", "#..."],
     unit: "…",
   }
   ```

The sidebar toggle and legend wire up automatically. The `url` is relative
to the document — Vite serves `public/` at the site root, so
`data/my_layer/5000m/` resolves correctly in both dev and the GH Pages build.

## 4. Deploy to GitHub Pages

The `.github/workflows/deploy.yml` workflow builds on every push to `main`
and publishes `dist/` via the official Pages actions. One-time setup:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Push to `main`; the workflow runs, and the site goes live at
   `https://<user>.github.io/<repo>/`.

Custom domain? Put it in `public/CNAME` and build with
`VITE_BASE=/ npm run build` (or set `VITE_BASE` as a repo variable).

## 5. Embed in platform.ruralgranular.eu

```html
<iframe
  src="https://antosubash.github.io/granular/?embed=1"
  title="GRANULAR landscape attractiveness"
  width="100%"
  height="640"
  style="border:0"
  loading="lazy"
  referrerpolicy="no-referrer-when-downgrade">
</iframe>
```

`?embed=1` hides the project chrome (sidebar) so only the map surface is
visible — the host page can provide its own layer controls later by posting
messages to the iframe, or by pointing at a per-layer URL.

## Notes

- Source: Hofer, M. (IIASA, 2024). *Landscape Attractiveness – Europe-wide
  Prediction*. [doi:10.5281/zenodo.18618619](https://doi.org/10.5281/zenodo.18618619).
  CC-BY 4.0.
- Model values are an ordinal 0–6 rating (0 = not very aesthetic,
  6 = very naturally aesthetic). NoData = -99 is dropped during tiling.
- CRS for the webmap is EPSG:3035; the basemap is the Eurostat GISCO
  Positron tileset in the same projection.
