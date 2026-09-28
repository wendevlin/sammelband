import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const BACKEND = "http://localhost:3000";

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      compilerOptions: {
        // Force runes mode for the project, except for libraries. Can be removed in svelte 6.
        runes: ({ filename }) =>
          filename.split(/[/\\]/).includes("node_modules") ? undefined : true,
      },
      // Pure SPA: the Bun backend serves ../dist/frontend and falls back to
      // index.html for every non-file path (see src/routes/spa.ts).
      adapter: adapter({
        pages: "../dist/frontend",
        assets: "../dist/frontend",
        fallback: "index.html",
        strict: false,
      }),
      // Hashes the inline bootstrap script into a CSP meta tag, so only it may
      // run inline. The backend's CSP header covers everything else.
      csp: { mode: "hash", directives: { "script-src": ["self"] } },
    }),
  ],
  server: {
    host: "0.0.0.0",
    port: 5173,
    // Allow access by MagicDNS name over Tailscale (dev only).
    allowedHosts: [".ts.net"],
    // Same-origin proxy so cookies and the CSRF origin check work without CORS.
    proxy: {
      "/api": { target: BACKEND, changeOrigin: false },
      "/ws": { target: BACKEND.replace("http", "ws"), ws: true, changeOrigin: false },
    },
  },
});
