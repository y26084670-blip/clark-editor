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
      if (mask & this.COLOR_BUFFER_BIT) { stats.lineSizes = []; stats.pointSizes = []; this.canvas.surfaceCounts = []; this.canvas.edgeCounts = []; }
      return clear.call(this, mask);
    };
    const drawElements = prototype.drawElements;
    prototype.drawElements = function(mode, count, ...args) {
      if (mode === this.TRIANGLES && !this.isEnabled(this.SCISSOR_TEST)) this.canvas.surfaceCounts?.push(count);
      return drawElements.call(this, mode, count, ...args);
    };
    const buffer = prototype.createBuffer, draw = prototype.drawArrays;
    prototype.createBuffer = function(...args) { stats.buffers++; return buffer.apply(this,args); };
    prototype.drawArrays = function(mode, first, count) {
      stats.draws++;
      if (mode === this.LINES) { stats.lines = Math.max(stats.lines, count / 2); this.canvas.edgeCounts?.push(count); }
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
  assert.equal(await win.getByRole("checkbox", { name: "Показать начало СК" }).count(), 0);
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

  const general = win.getByRole("button", { name: "Общие опции отображения" });
  const show = win.getByRole("button", { name: "Показ", exact: true });
  const viewportCanvas = win.locator("canvas");
  await general.click();
  const bilinear = win.getByRole("checkbox", { name: "Билинейность" });
  const faces = win.getByRole("checkbox", { name: "Грани", exact: true });
  assert.equal(await bilinear.isChecked(), false);
  const [faceBox, bilinearBox] = await Promise.all([faces.boundingBox(), bilinear.boundingBox()]);
  assert.ok(Math.abs(faceBox.y - bilinearBox.y) < 2 && faceBox.x < bilinearBox.x);
  assert.equal(await bilinear.locator("..").getAttribute("title"),
    "Показ неплоских граней/площадок 'как-есть' или более производительный показ как двух треугольников");
  await faces.check();
  await page.evaluate(async () => {
    const {modelService} = await import("/src/services/modelService.js");
    const {tabRegistry} = await import("/src/services/tabRegistry.js");
    const original = editorFixture.model();
    const set = (key, data) => modelService.setModelPart(tabRegistry.find(s => s.id === key), data);
    const geo = Array.from({length:8}, (_, i) => [i & 1, (i >> 1) & 1, (i >> 2) & 1]);
    geo[7][2] = 2;
    const vector = values => values.map(x => [x]);
    const options = { geoType: 0, dr: vector([0,0,0]), dp: vector([3,5,1]), symVi: vector([0,0,0]),
      symR0: vector([0,0,0]), symLs: 1, symAs: 1, symPs: 1, symTx: 0, symYa: 0, symYl: 0, targ: 0 };
    set("elements", [{ ...original.elements[0], ...options, geo }]);
    set("regions", [{ ...original.regions[0], ...options, geo: [4,5,7,6].map(i => geo[i]), dp: vector([4,6]) }]);
    window.restoreGeometryInputs = () => { set("elements", original.elements); set("regions", original.regions); };
  });
  const fastSurface = () => page.waitForFunction(() => appCanvas.surfaceCounts?.includes(6) && appCanvas.surfaceCounts.includes(36));
  await fastSurface();
  await bilinear.check();
  await page.waitForFunction(() => appCanvas.surfaceCounts?.filter(n => n > 36).length === 2);
  assert.deepEqual(await viewportCanvas.evaluate(c => c.edgeCounts.slice().sort((a,b) => a-b)), [8,24]);
  await general.click();
  await win.focus();
  await page.keyboard.press("Control+z");
  await frames();
  const faceView = await viewportCanvas.boundingBox();
  await viewportCanvas.hover({ position: { x: faceView.width / 2, y: faceView.height / 2 } });
  await win.getByRole("tooltip").filter({hasText: "грань №2"}).waitFor();
  await general.click();
  await bilinear.uncheck(); await fastSurface();
  assert.deepEqual(await viewportCanvas.evaluate(c => c.edgeCounts.slice().sort((a,b) => a-b)), [8,24]);
  await page.evaluate(() => restoreGeometryInputs());
  await faces.uncheck(); await general.click();
  await show.click();
  assert.deepEqual(await win.locator(".is-view-panel button").allTextContents(),
    ["Полёт", "Построения", "Сечение", "Настройка стрелок"]);
  await win.getByRole("button", { name: "Настройка стрелок", exact: true }).click();
  const arrowSettings = win.getByRole("dialog", { name: "Настройка стрелок заданных источников" });
  const position = await arrowSettings.boundingBox();
  await arrowSettings.getByRole("radio", {name:"Объёмные"}).check();
  await arrowSettings.getByRole("slider", {name:"Масштаб длины стрелок плотности тока"}).fill("1");
  assert.deepEqual(await arrowSettings.boundingBox(), position);
  await arrowSettings.getByRole("button", {name:"← Показ"}).click();
  await win.getByRole("button", {name:"Настройка стрелок", exact:true}).click();
  assert.equal(await arrowSettings.getByRole("slider", {name:"Масштаб длины стрелок плотности тока"}).inputValue(), "1");
  await arrowSettings.getByRole("button", {name:"Сбросить длины к ×1"}).click();
  await arrowSettings.getByRole("radio", {name:"Тонкие"}).check();
  await show.click();
  const bounds = await viewportCanvas.boundingBox();
  await viewportCanvas.hover({position:{x:45, y:bounds.height-45}});
  const axesHelp = win.getByRole("tooltip");
  await axesHelp.waitFor();
  const help = await axesHelp.textContent();
  for (const key of ["Ctrl+A","Ctrl+X","Ctrl+Y","Ctrl+Z","Alt+X/Y/Z","Shift+X/Y/Z"])
    assert.ok(help.includes(key));
  console.log("PASS bilinear element and region reach WebGL, only perimeter edges are drawn, arrow settings and axes help work");

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

  }
  for (const modifier of ["Alt", "Shift"]) {
    await win.focus(); await page.keyboard.press("Control+a");
    const initial = await viewImage(), box = await canvas.boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.keyboard.down(modifier);
    await page.keyboard.press("y"); await page.mouse.move(x + 45, y, {steps:6});
    await page.keyboard.up(modifier);
    assert.ok(!(await viewImage()).equals(initial), modifier + " and mouse must rotate the view");
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
