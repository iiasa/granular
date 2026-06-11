// Layer registry. Each entry describes one gridviz dataset + how to style it.
// To add a new layer: drop tiles under data/<name>/<res>m/ (with info.json per
// resolution) and append a new object below. The UI + map pick it up
// automatically.

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
    defaultVisible: false,
  },
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
      { v: 3111, label: "Open rural cells",                      color: "#9fcf6e" },
      { v: 3112, label: "Open rural cells in peri-urban areas",  color: "#2e7d32" },
      { v: 3121, label: "Rural settlements in peri-rural areas", color: "#6fc3c0" },
      { v: 3122, label: "Rural settlements in peri-urban areas", color: "#1f7a86" },
      { v: 3131, label: "Rural towns in peri-rural areas",       color: "#f3b24d" },
      { v: 3132, label: "Rural towns in peri-urban areas",       color: "#bf5a1b" },
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
];
