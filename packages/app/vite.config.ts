import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the site under /<repo>/ (see .github/workflows/pages.yml).
  base: process.env.BASE_PATH ?? '/',
  // Original resources and samples are served as-is at /samples, /original.
  publicDir: '../../assets',
  server: { host: '0.0.0.0', port: 5173, strictPort: true },
  preview: { port: 4173 },
  // three.js alone is ~500 kB minified; splitting comes later with the UI.
  build: { target: 'es2023', sourcemap: true, chunkSizeWarningLimit: 1000 },
});
