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
    args: [...JSON.parse(process.env.CHROMIUM_ARGS || "[]"), "--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
  await page.addInitScript(() => {
    const stats = window.gpuCounts = { buffers: 0, lines: 0, points: 0, draws: 0, strips: 0, loops: 0, lineSizes: [], pointSizes: [] };
    const prototype = WebGL2RenderingContext.prototype;
    const clear = prototype.clear;
    prototype.clear = function(mask) {
      if (mask & this.COLOR_BUFFER_BIT) { stats.lineSizes = []; stats.pointSizes = []; }
      return clear.call(this, mask);
    };
    const buffer = prototype.createBuffer, draw = prototype.drawArrays;
    prototype.createBuffer = function(...args) { stats.buffers++; return buffer.apply(this,args); };
    prototype.drawArrays = function(mode, first, count) {
      stats.draws++;
      if (mode === this.LINES) stats.lines = Math.max(stats.lines, count / 2);
      if (mode === this.POINTS) { stats.points = Math.max(stats.points, count); stats.pointSizes.push(count); }
      if (mode === this.LINE_STRIP && count === 3) stats.strips++;
      if (mode === this.LINE_LOOP && count === 3) stats.loops++;
      if (mode === this.LINE_STRIP || mode === this.LINE_LOOP) stats.lineSizes.push(count);
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
  assert.ok(await win.locator(".is-general-panel").evaluate(el => el.scrollHeight <= el.clientHeight + 1),
    "all current general options fit in a normally sized geometry window");
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

  const showConstructions = async () => {
    await win.getByRole("button", { name: "Показ", exact: true }).click();
    const flight = win.getByRole("button", { name: "Полёт", exact: true });
    assert.equal(await flight.evaluate(el => el.nextElementSibling.textContent.trim()), "Построения");
    assert.ok(await flight.evaluate(el => getComputedStyle(el).color === getComputedStyle(el.nextElementSibling).color));
    await win.getByRole("button", { name: "Построения", exact: true }).click();
  };
  const file = "input3XX/_constructions.json";
  const panel = page.locator(".geometry-constructions-window");
  const cells = panel.locator(".construction-cell");
  const list = panel.locator(".construction-list");
  const saved = async () => {
    await panel.getByRole("status").waitFor({ state: "hidden" });
    return page.evaluate(async path => JSON.parse(await editorFixture.read(path)).cells, file);
  };
  await showConstructions();
  assert.equal(await page.evaluate(path => editorFixture.exists(path), file), false);
  await panel.getByRole("button", { name: "+ Ячейка" }).click();
  const first = cells.nth(0);
  assert.equal(await first.getByRole("checkbox", { name: "Показ" }).isChecked(), true);
  const addNode = async (cell, values) => {
    const draft = cell.getByRole("form", { name: "Новый узел" });
    if (!await draft.count()) await cell.getByRole("button", { name: "Добавить узел" }).click();
    for (const [i, axis] of ["X", "Y", "Z"].entries()) await draft.getByLabel(axis, { exact: true }).fill(values[i]);
  };
  const draft = first.getByRole("form", { name: "Новый узел" });
  await draft.getByLabel("X").fill("0");
  await draft.getByLabel("Y").fill("0");
  await draft.getByLabel("Z").fill("-");
  assert.deepEqual((await saved())[0].nodes, []);
  const pointFramesBefore = await page.evaluate(() => gpuCounts.pointSizes.filter(n => n === 1).length);
  await draft.getByLabel("Z").fill("0");
  const lastCoordinate = first.getByRole("form", { name: "Узел 1" }).getByLabel("Z");
  assert.ok(await lastCoordinate.evaluate(el => el === document.activeElement));
  assert.equal(await draft.count(), 0);
  await frames();
  assert.ok(await page.evaluate(n => gpuCounts.pointSizes.filter(size => size === 1).length > n, pointFramesBefore),
    "the single completed point reaches WebGL while the last input is still focused");
  assert.deepEqual((await saved())[0].nodes, [[0, 0, 0]]);
  await lastCoordinate.press("End");
  await page.keyboard.type(",0123456789012");
  assert.equal(await lastCoordinate.inputValue(), "0,0123456789012");
  assert.deepEqual((await saved())[0].nodes, [[0, 0, 0.0123456789012]]);

  const normal = await panel.boundingBox();
  // Simulate a previously wide window. Restoring and manual resizing must remain usable.
  await panel.evaluate(el => { el.style.width = "900px"; });
  await panel.getByRole("button", { name: "На всю высоту" }).click();
  const full = await panel.boundingBox();
  assert.ok(full.width < 600 && full.width >= 330 && full.height > normal.height && full.height >= 880);
  const fitsFixed = await lastCoordinate.evaluate(input => {
    const s = getComputedStyle(input), ctx = document.createElement("canvas").getContext("2d");
    ctx.font = s.font;
    return input.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) >= ctx.measureText("-0.012345679").width;
  });
  assert.ok(fitsFixed, "signed F-format input with eight significant digits must fit");
  await panel.getByRole("button", { name: "Восстановить размер" }).click();
  assert.equal(Math.round((await panel.boundingBox()).width), 900);
  assert.equal(Math.round((await panel.boundingBox()).height), Math.round(normal.height));
  await panel.evaluate((el, width) => { el.style.width = width + "px"; }, normal.width);
  assert.deepEqual((await saved())[0].nodes, [[0, 0, 0.0123456789012]]);
  await lastCoordinate.fill("0");
  await lastCoordinate.press("Enter");
  assert.equal(await draft.count(), 1);
  await addNode(first, ["1,5","0","0"]);
  assert.equal(await draft.count(), 0);
  await frames();
  assert.ok(await page.evaluate(() => gpuCounts.lineSizes.includes(2)));
  assert.deepEqual((await saved())[0].nodes, [[0,0,0],[1.5,0,0]]);
  await addNode(first, ["0","2","0"]);
  await page.waitForFunction(() => gpuCounts.strips > 0);
  await panel.getByLabel("Замкнуть").check();
  await page.waitForFunction(() => gpuCounts.loops > 0);
  // The same frame APIs and decimal values have reached WebGL and the task file.
  const xyz = [[0,0,0],[1.5,0,0],[0,2,0]];
  assert.deepEqual((await saved())[0].nodes, xyz);
  await panel.getByLabel("Цвет", { exact: true }).fill("#33cc77");
  await first.locator(".construction-grip").first().dragTo(first.getByRole("form", { name: "Узел 3", exact: true }));
  assert.deepEqual((await saved())[0].nodes, [xyz[1],xyz[2],xyz[0]]);
  await first.getByRole("button", { name: "Удалить узел" }).nth(1).click();
  assert.deepEqual((await saved())[0].nodes, [xyz[1],xyz[0]]);
  await first.getByRole("form", { name: "Узел 1", exact: true }).getByLabel("X").fill("-3,4");
  await first.getByRole("form", { name: "Узел 1", exact: true }).getByLabel("X").press("Enter");

  await panel.getByRole("button", { name: "+ Ячейка" }).click();
  const second = cells.nth(1);
  await addNode(second, ["0","3","2"]);
  await addNode(second, ["0","4","2"]);
  await addNode(second, ["1","4","2"]);
  await panel.getByLabel("Цвет", { exact: true }).fill("#c070e0");
  const lineSizes = () => page.evaluate(() => gpuCounts.lineSizes.slice().sort((a,b) => a-b));
  await win.focus();
  await page.keyboard.press("Control+a");
  await frames();
  assert.deepEqual(await lineSizes(), [2, 3]);
  await second.getByRole("checkbox", { name: "Показ" }).uncheck();
  await frames();
  assert.deepEqual(await lineSizes(), [2]);
  await list.evaluate(el => el.scrollTop = 0);
  await page.waitForFunction(() => document.querySelector(".construction-cell").getAttribute("aria-current") === "true");
  assert.equal(await panel.getByLabel("Цвет", { exact: true }).inputValue(), "#33cc77");
  assert.equal(await panel.getByLabel("Замкнуть").isChecked(), true);
  await first.locator(".construction-grip").first().dragTo(second.locator("form").first());
  const beforeClose = await saved();
  assert.deepEqual(beforeClose.map(cell => cell.nodes), [[[-3.4,0,0],[0,0,0]],[[0,3,2],[0,4,2],[1,4,2]]]);
  assert.deepEqual(beforeClose.map(cell => [cell.closed, cell.color]), [[true,"#33cc77"],[false,"#c070e0"]]);
  assert.deepEqual(beforeClose.map(cell => cell.visible), [true, false]);
  await panel.getByRole("button", { name:"Закрыть", exact:true }).click();
  await frames();
  assert.deepEqual(await lineSizes(), []);
  await showConstructions();
  await frames();
  assert.deepEqual(await lineSizes(), [2]);
  assert.equal(await second.getByRole("checkbox", { name: "Показ" }).isChecked(), false);
  await panel.getByRole("button", { name:"Закрыть", exact:true }).click();
  const canvas = win.locator("canvas");
  async function viewImage() {
    await page.mouse.move(8, 8);
    await frames();
    const box = await canvas.boundingBox();
    return page.screenshot({ clip: { x: Math.ceil(box.x) + 3, y: Math.floor(box.y + box.height) - 116, width: 112, height: 112 } });
  }
  for (const axis of ["X", "Y", "Z"]) {
    await win.focus();
    await page.keyboard.press(axis.toLowerCase());
    const positive = await viewImage();
    await page.keyboard.press("Control+" + axis.toLowerCase());
    const negative = await viewImage();
    assert.ok(!positive.equals(negative), `Ctrl+${axis} must reverse the view`);
    await win.getByRole("button", { name: "Показ", exact: true }).click();
    await win.getByRole("button", { name: "вид по " + axis, exact: true }).click({ modifiers: ["Control"] });
    assert.ok((await viewImage()).equals(negative), `Ctrl+click on the ${axis} button must match the keyboard view`);
  }
  await page.evaluate(() => { editorFixture.setLoaded(false); });
  await page.waitForFunction(() => !appCanvas.isConnected);
  await page.evaluate(() => { editorFixture.setLoaded(true); });
  if (!(await win.isVisible())) await toggle.click();
  await showConstructions();
  await first.getByRole("form", { name:"Узел 2", exact:true }).waitFor();
  assert.deepEqual(await saved(), beforeClose);
  await frames();
  assert.deepEqual(await lineSizes(), [2]);
  await second.getByRole("button", { name: "Построение 2" }).click();
  await panel.getByRole("button", { name: "Удалить", exact:true }).click();
  assert.deepEqual(await saved(), [beforeClose[0]]);
  await panel.getByRole("button", { name: "Удалить", exact:true }).click();
  assert.deepEqual(await saved(), []);
  const external = { ...beforeClose[0], visible: false, color: "#102030" };
  await page.evaluate(([path, cell]) => editorFixture.put(path, JSON.stringify({ version: 1, cells: [cell] })), [file, external]);
  await panel.getByRole("button", { name: "+ Ячейка" }).click();
  await panel.getByRole("button", { name: "Загрузить с диска" }).click();
  await first.getByRole("form", { name:"Узел 2", exact:true }).waitFor();
  assert.deepEqual(await saved(), [external]);
  assert.equal(await first.getByRole("checkbox", { name: "Показ" }).isChecked(), false);
  assert.equal(await panel.getByLabel("Цвет", { exact: true }).inputValue(), external.color);
  assert.equal(await page.evaluate(() => editorFixture.dirty()), false);
  assert.deepEqual(errors, []);
  console.log("PASS construction cells, live WebGL lines, scoped row drag, scroll selection, per-task autosave and reopening");
  console.log("PASS immediate single/last node, in-place editing without spare rows, F-width maximization and restore");
} finally { await browser?.close(); await server.close(); }
