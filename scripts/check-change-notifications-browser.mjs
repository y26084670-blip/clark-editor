import assert from "node:assert/strict";
import { mkdir, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const viewer = resolve(process.env.VIEWER_ROOT || resolve(root, "../clark-viewer"));
const output = process.env.CHECK_OUTPUT || "/tmp/clark-update-notifications-check";
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const item = (id, category, extra = {}) => ({ id, category, revision: 1, release: "new", date: "2026-10-22", title: id, summary: "Описание изменения для пользователя.", ...extra });
let offline = false;
let feed = { schemaVersion: 1, recommendedClark: { version: "0.10.10", installerUrl: "https://example.test/ClarkInstaller.exe" },
  entries: [item("Новое в интерфейсе", "interface", { id: "ui-new" }),
    item("Архивная запись", "interface", { id: "ui-old", release: "old", date: "2026-10-20" }),
    item("Исправление вычислений", "computation", { id: "math-new", importance: "important", limitations: "Пересчёт нужен только для указанных задач." })] };
const server = await createServer({ root, cacheDir: `${output}/vite-cache`, resolve: { dedupe: ["solid-js"] },
  server: { host: "127.0.0.1", port: 0, fs: { allow: [root, viewer,
    await realpath(resolve(root, "node_modules")), await realpath(resolve(viewer, "node_modules"))] } },
  plugins: [{ name: "update-notifications-fixture", configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (req.url === "/__updates/feed") {
        res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store");
        res.statusCode = offline ? 503 : 200; res.end(JSON.stringify(feed)); return;
      }
      if (!/^\/__updates\/(editor|viewer)$/.test(req.url || "")) return next();
      const app = req.url.split("/").pop(), prefix = app === "editor" ? "" : `/@fs/${viewer}`;
      res.setHeader("Content-Type", "text/html");
      res.end(await server.transformIndexHtml(req.url, `<html><meta charset="utf-8"><body style="font:14px Arial;background:#edf2f7"><header style="display:flex;align-items:center;gap:20px;padding:12px"><strong>E3D ${app}</strong><div id="root"></div></header><label>Несохранённые данные <textarea id="draft">Черновик задания</textarea></label><script>window.updateComponent=${JSON.stringify(`${prefix}/src/components/updates/WhatsNewDialog.jsx`)}</script><script type="module" src="/test/browser/changeNotifications.fixture.jsx"></script></body></html>`));
    });
  } }],
});
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, headless: true,
  args: [...JSON.parse(process.env.CHROMIUM_ARGS || "[]"), "--no-sandbox", "--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const errors = [], checks = [];
const makePage = async app => {
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on("pageerror", error => { errors.push(error.message); console.error("PAGE ERROR", error.message); });
  page.on("crash", () => console.error("PAGE CRASH", app));
  await page.goto(`${origin}/__updates/${app}`); await page.waitForFunction(() => window.updateFixture?.ready);
  return page;
};
const pass = text => { checks.push(text); console.log("PASS", text); };
const badge = page => page.locator(".whats-new-button .whats-new-count");
const show = page => page.locator(".whats-new-button").click();
try {
  const editor = await makePage("editor"), viewerPage = await makePage("viewer");
  await editor.waitForFunction(() => document.querySelector(".whats-new-count")?.textContent === "2");
  await viewerPage.waitForFunction(() => document.querySelector(".whats-new-count")?.textContent === "2");
  assert.equal(await editor.locator("dialog[open]").count(), 0); assert.equal(await viewerPage.locator("dialog[open]").count(), 0);
  pass("new notifications use a passive badge in both applications");
  await show(editor); await show(viewerPage);
  await editor.getByText("Рекомендуется обновить Clark", { exact: true }).waitFor();
  assert.equal(await editor.getByRole("link", { name: "Скачать установщик" }).getAttribute("href"), "https://example.test/ClarkInstaller.exe");
  assert.equal(await badge(editor).textContent(), "2"); assert.equal(await editor.locator(".whats-new-entry").count(), 2);
  pass("version 0.10.9 is below 0.10.10; opening preserves unread marks and shows the archive");
  await editor.getByRole("button", { name: "Отметить раздел прочитанным" }).click();
  await viewerPage.waitForFunction(() => document.querySelector(".whats-new-count")?.textContent === "1");
  await viewerPage.getByRole("tab", { name: "Алгоритмы и вычисления (1)", exact: true }).click();
  await viewerPage.getByText("Влияет на результаты расчёта", { exact: true }).waitFor();
  assert.equal(await viewerPage.locator(".whats-new-entry").count(), 1);
  await viewerPage.getByRole("button", { name: "Прочитано", exact: true }).click();
  await editor.waitForFunction(() => !document.querySelector(".whats-new-count"));
  pass("independent category acknowledgements synchronize in both directions without reloading");
  feed.entries = [{ ...feed.entries[0], revision: 2 }, item("Ещё одно изменение", "interface", { id: "ui-next" }), ...feed.entries.slice(1)];
  await editor.getByRole("button", { name: "Проверить обновления", exact: true }).click();
  await editor.getByText("Установлена рекомендуемая версия Clark", { exact: true }).waitFor();
  await viewerPage.getByText("Установлена рекомендуемая версия Clark", { exact: true }).waitFor();
  assert.match((await editor.evaluate(() => updateFixture.calls))[0], /^clark:\/\/settings\?/);
  await editor.waitForFunction(() => document.querySelector(".whats-new-count")?.textContent === "2");
  await editor.getByLabel("Только непрочитанные", { exact: true }).check();
  assert.equal(await editor.locator(".whats-new-entry").count(), 2);
  assert.equal(await editor.locator("#draft").inputValue(), "Черновик задания");
  await editor.screenshot({ path: `${output}/desktop.png`, fullPage: true });
  pass("new release/revision remain unread; manual settings check obtains and shares the actual package version");
  offline = true;
  await editor.getByRole("button", { name: "Проверить обновления", exact: true }).click();
  await editor.getByText("Журнал недоступен. Показана последняя сохранённая копия.", { exact: true }).waitFor();
  assert.equal(await editor.locator(".whats-new-entry").count(), 2);
  await editor.getByRole("button", { name: "Закрыть уведомления" }).click();
  await editor.reload(); await editor.waitForFunction(() => window.updateFixture?.ready);
  await show(editor);
  await editor.getByText(/Журнал проверен: .*сохранённая копия/).waitFor();
  await editor.getByRole("button", { name: "Проверить обновления", exact: true }).click();
  await editor.getByText("Журнал недоступен. Показана последняя сохранённая копия.", { exact: true }).waitFor();
  assert.equal(await badge(editor).textContent(), "2");
  pass("offline refresh and page reload retain the journal, acknowledgements and last successful times");
  await editor.setViewportSize({ width: 480, height: 800 });
  await editor.screenshot({ path: `${output}/narrow.png`, fullPage: true });
  const fits = await editor.locator(".whats-new-dialog").evaluate(el => el.scrollWidth <= el.clientWidth + 1);
  assert.ok(fits, "dialog must fit narrow screens");
  await editor.keyboard.press("Escape");
  assert.equal(await editor.locator("dialog[open]").count(), 0);
  assert.equal(await editor.locator(".whats-new-button").evaluate(el => el === document.activeElement), true);
  assert.deepEqual(errors, []);
  pass("narrow dialog fits, Escape closes it and focus returns to the notification button");
  console.log(`${checks.length} browser checks passed; screenshots: ${output}`);
} finally { await context.close(); await browser.close(); await server.close(); }
