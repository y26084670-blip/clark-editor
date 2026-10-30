import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chooseProjectDisk } from "./browser-project-access.mjs";

// Actual Editor, dirty model, OPFS and native browser downloads.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = process.env.CHECK_OUTPUT || "/tmp/clark-editor-protocol-download";
await mkdir(output, { recursive: true });
const protocol = process.env.VIEWER_PROTOCOL_HTML ? await readFile(process.env.VIEWER_PROTOCOL_HTML, "utf8")
  : '<!doctype html><meta charset="utf-8"><h1>Протокол</h1><script>window.protocolReady=true;</script>\r\n';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const server = await createServer({ root, cacheDir: `${output}/vite-cache`, server: { host: "127.0.0.1", port: 0, hmr: false },
  plugins: [{ name: "protocol-download-fixture", configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (req.url !== "/__protocol-download") return next();
      res.setHeader("Content-Type", "text/html");
      res.end(await server.transformIndexHtml(req.url, '<html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/test/browser/taskOperations.fixture.jsx"></script></body></html>'));
    });
  } }],
});
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(20000);
const checks = [], errors = [], downloads = [];
page.on("pageerror", error => errors.push(error.message)); page.on("download", download => downloads.push(download));
page.context().on("page", tab => { tab.on("download", d => downloads.push(d)); tab.on("pageerror", e => errors.push(e.message)); });
const pass = name => { checks.push(name); console.log(`PASS ${checks.length}: ${name}`); };
const row = name => page.locator("#listTask .listTask-item").filter({ has: page.locator(".task-status-label", { hasText: new RegExp(`^(?:▶\\s*)?${name}$`) }) });
const icon = name => row(name).locator(".task-protocol-download-button");
const snapshot = () => page.evaluate(async () => ({ model: taskFixture.snapshot(), history: await taskFixture.read("clark.editor-last-task.json") }));
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__protocol-download`, { timeout: 60000 });
  await page.waitForFunction(() => window.taskFixture?.ready);
  await page.evaluate(async html => {
    await taskFixture.put("Project/Reports/DOCS/protocol-10.html", html + "\r\n");
    await taskFixture.put("Project/Reports/DOCS/protocol-2.HTML", html + "\n");
    await taskFixture.put("Project/Reports/DOCS/readme.txt", "Описание");
    await taskFixture.mkdir("Project/Reports/DOCS/folder.html");
    await taskFixture.put("Project/Original/DOCS/protocol.html", html);
  }, protocol);
  await chooseProjectDisk(page); await page.locator("#listProject").selectOption("Project");
  await icon("Original").waitFor(); await icon("Reports").waitFor();
  assert.equal(await icon("Failure").count(), 0); assert.equal(await icon("Reports").innerText(), "2");
  assert.match(await icon("Original").getAttribute("title"), /protocol\.html[\s\S]*[Бб]/);
  pass("Editor task rows show the same download icon, count, date and size for saved DOCS HTML only");

  await row("Original").click(); await page.getByRole("button", { name: "Загрузить для редактирования", exact: true }).click();
  await page.waitForFunction(() => taskFixture.snapshot().model.general);
  await page.evaluate(() => taskFixture.dirty());
  await page.getByRole("button", { name: "Выбор задания", exact: true }).click();
  const before = await snapshot();
  const [report] = await Promise.all([page.waitForEvent("popup"), icon("Original").click()]);
  const downloadButton=report.getByRole("link",{name:"Загрузить",exact:true});await downloadButton.waitFor();
  if (!process.env.VIEWER_PROTOCOL_HTML) await report.frameLocator("iframe").locator("h1").waitFor();
  if (!process.env.VIEWER_PROTOCOL_HTML) assert.equal(await report.frames()[1].evaluate(()=>window.protocolReady),true);
  assert.equal(await report.evaluate(()=>window.opener),null);assert.equal(downloads.length,0);
  const box=await downloadButton.boundingBox();assert.ok(box.x>1200&&box.y<20);
  await report.screenshot({path:`${output}/opened-protocol.png`});
  const [single] = await Promise.all([report.waitForEvent("download"), downloadButton.click()]); await single.saveAs(`${output}/protocol.html`);
  assert.equal(single.suggestedFilename(), "protocol.html"); assert.equal(await readFile(`${output}/protocol.html`, "utf8"), protocol);
  assert.deepEqual(await snapshot(), before);
  pass("The icon opens a working report without downloading; its top-right button downloads original HTML byte for byte, preserving the loaded dirty model and last-opened history");

  await icon("Reports").focus(); await page.keyboard.press("Enter");
  const chooser = page.getByRole("dialog", { name: "Протоколы задания «Reports»", exact: true });
  await chooser.waitFor();
  assert.deepEqual(await chooser.locator(".task-protocol-download-list button > span").allTextContents(), ["protocol-2.HTML", "protocol-10.html"]);
  await page.keyboard.press("Escape"); await chooser.waitFor({ state: "hidden" });
  assert.equal(await icon("Reports").evaluate(node => node === document.activeElement), true);
  await icon("Reports").click(); const chosen = page.waitForEvent("popup");
  await chooser.getByRole("button", { name: /^protocol-10\.html/ }).click(); const selectedReport = await chosen;
  await selectedReport.getByRole("link",{name:"Загрузить",exact:true}).waitFor();assert.equal(downloads.length,1);
  const [selected]=await Promise.all([selectedReport.waitForEvent("download"),selectedReport.getByRole("link",{name:"Загрузить",exact:true}).click()]);
  await selected.saveAs(`${output}/selected.html`); assert.equal(await readFile(`${output}/selected.html`, "utf8"), protocol + "\r\n");
  assert.deepEqual(await snapshot(), before);
  pass("Multiple protocols use a naturally sorted chooser; Enter, Escape, focus return and downloading another task's file leave the model unchanged");

  await page.evaluate(async html => { await taskFixture.put("Project/Failure/DOCS/protocol.html", html); }, protocol);
  await page.getByRole("button", { name: "Обновить список заданий", exact: true }).click();
  await icon("Failure").waitFor();
  pass("Refreshing the Editor list detects a protocol created externally, including a newly created DOCS directory");

  const load = page.locator(".task-browser-actions .task-load-button");
  await row("Original").click(); assert.equal(await load.isEnabled(), true); await load.click();
  await page.waitForFunction(() => document.querySelector('.tabs-header [data-tab-id="general"]')?.classList.contains("active"));
  assert.deepEqual(await snapshot(), before);
  await page.getByRole("button", { name: "Выбор задания", exact: true }).click(); await row("Original").dblclick();
  await page.waitForFunction(() => document.querySelector('.tabs-header [data-tab-id="general"]')?.classList.contains("active"));
  assert.deepEqual(await snapshot(), before);
  pass("Reopening the loaded task by button or double click always opens General without rereading or discarding dirty edits");

  await page.getByRole("button", { name: "Выбор задания", exact: true }).click();
  await page.getByRole("button", { name: "Обновить список заданий", exact: true }).click(); await row("Original").click(); await load.click();
  await page.waitForFunction(() => document.querySelector('.tabs-header [data-tab-id="general"]')?.classList.contains("active"));
  assert.deepEqual(await snapshot(), before);
  pass("Reopening after a task-list refresh recognizes a new native handle for the same directory and preserves dirty state");

  await page.getByRole("button", { name: "Выбор задания", exact: true }).click();
  await icon("Original").waitFor();
  const beforeCount = downloads.length;
  await page.evaluate(() => {
    const getFile = FileSystemFileHandle.prototype.getFile;
    FileSystemFileHandle.prototype.getFile = async function(...args) {
      if (this.name === "protocol.html") await new Promise(resolve => { taskFixture.releaseDownload = () => { FileSystemFileHandle.prototype.getFile = getFile; resolve(); }; });
      return getFile.apply(this, args);
    };
  });
  const [pendingReport]=await Promise.all([page.waitForEvent("popup"),icon("Original").click()]); await page.waitForFunction(() => taskFixture.releaseDownload);
  await page.locator("#listProject").selectOption("Second"); await page.evaluate(() => taskFixture.releaseDownload());
  await page.waitForTimeout(200); assert.equal(downloads.length, beforeCount); assert.equal(pendingReport.isClosed(),true); assert.deepEqual(await snapshot(), before);
  pass("Changing projects closes a pending report tab without altering the loaded model");

  await page.locator("#listProject").selectOption("Project"); await icon("Original").waitFor();
  await page.screenshot({ path: `${output}/editor-protocol-download.png`, fullPage: true });
  await page.close();
  const [independent]=await Promise.all([report.waitForEvent("download"),downloadButton.click()]);
  await independent.saveAs(`${output}/after-gui-close.html`);assert.equal(await readFile(`${output}/after-gui-close.html`, "utf8"),protocol);
  pass("The report and original HTML download survive closing Editor");
  assert.deepEqual(errors, []); await writeFile(`${output}/results.json`, JSON.stringify({ checks, errors }, null, 2));
  console.log(`BROWSER_OK ${checks.length}/${checks.length}`);
} catch (error) {
  if (!page.isClosed()) await page.screenshot({path:`${output}/failure.png`,fullPage:true});
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, errors, failure: error.stack }, null, 2)); throw error;
} finally { await browser.close(); await server.close(); }
