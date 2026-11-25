// Actual App, model service and native Chromium OPFS; controlled OS picker.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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

async function snapshotInputs() {
  return page.evaluate(async () => {
    let dir = await navigator.storage.getDirectory();
    for (const part of ["clark.editor-features", "Project", "Task", "input3XX"]) {
      dir = await dir.getDirectoryHandle(part);
    }
    const files = {};
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== "file") continue;
      const file = await handle.getFile();
      files[name] = { text: await file.text(), lastModified: file.lastModified };
    }
    return files;
  });
}

async function editPolarTolerance() {
  const row = page.locator(".tabulator-row:visible").filter({ hasText: "Полярное интегрирование по ЭП" });
  await row.locator('[tabulator-field="_record_0"]').dblclick();
  const input = row.locator("input");
  await input.fill("0.125");
  await input.press("Enter");
  await page.waitForFunction(() => editorFixture.model().conrab[0].POLAR_EPS_PERCENT === 0.125);
}

try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__save-warning`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.editorFixture?.ready, null, { timeout: 60000 });
  const demo = new URL("../data/demo/", import.meta.url);
  const names = ["general", "conrab", "kvs", "tks", "amplitudes", "moves", "mhj"];
  const inputs = await Promise.all(names.map(async name => [
    name, await readFile(new URL(name + ".txt", demo), "utf8"),
  ]));
  const oldSummary = "Сохранено редактором: 2020-08-17 11:12:13\n";
  await page.evaluate(async ({ inputs, oldSummary }) => {
    for (let [name, contents] of inputs) {
      if (name === "conrab") {
        contents = contents.trim().split("\n").map(line => {
          const profile = JSON.parse(line);
          delete profile.POLAR_EPS_PERCENT;
          return JSON.stringify(profile);
        }).join("\n");
      }
      await editorFixture.put(`input3XX/${name}.txt`, contents);
    }
    await editorFixture.put("input3XX/_summary.txt", oldSummary);
  }, { inputs, oldSummary });
  const original = await snapshotInputs();
  const beforeLoad = await page.evaluate(() => editorFixture.writes.length);
  await chooseProjectDisk(page);
  await page.locator("#listProject").selectOption("Project");
  await page.locator("#listTask .task-status-label").filter({ hasText: /^Task$/ }).dblclick();
  await page.waitForFunction(() => editorFixture.model().regions && editorFixture.model().elements?.length && editorFixture.model().conrab);
  await page.locator('[data-tab-id="conrab"]').click();
  const model = await page.evaluate(() => editorFixture.model());
  check("old inputs load with the solver defaults", model.general.forceGroupMinGap === 2 &&
    model.elements.every(row => row.take === 0) && model.regions[0].forceGroup === 0 &&
    model.conrab.every(profile => profile.POLAR_EPS_PERCENT === 0.05));
  check("opening old inputs leaves Save clean", !await orange() && !await page.evaluate(() => editorFixture.dirty()));
  assert.deepEqual(await snapshotInputs(), original);
  assert.deepEqual(await page.evaluate(i => editorFixture.writes.slice(i).filter(name => name !== "clark.editor-last-task.json"), beforeLoad), []);
  await editPolarTolerance();
  await save.hover();
  check("editing turns the background orange, including hover", await orange());
  await page.screenshot({ path: `${output}/dirty-save.png` });
  await page.getByRole("button", { name: "Открыть дополнительные функции" }).click();
  await page.getByTitle("Отменить последнее изменение текущей вкладки").click();
  await page.waitForFunction(() => !editorFixture.dirty());
  if (await page.locator(".side-panel.open").count()) await page.locator(".side-panel-close").click();
  check("Undo restores the clean state of the old task", !await orange());
  assert.deepEqual(await snapshotInputs(), original);
  await editPolarTolerance();
  let before = await countWrites();
  await save.click(); await waitSave(before);
  check("successful save clears the warning", !await orange());
  const saved = await snapshotInputs();
  assert.equal(JSON.parse(saved["general.txt"].text).forceGroupMinGap, 2);
  assert.ok(saved["kvs.txt"].text.trim().split("\n").map(JSON.parse).every(row => row.take === 0));
  assert.deepEqual(saved["conrab.txt"].text.trim().split("\n").map(line => JSON.parse(line).POLAR_EPS_PERCENT), [0.125, 0.05]);
  assert.match(saved["_summary.txt"].text, /^Сохранено редактором: /u);
  assert.ok(!saved["_summary.txt"].text.includes("2020-08-17"));

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
