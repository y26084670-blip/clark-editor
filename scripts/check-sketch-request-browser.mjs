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
const server = await createServer({ root, cacheDir: path.join(out, 'vite-cache'), base: "/clark-editor/", server: { host: "127.0.0.1", port: 0 },
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
const command = page.locator(".side-panel").getByRole("button", { name: "ZIP по эскизу для ИИ", exact: true });
const prepare = dialog.getByRole("button", { name: "Подготовить ZIP", exact: true });
const close = () => dialog.getByRole("button", { name: "Закрыть", exact: true }).click();
const open = async () => { if (!(await command.isVisible())) await button("Открыть дополнительные функции").click(); await command.click(); };
const snapshot = () => page.evaluate(() => taskFixture.snapshot());
const addImage = buffer => dialog.locator('input[type="file"]').setInputFiles({ name: "Эскиз.png", mimeType: "image/png", buffer });
async function downloadZip(filename) {
  const pending = page.waitForEvent("download"); await dialog.getByRole("button", { name: "Скачать пакет ZIP", exact: true }).click();
  const result = await pending; await result.saveAs(path.join(out, filename)); return result;
}
const readyZip = () => page.waitForFunction(() => [...document.querySelectorAll('.sketch-request-dialog footer button')]
  .some(button => button.textContent === 'Скачать пакет ZIP' && !button.disabled));
async function requestFromZip(filename) {
  const zipName = filename.replace(/\.md$/i, '.zip'); await downloadZip(zipName);
  const bytes = await readFile(path.join(out, zipName));
  for (let offset = 0; bytes.readUInt32LE(offset) === 0x04034b50;) {
    assert.equal(bytes.readUInt16LE(offset + 8), 0, 'expected ZIP/STORE');
    const size = bytes.readUInt32LE(offset + 18), nameSize = bytes.readUInt16LE(offset + 26), extraSize = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameSize).toString('utf8');
    const start = offset + 30 + nameSize + extraSize;
    if (name === 'REQUEST.md') { const text = bytes.subarray(start, start + size).toString('utf8');await writeFile(path.join(out, filename), text);return text; }
    offset = start + size;
  }
  throw Error('REQUEST.md missing from downloaded ZIP');
}
try {
  await page.goto(base + "/clark-editor/__sketch-fixture");
  await page.waitForFunction(() => window.taskFixture?.ready);
  await page.locator(".task-access-dialog").getByRole("button", { name: "Закрыть", exact: true }).click();
  await button("Открыть дополнительные функции").click();
  check("ZIP command is available without disk, project or task", await command.isEnabled());
  const emptyBefore = await snapshot();
  const filesBefore = await page.evaluate(async () => {
    async function entries(dir, prefix = "") {
      const result = [];
      for await (const [name, handle] of dir) {
        const path = prefix + name;
        if (handle.kind === "directory") { result.push([path + "/"]); result.push(...await entries(handle, path + "/")); }
        else {
          const data = await (await handle.getFile()).arrayBuffer();
          const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))].join(",");
          result.push([path, hash]);
        }
      }
      return result.sort((a, b) => a[0].localeCompare(b[0]));
    }
    window.sketchFixtureFiles = () => navigator.storage.getDirectory().then(dir => entries(dir));
    window.sketchOriginalPicker = window.showDirectoryPicker;
    window.showDirectoryPicker = () => { throw new Error("Sketch must not request a project directory"); };
    return window.sketchFixtureFiles();
  });
  const png = Buffer.from(await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 200; c.height = 120;
    const ctx = c.getContext("2d"); ctx.fillStyle = "white"; ctx.fillRect(0, 0, 200, 120);
    ctx.strokeStyle = "black"; ctx.strokeRect(20, 20, 160, 80);
    return c.toDataURL("image/png").split(",")[1];
  }), "base64");
  await command.click(); await dialog.waitFor({ state: "visible" });
  const condition = dialog.getByLabel("Масштаб и уточнения", { exact: true });
  const defaultCondition = "d=10 мм, использовать не более 20 шестигранников";
  check("condition starts with editable content, not a placeholder", await condition.inputValue() === defaultCondition
    && !(await condition.getAttribute("placeholder")));
  check("all four actions share the bottom row and ZIP is disabled until prepared", await dialog.locator('footer button').count() === 4
    && await dialog.getByRole('button', {name:'Скачать пакет ZIP',exact:true}).isDisabled()
    && await dialog.getByRole('link',{name:'Скачать REQUEST.md отдельно',exact:true}).count() === 0);
  await addImage(png);
  await prepare.click(); await readyZip();
  await requestFromZip("REQUEST-default.md");
  const defaultRequest = await readFile(path.join(out, "REQUEST-default.md"), "utf8");
  check("unchanged example is exported as the user condition", defaultRequest.includes(defaultCondition));
  await condition.focus(); await condition.press("End"); await condition.pressSequentially("; материал назначу позже");
  check("typing preserves the starting text", await condition.inputValue() === defaultCondition + "; материал назначу позже");
  await condition.fill("d=12 мм, использовать не более 12 шестигранников");
  await prepare.click(); await readyZip();
  await requestFromZip("REQUEST-custom-limit.md");
  const custom = (await readFile(path.join(out, "REQUEST-custom-limit.md"), "utf8")).split("## Условие пользователя")[1].split("## Эскизы")[0];
  check("edited scale and limit replace the example", custom.includes("d=12 мм, использовать не более 12 шестигранников") && !custom.includes("20"));
  await condition.fill("");
  await prepare.click(); await readyZip();
  await requestFromZip("REQUEST-empty.md");
  const empty = (await readFile(path.join(out, "REQUEST-empty.md"), "utf8")).split("## Условие пользователя")[1].split("## Эскизы")[0];
  check("cleared condition does not silently restore scale or limit", empty.includes("условие пока не задано") && !empty.includes("20"));
  await condition.fill("d = 10 мм");
  await prepare.click(); await readyZip();
  await downloadZip("request-d-only.zip");
  await requestFromZip("REQUEST-d-only.md");
  const minimal = await readFile(path.join(out, "REQUEST-d-only.md"), "utf8");
  check("sketch and d alone produce a request with layout and trial-dimension rules", minimal.includes("d = 10 мм")
    && minimal.includes("SKETCH-LAYOUT-01") && minimal.includes("ПРОБНЫЕ"));
  check("ZIP preparation creates no task and changes no files or model", JSON.stringify(await snapshot()) === JSON.stringify(emptyBefore)
    && JSON.stringify(await page.evaluate(() => window.sketchFixtureFiles())) === JSON.stringify(filesBefore));
  await close();
  await page.evaluate(() => { window.showDirectoryPicker = window.sketchOriginalPicker; });
  if (await button("Закрыть дополнительные функции").isVisible()) await button("Закрыть дополнительные функции").click();
  await chooseProjectDisk(page);
  await page.locator("#listProject").selectOption("Project");
  await page.locator("#listTask .listTask-item").filter({ has: page.locator(".task-status-label", { hasText: /^(?:▶\s*)?Original$/ }) }).click();
  await button("Загрузить для редактирования").click();
  await page.waitForFunction(() => taskFixture.snapshot().model.general);
  await page.evaluate(() => taskFixture.dirty());
  const before = await snapshot();
  await button("Выбор задания").click();
  await button("Открыть дополнительные функции").click();
  await command.click(); await dialog.waitFor({ state: "visible" });
  check("empty sketch cannot produce a request", await prepare.isDisabled());
  await addImage(png);
  await dialog.getByLabel("Название запроса", { exact: true }).fill("Блок по наброску");
  await dialog.getByLabel("Масштаб и уточнения", { exact: true }).fill("Длина 40 мм; остальные размеры уточнить.");
  await page.waitForFunction(() => document.querySelector(".sketch-request-previews img")?.naturalWidth === 200);
  check("selected image is decoded and previewed", await dialog.locator("figure").count() === 1);
  await prepare.click(); await readyZip();
  const zip = await downloadZip("request.zip");
  await requestFromZip("REQUEST.md");
  const request = await readFile(path.join(out, "REQUEST.md"), "utf8");
  check("downloaded ZIP contains REQUEST.md with the condition and seven actual schemas", /^clark-sketch-[\w-]+\.zip$/u.test(zip.suggestedFilename())
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
    check(`footer actions are aligned with ZIP immediately after Prepare at ${width}px`, await dialog.locator('footer').evaluate(footer => {
      const buttons=[...footer.querySelectorAll('button')], rects=buttons.map(button=>button.getBoundingClientRect());
      return buttons.map(button=>button.textContent).join('|')==='Подготовить ZIP|Скачать пакет ZIP|Скопировать инструкцию|Закрыть'
        && rects.every(rect=>Math.abs(rect.top-rects[0].top)<1&&Math.abs(rect.bottom-rects[0].bottom)<1)
        && rects[1].left>rects[0].right && rects[2].left>rects[1].right;
    }));
    await page.screenshot({ path: path.join(out, `sketch-${width}.png`) });
  }
  await dialog.getByLabel("Масштаб и уточнения", { exact: true }).fill("Исправлено: длина 50 мм.");
  check("editing the condition invalidates the previous package", await dialog.locator(".sketch-request-result").count() === 0);
  await prepare.click(); await readyZip();
  await requestFromZip("REQUEST-updated.md");
  check("rebuilt package uses the current condition", (await readFile(path.join(out, "REQUEST-updated.md"), "utf8")).includes("длина 50 мм"));
  await close(); await open();
  check("reopening starts a new request with the editable example", await condition.inputValue() === defaultCondition && await prepare.isDisabled() && await dialog.getByLabel("Название запроса", { exact: true }).inputValue() === ""
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
  await addImage(png); await prepare.click(); await readyZip();
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
