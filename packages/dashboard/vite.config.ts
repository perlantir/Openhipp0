import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Vite config for @openhipp0/dashboard — the React 19 + Tailwind v4 web UI.
// Output lands in dist/; served by the bridge Gateway's static handler or by
// `vite preview` for local dev.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
