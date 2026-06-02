import { layers as layerConfigs } from "./layers.js";
import {
  Map as GvMap,
  GridLayer,
  BackgroundLayer,
  MultiResolutionDataset,
  ShapeColorSizeStyle,
} from "gridviz";
import { TiledParquetGrid } from "gridviz-parquet";

// Build a continuous color ramp: (value) => "rgb(...)". Values outside
// [min,max] are clamped; NaN/undefined returns null so the cell isn't drawn.
function makeRamp([min, max], palette) {
  const stops = palette.map((hex) => {
    const v = hex.replace("#", "");
    return [parseInt(v.slice(0, 2), 16),
            parseInt(v.slice(2, 4), 16),
            parseInt(v.slice(4, 6), 16)];
  });
  const span = max - min;
  return (value) => {
    if (value == null || Number.isNaN(+value)) return null;
    let t = (value - min) / span;
    if (t <= 0) t = 0;
    else if (t >= 1) t = 1;
    const idx = t * (stops.length - 1);
    const i0 = Math.floor(idx);
    const i1 = Math.min(i0 + 1, stops.length - 1);
    const f = idx - i0;
    const [r0, g0, b0] = stops[i0];
    const [r1, g1, b1] = stops[i1];
    return `rgb(${Math.round(r0 + (r1 - r0) * f)},${
      Math.round(g0 + (g1 - g0) * f)},${
      Math.round(b0 + (b1 - b0) * f)})`;
  };
}

// Embed mode: rendered inside an <iframe>. Accepts ?embed=1 to hide the sidebar.
const params = new URLSearchParams(location.search);
const isEmbed = params.get("embed") === "1";
if (isEmbed) {
  document.body.classList.add("embed");
  // The legend normally lives in the sidebar, which embed mode hides. Pull it
  // out of the sidebar and into a floating overlay (styled via .legend-embed)
  // so the legend stays available when the map is embedded in an <iframe>.
  const legendEl = document.getElementById("legend");
  legendEl.classList.add("legend-embed");
  document.body.appendChild(legendEl);
}

// Gridviz reads container.offsetHeight at init. Because the inline <canvas>
// it creates influences layout, we pin the container to the intended viewport
// dimensions ourselves and pass them in explicitly — without this there's a
// feedback loop that grows the canvas unboundedly.
const mapEl = document.getElementById("map");
const sidebarWidth = isEmbed ? 0 : 280;
function sizeMap() {
  mapEl.style.width = `${window.innerWidth - sidebarWidth}px`;
  mapEl.style.height = `${window.innerHeight}px`;
}
sizeMap();

// View centre — central Europe, in EPSG:3035 metres.
const CENTER_X = 4500000;
const CENTER_Y = 3100000;

// Keep the view inside GISCO's EPSG:3035 basemap coverage. Past roughly the
// European extent the LAEA tile grid has no tiles, so the map fills with the
// empty background colour (black) and a few stray pale ocean tiles (white).
// Both zooming out and panning can run off the tiles, so we bound both.
//
// COVERAGE is the box of CRS metres we keep the view within — the region GISCO
// serves usable European basemap for. Its north edge is the grid origin
// (y = 6,000,000, a hard edge); south of ~1,000,000 the tiles turn into empty
// pale (white) desert and then nothing (black), so we stop well above that.
const COVERAGE = { xMin: 1000000, yMin: 1000000, xMax: 8000000, yMax: 5950000 };
const MIN_Z = 10; // closest zoom-in, in metres-per-pixel (smaller = closer)
const DEFAULT_Z = 4000;
// Largest visible span (metres) we allow at full zoom-out — frames ~all of
// Europe. MUST stay below the COVERAGE span in each axis, or the pan bounds
// below would invert at max zoom-out. Height is the tighter limit.
const MAX_VISIBLE_W = 6500000;
const MAX_VISIBLE_H = 4800000;

const viewportW = () => window.innerWidth - sidebarWidth;
const viewportH = () => window.innerHeight;
// The void onset depends on the visible extent (zoom × pixels), so the cap is
// derived from the viewport rather than hard-coded — correct on any screen.
const maxZoomOut = () =>
  Math.min(MAX_VISIBLE_W / viewportW(), MAX_VISIBLE_H / viewportH());

const map = new GvMap(mapEl, {
  x: CENTER_X,
  y: CENTER_Y,
  // On very wide viewports the zoom-out cap is tighter than the default zoom,
  // so start no further out than the cap allows.
  z: Math.min(DEFAULT_Z, maxZoomOut()),
  w: viewportW(),
  h: viewportH(),
  backgroundColor: "#0b0d12",
});

