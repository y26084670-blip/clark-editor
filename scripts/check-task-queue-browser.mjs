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
const refresh = queue.getByRole("button", { name: "Обновить состояние расчета заданий", exact: true });
async function checkPanelBounds(name) {
  const actual = await queue.boundingBox(), middle = await page.locator(".task-summary-panel").boundingBox();
  const right = await page.locator(".task-results-panel").boundingBox();
  check(name, Math.abs(actual.x - middle.x) < 2 && Math.abs(actual.y - middle.y) < 2
    && Math.abs(actual.width - (right.x + right.width - middle.x)) < 2
    && Math.abs(actual.height - middle.height) < 2);
}
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
  await checkPanelBounds("expanded queue matches both right panels");
  check("only minimize and close window actions remain", await queue.getByRole("button", { name: /На весь экран|На всю высоту|Восстановить размер/ }).count() === 0
    && await queue.evaluate(element => getComputedStyle(element).resize) === "none");
  check("compact dark heading with yellow text", await queue.locator(".floating-window-title").textContent()
    === "Список заданий для расчета: сформируйте перетаскиванием из списков в проектах и запустите расчет"
    && await queue.locator(".floating-window-titlebar").evaluate(el => {
      const style = getComputedStyle(el);
      return style.backgroundColor === "rgb(41, 49, 58)" && style.color === "rgb(255, 223, 85)"
        && Math.abs(el.getBoundingClientRect().height - 39) < 1;
    }));
  check("removed controls and counts are absent", await queue.locator(".task-launch-metadata,.task-launch-toolbar,.task-launch-counts").count() === 0);
  check("empty queue cannot launch", await rows.count() === 0 && await start.isDisabled());
  await drop(); await page.waitForFunction(() => ![...document.querySelectorAll(".task-launch-start")][0].disabled);
  check("drop adds the full catalog/project/task path", await rows.first().locator(".task-status-name").textContent() === "clark.projects/Проект 1/Задание");
  const mpiLabel = await queue.locator(".task-launch-mpi > span").boundingBox();
  const mpiInput = await queue.locator(".task-launch-mpi input").boundingBox();
  const mpiRow = await queue.locator(".task-launch-mpi").boundingBox();
  const taskName = await rows.first().locator(".task-status-name").boundingBox();
  const twoCharacters = await queue.locator(".task-launch-mpi > span").evaluate(element => {
    const context = document.createElement("canvas").getContext("2d");
    context.font = getComputedStyle(element).font;
    return context.measureText("00").width;
  });
  check("MPI label is two characters left of task paths while the input keeps its position", Math.abs(mpiLabel.x + twoCharacters - taskName.x) < 1
    && Math.abs(mpiInput.x + mpiInput.width - mpiRow.x - mpiRow.width) < 1
    && mpiInput.x - mpiLabel.x - mpiLabel.width >= 9 && mpiInput.width < mpiRow.width * 0.7);
  await page.locator("#listTask .task-status-label").first().dragTo(list);
  await page.waitForTimeout(200);
  check("repeated drop keeps a single task", await rows.count() === 1);
  await page.evaluate(() => queueFixture.otherStatuses("clark.projects/Проект 1/Задание"));
  await page.evaluate(() => queueFixture.completed("clark.projects/Проект 1/Задание", true));
  await refresh.click();
  await page.waitForFunction(() => document.querySelectorAll(".task-launch-solution [role=img]").length === 1);
  check("refresh shows only the completed calculation checkmark", await rows.getByRole("img", { name: "Решение получено", exact: true }).count() === 1
    && await queue.locator(".task-status-2d,.task-status-movie,.task-status-comparison,.task-status-missing").count() === 0);
  await page.evaluate(() => queueFixture.completed("clark.projects/Проект 1/Задание", false));
  await refresh.click();
  await page.waitForFunction(() => document.querySelectorAll(".task-launch-solution [role=img]").length === 0);
  check("refresh removes a checkmark when the completed calculation disappears", await rows.getByRole("img").count() === 0);
  await page.locator("#listProject").selectOption("Проект 2"); await drop();
  await page.locator("#projectCatalog").selectOption("CLARK.Tests");
  await page.locator("#listProject").selectOption("Проект 1"); await drop();
  check("catalog and project changes retain the formed queue", JSON.stringify(await rows.locator(".task-status-name").allTextContents())
    === JSON.stringify(["clark.projects/Проект 1/Задание", "clark.projects/Проект 2/Задание", "CLARK.Tests/Проект 1/Задание"]));
  check("launcher receives portable cross-catalog paths", await page.evaluate(() => queueFixture.read("clark.tasks.txt"))
    === "Проект 1/Задание\nПроект 2/Задание\n../CLARK.Tests/Проект 1/Задание\n");
  const loadedPath = await page.evaluate(() => queueFixture.loadedPath());
  for (const [index, catalog, project] of [[0, "clark.projects", "Проект 1"], [1, "clark.projects", "Проект 2"], [2, "CLARK.Tests", "Проект 1"]]) {
    await rows.nth(index).locator(".task-status-name").dblclick();
    await page.waitForFunction(({ catalog, project }) => document.querySelector("#projectCatalog").value === catalog
      && document.querySelector("#listProject").value === project && Boolean(document.querySelector("#listTask .selected")), { catalog, project });
    check(`double click selects ${catalog}/${project}/Задание`, (await page.locator("#listTask .selected .task-status-label").textContent()).trim() === "Задание");
    await page.waitForFunction(() => !document.querySelector(".task-launch-remove").disabled);
  }
  check("queue navigation preserves the loaded editor model", await page.evaluate(() => queueFixture.loadedPath()) === loadedPath);
  const title = queue.locator(".floating-window-titlebar");
  let bounds = await title.boundingBox();
  await page.mouse.move(bounds.x + 70, bounds.y + bounds.height / 2); await page.mouse.down();
  await page.mouse.move(bounds.x - 80, bounds.y - 35, { steps: 5 }); await page.mouse.up();
  await checkPanelBounds("expanded queue cannot be moved away from its panels");
  await queue.getByRole("button", { name: "Свернуть окно", exact: true }).click();
  check("minimized queue is a compact movable titlebar", await queue.evaluate(element => element.classList.contains("is-minimized"))
    && (await queue.boundingBox()).width === 400 && (await queue.boundingBox()).height < 80);
  check("refresh is hidden while the queue is minimized", await refresh.isHidden());
  bounds = await title.boundingBox();
  await page.mouse.move(bounds.x + 60, bounds.y + bounds.height / 2); await page.mouse.down();
  await page.mouse.move(100, 180, { steps: 5 }); await page.mouse.up();
  check("minimized window moves over the left panel", (await queue.boundingBox()).x < 150);
  await queue.getByRole("button", { name: "Развернуть окно", exact: true }).click();
  check("refresh returns when the queue is restored", await refresh.isVisible());
  await checkPanelBounds("restore returns to the panels after moving the minimized window");
  await page.setViewportSize({ width: viewport.width + 100, height: viewport.height + 60 });
  await page.waitForTimeout(150);
  await checkPanelBounds("expanded bounds follow browser resizing");
  await page.setViewportSize(viewport); await page.waitForTimeout(150);
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
  await page.reload(); await page.waitForFunction(() => window.queueFixture?.ready);
  await access.getByRole("button", { name: "Выбрать диск с проектами", exact: true }).click();
  await access.getByRole("button", { name: "Продолжить", exact: true }).click();
  await page.locator("#projectCatalog").selectOption("CLARK.Tests");
  await page.getByRole("button", { name: "Формирование списка заданий и запуск приложений", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".task-launch-row").length === 2);
  check("F5 restores the formed queue even while another catalog is selected", (await rows.locator(".task-status-name").allTextContents()).join("|")
    === "clark.projects/Проект 1/Задание|CLARK.Tests/Проект 1/Задание");
  await checkPanelBounds("reopening after F5 uses only the panel-sized expanded state");
  check("no browser errors", errors.length === 0);
  console.log(`Task queue browser PASS: ${checks} checks`);
} finally { await browser.close(); await server.close(); }
