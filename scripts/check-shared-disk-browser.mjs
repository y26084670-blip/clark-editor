import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const viewer = resolve(process.env.VIEWER_ROOT || resolve(root, "../clark-viewer"));
const output = process.env.CHECK_OUTPUT || "/tmp/clark-shared-disk-check";
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const server = await createServer({ root, cacheDir: `${output}/vite-cache`,
  resolve: { dedupe: ["solid-js"] },
  server: { host: "127.0.0.1", port: 0, fs: { allow: [root, viewer,
    await realpath(resolve(root, "node_modules")), await realpath(resolve(viewer, "node_modules"))] } },
  plugins: [{ name: "shared-disk-fixture", configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith("/__shared-disk/")) return next();
      const fixture = req.url.startsWith("/__shared-disk/editor") ? "/test/browser/taskAccess.fixture.jsx"
        : `/@fs/${viewer}/test/browser/projectDisk.fixture.jsx`;
      res.setHeader("Content-Type", "text/html");
      res.end(await server.transformIndexHtml(req.url,
        `<html><body><div id="root"></div><script type="module" src="${fixture}"></script></body></html>`));
    });
  } }],
});
await server.listen();
const profile = await mkdtemp(resolve(tmpdir(), "clark-shared-disk-"));
const context = await chromium.launchPersistentContext(profile, { executablePath: process.env.CHROMIUM_EXECUTABLE, headless: true,
  viewport: { width: 1440, height: 900 },
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const errors = [], checks = [];
const makePage = async () => {
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message)); return page;
};
const pass = label => { checks.push(label); console.log("PASS", label); };
const waitCatalog = (page, name) => page.waitForFunction(name => document.querySelector("#projectCatalog")?.value === name, name);
const viewerPage = await makePage(), editor = await makePage();
const access = editor.locator(".task-access-dialog");
const pickEditor = async () => {
  await access.getByRole("button", { name: "Выбрать диск с проектами", exact: true }).click();
  await editor.waitForFunction(() => !document.querySelector(".task-access-dialog button").disabled);
};
try {
  await viewerPage.goto(`${origin}/__shared-disk/viewer`);
  await viewerPage.waitForFunction(() => window.diskFixture?.ready);
  assert.equal(await viewerPage.locator("#projectCatalog").isDisabled(), true);
  assert.equal(await viewerPage.evaluate(() => diskFixture.calls.length), 0);
  pass("Viewer without a saved disk offers explicit disk selection");
  await editor.goto(`${origin}/__shared-disk/editor`);
  await editor.waitForFunction(() => window.accessFixture?.ready);
  await editor.waitForLoadState("networkidle");
  const help = editor.locator(".general-information-dialog");
  if (await help.isVisible()) await help.getByRole("button", { name: "Закрыть", exact: true }).click();
  await access.waitFor({ state: "visible" }); await pickEditor();
  await waitCatalog(viewerPage, "clark.projects");
  assert.deepEqual(await viewerPage.locator("#projectCatalog option").allTextContents(), ["clark.projects", "CLARK.Tests"]);
  assert.equal(await viewerPage.evaluate(() => diskFixture.calls.length), 0);
  assert.deepEqual(await viewerPage.evaluate(() => diskFixture.queries), [{ mode: "readwrite" }]);
  pass("Editor publishes a real directory handle; open Viewer receives it through IndexedDB and notification without a picker");
  await access.getByRole("button", { name: "Продолжить", exact: true }).click();
  await editor.locator("#listProject").selectOption("Project");
  await editor.locator("#listTask .listTask-item").filter({ hasText: /^Задание$/ }).dblclick();
  await editor.waitForFunction(() => accessFixture.path()?.includes("clark.projects/Project/Задание"));
  await editor.getByRole("button", { name: "Выбор задания", exact: true }).click();
  await viewerPage.getByLabel("Список проектов", { exact: true }).selectOption("Project");
  await viewerPage.getByRole("option", { name: /Задание/, exact: false }).last().dblclick();
  await viewerPage.waitForFunction(() => diskFixture.path() === "clark.projects/Project/Задание");
  await viewerPage.locator("#projectCatalog").selectOption("CLARK.Tests");
  assert.equal(await editor.locator("#projectCatalog").inputValue(), "clark.projects");
  assert.equal(await viewerPage.evaluate(() => diskFixture.path()), "clark.projects/Project/Задание");
  assert.equal(await editor.evaluate(() => accessFixture.path()), "clark.projects/Project/Задание");
  pass("catalog selection is independent; switching catalogs preserves both loaded tasks");

  await editor.getByRole("button", { name: "Выбрать в Viewer", exact: true }).click();
  await waitCatalog(viewerPage, "clark.projects");
  await viewerPage.waitForFunction(() => document.querySelector('[aria-label="Список проектов"]')?.value === "Project"
    && document.querySelector('.task-list .selected, [role="option"].selected')?.textContent.includes("Задание"));
  assert.equal(await viewerPage.evaluate(() => diskFixture.path()), "clark.projects/Project/Задание");
  pass("Editor selects all three levels in Viewer across catalogs without reloading results");
  await viewerPage.locator("#projectCatalog").selectOption("CLARK.Tests");
  await viewerPage.getByLabel("Список проектов", { exact: true }).selectOption("Другой проект");
  await viewerPage.getByRole("option", { name: /Задание/ }).last().click();
  await viewerPage.getByRole("button", { name: "Выбрать в Editor", exact: true }).click();
  await waitCatalog(editor, "CLARK.Tests");
  await editor.waitForFunction(() => document.querySelector("#listProject")?.value === "Другой проект"
    && document.querySelector("#listTask .selected")?.textContent.includes("Задание"));
  assert.equal(await editor.evaluate(() => accessFixture.path()), "clark.projects/Project/Задание");
  pass("Viewer selects all three levels in Editor while preserving the loaded model");
  await editor.locator("#projectCatalog").selectOption("clark.projects");
  await editor.locator("#listProject").selectOption("Project");
  await editor.locator("#listTask .listTask-item").filter({ hasText: /Задание/ }).first().click();

  const beforeSummary = await editor.locator(".task-summary-text").inputValue();
  await editor.evaluate(async () => {
    const { modelService } = await import("/src/services/modelService.js");
    const { tabRegistry } = await import("/src/services/tabRegistry.js");
    modelService.setModelPart(tabRegistry.find(item => item.id === "general"), { ...modelService.getModel().general, timeStep: 3.125 });
  });
  await editor.getByRole("button", { name: "Сохранить модель", exact: true }).click();
  await editor.waitForFunction(() => document.querySelector(".task-summary-text")?.value.includes("3.125"));
  assert.notEqual(await editor.locator(".task-summary-text").inputValue(), beforeSummary);
  const savedText = await editor.evaluate(async () => {
    let handle = await navigator.storage.getDirectory();
    for (const name of ["access-test", "Диск Д", "clark.projects", "Project", "Задание", "input3XX"]) handle = await handle.getDirectoryHandle(name);
    return (await (await handle.getFileHandle("_summary.txt")).getFile()).text();
  });
  assert.equal(await editor.locator(".task-summary-text").inputValue(), savedText);
  pass("saving overwrites the existing summary and immediately refreshes its displayed text");

  await editor.getByRole("button", { name: "Открыть 3D-просмотр геометрии", exact: true }).click();
  await editor.getByRole("button", { name: "Общие опции отображения", exact: true }).click();
  await editor.getByLabel("Производительность", { exact: true }).check();
  await editor.getByRole("button", { name: "Общие опции отображения", exact: true }).click();
  await editor.locator(".geometry-performance-overlay").getByText(/render .* ms/).waitFor();
  const position = await editor.locator(".geometry-performance-overlay").evaluate(element => {
    const panel = element.getBoundingClientRect(), parent = element.parentElement.getBoundingClientRect();
    return { left: panel.left - parent.left, top: panel.top - parent.top };
  });
  assert.ok(Math.abs(position.left - 8) <= 1 && Math.abs(position.top - 8) <= 1);
  await editor.screenshot({ path: `${output}/editor-performance.png` });
  await editor.getByRole("button", { name: "Закрыть 3D-просмотр геометрии", exact: true }).click();
  pass("Editor performance panel reports real WebGL frame counters at the upper left");

  await editor.evaluate(async () => {
    let handle = await navigator.storage.getDirectory();
    for (const name of ["access-test", "Диск Д", "clark.projects", "Project", "Задание", "DOCS"]) handle = await handle.getDirectoryHandle(name, { create: true });
    for (const [name, text] of [["README.txt", "Описание задания"], ["protocol.html", "<h1>Протокол</h1>"]]) {
      const stream = await (await handle.getFileHandle(name, { create: true })).createWritable();
      await stream.write(text); await stream.close();
    }
    window.dispatchEvent(new Event("focus"));
  });
  await editor.getByRole("tab", { name: /^DOCS/ }).click();
  const documentList = editor.getByLabel("Текстовый документ DOCS", { exact: true });
  await documentList.waitFor();
  await editor.waitForFunction(() => document.querySelector('[aria-label="Текстовый документ DOCS"]').value === "README.txt");
  assert.equal(await documentList.locator("option").last().textContent(), "все документы см в Viewer");
  assert.equal(await documentList.locator("option").last().isDisabled(), true);
  await documentList.focus(); await editor.keyboard.press("End"); await editor.keyboard.press("Enter");
  assert.equal(await documentList.inputValue(), "README.txt");
  assert.equal(await editor.getByLabel("Содержимое документа DOCS", { exact: true }).inputValue(), "Описание задания");
  pass("Editor lower DOCS dropdown contains a disabled hint that does not replace the document");

  await editor.getByRole("button", { name: "Доступ к проектам", exact: true }).click();
  await editor.evaluate(() => accessFixture.mode("empty")); await pickEditor();
  assert.equal(await viewerPage.locator("#projectCatalog").inputValue(), "CLARK.Tests");
  assert.equal(await viewerPage.evaluate(() => diskFixture.path()), "clark.projects/Project/Задание");
  pass("another tab changing the shared disk does not switch an existing Viewer task");
  await editor.evaluate(() => accessFixture.mode("disk")); await pickEditor(); await editor.close();
  await viewerPage.reload(); await waitCatalog(viewerPage, "clark.projects");
  assert.equal(await viewerPage.evaluate(() => diskFixture.calls.length), 0);
  pass("Viewer restores the saved disk after the Editor tab is closed and Viewer is reloaded");
  await viewerPage.goto(`${origin}/__shared-disk/viewer?permission=prompt`);
  const allow = viewerPage.getByRole("button", { name: /Разрешить доступ к диску/ });
  await allow.waitFor();
  assert.equal(await viewerPage.evaluate(() => diskFixture.requests.length), 0);
  assert.equal(await viewerPage.locator("#projectCatalog").isDisabled(), true);
  await viewerPage.evaluate(() => diskFixture.requestResult("denied")); await allow.click();
  await viewerPage.getByRole("status").filter({ hasText: "не разрешён" }).waitFor();
  assert.equal(await viewerPage.locator("#projectCatalog").isDisabled(), true);
  await viewerPage.evaluate(() => diskFixture.requestResult("granted")); await allow.click();
  await waitCatalog(viewerPage, "clark.projects");
  assert.deepEqual(await viewerPage.evaluate(() => diskFixture.requests), [
    { mode: "readwrite", active: true }, { mode: "readwrite", active: true },
  ]);
  pass("restoration never prompts automatically; denial and user-activated permission retry work");
  for (const mode of ["cancel", "denied"]) {
    await viewerPage.evaluate(value => diskFixture.mode(value), mode);
    await viewerPage.getByRole("button", { name: "Выбрать диск с проектами", exact: true }).click();
    await waitCatalog(viewerPage, "clark.projects");
  }
  pass("cancelled and denied disk pickers preserve the current catalog");
  await viewerPage.goto(`${origin}/__shared-disk/viewer?permission=delay`);
  await viewerPage.waitForFunction(() => window.diskFixture?.queries.length === 1);
  await viewerPage.getByRole("button", { name: "Выбрать диск с проектами", exact: true }).click();
  await waitCatalog(viewerPage, "clark.viewer");
  await viewerPage.evaluate(() => diskFixture.release());
  await viewerPage.waitForLoadState("networkidle");
  assert.equal(await viewerPage.locator("#projectCatalog").inputValue(), "clark.viewer");
  pass("late restoration cannot overwrite a newer explicit disk selection");
  for (const width of [1100, 1440]) {
    await viewerPage.setViewportSize({ width, height: width === 1100 ? 600 : 900 });
    assert.equal(await viewerPage.locator(".task-catalog-row").evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
    await viewerPage.screenshot({ path: `${output}/viewer-${width}.png` });
  }
  pass("Viewer catalog dropdown and folder button fit at 1100 and 1440 pixels");
  const noStorage = await makePage();
  await noStorage.addInitScript(() => Object.defineProperty(window, "indexedDB", { get() { throw new DOMException("Blocked", "SecurityError"); } }));
  await noStorage.goto(`${origin}/__shared-disk/viewer`);
  await noStorage.getByRole("status").filter({ hasText: "Сохранённый диск недоступен" }).waitFor();
  await noStorage.getByRole("button", { name: "Выбрать диск с проектами", exact: true }).click();
  await waitCatalog(noStorage, "clark.viewer");
  await noStorage.getByRole("status").filter({ hasText: "Не удалось сохранить" }).waitFor();
  pass("unavailable IndexedDB does not prevent local disk selection and project access");
  assert.deepEqual(errors, []); pass("no browser exceptions");
  console.log(`${checks.length} shared-disk browser checks passed`);
} finally { await context.close(); await server.close(); await rm(profile, { recursive: true, force: true }); }
