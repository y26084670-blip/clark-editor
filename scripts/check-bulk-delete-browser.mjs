import { chooseProjectDisk } from "./browser-project-access.mjs";
// Actual App/Tabulator, model history, serializer and native Chromium OPFS.
// Only the directory picker and the explicit replacement failure are controlled.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = process.env.CHECK_OUTPUT || "/tmp/editor-bulk-delete";
await mkdir(output, { recursive: true });
const checks = [], errors = [], timings = [];
let server, browser, page;
const passed = name => { checks.push(name); console.log(`PASS ${checks.length}: ${name}`); };
const model = () => page.evaluate(() => editorFixture.model());
const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function tab(id) {
  const label = await page.evaluate(id => bulk.schemas[id].title, id);
  await page.locator(".tabs-header button").filter({ hasText: new RegExp(`^${label}\\*?$`) }).click();
  await frame();
}
async function history(id, direction) {
  assert.ok(await page.evaluate(({ id, direction }) => bulk.modelService[direction](id), { id, direction }));
  await page.waitForFunction(id => {
    const table = bulk.table(id);
    return table && table.getDataCount() === editorFixture.model()[id][0].v.length;
  }, id);
  await frame();
}

try {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  server = await createServer({ root, cacheDir: path.join(output, "vite-cache"),
    optimizeDeps: { include: ["chart.js/auto"] }, server: { host: "127.0.0.1", port: 0 }, plugins: [{
      name: "bulk-delete-fixture", configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url?.split("?")[0] !== "/__bulk-delete") return next();
          res.setHeader("Content-Type", "text/html");
          res.end(await server.transformIndexHtml(req.url, '<html><body><div id="root"></div><script type="module" src="/test/browser/editorFeatures.fixture.jsx"></script></body></html>'));
        });
      },
    }] });
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  page = await browser.newPage({ viewport: { width: 1500, height: 1050 } });
  page.setDefaultTimeout(20000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__bulk-delete`);
  await page.waitForFunction(() => window.editorFixture?.ready);
  await page.evaluate(async () => {
    const { modelService } = await import("/src/services/modelService.js");
    const { recordsActions } = await import("/src/tabulator/actions/recordsActions.js");
    const { selectionContextService } = await import("/src/services/selectionContextService.js");
    const { dataService } = await import("/src/services/dataService.js");
    const { serialize } = await import("/src/services/model/modelSerializer.js");
    const { mhjValidator } = await import("/src/tabulator/validators/models/mhj/mhjValidator.js");
    const schemas = {};
    for (const id of ["mhj", "elements", "amps", "moves"]) schemas[id] = (await import(`/src/services/schemas/${id}.schema.js`)).default;
    window.bulk = { modelService, recordsActions, selectionContextService, schemas, serialize, mhjValidator,
      table: id => editorFixture.tables(".tabulator").find(t => t._gui?.schema.id === id && t.element.offsetWidth > 0),
      select(table, indices) {
        table.deselectRow();
        const rows = table.getRows();
        table.selectRow(indices.map(index => rows[index]));
        selectionContextService.setActiveTable(table);
      },
      watch(table) {
        const stats = { replacements: 0, publications: 0, rowUpdates: 0 };
        const replace = table.replaceData.bind(table), publish = modelService.setModelPart;
        table.replaceData = (...args) => { stats.replacements++; return replace(...args); };
        modelService.setModelPart = (...args) => {
          if (args[0].id === table._gui.schema.id) stats.publications++;
          return publish(...args);
        };
        const update = () => stats.rowUpdates++;
        table.on("rowUpdated", update);
        return { stats, stop() { table.replaceData = replace; modelService.setModelPart = publish; table.off("rowUpdated", update); } };
      },
    };
    const coil = dataService.createDefaultRecord(schemas.elements);
    Object.assign(coil, { targ: 2, dp: [[167], [1], [1]], symLs: 144, symAs: 1, symPs: 1 });
    const values = Array.from({ length: 24048 }, (_, i) => [i + .125, -i - .25, 2 * i + .5]);
    await editorFixture.put("input3XX/kvs.txt", serialize([coil], schemas.elements).map(JSON.stringify).join("\n"));
    await editorFixture.put("input3XX/mhj.txt", JSON.stringify(serialize([{ v: values }], schemas.mhj)[0]));
    await editorFixture.put("input3XX/amplitudes.txt", [
      { impuls: [0, 1, 2, 3, 10, 11, 12, 13], n: 4 },
      { impuls: [0, 1, 20, 21], n: 2 },
    ].map(JSON.stringify).join("\n"));
    await editorFixture.put("input3XX/moves.txt", JSON.stringify({ n: 4,
      angle: [0, 1, 2, 3, 10, 11, 12, 13, 20, 21, 22, 23, 30, 31, 32, 33],
      position: [0, 1, 2, 3, 40, 41, 42, 43, 50, 51, 52, 53, 60, 61, 62, 63] }));
  });
  await chooseProjectDisk(page);
  await page.locator("#listProject").selectOption("Project");
  await page.locator("#listTask .listTask-item").filter({ hasText: /^Task$/ }).dblclick();
  await page.waitForFunction(() => editorFixture.model().mhj?.[0]?.v.length === 24048);
  const original = await model();
  await tab("mhj");
  await page.waitForFunction(() => bulk.table("mhj")?.getDataCount() === 24048);
  const visibleRows = await page.locator('.tabulator-row:visible').count();
  assert.ok(visibleRows > 0 && visibleRows < 300, `Virtual viewport expected, got ${visibleRows}`);
  passed("Loaded 24,048 distinct source vectors through actual App with a virtual viewport");

  await page.evaluate(() => {
    const table = bulk.table("mhj");
    bulk.select(table, Array.from({ length: 24048 }, (_, i) => i).filter(i => i % 167 !== 0));
    bulk.watching = bulk.watch(table);
    const remove = bulk.recordsActions.removeRecord;
    bulk.recordsActions.removeRecord = async () => {
      const start = performance.now();
      try { await remove(); } finally { bulk.elapsed = performance.now() - start; bulk.recordsActions.removeRecord = remove; }
    };
  });
  await page.locator('button[title="Удалить строки"]').filter({ visible: true }).click();
  await page.waitForFunction(() => Number.isFinite(bulk.elapsed));
  const first = await page.evaluate(() => { const result = { ms: bulk.elapsed, ...bulk.watching.stats }; bulk.watching.stop(); return result; });
  timings.push({ operation: "24048 -> 144", ...first });
  assert.equal(first.replacements, 1);
  assert.equal(first.publications, 1);
  assert.equal(first.rowUpdates, 0);
  assert.ok(first.ms < 5000, `Bulk deletion blocked for ${first.ms} ms`);
  const retained = original.mhj[0].v.filter((_, i) => i % 167 === 0);
  assert.deepEqual((await model()).mhj[0].v, retained);
  assert.deepEqual((await model()).elements, original.elements);
  assert.ok(await page.evaluate(() => editorFixture.dirty()));
  assert.ok(await page.evaluate(() => bulk.table("mhj").getData().every((row, index) => row.index === index + 1)));
  passed("Toolbar deletion preserves noncontiguous vectors/order, renumbers once and publishes once");
  const mismatch = await page.evaluate(() => {
    const diagnostics = []; bulk.mhjValidator(bulk.modelService, diagnostics); return diagnostics;
  });
  assert.ok(JSON.stringify(mismatch).includes("не соответствует"));
  passed("Source/geometry mismatch is still diagnosed; deleting vectors does not modify geometry");
  await history("mhj", "undo");
  assert.deepEqual((await model()).mhj, original.mhj);
  assert.equal(await page.evaluate(() => bulk.modelService.canUndo("mhj")), false);
  await history("mhj", "redo");
  assert.deepEqual((await model()).mhj[0].v, retained);
  passed("One Undo restores all vectors in App and one Redo reapplies the complete deletion");

  // Removing only the first rows must not trigger thousands of row.update calls.
  await history("mhj", "undo");
  const small = await page.evaluate(async () => {
    const table = bulk.table("mhj"); bulk.select(table, [0, 1]);
    const watch = bulk.watch(table), start = performance.now();
    try { await bulk.recordsActions.removeRecord(); return { ms: performance.now() - start, ...watch.stats }; }
    finally { watch.stop(); }
  });
  timings.push({ operation: "24048 -> 24046", ...small });
  assert.equal(small.replacements, 1);
  assert.equal(small.publications, 1);
  assert.equal(small.rowUpdates, 0);
  assert.ok(small.ms < 5000, `Renumbering blocked for ${small.ms} ms`);
  assert.deepEqual((await model()).mhj[0].v, original.mhj[0].v.slice(2));
  passed("Deleting the first two rows preserves 24,046 values without per-row renumbering updates");
  await history("mhj", "undo");

  const guards = await page.evaluate(async () => {
    const table = bulk.table("mhj"), before = JSON.stringify(editorFixture.model());
    const revision = bulk.modelService.getModelPartUpdate("mhj").revision;
    bulk.select(table, []); await bulk.recordsActions.removeRecord();
    bulk.select(table, [1, 3]); table._gui.structure.mutable = false;
    try { await bulk.recordsActions.removeRecord(); } finally { table._gui.structure.mutable = true; }
    bulk.select(table, table.getRows().map((_, i) => i)); table._gui.required = true;
    try { await bulk.recordsActions.removeRecord(); } finally { table._gui.required = false; }
    return before === JSON.stringify(editorFixture.model()) && revision === bulk.modelService.getModelPartUpdate("mhj").revision;
  });
  assert.ok(guards);
  passed("Empty selection, structural lock and required-table protection make no model/history changes");
  const failed = await page.evaluate(async () => {
    const table = bulk.table("mhj"); bulk.select(table, [2, 4]);
    const before = JSON.stringify(table.getData()), revision = bulk.modelService.getModelPartUpdate("mhj").revision;
    const replace = table.replaceData.bind(table); let calls = 0, error;
    table.replaceData = async data => { await replace(data); if (++calls === 1) throw new Error("Controlled replacement failure"); };
    try { await bulk.recordsActions.removeRecord(); } catch (e) { error = e.message; }
    finally { table.replaceData = replace; }
    return { error, calls, same: JSON.stringify(table.getData()) === before,
      selected: table.getSelectedRows().map(row => row.getPosition()),
      revisionUnchanged: revision === bulk.modelService.getModelPartUpdate("mhj").revision,
      canUndo: bulk.modelService.canUndo("mhj") };
  });
  assert.deepEqual(failed, { error: "Controlled replacement failure", calls: 2, same: true, selected: [3, 5], revisionUnchanged: true, canUndo: false });
  assert.deepEqual((await model()).mhj, original.mhj);
  passed("Failure after replacing rows restores the full table/selection without publishing or recording history");
  await page.evaluate(async () => { await bulk.recordsActions.removeRecord(); });
  assert.deepEqual((await model()).mhj[0].v, original.mhj[0].v.filter((_, i) => i !== 2 && i !== 4));
  await history("mhj", "undo");
  passed("A valid deletion and Undo still work after the failed transaction");

  await page.evaluate(async () => {
    const table = bulk.table("mhj"); bulk.select(table, table.getRows().map((_, i) => i));
    await bulk.recordsActions.removeRecord();
  });
  assert.deepEqual((await model()).mhj, [{ v: [] }]);
  assert.equal(await page.evaluate(() => bulk.table("mhj").getDataCount()), 0);
  await history("mhj", "undo");
  assert.deepEqual((await model()).mhj, original.mhj);
  passed("Optional MHJ can become empty and its full contents are restored by one Undo");

  // Actual cell-backed TableView: preserve the other record, computed n and graph.
  await tab("amps");
  await page.evaluate(() => {
    const main = bulk.table("amps"); bulk.select(main, [0]); main.getRows()[0].getCell("impuls").getElement().click();
  });
  await page.waitForFunction(() => editorFixture.tables(".tabulator").some(t => t._gui?.schema.id === "amps" && t._gui.structure.removeRows && t.element.offsetWidth));
  await page.evaluate(async () => {
    const nested = editorFixture.tables(".tabulator").find(t => t._gui?.schema.id === "amps" && t._gui.structure.removeRows && t.element.offsetWidth);
    bulk.select(nested, [1, 3]); await bulk.recordsActions.removeRecord();
  });
  await page.waitForFunction(() => editorFixture.model().amps[0].n === 2);
  assert.deepEqual((await model()).amps[0].impuls, [[0, 10], [2, 12]]);
  assert.deepEqual((await model()).amps[1], original.amps[1]);
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.record-graph-region canvas')).some(canvas =>
    editorFixture.chart(canvas)?.data.datasets.some(series => series.data?.length === 2 && series.data[1].y === 12)));
  assert.ok(await page.evaluate(() => bulk.modelService.undo("amps")));
  await page.waitForFunction(() => editorFixture.model().amps[0].n === 4);
  assert.deepEqual((await model()).amps, original.amps);
  passed("Nested impulse deletion preserves the other record, updates n/graph and supports Undo");

  await tab("moves");
  await page.evaluate(() => { const main = bulk.table("moves"); bulk.select(main, [0]); main.getRows()[0].getCell("position").getElement().click(); });
  await page.waitForFunction(() => editorFixture.tables(".tabulator").some(t => t._gui?.schema.id === "moves" && t._gui.structure.removeRows && t.element.offsetWidth));
  await page.evaluate(async () => {
    const nested = editorFixture.tables(".tabulator").find(t => t._gui?.schema.id === "moves" && t._gui.structure.removeRows && t.element.offsetWidth);
    bulk.select(nested, [0, 2]); await bulk.recordsActions.removeRecord();
  });
  assert.deepEqual((await model()).moves[0].position, [[1, 41, 51, 61], [3, 43, 53, 63]]);
  assert.deepEqual((await model()).moves[0].angle, original.moves[0].angle);
  assert.ok(await page.evaluate(() => bulk.modelService.undo("moves")));
  await page.waitForFunction(() => editorFixture.model().moves[0].position.length === 4);
  passed("Nested trajectory deletion preserves all four columns and the independent rotation table");

  await tab("amps");
  await page.evaluate(async () => { const main = bulk.table("amps"); bulk.select(main, [0]); await bulk.recordsActions.removeRecord(); });
  assert.deepEqual((await model()).amps, [original.amps[1]]);
  assert.equal(await page.evaluate(() => editorFixture.tables(".tabulator").filter(t => t._gui?.schema.id === "amps" && t._gui.structure.removeRows && t.element.offsetWidth).length), 0);
  assert.ok(await page.evaluate(() => bulk.modelService.undo("amps")));
  await page.waitForFunction(() => editorFixture.model().amps.length === 2);
  passed("Main RECORDS deletion still closes the deleted owner's detail view and supports Undo");

  await tab("mhj");
  await page.evaluate(async () => {
    const table = bulk.table("mhj"); bulk.select(table, table.getRows().map((_, i) => i).filter(i => i % 167 !== 0));
    await bulk.recordsActions.removeRecord();
  });
  const beforeSave = await page.evaluate(() => editorFixture.writes.filter(name => name === "mhj.txt").length);
  await page.keyboard.press("Control+s");
  await page.waitForFunction(before => editorFixture.writes.filter(name => name === "mhj.txt").length > before, beforeSave);
  const saved = await page.evaluate(async () => JSON.parse(await editorFixture.read("input3XX/mhj.txt")));
  assert.deepEqual(saved, { v: [0, 1, 2].flatMap(column => retained.map(row => row[column])) });
  passed("Normal save writes exactly the retained vectors in the unchanged column-major solver format");
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(output, "mhj-after-delete.png"), fullPage: true });
  console.log(JSON.stringify({ timings }));
} catch (error) {
  await page?.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {});
  errors.push(error.stack); console.error(error); process.exitCode = 1;
} finally {
  await writeFile(path.join(output, "browser.json"), JSON.stringify({ passed: checks.length, checks, timings, errors }, null, 2));
  for (const resource of [browser, server]) {
    let timer;
    try { await Promise.race([resource?.close(), new Promise(resolve => { timer = setTimeout(resolve, 5000); })]); }
    finally { clearTimeout(timer); }
  }
}
