import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// root = este directorio (web/). Output → web/dist, consumido por wrangler como assets.
export default defineConfig({
  root: import.meta.dirname,
  base: "/",
  plugins: [preact()],
  build: { outDir: "dist", emptyOutDir: true },
});
