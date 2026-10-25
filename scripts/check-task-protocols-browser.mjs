// Actual Editor App and native OPFS; only the operating-system picker is controlled.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chooseProjectDisk } from "./browser-project-access.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = process.env.CHECK_OUTPUT || "/tmp/clark-task-protocols-check";
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const server = await createServer({ root, cacheDir: `${output}/vite-cache`,
  server: { host: "127.0.0.1", port: 0, hmr: false },
  plugins: [{ name: "task-protocols-fixture", configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (req.url !== "/__task-protocols") return next();
      res.setHeader("Content-Type", "text/html");
      res.end(await server.transformIndexHtml(req.url, '<html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/test/browser/taskOperations.fixture.jsx"></script></body></html>'));
    });
  } }],
});
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE,
  headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
page.setDefaultTimeout(15000);
const errors = [], checks = [];
page.on("pageerror", error => errors.push(error.message));
const check = (name, value) => { assert.ok(value, name); checks.push(name); console.log("PASS", name); };
const row = name => page.locator("#listTask .listTask-item").filter({ has: page.locator(".task-status-name", { hasText: new RegExp(`^(?:▶\\s*)?${name}$`) }) });
const selected = () => page.locator("#listTask .selected .task-status-name").textContent();
const snapshot = () => page.evaluate(async () => ({
  model: taskFixture.snapshot(), history: await taskFixture.read("clark.editor-last-task.json"),
}));
const waitProtocols = async popup => {
  await popup.getByRole("tab").first().waitFor();
  assert.equal(await popup.getByRole("tab").count(), 3);
};
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__task-protocols`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.taskFixture?.ready, null, { timeout: 60000 });
  await page.evaluate(async () => {
    const html = label => `<!doctype html><meta charset="utf-8"><h1>${label}</h1><button id="step">Сменить время</button><output id="time">0</output><a id="csv" download="report.csv" href="data:text/csv,time%2Cvalue%0A1%2C2">CSV</a><script>document.querySelector('#step').onclick=()=>document.querySelector('#time').value='5';document.body.dataset.ready='yes';</script>`;
    await taskFixture.put("Project/Reports/comparison/root.html", html("Корневой"));
    await taskFixture.put("Project/Reports/comparison/TEAM7/report.HTML", html("TEAM7"));
    await taskFixture.put("Project/Reports/comparison/TEAM13/deep/report.html", html("TEAM13"));
    await taskFixture.put("Project/Reports/comparison/ignored.txt", "not a report");
    await taskFixture.mkdir("Project/Failure/comparison");
  });
  await chooseProjectDisk(page);
  await page.locator("#listProject").selectOption("Project");
  await row("Reports").getByRole("button").waitFor();
  check("T is available for comparison, including an empty directory, and absent otherwise",
    await row("Reports").getByRole("button").isEnabled() && await row("Failure").getByRole("button").isEnabled()
      && await row("Original").getByRole("button").count() === 0);

  await row("Original").click();
  await page.getByRole("button", { name: "Загрузить для редактирования", exact: true }).click();
  await page.waitForFunction(() => taskFixture.snapshot().model.general);
  await page.evaluate(() => taskFixture.dirty());
  await page.getByRole("button", { name: "Выбор задания", exact: true }).click();
  const before = await snapshot(), beforeSelected = await selected();
  // Hold a native read to observe guards without depending on machine speed.
  await page.evaluate(() => {
    const original = FileSystemFileHandle.prototype.getFile;
    FileSystemFileHandle.prototype.getFile = async function (...args) {
      if (this.name === "root.html") await new Promise(resolve => {
        taskFixture.releaseRead = () => { FileSystemFileHandle.prototype.getFile = original; resolve(); };
      });
      return original.apply(this, args);
    };
  });
  const opening = page.waitForEvent("popup");
  await row("Reports").getByRole("button").click();
  const popup = await opening;
  await page.waitForFunction(() => taskFixture.releaseRead);
  await row("Failure").click();
  check("reading blocks repeated T actions and project changes without changing selection",
    await row("Reports").getByRole("button").isDisabled() && await page.locator("#listProject").isDisabled()
      && await selected() === beforeSelected);
  await page.evaluate(() => taskFixture.releaseRead());
  await waitProtocols(popup);
  check("one window contains every nested report with full paths", (await popup.getByRole("tab").allTextContents()).join("|")
    === "comparison/root.html|comparison/TEAM7/report.HTML|comparison/TEAM13/deep/report.html");
  const frame = popup.frameLocator('iframe[title="comparison/TEAM7/report.HTML"]');
  await popup.getByRole("tab", { name: "comparison/TEAM7/report.HTML", exact: true }).click();
  await frame.locator('body[data-ready="yes"]').waitFor();
  await frame.getByRole("button", { name: "Сменить время" }).click();
  check("report scripts and controls work", await frame.locator("#time").textContent() === "5");
  const downloading = popup.waitForEvent("download");
  await frame.getByText("CSV", { exact: true }).click();
  check("report tables can be downloaded", (await downloading).suggestedFilename() === "report.csv");
  assert.deepEqual(await snapshot(), before);
  check("opening another task's reports preserves the dirty model, selection and last-opened marker",
    await selected() === beforeSelected && await popup.evaluate(() => opener === null));
  await popup.screenshot({ path: `${output}/comparison-protocols.png` });
  await page.screenshot({ path: `${output}/editor-comparison-button.png` });
  await popup.close();

  for (const key of ["Enter", "Space"]) {
    const next = page.waitForEvent("popup");
    await row("Reports").getByRole("button").focus();
    await page.keyboard.press(key);
    const tab = await next; await waitProtocols(tab); await tab.close();
  }
  assert.deepEqual(await snapshot(), before);
  check("Enter and Space open reports without loading or selecting their task", await selected() === beforeSelected);

  await row("Failure").getByRole("button").click();
  const error = page.locator(".task-load-error-dialog");
  await error.waitFor({ state: "visible" });
  check("empty comparison uses the existing error dialog", (await error.textContent()).includes("В comparison нет HTML-протоколов."));
  await error.getByRole("button").click();
  await page.evaluate(() => { taskFixture.openWindow = window.open; window.open = () => null; });
  await row("Reports").getByRole("button").click();
  await error.waitFor({ state: "visible" });
  check("blocked popup explains the failure and allows retry", (await error.textContent()).includes("Браузер заблокировал окно протоколов"));
  await error.getByRole("button").click();
  await page.evaluate(() => { window.open = taskFixture.openWindow; });
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, errors }, null, 2));
} finally {
  await browser.close(); await server.close();
}
