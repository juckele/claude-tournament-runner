import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `npm run dev` proxies the API to a local `wrangler dev` (see service/README.md).
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/v1": { target: "http://127.0.0.1:8787", ws: true } } },
  build: { outDir: "dist", sourcemap: true },
});
