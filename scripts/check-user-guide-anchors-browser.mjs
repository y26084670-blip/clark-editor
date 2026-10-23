import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const guide = resolve(root, "docs/user-guide");
const feed = JSON.parse(await readFile(resolve(root, "data/updates/changes.json"), "utf8"));
const links = feed.entries.filter(item => item.category === "interface" && item.detailsUrl);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "application/javascript",
  ".png": "image/png", ".webp": "image/webp" };
const server = createServer(async (req, res) => {
  try {
    const path = resolve(guide, "." + new URL(req.url, "http://localhost").pathname);
    if (!path.startsWith(guide + sep)) throw new Error("Invalid path");
    res.setHeader("Content-Type", types[extname(path)] || "application/octet-stream");
    res.end(await readFile(path));
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  for (const width of [1440, 800, 390]) {
    for (const item of links) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      // Reproduce a cold visit: the compact illustrations arrive after the
      // browser has started following the initial fragment link.
      await page.route(/quickstart-(07|13)\.webp$/, async route => {
        await new Promise(done => setTimeout(done, 300));
        await route.continue();
      });
      const hash = new URL(item.detailsUrl, "https://example.test/").hash;
      await page.goto(`http://127.0.0.1:${server.address().port}/index.html${hash}`);
      assert.ok(await page.locator(".quickstart-compact img").evaluateAll(images =>
        images.every(image => image.getBoundingClientRect().height > 100)), "compact images reserve their height before loading");
      await page.locator(".quickstart-compact img").evaluateAll(images => Promise.all(images.map(image => {
        image.loading = "eager";
        return image.decode();
      })));
      await page.waitForFunction(id => Math.abs(document.getElementById(id).getBoundingClientRect().top - 30) < 2,
        hash.slice(1), { timeout: 10000 });
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px: ${item.title} stays at the fragment target after illustration loading`);
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
