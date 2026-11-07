import { createServer } from "vite";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({ root, server: { host: "127.0.0.1", port: 0 }, plugins: [{
  name: "task-queue-fixture", configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (req.url !== "/__task-queue") return next();
      res.setHeader("Content-Type", "text/html");
      res.end(await server.transformIndexHtml(req.url,
        '<html><body><div id="root"></div><script type="module" src="/test/browser/taskQueue.fixture.jsx"></script></body></html>'));
    });
  },
}] });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
  headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const viewport = { width: Number(process.env.QUEUE_VIEWPORT_WIDTH ?? 1600), height: Number(process.env.QUEUE_VIEWPORT_HEIGHT ?? 960) };
const page = await browser.newPage({ viewport });
page.setDefaultTimeout(15000);
await page.addInitScript(() => localStorage.setItem("e3d.generalInformation.openAtStartup", "false"));
const errors = []; page.on("pageerror", error => errors.push(error.message));
let checks = 0;
const check = (name, result) => { assert.ok(result, name); checks++; console.log("PASS", name); };
const queue = page.locator(".task-launch-window"), list = queue.locator(".task-launch-list");
const rows = queue.locator(".task-launch-row");
const start = queue.getByRole("button", { name: "Запустить", exact: true });
async function drop() {
  const count = await rows.count();
  await page.locator("#listTask .task-status-label").first().dragTo(list);
  await page.waitForFunction(expected => document.querySelectorAll(".task-launch-row").length === expected, count + 1);
  await page.waitForFunction(() => !document.querySelector(".task-launch-remove").disabled);
}
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__task-queue`);
  await page.waitForFunction(() => window.queueFixture?.ready);
  const access = page.locator(".task-access-dialog");
  await access.getByRole("button", { name: "Выбрать диск с проектами", exact: true }).click();
  await access.getByRole("button", { name: "Продолжить", exact: true }).click();
  await page.locator("#projectCatalog").selectOption("clark.projects");
  await page.locator("#listProject").selectOption("Проект 1");
  await page.getByRole("button", { name: "Формирование списка заданий и запуск приложений", exact: true }).click();
  await queue.waitFor();
  const geometry = await queue.boundingBox(), middle = await page.locator(".task-summary-panel").boundingBox();
  check("default covers both right panels at maximum height", Math.abs(geometry.x - middle.x) < 2
    && geometry.y === 8 && geometry.height === viewport.height - 16 && geometry.x + geometry.width >= viewport.width - 10);
  check("static yellow heading", await queue.locator(".floating-window-title").textContent()
    === "Список заданий для расчета: сформируйте перетаскиванием из списков в проектах и запустите расчет"
    && await queue.locator(".floating-window-titlebar").evaluate(el => getComputedStyle(el).backgroundColor) === "rgb(255, 223, 85)");
  check("removed controls and counts are absent", await queue.locator(".task-launch-metadata,.task-launch-toolbar,.task-launch-counts").count() === 0);
  check("empty queue cannot launch", await rows.count() === 0 && await start.isDisabled());
  await drop(); await page.waitForFunction(() => ![...document.querySelectorAll(".task-launch-start")][0].disabled);
  check("drop adds the full catalog/project/task path", await rows.first().locator(".task-status-name").textContent() === "clark.projects/Проект 1/Задание");
  await page.locator("#listTask .task-status-label").first().dragTo(list);
  await page.waitForTimeout(200);
  check("repeated drop keeps a single task", await rows.count() === 1);
  await page.locator("#listProject").selectOption("Проект 2"); await drop();
  await page.locator("#projectCatalog").selectOption("CLARK.Tests");
  await page.locator("#listProject").selectOption("Проект 1"); await drop();
  check("catalog and project changes retain the formed queue", JSON.stringify(await rows.locator(".task-status-name").allTextContents())
    === JSON.stringify(["clark.projects/Проект 1/Задание", "clark.projects/Проект 2/Задание", "CLARK.Tests/Проект 1/Задание"]));
  check("launcher receives portable cross-catalog paths", await page.evaluate(() => queueFixture.read("clark.tasks.txt"))
    === "Проект 1/Задание\nПроект 2/Задание\n../CLARK.Tests/Проект 1/Задание\n");
  await page.evaluate(() => queueFixture.setDirty("CLARK.Tests/Проект 1/Задание"));
  await page.waitForFunction(() => document.querySelector(".task-launch-save-prompt")
    && document.querySelector(".task-launch-start").disabled);
  check("dirty queued task from another catalog blocks launching", await start.isDisabled());
  await page.evaluate(() => queueFixture.setDirty(null));
  await rows.nth(1).getByRole("button").click();
  await page.waitForFunction(() => document.querySelectorAll(".task-launch-row").length === 2);
  check("cross removes only its own row", (await rows.locator(".task-status-name").allTextContents()).join("|")
    === "clark.projects/Проект 1/Задание|CLARK.Tests/Проект 1/Задание");
  await page.waitForFunction(() => !document.querySelector(".task-launch-start").disabled);
  await start.click();
  check("launch freezes editing until acceptance", await rows.first().getByRole("button").isDisabled());
  await page.evaluate(() => queueFixture.ack());
  await page.waitForFunction(() => !document.querySelector(".task-launch-remove").disabled);
  check("native acceptance restores ordinary controls", await rows.count() === 2 && await start.isEnabled());
  if (process.env.QUEUE_SCREENSHOT) await page.screenshot({ path: process.env.QUEUE_SCREENSHOT });
  await queue.getByRole("button", { name: "Закрыть окно", exact: true }).click();
  await page.getByRole("button", { name: "Формирование списка заданий и запуск приложений", exact: true }).click();
  check("closing and reopening retains the same queue", await rows.count() === 2);
  check("no browser errors", errors.length === 0);
  console.log(`Task queue browser PASS: ${checks} checks`);
} finally { await browser.close(); await server.close(); }
