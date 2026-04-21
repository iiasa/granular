import { defineConfig } from "vite";

// GitHub Pages serves the site under /<repo>/ — production builds get that
// base prefix so asset URLs resolve. Dev stays at `/` for simpler local URLs.
// Override with VITE_BASE at build time for custom domains.
export default defineConfig(({ command }) => ({
  base: process.env.VITE_BASE ?? (command === "build" ? "/granular/" : "/"),
  server: {
    port: 8765,
    host: "127.0.0.1",
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
}));
