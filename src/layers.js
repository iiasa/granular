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
    defaultVisible: true,
  },
];
