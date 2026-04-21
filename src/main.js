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
if (isEmbed) document.body.classList.add("embed");

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

const map = new GvMap(mapEl, {
  x: 4500000,
  y: 3100000,
  z: 4000,
  w: window.innerWidth - sidebarWidth,
  h: window.innerHeight,
  backgroundColor: "#0b0d12",
});

window.addEventListener("resize", () => {
  sizeMap();
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
