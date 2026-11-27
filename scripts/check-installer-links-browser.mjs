import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import solid from "vite-plugin-solid";

const root = fileURLToPath(new URL("../", import.meta.url));
const viewer = resolve(process.env.VIEWER_ROOT || resolve(root, "../clark-viewer"));
const fixture = resolve(root, "__installer_links_check__");
const output = process.env.CHECK_OUTPUT || "/tmp/clark-installer-links-check";
const feed = {
  schemaVersion: 1,
  recommendedClark: { version: "0.10.48", installerUrl: "https://example.test/obsolete" },
  entries: [{ id: "check", revision: 1, release: "check", date: "2026-10-30", category: "interface",
    title: "Проверка журнала", summary: "Текст опубликованного изменения." }],
};
let server, browser;
const errors = [], requests = [], checks = [];
const pass = name => { checks.push(name); console.log("PASS", name); };

await mkdir(fixture, { recursive: true });
await mkdir(output, { recursive: true });
try {
  await writeFile(resolve(fixture, "index.html"), '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="./fixture.jsx"></script></body></html>');
  await writeFile(resolve(fixture, "fixture.jsx"), `
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { WhatsNewDialog as EditorNews } from '../src/components/updates/WhatsNewDialog.jsx';
import { WhatsNewDialog as ViewerNews } from '/@fs/${viewer}/src/components/updates/WhatsNewDialog.jsx';
import { GeneralInformationDialog } from '../src/components/help/GeneralInformationDialog.jsx';
const app = new URL(location.href).searchParams.get('app');
localStorage.setItem('clark.updates.installed.v1', JSON.stringify({version:'0.10.47', checkedAt:'2026-10-30T00:00:00Z'}));
function Fixture() {
  const [open, setOpen] = createSignal(app === 'editor');
  const News = app === 'viewer' ? ViewerNews : EditorNews;
  return <><News app={app} feedUrl={location.origin+'/updates.json'} getVersionContext={async()=>null}/>
    <Show when={app === 'editor'}><GeneralInformationDialog open={open()} onClose={()=>setOpen(false)}/></Show></>;
}
render(()=><Fixture/>, document.getElementById('root'));
`);
  server = await createServer({
    configFile: false, root, cacheDir: resolve(output, "vite-cache"),
    plugins: [solid(), { name: "installer-check", configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== "/updates.json" && req.url !== "/examples-config.json") return next();
        requests.push(req.url);
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Type", "application/json");
        res.statusCode = req.url === "/updates.json" ? 200 : 503;
        res.end(JSON.stringify(feed));
      });
    } }],
    resolve: { dedupe: ["solid-js"] },
    server: { host: "127.0.0.1", port: 0, fs: { allow: [root, viewer] } },
  });
  await server.listen();
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE,
    args: [...JSON.parse(process.env.CHROMIUM_ARGS || "[]"), "--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  for (const app of ["editor", "viewer"]) {
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__installer_links_check__/index.html?app=${app}`);
    if (app === "editor") {
      const help = page.getByRole("dialog", { name: "Общая информация" });
      await help.waitFor();
      const demo = help.getByRole("img", { name: "Кнопка «Демо»" });
      assert.equal(await demo.locator("..").innerText(),
        "Для быстрого знакомства без обязательств и загрузки дополнительных файлов нажмите кнопку Демо для эмуляции загрузки с возможностью редактирования конкретной задачи, 3D просмотра конструкции и общего ознакомления с интерфейсом.");
      const installation = help.locator('section[aria-labelledby="general-information-installation"]');
      const installationText = await installation.innerText();
      for (const text of ["PICT", "DOCS", "В Editor кнопка «Открыть для чтения»",
        "В Viewer кнопка «Загрузить для просмотра»", "в Editor нажмите «Загрузить на локальный диск»",
        "Локальная загрузка выделенного облачного проекта",
        "Локальный каталог с проектами", "ClarkInstaller.exe", "mpiRanks"]) {
        assert.ok(installationText.includes(text), text);
      }
      assert.ok(!installationText.includes("Добавить в список"));
      assert.match(await help.locator("#general-information-quick-start").locator("..").innerText(),
        /Перетащите нужное локальное задание из списка проекта/);
      assert.equal(await installation.locator("a, button").count(), 0);
      await help.getByRole("button", { name: "Закрыть", exact: true }).click();
      pass("Quick Start shows cloud examples, the original Demo explanation and local installation instructions");
    }
    await page.locator(".whats-new-button").click();
    await page.getByText("Рекомендуется обновить Clark", { exact: true }).waitFor();
    await page.getByRole("heading", { name: feed.entries[0].title }).waitFor();
    assert.equal(await page.getByRole("link", { name: "Скачать установщик" }).count(), 0);
    assert.equal(await page.locator('a[href^="clark://download-installer"], a[href="https://example.test/obsolete"]').count(), 0);
    await page.close();
    pass(`${app} displays the version recommendation and ignores an installer link in an old journal`);
  }
  assert.deepEqual(errors, []);
  assert.ok(requests.includes("/updates.json"));
  assert.ok(!requests.includes("/examples-config.json"));
  await writeFile(resolve(output, "browser.json"), JSON.stringify({ checks, errors, requests }, null, 2));
  console.log(`BROWSER_OK ${checks.length}/${checks.length}`);
} finally {
  await browser?.close();
  await server?.close();
  await rm(fixture, { recursive: true, force: true });
}