// Clamp zoom, then derive the pan bounds from the *current* zoom so that no view
// edge can cross a COVERAGE edge — i.e. the centre is kept at least half a
// viewport away from each side. Recomputed on resize and after every zoom (zoom
// changes the half-viewport in metres, hence the allowed centre range).
function applyViewLimits() {
  const maxZ = maxZoomOut();
  map.setZoomExtent([MIN_Z, maxZ]);
  // setZoomExtent/setCenterExtent only clamp future gestures, so also pull the
  // current view in if a resize/zoom left it outside the new bounds.
  const z = Math.min(map.getZoom(), maxZ);
  const halfW = (z * viewportW()) / 2;
  const halfH = (z * viewportH()) / 2;
  const ext = [
    COVERAGE.xMin + halfW, COVERAGE.yMin + halfH,
    COVERAGE.xMax - halfW, COVERAGE.yMax - halfH,
  ];
  map.setCenterExtent(ext);
  const v = map.getView();
  const cx = Math.min(Math.max(v.x, ext[0]), ext[2]);
  const cy = Math.min(Math.max(v.y, ext[1]), ext[3]);
  if (z !== v.z || cx !== v.x || cy !== v.y) {
    map.setView(cx, cy, z);
    map.redraw();
  }
}
applyViewLimits();
map.geoCanvas.onZoomEndFun = applyViewLimits;

window.addEventListener("resize", () => {
  sizeMap();
  applyViewLimits();
  map.redraw();
});

// Basemap: Eurostat GISCO OSM Positron in EPSG:3035. Resolutions/origin match
// what gridviz-eurostat's giscoBackgroundLayer() helper uses internally — the
// scheme is web-mercator-style geometry but served in LAEA coords.
const basemap = new BackgroundLayer({
  url: "https://gisco-services.ec.europa.eu/maps/tiles/OSMPositronBackground/EPSG3035/",
  resolutions: Array.from({ length: 19 },
                          (_, i) => 156543.03392804097 * Math.pow(2, -i)),
  origin: [0, 6000000],
});

// Build a GridLayer per configured layer.
const state = new Map();
for (const cfg of layerConfigs) {
  const ramp = makeRamp(cfg.valueDomain, cfg.palette);
  const style = new ShapeColorSizeStyle({
    color: (cell) => ramp(cell[cfg.column]),
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
  const entry = { cfg, style, ramp, enabled: cfg.defaultVisible !== false };
  entry.layer = new GridLayer(mrd, [style], {
    minPixelsPerCell: 2,
    visible: () => entry.enabled,
    cellInfoHTML: (cell) => {
      const v = cell[cfg.column];
      if (v == null || Number.isNaN(+v)) return null;
      return `<strong>${cfg.title}</strong><br/>${(+v).toFixed(2)}`;
    },
  });
  state.set(cfg.id, entry);
}

map.layers = [basemap, ...Array.from(state.values()).map((s) => s.layer)];

// Sidebar UI — checkboxes to toggle each configured layer.
const toggles = document.getElementById("layer-toggles");
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

  // Hand-rolled legend — the built-in ColorLegend expects a d3-style scale,
  // and it's faster to render a static gradient swatch than pull in d3 just
  // for the legend widget.
  const legend = document.createElement("div");
  legend.className = "legend-card";
  const stops = s.cfg.palette.map((c, i) =>
    `${c} ${(i / (s.cfg.palette.length - 1) * 100).toFixed(0)}%`).join(",");

  const [vmin, vmax] = s.cfg.valueDomain;
  const classTicks = (s.cfg.classes ?? []).map((cls) => {
    const pct = ((cls.v - vmin) / (vmax - vmin)) * 100;
    const swatch = s.ramp(cls.v);
    return `
      <li>
        <span class="sw" style="background:${swatch}"></span>
        <span class="v">${cls.v}</span>
        <span class="lbl">${cls.label}</span>
      </li>`;
  }).join("");

  const source = s.cfg.source
    ? `<a href="${s.cfg.source.href}" target="_blank" rel="noopener">${s.cfg.source.label}</a>`
    : "";

  legend.innerHTML = `
    <div class="legend-title">${s.cfg.title}</div>
    <div class="legend-sub">${s.cfg.unit ?? ""}</div>
    <div class="legend-bar" style="background:linear-gradient(to right,${stops})"></div>
    <div class="legend-axis">
      <span>${vmin}</span><span>${vmax}</span>
    </div>
    ${classTicks ? `<ul class="legend-classes">${classTicks}</ul>` : ""}
    ${s.cfg.description ? `<p class="legend-desc">${s.cfg.description}</p>` : ""}
    <div class="legend-meta">
      ${s.cfg.resolutionLabel ? `<span>${s.cfg.resolutionLabel}</span>` : ""}
      ${source}
    </div>
  `;
  document.getElementById("legend").appendChild(legend);
}

map.redraw();
