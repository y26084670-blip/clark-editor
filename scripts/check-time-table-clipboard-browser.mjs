import { chooseProjectDisk } from "./browser-project-access.mjs";
// Actual App, Tabulator, Chart.js, system clipboard and native OPFS in Chromium.
// The existing fixture controls only the directory picker; permission failures
// and delayed reads below are injected explicitly as separate failure cases.
import { createServer } from "vite";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = process.env.CHECK_OUTPUT || "/tmp/editor-clipboard-tables";
await mkdir(output, { recursive: true });
const checks = [], errors = [];
let server, browser, page;
const labels = {
  impuls: "Заменить амплитуды значениями из буфера",
  angle: "Заменить повороты значениями из буфера",
  position: "Заменить положения значениями из буфера",
};
function passed(name) { checks.push(name); console.log(`PASS ${checks.length}: ${name}`); }
const model = () => page.evaluate(() => editorFixture.model());
const tab = name => page.locator(".tabs-header button").filter({ hasText: new RegExp(`^${name}\\*?$`) });
async function drawer() {
  await page.getByRole("button", { name: "Открыть дополнительные функции", exact: true }).click();
  await page.locator('.side-panel').evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
}
async function select(id, indices, field) {
  await page.evaluate(({ id, indices, field }) => {
    const table = editorFixture.tables(".tabulator").find(t => t._gui?.schema.id === id
      && t.getColumn(field));
    if (!table) throw new Error("Main table missing: " + id);
    table.deselectRow();
    for (const i of indices) table.getRows()[i].select();
  }, { id, indices, field });
}
async function writeClipboard(text) { await page.evaluate(text => navigator.clipboard.writeText(text), text); }
async function paste(property) {
  await drawer();
  const button = page.locator(".side-panel").getByRole("button", { name: labels[property], exact: true });
  assert.ok((await button.getAttribute("title")).includes("без заголовка"));
  await button.click();
}
const errorDialog = () => page.getByRole("dialog", { name: "Ошибка вставки таблицы", exact: true });
async function expectError(pattern, before) {
  await errorDialog().waitFor();
  assert.match(await errorDialog().innerText(), pattern);
  assert.ok(await errorDialog().evaluate(el => el.matches(":modal")));
  assert.deepEqual(await model(), before);
  await errorDialog().getByRole("button", { name: "Закрыть", exact: true }).click();
}
async function history(name) {
  await drawer();
  await page.locator(".side-panel-history").getByRole("button", { name: new RegExp(name) }).click();
  await page.getByRole("button", { name: "Закрыть дополнительные функции", exact: true }).click();
}

