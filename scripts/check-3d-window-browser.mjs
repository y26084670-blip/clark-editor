import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chooseProjectDisk } from "./browser-project-access.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const route = "/__complete-geometry-window";
const appRoute = "/__complete-geometry-editor";
const fixtures = new Map([[route, "completeGeometry"], [appRoute, "editorFeatures"]]);
const server = await createServer({ root, server: { host: "127.0.0.1", port: 0, strictPort: false },
  plugins: [{ name: "complete-geometry-check", configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const fixture = fixtures.get(req.url);
      if (!fixture) return next();
      res.setHeader("Content-Type", "text/html");
      res.end(await server.transformIndexHtml(req.url, '<div id="root"></div><script type="module" src="/test/browser/' + fixture + '.fixture.jsx"></script>'));
    });
  } }] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, headless: true,
    args: ["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    const stats = window.gpuCounts = { buffers: 0, lines: 0, points: 0, draws: 0 };
    const prototype = WebGL2RenderingContext.prototype;
    const buffer = prototype.createBuffer, draw = prototype.drawArrays;
    prototype.createBuffer = function(...args) { stats.buffers++; return buffer.apply(this,args); };
    prototype.drawArrays = function(mode, first, count) {
      stats.draws++;
      if (mode === this.LINES) stats.lines = Math.max(stats.lines, count / 2);
      if (mode === this.POINTS) stats.points = Math.max(stats.points, count);
      return draw.call(this, mode, first, count);
    };
  });
  await page.goto('http://127.0.0.1:' + server.httpServer.address().port + route);
  await page.waitForFunction(() => window.geometryCheck);
  const call = (name, value) => page.evaluate(([n,v]) => window.geometryCheck[n](v), [name,value]);
  const frames = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
  assert.equal(await page.locator("canvas").count(), 0);
  await call("setOpen", true);
  const win = page.locator(".geometry-viewer-window");
  await win.locator("canvas").waitFor();
  await win.getByRole("button", { name:"Общие опции отображения" }).click();
  await win.getByLabel("Линии дискретизации").check();
  await win.getByLabel("Центры и узлы").check();
  await page.waitForFunction(() => gpuCounts.lines === 262160 && gpuCounts.points === 131074);
  await frames();
  console.log("PASS all 262160 line segments and 131074 centres reached WebGL");
  const buffers = await win.locator("canvas").evaluate(c => {
    window.originalCanvas = c; window.originalGL = c.getContext("webgl2");
    return gpuCounts.buffers;
  });
  await call("setOpen", false); await frames();
  assert.equal(await win.isVisible(), false);
  const hiddenDraws = await page.evaluate(() => gpuCounts.draws);
  await frames(); assert.equal(await page.evaluate(() => gpuCounts.draws), hiddenDraws);
  await call("setOpen", true); await frames();
  assert.equal(await win.locator("canvas").evaluate(c => c === originalCanvas && c.getContext("webgl2") === originalGL && !originalGL.isContextLost()), true);
  assert.equal(await page.evaluate(() => gpuCounts.buffers), buffers);
  console.log("PASS close/reopen retains canvas and WebGL buffers; hidden window is idle");
  await call("setOpen", false); await frames();
  await call("resizeGrid", 70000); await call("resizeGrid", 70001); await frames();
  assert.equal(await page.evaluate(() => gpuCounts.buffers), buffers);
  await call("setOpen", true);
  await page.waitForFunction(() => gpuCounts.points === 140002 && gpuCounts.lines === 280016);
  console.log("PASS hidden grid edits render the latest complete geometry on reopen");
  await call("setOpen", false); await call("replaceTask");
  await page.waitForFunction(() => !originalCanvas.isConnected && originalGL.isContextLost());
  console.log("PASS changing tasks releases the old context");
  await call("startPreview");
  await page.waitForFunction(() => window.geometryCheck.diskReads() > 0);
  const preview = page.locator(".task-geometry-preview canvas");
  await preview.waitFor();
  await preview.evaluate(c => { window.previewCanvas = c; });
  await frames(); const reads = await call("diskReads");
  await call("setPreviewOn", false); await frames(); await call("setPreviewOn", true); await frames();
  assert.equal(await call("diskReads"), reads);
  assert.equal(await preview.evaluate(c => c === previewCanvas && !c.getContext("webgl2").isContextLost()), true);
  assert.deepEqual(errors, []);
  console.log("PASS returning to the selected task preview keeps its canvas with zero extra directory reads");

  await page.goto("http://127.0.0.1:" + server.httpServer.address().port + appRoute);
  await page.waitForFunction(() => window.editorFixture?.ready);
  await chooseProjectDisk(page);
  await page.locator("#listProject").selectOption("Project");
  await page.locator("#listTask .task-status-label").filter({ hasText: /^Task$/ }).dblclick();
  await page.waitForFunction(() => editorFixture.task() && editorFixture.model().elements);
  const toggle = page.locator("button.geometry-button");
  await toggle.click(); await win.locator("canvas").waitFor();
  await win.locator("canvas").evaluate(c => { window.appCanvas = c; });
  await toggle.click(); await win.waitFor({ state: "hidden" });
  await toggle.click(); await win.locator("canvas").waitFor();
  assert.equal(await win.locator("canvas").evaluate(c => c === appCanvas && !c.getContext("webgl2").isContextLost()), true);
  assert.deepEqual(errors, []);
  console.log("PASS full Editor loads an OPFS task and restores its canvas via the 3D toolbar button");
} finally { await browser?.close(); await server.close(); }
