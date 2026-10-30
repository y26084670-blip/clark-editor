import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { examplesAssetsPlugin } from "./scripts/serve-examples-assets.mjs";
import { readFileSync } from "node:fs";

function publishedUpdates() {
  const feed = JSON.parse(readFileSync(new URL("./data/updates/changes.json", import.meta.url), "utf8"));
  const config = JSON.parse(readFileSync(new URL("./public/examples-config.json", import.meta.url), "utf8"));
  // Older open tabs require this field. It is derived, never edited separately;
  // current clients read the installer resource directly on every refresh.
  if (feed.recommendedClark) feed.recommendedClark.installerUrl = config.solverInstallerUrl;
  return JSON.stringify(feed, null, 2) + "\n";
}

export default defineConfig({
  plugins: [solid(), examplesAssetsPlugin(), {
    name: "clark-updates",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== "/updates.json") return next();
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(publishedUpdates());
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "updates.json",
        source: publishedUpdates() });
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
