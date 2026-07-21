import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// https://vite.dev/config/
// SINGLEFILE=1 genera un único index.html autocontenido (todo el JS y CSS
// embebidos), ideal para abrirlo en local o subirlo a cualquier hosting.
const singleFile = process.env.SINGLEFILE === "1";

export default defineConfig({
  base: "./",
  plugins: [react(), ...(singleFile ? [viteSingleFile()] : [])],
  server: {
    host: true,
    port: 5173,
  },
});
