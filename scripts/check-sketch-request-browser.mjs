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
const workflow = dialog.getByRole("region", { name: "Порядок работы с ИИ", exact: true });
const chatTable = workflow.getByRole("table");
const repeatabilityNote = "Повторный запрос может дать другую геометрию. Даже у одной модели при тех же исходниках могут различаться число крупных ШГ, положение их границ и внутреннее разбиение";

async function checkChatTable(packageName) {
  assert.deepEqual(await chatTable.getByRole("columnheader").allTextContents(), ["Что приложить", "Что написать в чате"]);
  const rows = chatTable.locator("tbody tr");
  assert.equal(await rows.count(), 2);
  const context = rows.nth(0).getByRole("cell");
  const task = rows.nth(1).getByRole("cell");
  const contextLink = context.first().getByRole("link", { name: "Общий контекст CLARK", exact: true });
  assert.equal(await contextLink.getAttribute("href"), "/clark-editor/geometry/01_CLARK_Context.zip");
  assert.match(await context.first().innerText(), /Один раз для нового чата/);
  assert.equal(await context.last().innerText(), "Открой START.txt в приложенном архиве CLARK и выполни его инструкцию.");
  assert.equal(await task.first().innerText(), packageName + "\nВ том же чате");
  assert.equal(await task.last().innerText(), "Выполни задание из REQUEST.md по приложенным файлам, используя общий контекст CLARK.");
  const note = workflow.getByRole("note");
  assert.equal((await note.innerText()).trim(), repeatabilityNote);
  check(packageName + " — both attachments have the corresponding chat prompts and a static note below",
    await note.isVisible() && await note.evaluate(el => el.previousElementSibling?.tagName === "TABLE"));
}
const aiSection = page.locator(".side-panel details").filter({ hasText: "Подготовка геометрии" });
const command = aiSection.getByRole("button", { name: "Запрос к ИИ по эскизу…", exact: true });
const prepare = dialog.getByRole("button", { name: "Подготовить ZIP", exact: true });
const close = () => dialog.getByRole("button", { name: "Закрыть", exact: true }).click();
const open = async (action = command) => {
  if (!(await button("Закрыть дополнительные функции").isVisible())) await button("Открыть дополнительные функции").click();
  if (!(await aiSection.evaluate(section => section.open))) await aiSection.locator("summary").click();
  await action.click();
};
const snapshot = () => page.evaluate(() => taskFixture.snapshot());
const addImage = buffer => dialog.locator('input[type="file"]').setInputFiles({ name: "Эскиз.png", mimeType: "image/png", buffer });
async function checkPickerCancel(mode) {
  const state = () => dialog.evaluate(el => ({
    open: el.open, example: el.querySelector("select").value,
    title: el.querySelector("input:not([type=file])").value,
    instructions: el.querySelector("textarea")?.value,
    sources: [...el.querySelectorAll("figcaption a")].map(a => [a.download, a.href]),
    ready: !el.querySelector("footer button:nth-of-type(2)").disabled,
  }));
  const before = await state();
  const picker = dialog.locator("input[type=file]");
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Page.setInterceptFileChooserDialog", { enabled: true, cancel: true });
    await picker.evaluate(input => {
      window.geometryPickerCancelled = false;
      input.addEventListener("cancel", event => {
        window.geometryPickerCancelled = event.isTrusted && event.bubbles;
      }, { once: true });
    });
    await picker.click();
    await page.waitForFunction(() => window.geometryPickerCancelled);
    assert.deepEqual(await state(), before);
    check("cancelling the browser file picker preserves the open " + mode + " form and prepared ZIP", before.open && before.ready);
  } finally {
    await session.send("Page.setInterceptFileChooserDialog", { enabled: false });
    await session.detach();
  }
}
async function downloadZip(filename, label = "Скачать пакет ZIP") {
  const pending = page.waitForEvent("download"); await dialog.getByRole("button", { name: label, exact: true }).click();
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
  check("AI requests section starts collapsed with the sketch command hidden", !(await aiSection.evaluate(section => section.open)) && !(await command.isVisible()));
  await aiSection.locator("summary").press("Enter");
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
  const condition = dialog.getByLabel("Инструкции пользователя по задаче", { exact: true });
  await page.waitForFunction(() => document.querySelector(".sketch-request-dialog textarea")?.value.includes("μr=500"));
  const defaultCondition = await condition.inputValue();
  await checkChatTable("Подготовленный пакет эскиза");
  check("workflow retains the steps for preparing the package and unpacking the result",
    (await workflow.innerText()).includes("Скачать пакет ZIP") && (await workflow.innerText()).toLowerCase().includes("распакуйте"));
  check("the editable field identifies its file and the example explains its origin",
    await condition.getAttribute("aria-describedby") === "geometry-instruction-file"
    && await dialog.locator("#geometry-instruction-file code").innerText() === "REQUEST.md"
    && (await dialog.locator(".geometry-example-reference").innerText()).includes("ChatGPT Pro с моделью GPT-6.x Sol"));
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    check("table and cell text fit without horizontal scrolling at " + width + "px", await chatTable.evaluate(table => {
      const bounds = table.getBoundingClientRect();
      const content = table.closest(".sketch-request-content");
      return bounds.left >= 0 && bounds.right <= innerWidth && content.scrollWidth <= content.clientWidth + 1
        && [...table.querySelectorAll("th,td")].every(cell => cell.scrollWidth <= cell.clientWidth + 1);
    }));
  }
  check("condition starts with editable content, not a placeholder", await condition.inputValue() === defaultCondition
    && !(await condition.getAttribute("placeholder")));
  check("all four actions share the bottom row and ZIP is disabled until prepared", await dialog.locator('footer button').count() === 4
    && await dialog.getByRole('button', {name:'Скачать пакет ZIP',exact:true}).isDisabled()
    && await dialog.getByRole('link',{name:'Скачать REQUEST.md отдельно',exact:true}).count() === 0);
  await prepare.click(); await readyZip();
  await checkPickerCancel("sketch prototype");
  await requestFromZip("REQUEST-default.md");
  const defaultRequest = await readFile(path.join(out, "REQUEST-default.md"), "utf8");
  check("unchanged example is exported as the user condition", defaultRequest.includes(defaultCondition) && defaultRequest.includes("в корень итогового ZIP"));
  await condition.focus(); await condition.press("Control+End"); await condition.pressSequentially("; материал назначу позже");
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
  await open(); await dialog.waitFor({ state: "visible" });
  await dialog.getByText("frame.svg", { exact:true }).waitFor();
  check("fresh sketch includes a ready prototype", await prepare.isEnabled());
  await addImage(png);
  await dialog.getByLabel("Название запроса", { exact: true }).fill("Блок по наброску");
  await dialog.getByLabel("Инструкции пользователя по задаче", { exact: true }).fill("Длина 40 мм; остальные размеры уточнить.");
  await page.waitForFunction(() => document.querySelector(".sketch-request-previews img")?.naturalWidth === 200);
  check("selected image is decoded and previewed", await dialog.locator("figure").count() === 1);
  await prepare.click(); await readyZip();
  await checkPickerCancel("custom sketch");
  const zip = await downloadZip("request.zip");
  await requestFromZip("REQUEST.md");
  const request = await readFile(path.join(out, "REQUEST.md"), "utf8");
  check("downloaded ZIP contains the edited condition and refers to the separate common context", /^clark-sketch-[\w-]+\.zip$/u.test(zip.suggestedFilename())
    && request.includes("Длина 40 мм") && request.includes("01_CLARK_Context.zip") && !request.includes('"exampleOnlyNotTask":'));
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
  await dialog.getByLabel("Инструкции пользователя по задаче", { exact: true }).fill("Исправлено: длина 50 мм.");
  check("editing the condition invalidates the previous package", await dialog.locator(".sketch-request-result").count() === 0);
  await prepare.click(); await readyZip();
  await requestFromZip("REQUEST-updated.md");
  check("rebuilt package uses the current condition", (await readFile(path.join(out, "REQUEST-updated.md"), "utf8")).includes("длина 50 мм"));
  await close(); await open();
  await dialog.getByText("frame.svg", {exact:true}).waitFor();
  check("reopening starts a new request with the editable example", await condition.inputValue() === defaultCondition && await prepare.isEnabled() && await dialog.getByLabel("Название запроса", { exact: true }).inputValue() === "Рамка и отдельный магнит"
    && await dialog.locator("figure").count() === 1 && await dialog.locator(".sketch-request-result").count() === 0);
  await addImage(png);
  await page.evaluate(() => {
    const digest = crypto.subtle.digest.bind(crypto.subtle); let first = true;
    crypto.subtle.digest = async (...args) => { if (first) { first = false; await new Promise(resolve => { window.resumeSketchDigest = resolve; }); } return digest(...args); };
  });
  await prepare.click(); await page.waitForFunction(() => typeof window.resumeSketchDigest === "function");
  check("preparation exposes its busy state", await dialog.getByRole("button", { name: "Подготовка пакета…", exact: true }).isDisabled());
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
  await open();
  const select = dialog.getByLabel("Пример", { exact: true });
  await select.selectOption("1");
  await dialog.getByRole("link", {name:"frame.png", exact:true}).waitFor();
  check("PNG prototype includes matching editable drawing instructions", (await condition.inputValue()).includes("frame.png") && !(await condition.inputValue()).includes("SVG"));
  await prepare.click(); await readyZip(); await downloadZip("example-png.zip"); await close();

  const meshAction = aiSection.getByRole("button", {name:"Запрос к ИИ по сетке…", exact:true});
  await open(meshAction);
  await dialog.getByRole("link", {name:"frame.msh", exact:true}).waitFor();
  await checkChatTable("Подготовленный пакет сетки");
  const meshText = dialog.getByLabel("Инструкции пользователя по задаче", {exact:true});
  check("mesh example is ready with tagged frame and magnet regions", (await meshText.inputValue()).includes("группа 2 magnet"));
  await prepare.click(); await readyZip(); await checkPickerCancel("mesh"); await downloadZip("example-mesh.zip");
  await meshText.fill("Экструзия 20 мм");
  await dialog.locator('input[type=file]').setInputFiles(path.join(root,"public/geometry/frame.msh"));
  check("changing the mesh preserves a manually edited condition", await meshText.inputValue() === "Экструзия 20 мм");
  await prepare.click(); await readyZip();
  check("edited mesh request packages the source and new condition", (await requestFromZip("mesh-custom.md")).includes("Экструзия 20 мм"));
  await close();

  const directAction = aiSection.getByRole("button", {name:"Прямой импорт геометрии…", exact:true});
  await open(directAction);
  check("the procedural importer keeps its own workflow", await workflow.count() === 0);
  const buildTask = dialog.getByRole("button", {name:"Построить задание", exact:true});
  const saveTask = dialog.getByRole("button", {name:"Сохранить в проект", exact:true});
  for (const [i, file] of [[0,"TVV320_1.fem"],[1,"TVV320_2.fem"],[2,"magnet.step"]]) {
    await select.selectOption(String(i));
    await dialog.getByRole("link", {name:file,exact:true}).waitFor();
    await buildTask.click();
    const result = dialog.locator(".sketch-request-result");
    await result.waitFor();
    check("direct import produces a native task for "+file, (await result.innerText()).includes(i===2 ? "1 ШГ" : "24 ШГ"));
    if (i === 2) await checkPickerCancel("STEP");
    await downloadZip(file+".zip","Скачать задание ZIP");
  }
  await dialog.getByLabel("Название задания",{exact:true}).fill("STEP edited");
  await dialog.getByLabel("Mz, кА/м",{exact:true}).fill("720");
  await dialog.getByLabel("Разбиение каждого ШГ (D1 D2 D3)",{exact:true}).fill("3 4 1");
  check("editing STEP parameters invalidates the former task", await saveTask.isDisabled());
  await buildTask.click();
  await dialog.getByText("1 ШГ · 12 ЭО · Mz = 720 кА/м",{exact:true}).waitFor();
  await saveTask.click(); await dialog.waitFor({state:"hidden"});
  check("direct import selects the new editable task in its project", await page.locator("#listTask .listTask-item.selected").filter({hasText:"STEP edited"}).count() === 1);
  await open(directAction); await dialog.getByRole("link",{name:"TVV320_1.fem",exact:true}).waitFor();
  await dialog.getByLabel("Название задания",{exact:true}).fill("STEP edited");
  await buildTask.click(); await saveTask.click();
  check("collision preserves the existing task and shows the name", (await dialog.getByRole("alert").innerText()).includes("STEP edited"));
  await close();
  check("no request is sent to a model", modelRequests.length === 0);
  check("no uncaught browser errors", errors.length === 0);
  await writeFile(path.join(out, "checks.json"), JSON.stringify({ checks, errors, modelRequests, browser: browser.browser().version() }, null, 2) + "\n");
  console.log(`${checks.length} browser checks passed; artifacts: ${out}`);
} catch (error) {
  await page.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
  await writeFile(path.join(out, "failure.txt"), `${error.stack}\n${errors.join("\n")}\n${await page.locator("body").innerText().catch(() => "")}`);
  throw error;
} finally { await browser.close(); await server.close(); await rm(profile, { recursive: true, force: true }); }
