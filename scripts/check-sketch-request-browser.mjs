// Real App/OPFS; the OS picker is controlled. No model service is invoked.
import { chooseProjectDisk } from "./browser-project-access.mjs";
import { createServer } from "vite";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const out = path.resolve(process.env.CHECK_OUTPUT ?? "/tmp/clark-sketch-browser");
await mkdir(out, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), "clark-sketch-browser-"));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const server = await createServer({ root, base: "/clark-editor/", server: { host: "127.0.0.1", port: 0 },
  plugins: [{ name: "sketch-fixture-route", configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.split("?")[0].endsWith("/__sketch-fixture")) return next();
      res.setHeader("Content-Type", "text/html");
      res.end(await server.transformIndexHtml(req.url, '<html><body><div id="root"></div><script type="module" src="/test/browser/taskOperations.fixture.jsx"></script></body></html>'));
    });
  } }],
});
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, headless: true,
  viewport: { width: 1440, height: 900 }, acceptDownloads: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = browser.pages()[0];
page.setDefaultTimeout(15000);
const errors = [], checks = [], modelRequests = [];
page.on("pageerror", error => errors.push(error.message));
page.on("request", req => { if (/chatgpt\.com|api\.openai\.com/u.test(req.url())) modelRequests.push(req.url()); });
const check = (name, condition) => { assert.ok(condition, name); checks.push(name); console.log("PASS", name); };
const button = name => page.getByRole("button", { name, exact: true });
const dialog = page.locator(".sketch-request-dialog");
const command = page.locator(".side-panel").getByRole("button", { name: "По эскизу", exact: true });
const prepare = dialog.getByRole("button", { name: "Подготовить пакет", exact: true });
const close = () => dialog.getByRole("button", { name: "Вернуться к заданиям", exact: true }).click();
const open = async () => { if (!(await command.isVisible())) await button("Открыть дополнительные функции").click(); await command.click(); };
const snapshot = () => page.evaluate(() => taskFixture.snapshot());
const addImage = buffer => dialog.locator('input[type="file"]').setInputFiles({ name: "Эскиз.png", mimeType: "image/png", buffer });
async function download(name, filename) {
  const pending = page.waitForEvent("download"); await dialog.getByRole("link", { name, exact: true }).click();
  const result = await pending; await result.saveAs(path.join(out, filename)); return result;
}
try {
  await page.goto(base + "/clark-editor/__sketch-fixture");
  await page.waitForFunction(() => window.taskFixture?.ready);
  await page.locator(".task-access-dialog").getByRole("button", { name: "Закрыть", exact: true }).click();
  await button("Открыть дополнительные функции").click();
  check("command disabled without a selected project", await command.isDisabled());
  await button("Закрыть дополнительные функции").click();
  await chooseProjectDisk(page);
  await page.locator("#listProject").selectOption("Project");
  await page.locator("#listTask .listTask-item").filter({ hasText: /^Original$/ }).click();
  await button("Загрузить для редактирования").click();
  await page.waitForFunction(() => taskFixture.snapshot().model.general);
  await page.evaluate(() => taskFixture.dirty());
  const before = await snapshot();
  await button("Выбор задания").click();
  await button("Открыть дополнительные функции").click();
  await command.click(); await dialog.waitFor({ state: "visible" });
  check("empty sketch cannot produce a request", await prepare.isDisabled());
  const png = Buffer.from(await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 200; c.height = 120;
    const ctx = c.getContext("2d"); ctx.fillStyle = "white"; ctx.fillRect(0, 0, 200, 120);
    ctx.strokeStyle = "black"; ctx.strokeRect(20, 20, 160, 80);
    return c.toDataURL("image/png").split(",")[1];
  }), "base64");
  await addImage(png);
  await dialog.getByLabel("Название задания", { exact: true }).fill("Блок по наброску");
  await dialog.getByLabel("Условие и известные размеры", { exact: true }).fill("Длина 40 мм; остальные размеры уточнить.");
  await page.waitForFunction(() => document.querySelector(".sketch-request-previews img")?.naturalWidth === 200);
  check("selected image is decoded and previewed", await dialog.locator("figure").count() === 1);
  await prepare.click(); await dialog.getByRole("link", { name: "Скачать пакет ZIP", exact: true }).waitFor();
  const zip = await download("Скачать пакет ZIP", "request.zip");
  await download("Скачать REQUEST.md отдельно", "REQUEST.md");
  const request = await readFile(path.join(out, "REQUEST.md"), "utf8");
  check("browser downloads request with condition and seven actual schemas", /^clark-sketch-[\w-]+\.zip$/u.test(zip.suggestedFilename())
    && request.includes("Длина 40 мм") && (request.match(/"exampleOnlyNotTask":/gu) || []).length === 7);
  check("selected images and loaded model remain independent", JSON.stringify(await snapshot()) === JSON.stringify(before)
    && !request.includes('"timeStep": 42'));
  check("external chat is an ordinary explicit link", await dialog.getByRole("link", { name: "ChatGPT", exact: true }).getAttribute("href") === "https://chatgpt.com/");
  await page.evaluate(() => { Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("Unavailable"); } } }); });
  await dialog.getByRole("button", { name: "Скопировать инструкцию", exact: true }).click();
  check("clipboard failure offers manual copying", await dialog.getByText("Не удалось скопировать. Выделите текст инструкции ниже и скопируйте вручную.", { exact: true }).isVisible());
  for (const [width, height] of [[1100, 600], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    check(`dialog remains within viewport ${width}x${height}`, await dialog.evaluate(el => {
      const r = el.getBoundingClientRect(); return r.x >= 0 && r.y >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && el.scrollWidth <= el.clientWidth + 1;
    }));
    await page.screenshot({ path: path.join(out, `sketch-${width}.png`) });
  }
  await dialog.getByLabel("Условие и известные размеры", { exact: true }).fill("Исправлено: длина 50 мм.");
  check("editing the condition invalidates the previous package", await dialog.locator(".sketch-request-result").count() === 0);
  await prepare.click(); await dialog.getByRole("link", { name: "Скачать пакет ZIP", exact: true }).waitFor();
  await download("Скачать REQUEST.md отдельно", "REQUEST-updated.md");
  check("rebuilt package uses the current condition", (await readFile(path.join(out, "REQUEST-updated.md"), "utf8")).includes("длина 50 мм"));
  await close(); await open();
  check("reopening starts an empty request", await prepare.isDisabled() && await dialog.getByLabel("Название задания", { exact: true }).inputValue() === ""
    && await dialog.locator("figure").count() === 0 && await dialog.locator(".sketch-request-result").count() === 0);
  await addImage(png);
  await page.evaluate(() => {
    const digest = crypto.subtle.digest.bind(crypto.subtle); let first = true;
    crypto.subtle.digest = async (...args) => { if (first) { first = false; await new Promise(resolve => { window.resumeSketchDigest = resolve; }); } return digest(...args); };
  });
  await prepare.click(); await page.waitForFunction(() => typeof window.resumeSketchDigest === "function");
  check("preparation exposes its busy state", await prepare.isDisabled() && await dialog.getByText("Подготовка пакета…", { exact: true }).isVisible());
  await close(); await page.evaluate(() => window.resumeSketchDigest());
  await open(); await dialog.waitFor({ state: "visible" });
  // A new successful generation runs after the old async digest has resumed.
  await addImage(png); await prepare.click(); await dialog.getByRole("link", { name: "Скачать пакет ZIP", exact: true }).waitFor();
  check("late completion after close does not prevent a fresh request", await dialog.locator(".sketch-request-result").count() === 1);
  await dialog.locator('input[type="file"]').setInputFiles({ name: "bad.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
  await prepare.click(); await page.waitForFunction(() => document.querySelector(".sketch-request-error")?.textContent.includes("не соответствует расширению"));
  check("incorrect image signature cannot produce a package", await dialog.locator(".sketch-request-result").count() === 0);
  await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
  check("closing keeps the loaded dirty task untouched", JSON.stringify(await snapshot()) === JSON.stringify(before));
  check("no request is sent to a model", modelRequests.length === 0);
  check("no uncaught browser errors", errors.length === 0);
  await writeFile(path.join(out, "checks.json"), JSON.stringify({ checks, errors, modelRequests, browser: browser.browser().version() }, null, 2) + "\n");
  console.log(`${checks.length} browser checks passed; artifacts: ${out}`);
} catch (error) {
  await page.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
  await writeFile(path.join(out, "failure.txt"), `${error.stack}\n${errors.join("\n")}\n${await page.locator("body").innerText().catch(() => "")}`);
  throw error;
} finally { await browser.close(); await server.close(); await rm(profile, { recursive: true, force: true }); }
