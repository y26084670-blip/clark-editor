// Actual App, model service and native Chromium OPFS; controlled OS picker.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chooseProjectDisk } from "./browser-project-access.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = process.env.CHECK_OUTPUT || "/tmp/clark-save-warning-check";
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const server = await createServer({ root, cacheDir: `${output}/vite-cache`,
  server: { host: "127.0.0.1", port: 0, hmr: false },
  plugins: [{ name: "save-warning-fixture", configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (req.url !== "/__save-warning") return next();
      res.setHeader("Content-Type", "text/html");
      res.end(await server.transformIndexHtml(req.url, '<html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/test/browser/editorFeatures.fixture.jsx"></script></body></html>'));
    });
  } }],
});
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE,
  headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.setDefaultTimeout(15000);
const errors = [], checks = [];
page.on("pageerror", error => errors.push(error.message));
const check = (name, value) => { assert.ok(value, name); checks.push(name); console.log("PASS", name); };
const save = page.locator(".save-button");
const orange = () => save.evaluate(e => getComputedStyle(e).backgroundColor === "rgb(232, 136, 55)");
const countWrites = () => page.evaluate(() => editorFixture.writes.filter(v => v === "general.txt").length);
async function waitSave(before) {
  await page.waitForFunction(n => editorFixture.writes.filter(v => v === "general.txt").length > n, before);
  await page.waitForFunction(() => !document.querySelector(".save-button")?.disabled);
}
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__save-warning`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.editorFixture?.ready, null, { timeout: 60000 });
  await chooseProjectDisk(page);
  await page.locator("#listProject").selectOption("Project");
  await page.locator("#listTask .listTask-item").filter({ hasText: /^Task$/ }).dblclick();
  await page.waitForFunction(() => editorFixture.model().general && editorFixture.model().elements && editorFixture.model().conrab);
  await page.locator('[data-tab-id="general"]').click();
  check("loaded data uses the normal save background", !await orange());
  await page.evaluate(() => editorFixture.setDirty());
  await save.hover();
  check("editing turns the background orange, including hover", await orange());
  await page.screenshot({ path: `${output}/dirty-save.png` });
  let before = await countWrites();
  await save.click(); await waitSave(before);
  check("successful save clears the warning", !await orange());

  await page.evaluate(() => { editorFixture.setDirty(); editorFixture.failFile("general.txt"); });
  await save.click();
  await page.waitForFunction(() => document.querySelector(".save-button-error:not(:disabled)"));
  check("failed input write preserves the warning", await orange());
  await page.evaluate(() => {
    editorFixture.failFile(null);
    const original = FileSystemFileHandle.prototype.createWritable;
    FileSystemFileHandle.prototype.createWritable = async function (...args) {
      if (this.name === "general.txt") await new Promise(resolve => {
        editorFixture.releaseWrite = () => { FileSystemFileHandle.prototype.createWritable = original; resolve(); };
      });
      return original.apply(this, args);
    };
  });
  before = await countWrites(); await save.click();
  await page.waitForFunction(() => typeof editorFixture.releaseWrite === "function");
  check("saving retains orange while the button is disabled", await save.isDisabled() && await orange());
  await page.evaluate(() => { editorFixture.setDirty(); editorFixture.releaseWrite(); });
  await waitSave(before);
  check("an edit made during saving retains the warning", await orange());
  before = await countWrites(); await save.click(); await waitSave(before);
  check("saving the newest snapshot restores the normal background", !await orange());
  assert.deepEqual(errors, []);
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, errors }, null, 2));
  await browser.close(); await server.close();
}
