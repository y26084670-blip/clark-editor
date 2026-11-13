import assert from "node:assert/strict";
import { mkdir, readFile, realpath } from "node:fs/promises";
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
      if (req.url === "/__updates/examples-config.json") {
        res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify({ solverInstallerUrl: "https://example.test/ClarkInstaller.exe" })); return;
      }
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
  for (const page of [editor, viewerPage]) {
    const tabs = page.getByRole("tablist").getByRole("tab");
    assert.deepEqual(await tabs.allTextContents(), ["Рекомендации", "Интерфейс (1)", "Алгоритмы (1)"]);
    await tabs.first().click();
    await page.getByText("Рекомендаций пока нет.", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("Только непрочитанные").count(), 0);
    assert.equal(await page.getByRole("button", { name: "Отметить раздел прочитанным" }).count(), 0);
    assert.equal(await badge(page).textContent(), "2");
    await page.getByRole("tab", { name: /^Интерфейс/ }).click();
  }
  pass("recommendations precede both news tabs and old feeds open an empty section without changing unread counts");
  await editor.getByRole("button", { name: "Отметить раздел прочитанным" }).click();
  await viewerPage.waitForFunction(() => document.querySelector(".whats-new-count")?.textContent === "1");
  await viewerPage.getByRole("tab", { name: "Алгоритмы (1)", exact: true }).click();
  await viewerPage.getByText("Влияет на результаты расчёта", { exact: true }).waitFor();
  assert.equal(await viewerPage.locator(".whats-new-entry").count(), 1);
  await viewerPage.getByRole("button", { name: "Прочитано", exact: true }).click();
  await editor.waitForFunction(() => !document.querySelector(".whats-new-count"));
  pass("independent category acknowledgements synchronize in both directions without reloading");
  feed.recommendations = [{ title: "Первый пункт", summary: "Первое описание." },
    { title: "Второй пункт", summary: "Второе описание." }];
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
  for (const page of [editor, viewerPage]) {
    await page.getByRole("tab", { name: "Рекомендации", exact: true }).click();
    const panel = page.getByRole("tabpanel", { name: "Рекомендации" });
    await panel.getByText("Первое описание.", { exact: true }).waitFor();
    assert.deepEqual(await panel.getByRole("heading").allTextContents(), feed.recommendations.map(tip => tip.title));
    assert.equal(await badge(page).textContent(), "2");
    await page.getByRole("tab", { name: /^Интерфейс/ }).click();
  }
  assert.equal(await editor.getByLabel("Только непрочитанные", { exact: true }).isChecked(), true);
  pass("both clients show feed-order recommendations independently of notification filters");
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
  await editor.getByRole("tab", { name: "Рекомендации", exact: true }).click();
  await editor.getByRole("heading", { name: "Второй пункт", exact: true }).waitFor();
  await editor.getByRole("tab", { name: /^Интерфейс/ }).click();
  pass("offline refresh and page reload retain the journal, acknowledgements and last successful times");
  offline = false;
  feed.recommendedClark.version = "0.10.48";
  await editor.evaluate(() => updateFixture.setNativeVersion("0.10.49"));
  await editor.getByRole("button", { name: "Проверить обновления", exact: true }).click();
  for (const appPage of [editor, viewerPage]) {
    await appPage.getByText("Установлена более новая версия Clark. Обновление не требуется", { exact: true }).waitFor();
    await appPage.getByText("Установлено: 0.10.49; версия в журнале: 0.10.48.", { exact: true }).waitFor();
    assert.equal(await appPage.getByRole("link", { name: "Скачать установщик" }).count(), 0);
    const style = await appPage.locator(".whats-new-button").evaluate(el => getComputedStyle(el).borderTopWidth);
    assert.equal(style, "2px");
    assert.equal(await appPage.locator(".whats-new-dialog").evaluate(el => getComputedStyle(el).borderTopWidth), "1px");
  }
  pass("0.10.49 never recommends or links to the older 0.10.48 in either app; only the button border is 2px");
  await editor.setViewportSize({ width: 480, height: 800 });
  await editor.screenshot({ path: `${output}/narrow.png`, fullPage: true });
  const fits = await editor.locator(".whats-new-dialog").evaluate(el => el.scrollWidth <= el.clientWidth + 1);
  assert.ok(fits, "dialog must fit narrow screens");
  await editor.keyboard.press("Escape");
  assert.equal(await editor.locator("dialog[open]").count(), 0);
  assert.equal(await editor.locator(".whats-new-button").evaluate(el => el === document.activeElement), true);
  pass("narrow dialog fits, Escape closes it and focus returns to the notification button");

  const journal = JSON.parse(await readFile(resolve(root, "data/updates/changes.json"), "utf8"));
  const published = await context.request.get(origin + "/updates.json");
  assert.ok(published.ok());
  feed = await published.json();
  assert.deepEqual(feed.recommendations, [...journal.recommendations].reverse());
  assert.deepEqual(feed.entries, journal.entries);
  await show(editor);
  await editor.getByRole("button", { name: "Проверить обновления", exact: true }).click();
  for (const [app, appPage] of [["editor", editor], ["viewer", viewerPage]]) {
    await appPage.getByLabel("Только непрочитанные", { exact: true }).uncheck();
    await appPage.getByRole("tab", { name: /^Интерфейс/ }).click();
    const med = appPage.locator(".whats-new-entry").filter({ has:
      appPage.getByRole("heading", { name: "Автоматизация заполнения MED", exact: true }) });
    await med.waitFor();
    assert.equal(await appPage.locator(".whats-new-entry").count(),
      feed.entries.filter(entry => entry.category === "interface").length);
    assert.equal(await med.getByRole("link", { name: "Подробнее" }).getAttribute("href"), `${origin}/__updates/user-guide/index.html#med`);
    assert.match(await med.textContent(), /В общих параметрах включить Учёт зарядов\./);
    for (const title of ["Верхняя панель Editor и тема уведомлений", "Уведомления об изменениях и обновлениях"]) {
      assert.equal(await appPage.getByRole("heading", { name: title, exact: true }).count(), 0);
    }
    for (const [key, label] of [["interface", "Интерфейс"], ["computation", "Алгоритмы"]]) {
      await appPage.getByRole("tab", { name: new RegExp(`^${label}`) }).click();
      const section = feed.entries.filter(item => item.category === key)
        .sort((a, b) => b.date.localeCompare(a.date));
      assert.deepEqual(await appPage.locator(".whats-new-entry-title .whats-new-entry-status").allTextContents(),
        section.flatMap(item => item.status ? [item.status] : []));
    }
    const contact = appPage.locator(".whats-new-entry").filter({ has:
      appPage.getByRole("heading", { name: "Контактное возбуждение проводников", exact: true }) });
    assert.match(await contact.textContent(), /Ограничения: Для инструмента Editor добавление строк/);
    await appPage.getByRole("tab", { name: "Рекомендации", exact: true }).click();
    const panel = appPage.getByRole("tabpanel", { name: "Рекомендации" });
    assert.deepEqual(await panel.getByRole("heading").allTextContents(),
      (feed.recommendations ?? []).map(item => item.title));
    for (const width of [1280, 480, 320]) {
      await appPage.setViewportSize({ width, height: 900 });
      const widths = await appPage.getByRole("tablist").getByRole("tab").evaluateAll(tabs =>
        tabs.map(el => el.getBoundingClientRect().width));
      assert.ok(Math.max(...widths) - Math.min(...widths) < 1, "category buttons must have equal widths");
      assert.ok(await appPage.locator(".whats-new-dialog").evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      await appPage.screenshot({ path: `${output}/${app}-recommendations-${width}.png` });
    }
  }
  pass("current feed in both apps: published categories, MED details, recommendations and three equal-width tabs on desktop and mobile");
  assert.deepEqual(errors, []);
  console.log(`${checks.length} browser checks passed; screenshots: ${output}`);
} finally { await context.close(); await browser.close(); await server.close(); }
