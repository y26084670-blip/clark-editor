// Actual App, WebGL, raycaster and OPFS. The OS directory picker is supplied
// by the existing fixture; native Windows permission dialogs are not covered.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chooseProjectDisk } from "./browser-project-access.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const output = process.env.CHECK_OUTPUT || "/tmp/contact-element-browser";
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const server = await createServer({ root, cacheDir: `${output}/vite-cache`, server: { host: "127.0.0.1", port: 0 }, plugins: [{ name: "contact-fixture", configureServer(server) {
  server.middlewares.use(async (req, res, next) => {
    if (req.url?.split("?")[0] !== "/__contact") return next();
    res.setHeader("Content-Type", "text/html");
    res.end(await server.transformIndexHtml(req.url, '<html><body><div id="root"></div><script type="module" src="/test/browser/editorFeatures.fixture.jsx"></script></body></html>'));
  });
} }] });
await server.listen();
const profile = await mkdtemp(resolve(tmpdir(), "contact-browser-"));
const browser = await chromium.launchPersistentContext(profile, { executablePath: process.env.CHROMIUM_EXECUTABLE, headless: true,
  viewport: { width: 1500, height: 1050 }, args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage(); page.setDefaultTimeout(15000);
const errors = []; page.on("pageerror", e => errors.push(e.message));
const pass = label => console.log("PASS", label);
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__contact`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => window.editorFixture?.ready);
  await chooseProjectDisk(page); await page.locator("#listProject").selectOption("Project");
  await page.locator("#listTask .listTask-item").filter({ hasText: /^Task$/ }).dblclick();
  await page.waitForFunction(() => editorFixture.model().elements);
  await page.evaluate(async () => {
    const { modelService } = await import("/src/services/modelService.js");
    const { dataService } = await import("/src/services/dataService.js");
    const { default: schema } = await import("/src/services/schemas/elements.schema.js");
    const conductor = { ...dataService.createDefaultRecord(schema), name: "Проводник", geoType: 2,
      geo: [[10,12,14], ...Array.from({ length: 7 }, () => [0,0,0])], dp: [[2],[3],[4]], rv: 1, targ: 0 };
    modelService.setModelPart(schema, [conductor]);
  });
  await page.locator(".tabs-header button").filter({ hasText: /^Элементы$/ }).click();
  await page.getByRole("button", { name: "Открыть дополнительные функции", exact: true }).click();
  await page.locator(".side-panel").getByRole("button", { name: "Контактное возбуждение", exact: true }).click();
  const panel = page.locator(".contact-element-dialog"); await panel.waitFor();
  assert.equal(await panel.locator("input").count(), 4);
  const thickness = panel.getByLabel("Толщина контактного элемента, мм", { exact: true });
  const current = panel.getByLabel("Нормальная плотность тока, А/мм²", { exact: true });
  const add = panel.getByRole("button", { name: "Добавить элемент", exact: true });
  // Typing (not just fill) reproduces the former valueAsNumber feedback bug.
  for (const [input, text] of [[thickness, "0.05"], [thickness, "0,02"], [current, "-0.25"], [current, "-.5E-2"]]) {
    await input.fill(""); let prefix = "";
    for (const char of text) {
      await input.pressSequentially(char); prefix += char;
      assert.equal(await input.inputValue(), prefix);
    }
    assert.equal(await add.isEnabled(), true);
  }
  await current.fill("1e-"); assert.equal(await add.isEnabled(), false);
  await current.pressSequentially("3"); assert.equal(await current.inputValue(), "1e-3");
  assert.equal(await add.isEnabled(), true);
  await current.fill("-0.25"); await current.press("ArrowLeft"); await current.press("Backspace");
  assert.equal(await current.inputValue(), "-0.5");
  await current.pressSequentially("3"); assert.equal(await current.inputValue(), "-0.35");
  await current.fill(""); assert.equal(await add.isEnabled(), false);
  await thickness.fill("0.2"); await current.fill("3");
  pass("keystrokes preserve decimal separators, sign, exponent, intermediate text and caret edits");
  await page.screenshot({ path: `${output}/contact-panel.png` });
  await panel.getByRole("button", { name: "Добавить элемент", exact: true }).click();
  await page.waitForFunction(() => editorFixture.model().elements.length === 2);
  const model = await page.evaluate(() => editorFixture.model());
  assert.equal(model.elements[0].med[0][0], 2); assert.equal(model.elements[1].med[1][0], 1);
  assert.deepEqual(model.elements[1].dp, [[1],[1],[1]]); assert.deepEqual(model.mhj[0].v, [[0,-3,0]]);
  await panel.getByRole("status").filter({ hasText: "Добавлен контактный элемент №2" }).waitFor();
  assert.equal(await panel.getByRole("alert").count(), 0);
  pass("four-field panel creates a full-face J-const contact with reciprocal MED and signed normal MHJ");
  await panel.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.evaluate(async () => { const { modelService } = await import("/src/services/modelService.js"); modelService.undo("mhj"); });
  await page.waitForFunction(() => editorFixture.model().elements.length === 1);
  assert.equal((await page.evaluate(() => editorFixture.model())).elements[0].med[0][0], 0);
  await page.evaluate(async () => { const { modelService } = await import("/src/services/modelService.js"); modelService.redo("elements"); });
  await page.waitForFunction(() => editorFixture.model().elements.length === 2);
  pass("one Undo/Redo restores both elements, MED and sources through the real model service");

  await page.getByRole("button", { name: "Открыть 3D-просмотр геометрии", exact: true }).click();
  await page.getByRole("button", { name: "Общие опции отображения", exact: true }).click();
  const faces = page.getByLabel("Грани", { exact: true }); assert.equal(await faces.isChecked(), false);
  const labels = await faces.locator("..").evaluate(el => [el.previousElementSibling.textContent.trim(), el.nextElementSibling.textContent.trim()]);
  assert.deepEqual(labels, ["Ортогональный вид", "Рёбра"]);
  await faces.check(); await page.getByRole("button", { name: "Общие опции отображения", exact: true }).click();
  const canvas = page.locator(".geometry-viewer-canvas-region .three-geometry-viewport canvas").first();
  await canvas.waitFor(); const bounds = await canvas.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2 + 2, bounds.y + bounds.height / 2 + 2);
  const tooltip = page.locator(".geometry-viewport-tooltip");
  await tooltip.filter({ hasText: /грань №[1-6]/ }).waitFor();
  await page.screenshot({ path: `${output}/face-tooltip.png` });
  await page.getByRole("button", { name: "Общие опции отображения", exact: true }).click(); await faces.uncheck();
  await page.getByRole("button", { name: "Общие опции отображения", exact: true }).click();
  await page.mouse.move(bounds.x + bounds.width / 2 + 4, bounds.y + bounds.height / 2 + 4);
  await tooltip.waitFor(); await page.waitForFunction(() => !document.querySelector(".geometry-viewport-tooltip")?.textContent.includes("грань №"));
  pass("Faces defaults off after Orthographic; real surface hover adds/removes its MED face number");

  const rayResult = await page.evaluate(async () => {
    const THREE = await import("/node_modules/three/build/three.module.js");
    const { buildGeometryScene } = await import("/src/services/visualization/geometrySceneModel.js");
    const { createGeometryObjects } = await import("/src/components/geometry/ThreeGeometryViewport.jsx");
    const { geometryHitFace } = await import("/src/services/visualization/geometryPicking.js");
    const { physicalHex } = await import("/src/services/solver/medContactGeometry.js");
    const { applyMatrix4ToPoint } = await import("/src/services/solver/rotation3d.js");
    const source = editorFixture.model().elements[0];
    const input = { general: { mirrorSymmetryX: 0, mirrorSymmetryY: 1 }, elements: [{ ...source,
      symVi: [[17],[29],[41]], symR0: [[50],[60],[70]], symLs: 2, symYl: 180, symPs: 2, symTx: 200 }] };
    const scene = buildGeometryScene(input), objects = [], failures = []; let count = 0;
    createGeometryObjects(THREE, scene, {}, "solid", false, 100, (object, primitive, instances) => {
      objects.push(object); object.updateMatrixWorld(true);
      for (const instance of instances) {
        const points = Array.from({ length: 8 }, (_, i) => applyMatrix4ToPoint(instance.matrix, Array.from(primitive.vertices.slice(i * 3, i * 3 + 3))));
        const hex = physicalHex(points, 1e-8);
        for (const face of hex.faces) {
          const normal = new THREE.Vector3(...face.normal), center = new THREE.Vector3(...face.center);
          const ray = new THREE.Raycaster(center.clone().addScaledVector(normal, 0.01), normal.negate());
          const hit = ray.intersectObject(object, false)[0];
          if (geometryHitFace(hit) !== face.index + 1) failures.push({ expected: face.index + 1, actual: geometryHitFace(hit), instance });
          count++;
        }
      }
    });
    for (const object of objects) { object.geometry.dispose(); object.material.dispose(); }
    return { count, failures };
  });
  assert.deepEqual(rayResult.failures, []); assert.ok(rayResult.count >= 48);
  pass(`${rayResult.count} actual Three.js ray hits resolve all six faces through rotations, local/periodic images and mirrors`);

  // A model with 160 identical geometry failures used to produce a wall of
  // repeated inline errors and never insert the requested contact.
  await page.getByRole("button", { name: "Закрыть 3D-просмотр геометрии", exact: true }).click();
  await page.evaluate(async () => {
    const { modelService } = await import("/src/services/modelService.js");
    const { tabRegistry } = await import("/src/services/tabRegistry.js");
    const source = { ...editorFixture.model().elements[0], med: Array.from({ length: 6 }, () => [-1]) };
    const invalid = Array.from({ length: 160 }, () => ({ ...source, geoType: 0, geo: Array.from({ length: 8 }, () => [0,0,0]) }));
    modelService.setModelParts([
      { schema: tabRegistry.find(s => s.id === "elements"), data: [source, ...invalid] },
      { schema: tabRegistry.find(s => s.id === "mhj"), data: [] },
    ]);
  });
  const beforeErrors = await page.evaluate(() => editorFixture.model());
  await page.getByRole("button", { name: "Открыть дополнительные функции", exact: true }).click();
  await page.locator(".side-panel").getByRole("button", { name: "Контактное возбуждение", exact: true }).click();
  await panel.waitFor(); await thickness.fill("0,02"); await current.fill("-2,5e-1"); await add.click();
  await page.waitForFunction(() => editorFixture.model().elements.length === 162);
  await panel.getByRole("status").filter({ hasText: "Добавлен контактный элемент №162" }).waitFor();
  await page.waitForFunction(() => !document.querySelector(".contact-element-actions button")?.disabled);
  assert.equal(await panel.getByRole("alert").count(), 0);
  const afterErrors = await page.evaluate(() => editorFixture.model());
  assert.deepEqual(afterErrors.mhj[0].v, [[0, 0.25, 0]]);
  await panel.getByRole("button", { name: "Закрыть", exact: true }).click();
  const repeated = await page.evaluate(async () => {
    const { diagnosticService } = await import("/src/services/diagnosticService.js");
    const counts = new Map();
    for (const d of diagnosticService.diagnostics()) counts.set(d.message, (counts.get(d.message) || 0) + 1);
    return [...counts].find(([, count]) => count >= 160);
  });
  assert.ok(repeated, "the errors must still be available in model diagnostics");
  await page.locator(".validation-indicator").click();
  await page.locator(".diagnostic-popup").waitFor();
  const messages = await page.locator(".diagnostic-message").allTextContents();
  assert.equal(messages.filter(text => text === repeated[0]).length, 1);
  await page.screenshot({ path: `${output}/grouped-model-errors.png` });
  pass("160 model errors allow insertion and appear once as a grouped diagnostic, not an inline wall of text");
  await page.evaluate(async () => { const { modelService } = await import("/src/services/modelService.js"); modelService.undo("mhj"); });
  assert.deepEqual(await page.evaluate(() => editorFixture.model()), beforeErrors);
  await page.evaluate(async () => { const { modelService } = await import("/src/services/modelService.js"); modelService.redo("elements"); });
  assert.deepEqual(await page.evaluate(() => editorFixture.model()), afterErrors);
  pass("draft insertion with model errors is atomic and fully undoable");
  await page.locator(".whats-new-button").click();
  await page.getByRole("tab", { name: /^Алгоритмы и вычисления/ }).click();
  const news = page.locator(".whats-new-entry").filter({ hasText: "Контактное возбуждение проводников" });
  await news.waitFor();
  assert.match(await news.textContent(), /используйте «Контактное возбуждение»/);
  assert.doesNotMatch(await news.textContent(), /«Контактный элемент»/);
  pass("What's New computation entry uses the current Contact Excitation menu label");
  assert.deepEqual(errors, []); pass("no browser exceptions");
} finally { await browser.close(); await server.close(); await rm(profile, { recursive: true, force: true }); }