try {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  server = await createServer({ root, cacheDir: path.join(output, "vite-cache"),
    optimizeDeps: { include: ["chart.js/auto"] }, server: { host: "127.0.0.1", port: 0 }, plugins: [{
    name: "time-clipboard-fixture", configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split("?")[0] !== "/__time-clipboard") return next();
        res.setHeader("Content-Type", "text/html");
        res.end(await server.transformIndexHtml(req.url, '<html><body><div id="root"></div><script type="module" src="/test/browser/editorFeatures.fixture.jsx"></script></body></html>'));
      });
    },
  }] });
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  page = await browser.newPage({ viewport: { width: 1500, height: 1050 } });
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") console.error(message.text()); });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__time-clipboard`);
  await page.waitForFunction(() => window.editorFixture?.ready);
  await tab("Амплитуды").click(); await drawer();
  assert.ok(await page.getByRole("button", { name: labels.impuls, exact: true }).isDisabled());
  await page.getByRole("button", { name: "Закрыть дополнительные функции", exact: true }).click();
  await tab("Выбор задания").click();
  await page.evaluate(async () => {
    const general = JSON.parse(await editorFixture.read("input3XX/general.txt"));
    await editorFixture.put("input3XX/general.txt", JSON.stringify({ ...general, countTimeSteps: 2, timeStep: .5 }));
    await editorFixture.put("input3XX/amplitudes.txt", [
      { impuls: [0, 1, 11, 12], n: 2 }, { impuls: [0, 1, 21, 22], n: 2 },
    ].map(JSON.stringify).join("\n"));
    await editorFixture.put("input3XX/moves.txt", [
      { angle: [0, 1, 1, 2, 3, 4, 5, 6], position: [0, 1, 11, 12, 13, 14, 15, 16], n: 2 },
      { angle: [0, 1, 7, 8, 9, 10, 11, 12], position: [0, 1, 17, 18, 19, 20, 21, 22], n: 2 },
    ].map(JSON.stringify).join("\n"));
  });
  await chooseProjectDisk(page);
  await page.locator("#listProject").selectOption("Project");
  await page.locator("#listTask .listTask-item").filter({ hasText: /^Task$/ }).dblclick();
  await page.waitForFunction(() => editorFixture.model().amps?.length === 2 && editorFixture.model().moves?.length === 2);
  await tab("Амплитуды").click();
  const original = await model();
  await writeClipboard("0\t-1,25\r\n0,5\t2.5e2\r\n1\t-60438.09105958964\r\n");
  await select("amps", [], "impuls"); await paste("impuls"); await expectError(/ровно одну/, original);
  await select("amps", [0, 1], "impuls"); await paste("impuls"); await expectError(/ровно одну/, original);
  passed("Command requires a loaded task and exactly one main row; invalid selection leaves data unchanged");
  await select("amps", [1], "impuls");
  await page.evaluate(() => {
    const table = editorFixture.tables(".tabulator").find(t => t._gui?.schema.id === "amps" && t.getColumn("impuls"));
    table.getRows()[1].getCell("impuls").getElement().click();
  });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.record-graph-region canvas')).some(canvas =>
    editorFixture.chart(canvas)?.data.datasets.some(series => series.data?.length === 2 && series.data[1].y === 22)));
  await paste("impuls");
  await page.waitForFunction(() => editorFixture.model().amps[1].n === 3);
  const amplitude = await model();
  assert.deepEqual(amplitude.amps[0], original.amps[0]);
  assert.deepEqual(amplitude.amps[1].impuls, [[0, -1.25], [.5, 250], [1, -60438.09105958964]]);
  assert.ok(await page.evaluate(() => editorFixture.dirty()));
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.record-graph-region canvas')).some(canvas =>
    editorFixture.chart(canvas)?.data.datasets.some(series => series.data?.length === 3 && series.data[2].y === -60438.09105958964)));
  passed("Actual clipboard replaces only the selected amplitude, preserves full values and updates n/dirty");
  await history("Отменить"); await page.waitForFunction(() => editorFixture.model().amps[1].n === 2);
  assert.deepEqual((await model()).amps, original.amps);
  await history("Повторить"); await page.waitForFunction(() => editorFixture.model().amps[1].n === 3);
  assert.deepEqual((await model()).amps, amplitude.amps);
  passed("One Undo restores the complete previous table; Redo reapplies the replacement");
  await select("amps", [1], "impuls");
  for (const [text, pattern] of [["0\t1\t2", /колонки/], ["0\t1\n1\t", /колонка 2/], ["0\t1\n1\tNaN", /колонка 2/], ["", /пуст/]]) {
    await writeClipboard(text); const before = await model(); await paste("impuls"); await expectError(pattern, before);
  }
  passed("Malformed, incomplete, nonnumeric and empty clipboard tables do not partially replace data");
  await page.evaluate(() => {
    window.__nativeClipboardRead = navigator.clipboard.readText.bind(navigator.clipboard);
    navigator.clipboard.readText = () => Promise.reject(new DOMException("Denied", "NotAllowedError"));
  });
  const beforeDenied = await model(); await paste("impuls"); await expectError(/не разрешил/, beforeDenied);
  await page.evaluate(() => { navigator.clipboard.readText = window.__nativeClipboardRead; });
  passed("Clipboard permission rejection opens a dark modal and leaves the model intact");
  await page.evaluate(() => { navigator.clipboard.readText = () => new Promise(resolve => { window.__resolveRead = resolve; }); });
  await paste("impuls"); await page.waitForFunction(() => Boolean(window.__resolveRead));
  await select("amps", [0], "impuls");
  const beforeDelayed = await model();
  await page.evaluate(() => window.__resolveRead("0\t99\n1\t100"));
  await expectError(/изменились/, beforeDelayed);
  await page.evaluate(() => { navigator.clipboard.readText = window.__nativeClipboardRead; });
  passed("Changing the selected row during an asynchronous clipboard read cancels the operation");
  await tab("Траектории").click(); await drawer();
  assert.equal(await page.getByRole("button", { name: labels.impuls, exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: labels.angle, exact: true }).count(), 1);
  assert.equal(await page.getByRole("button", { name: labels.position, exact: true }).count(), 1);
  await page.screenshot({ path: path.join(output, "trajectory-menu.png"), fullPage: true });
  await page.getByRole("button", { name: "Закрыть дополнительные функции", exact: true }).click();
  await select("moves", [0], "angle");
  await writeClipboard("0\t10\t20\t30\n0,5\t11\t21\t31\n1\t12\t22\t32"); await paste("angle");
  await page.waitForFunction(() => editorFixture.model().moves[0].angle.length === 3);
  const turned = await model();
  assert.deepEqual(turned.moves[0].position, original.moves[0].position);
  assert.deepEqual(turned.moves[1], original.moves[1]);
  assert.deepEqual(turned.moves[0].angle, [[0, 10, 20, 30], [.5, 11, 21, 31], [1, 12, 22, 32]]);
  assert.equal(turned.moves[0].n, 0);
  await writeClipboard("0\t-1\t-2\t-3\n0.5\t4\t5\t6\n1\t7\t8\t9"); await paste("position");
  await page.waitForFunction(() => editorFixture.model().moves[0].n === 3);
  const moved = await model();
  assert.deepEqual(moved.moves[0].angle, turned.moves[0].angle);
  assert.deepEqual(moved.moves[0].position, [[0, -1, -2, -3], [.5, 4, 5, 6], [1, 7, 8, 9]]);
  assert.deepEqual(moved.moves[1], original.moves[1]);
  passed("Trajectory menu replaces rotations and positions independently and recomputes their common n");
  // Activate the nested table first: the command must still target the main row.
  await page.evaluate(() => {
    const table = editorFixture.tables(".tabulator").find(t => t._gui?.schema.id === "moves" && t.getColumn("position"));
    table.getRows()[0].getCell("position").getElement().click();
  });
  await page.waitForFunction(() => document.querySelector('.data-editor-detail .tabulator') || editorFixture.tables('.tabulator').some(t => t._gui?.schema.id === "moves" && !t.getColumn("position")));
  await writeClipboard("0\t40\t50\t60\n0.5\t41\t51\t61\n1\t42\t52\t62"); await paste("position");
  await page.waitForFunction(() => editorFixture.model().moves[0].position[0][1] === 40);
  assert.deepEqual((await model()).moves[0].angle, moved.moves[0].angle);
  passed("An open nested table does not redirect replacement away from the selected trajectory");
  // Generate a preview to inspect text/grid/curve contrast on the new background.
  const generator = page.locator('.time-generator').filter({ visible: true });
  await generator.locator('textarea').fill("sin(pi*t)");
  await generator.getByRole('button', { name: 'Генерировать', exact: true }).click();
  await generator.locator('canvas').waitFor();
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.time-generator canvas')).some(canvas => editorFixture.chart(canvas)?.data.datasets[0]?.data.length === 3));
  assert.equal(await generator.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(229, 234, 238)');
  await page.screenshot({ path: path.join(output, "trajectory-generator.png"), fullPage: true });
  await tab("Амплитуды").click();
  await page.screenshot({ path: path.join(output, "amplitude-generator.png"), fullPage: true });
  passed("Both generator panels and the plotted preview render with the softer gray-blue palette");
  const beforeSave = await page.evaluate(() => editorFixture.writes.filter(v => v === "amplitudes.txt").length);
  await page.keyboard.press("Control+s");
  await page.waitForFunction(n => editorFixture.writes.filter(v => v === "amplitudes.txt").length > n, beforeSave);
  await page.waitForFunction(() => !document.querySelector('.save-button')?.disabled);
  const saved = await page.evaluate(async () => ({
    amps: (await editorFixture.read("input3XX/amplitudes.txt")).trim().split(/\r?\n/).map(JSON.parse),
    moves: (await editorFixture.read("input3XX/moves.txt")).trim().split(/\r?\n/).map(JSON.parse),
  }));
  assert.deepEqual(saved.amps[1].impuls, [0, .5, 1, -1.25, 250, -60438.09105958964]);
  assert.deepEqual(saved.moves[0].position, [0, .5, 1, 40, 41, 42, 50, 51, 52, 60, 61, 62]);
  assert.equal(saved.amps[1].n, 3); assert.equal(saved.moves[0].n, 3);
  passed("Normal save writes both tables in the existing column-major solver format with correct node counts");
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, "browser.json"), JSON.stringify({ passed: checks.length, checks, errors }, null, 2));
  console.log(`BROWSER_OK ${checks.length}/${checks.length}`);
} catch (error) {
  await page?.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {});
  await writeFile(path.join(output, "browser.json"), JSON.stringify({ passed: checks.length, checks, errors, failure: error.stack }, null, 2));
  console.error(error); process.exitCode = 1;
} finally {
  for (const resource of [browser, server]) {
    let timer;
    try { await Promise.race([resource?.close(), new Promise(resolve => { timer = setTimeout(resolve, 5000); })]); }
    finally { clearTimeout(timer); }
  }
}
