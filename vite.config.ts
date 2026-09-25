import { defineConfig } from "vite";

const BACKEND = "http://localhost:3000";
const BACKEND_WS = "ws://localhost:3000";

// Same-origin proxy so cookies + CSRF Origin checks work without CORS in dev.
export default defineConfig({
  root: "frontend",
  build: {
    outDir: "../dist/frontend",
    emptyOutDir: true,
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      // All HTTP API routes are under /api; everything else falls through to the
      // SPA (so a direct load of /admin/storage, /albums/:id, etc. serves the app).
      "/api": { target: BACKEND, changeOrigin: false },
      "/ws": { target: BACKEND_WS, ws: true, changeOrigin: false },
    },
  },
});
