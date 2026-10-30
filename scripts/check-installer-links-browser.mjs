import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import solid from "vite-plugin-solid";

const root = fileURLToPath(new URL("../", import.meta.url));
const viewer = resolve(process.env.VIEWER_ROOT || resolve(root, "../clark-viewer"));
const fixture = resolve(root, "__installer_links_check__");
const output = process.env.CHECK_OUTPUT || "/tmp/clark-installer-links-check";
const config = JSON.parse(await readFile(resolve(root, "public/examples-config.json"), "utf8"));
const feed = { schemaVersion: 1, recommendedClark: { version: "0.10.48", installerUrl: "https://example.test/obsolete" },
  entries: [{ id: "installer-check", revision: 1, release: "check", date: "2026-10-30", category: "interface",
    title: "Проверка общего ресурса", summary: "Журнал доступен независимо от ссылки установщика." }] };
let unavailable = false, server, browser;
const errors = [], checks = [], requests = [];
const pass = name => { checks.push(name); console.log("PASS", name); };
await mkdir(fixture, { recursive: true }); await mkdir(output, { recursive: true });
try {
  await writeFile(resolve(fixture, "index.html"), '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="./fixture.jsx"></script></body></html>');
  await writeFile(resolve(fixture, "fixture.jsx"), `
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { WhatsNewDialog as EditorNews } from '../src/components/updates/WhatsNewDialog.jsx';
import { WhatsNewDialog as ViewerNews } from '/@fs/${viewer}/src/components/updates/WhatsNewDialog.jsx';
import { ExamplesInstaller } from '../src/components/help/ExamplesInstaller.jsx';
const app = new URL(location.href).searchParams.get('app');
localStorage.setItem('clark.updates.installed.v1', JSON.stringify({version:'0.10.47', checkedAt:'2026-10-30T00:00:00Z'}));
function Fixture() {
  const [open, setOpen] = createSignal(true);
  window.installerFixture = {
    async reopenExamples() { setOpen(false); await Promise.resolve(); setOpen(true); },
    setNewerVersion() {
      localStorage.setItem('clark.updates.installed.v1', JSON.stringify({version:'0.10.49', checkedAt:'2026-10-30T00:00:00Z'}));
      dispatchEvent(new StorageEvent('storage', {key:'clark.updates.installed.v1'}));
    }
  };
  const News = app === 'viewer' ? ViewerNews : EditorNews;
  return <><News app={app} feedUrl={location.origin+'/updates.json'} getVersionContext={async()=>null}/>
    <Show when={app === 'editor'}><ExamplesInstaller open={open()}/></Show></>;
}
render(()=><Fixture/>, document.getElementById('root'));
`);
  server = await createServer({ configFile: false, root, cacheDir: resolve(output, "vite-cache"),
    plugins: [solid(), { name: "installer-resource-fixture", configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!["/updates.json", "/examples-config.json"].includes(req.url)) return next();
        requests.push(req.url); res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store");
        res.statusCode = req.url === "/examples-config.json" && unavailable ? 503 : 200;
        res.end(JSON.stringify(req.url === "/updates.json" ? feed : config));
      });
    } }],
    resolve: { alias: [
      { find: /^solid-js\/web$/, replacement: resolve(root, "node_modules/solid-js/web/dist/web.js") },
      { find: /^solid-js\/store$/, replacement: resolve(root, "node_modules/solid-js/store/dist/store.js") },
      { find: /^solid-js$/, replacement: resolve(root, "node_modules/solid-js/dist/solid.js") },
    ] },
    server: { host: "127.0.0.1", port: 0, fs: { allow: [root, viewer] } },
  });
  await server.listen();
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE,
    args: [...JSON.parse(process.env.CHROMIUM_ARGS || "[]"), "--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const pages = [];
  for (const app of ["editor", "viewer"]) {
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__installer_links_check__/index.html?app=${app}`);
    await page.waitForFunction(() => window.installerFixture);
    pages.push(page);
  }
  const [editor] = pages;
  const show = page => page.locator(".whats-new-button").click();
  const close = page => page.getByRole("button", { name: "Закрыть уведомления", exact: true }).click();
  const checkLinks = async () => {
    for (const page of pages) {
      await page.waitForFunction(url => document.querySelector('.whats-new-version-actions a')?.href === url, config.solverInstallerUrl);
    }
    await editor.waitForFunction(url => document.querySelector('.examples-installer-download a')?.href === url, config.solverInstallerUrl);
  };
  for (const page of pages) await show(page);
  await checkLinks();
  assert.notEqual(config.solverInstallerUrl, feed.recommendedClark.installerUrl);
  pass("Quick Start and both What's New dialogs use the resource, ignoring the legacy journal URL");

  for (const page of pages) await close(page);
  config.solverInstallerUrl = "https://example.test/replacement-installer";
  await editor.evaluate(() => installerFixture.reopenExamples());
  for (const page of pages) await show(page);
  await checkLinks();
  pass("Changing only JSON updates all links on reopening without reloading or rebuilding JavaScript");

  unavailable = true;
  for (const page of pages) { await close(page); await show(page); }
  await editor.evaluate(() => installerFixture.reopenExamples());
  for (const page of pages) {
    await page.getByText("Не удалось получить ссылку на установщик. Повторите проверку обновлений.", { exact: true }).waitFor();
    assert.equal(await page.locator(".whats-new-version-actions a").count(), 0);
    await page.getByRole("heading", { name: "Проверка общего ресурса", exact: true }).waitFor();
  }
  assert.equal(await editor.locator(".examples-installer-download a").getAttribute("href"), null);
  assert.equal(await editor.locator(".examples-installer-download a").getAttribute("aria-disabled"), "true");
  pass("Unavailable configuration preserves the journal and disables download instead of using a stale address");

  unavailable = false; delete feed.recommendedClark.installerUrl;
  for (const page of pages) await page.getByRole("button", { name: "Проверить обновления", exact: true }).click();
  await editor.evaluate(() => installerFixture.reopenExamples());
  await checkLinks();
  pass("Retry recovers the links and a version-only recommendation works in both applications");

  await close(editor);
  await editor.getByLabel("Прямая загрузка", { exact: true }).check();
  assert.match(await editor.locator(".examples-installer-download a").getAttribute("href"), /^clark:\/\/download-installer\?request=/);
  await editor.getByLabel("Прямая загрузка", { exact: true }).uncheck();
  assert.equal(await editor.locator(".examples-installer-download a").getAttribute("href"), config.solverInstallerUrl);
  pass("Native direct-download action still uses the installed handler and the ordinary link restores the shared URL");

  await show(editor);
  await editor.evaluate(() => installerFixture.setNewerVersion());
  for (const page of pages) {
    await page.getByText("Установлена более новая версия Clark. Обновление не требуется", { exact: true }).waitFor();
    assert.equal(await page.locator(".whats-new-version-actions a").count(), 0);
  }
  pass("Newer installed versions still suppress downgrade recommendations");
  assert.deepEqual(errors, []);
  assert.ok(requests.filter(url => url === "/examples-config.json").length >= 10);
  await writeFile(resolve(output, "browser.json"), JSON.stringify({ checks, errors, requests }, null, 2));
  console.log(`BROWSER_OK ${checks.length}/${checks.length}`);
} finally {
  await browser?.close(); await server?.close(); await rm(fixture, { recursive: true, force: true });
}
