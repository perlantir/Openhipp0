import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Vite config for @openhipp0/dashboard — the React 19 + Tailwind v4 web UI.
// Output lands in dist/; served by the bridge Gateway's static handler or by
// `vite preview` for local dev.
// Dev-mode target for /ws + /health proxying. Override with HIPP0_SERVE_URL
// (e.g. HIPP0_SERVE_URL=http://127.0.0.1:3150 pnpm --filter dashboard dev).
const hipp0Target = process.env['HIPP0_SERVE_URL'] ?? 'http://127.0.0.1:3100';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    proxy: {
      '/ws': { target: hipp0Target, ws: true, changeOrigin: true },
      '/api': { target: hipp0Target, changeOrigin: true },
      // NB: /health is intentionally NOT proxied — the dashboard has a
      // React route at /health, and the browser would otherwise bypass
      // the SPA and see the raw JSON. The Health page fetches /api/health
      // instead (wired as an alias in hipp0 serve).
    },
  },
});
