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
    defaultVisible: true,
  },
];
