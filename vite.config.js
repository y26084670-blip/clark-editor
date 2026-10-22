import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { examplesAssetsPlugin } from "./scripts/serve-examples-assets.mjs";
import { readFileSync } from "node:fs";

export default defineConfig({
  plugins: [solid(), examplesAssetsPlugin(), {
    name: "clark-updates",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== "/updates.json") return next();
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(readFileSync(new URL("./data/updates/changes.json", import.meta.url), "utf8"));
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "updates.json",
        source: readFileSync(new URL("./data/updates/changes.json", import.meta.url), "utf8") });
    },
  }, {
    name: "third-party-notices",
    generateBundle() {
      // This project uses .generated as publicDir, so public/ is not copied.
      this.emitFile({ type: "asset", fileName: "third-party-notices.txt",
        source: readFileSync(new URL("./public/third-party-notices.txt", import.meta.url), "utf8") });
    },
  }],
  publicDir: ".generated",
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
});
