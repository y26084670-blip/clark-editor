import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'task-access-fixture', configureServer(server) {
  server.middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith('/__task-access')) return next();
    res.setHeader('Content-Type', 'text/html');
    res.end(await server.transformIndexHtml(req.url, '<html><body><div id="root"></div><script type="module" src="/test/browser/taskAccess.fixture.jsx"></script></body></html>'));
  });
} }] });
await server.listen();
// Persistent profiles exercise F5 with IndexedDB directory handles as in normal Chromium sessions.
const profile = await mkdtemp(resolve(tmpdir(), 'clark-task-access-'));
const browser = await chromium.launchPersistentContext(profile, { executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, headless: true,
  viewport: { width: 1440, height: 900 },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.setDefaultTimeout(15000);
const errors = []; page.on('pageerror', error => errors.push(error.message));
let checks = 0;
const check = (message, value) => { assert.ok(value, message); checks++; console.log('PASS', message); };
const access = page.locator('.task-access-dialog'), help = page.locator('.general-information-dialog');
const button = name => access.getByRole('button', { name, exact: true });
const pick = async () => {
  await button('Выбрать диск с проектами').click();
  await page.waitForFunction(() => !document.querySelector('.task-access-actions button:last-child').disabled);
};
const reloadAccess = async () => {
  await page.evaluate(() => localStorage.setItem('e3d.generalInformation.openAtStartup', 'false'));
  await page.reload(); await page.waitForFunction(() => window.accessFixture?.ready);
  await access.waitFor({ state: 'visible' });
};
const bound = () => page.waitForFunction(() => document.querySelector('.task-access-bind--bound'));
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__task-access`);
  await page.waitForFunction(() => window.accessFixture?.ready);
  await page.waitForLoadState("networkidle");
  check('quick start precedes disk access on first load', await help.isVisible() && !await access.isVisible());
  await help.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await access.waitFor({ state: 'visible' });
  check('only one modal and focus inside access panel', await page.locator('dialog[open]').count() === 1 && await access.evaluate(el => el.contains(document.activeElement)));
  check('instructions are separate paragraphs and catalog count starts at zero',
    JSON.stringify(await access.locator(':scope > p').allTextContents()) === JSON.stringify([
      'Выберите диск с проектами и разрешите чтение и запись.',
      'Каталоги clark.* с проектами появятся в верхнем списке.', ''
    ]) && await access.locator('.task-access-location').textContent() === 'Выбрано каталогов: 0');
  for (const mode of ['cancel', 'denied']) {
    await page.evaluate(value => accessFixture.mode(value), mode); await pick();
    check(`${mode} keeps the picker available for retry`, await button('Выбрать диск с проектами').isEnabled());
  }
  await page.evaluate(() => accessFixture.mode('disk'));
  await pick();
  await page.waitForFunction(() => document.querySelector('#projectCatalog')?.options.length === 2);
  check('service directories, clark.app and files excluded', JSON.stringify(await page.locator('#projectCatalog option').allTextContents()) === JSON.stringify(['clark.projects', 'CLARK.Tests']));
  check('picker requests entire selected disk read-write', await page.evaluate(() => accessFixture.calls.every(call => call.mode === 'readwrite')));
  check('completed selection disables picker and displays catalog count', await button('Выбрать диск с проектами').isDisabled()
    && await access.locator('.task-access-location').textContent() === 'Выбрано каталогов: 2');
  const picks = await page.evaluate(() => accessFixture.calls.length);
  await button('Выбрать диск с проектами').evaluate(el => el.click());
  check('disabled picker cannot open another selection', await page.evaluate(() => accessFixture.calls.length) === picks);
  await button('Связать с Решателем').click();
  await page.waitForFunction(async () => { try { return !!(await accessFixture.read('clark.catalogs-request.json')).requestId; } catch { return false; } });
  const request = await page.evaluate(() => accessFixture.read('clark.catalogs-request.json'));
  check('single request covers both catalogs', request.catalogs.length === 2 && new Set(request.catalogs.map(x => x.workspaceId)).size === 2);
  check('preparation preserves existing child markers', await page.evaluate(async () => { try { await accessFixture.marker('clark.projects'); return false; } catch (e) { return e.name === 'NotFoundError'; } }));
  await page.evaluate(() => accessFixture.ack('bound', true));
  await page.waitForTimeout(1200);
  check('stale result does not confirm binding', !await access.locator('.task-access-bind--bound').count());
  await page.evaluate(() => accessFixture.ack()); await bound();
  check('full confirmation changes button label and color', await button('Связано с Решателем').evaluate(el => el.classList.contains('task-access-bind--bound') && getComputedStyle(el).backgroundColor === 'rgb(152, 229, 181)'));
  await reloadAccess();
  check('F5 enables disk selection again', await button('Выбрать диск с проектами').isEnabled());
  await pick();
  check('new disk selection after F5 resets confirmation', await button('Связать с Решателем').evaluate(el => !el.classList.contains('task-access-bind--bound')));
  await button('Связать с Решателем').click();
  await page.waitForFunction(old => accessFixture.read('clark.catalogs-request.json').then(r => r.requestId !== old).catch(() => false), request.requestId);
  await page.evaluate(() => accessFixture.ack('error'));
  await page.waitForFunction(() => document.querySelector('.task-access-notice')?.textContent.includes('1 из 2'));
  check('partial error remains yellow and retry is enabled', await button('Связать с Решателем').isEnabled() && await button('Связать с Решателем').evaluate(el => getComputedStyle(el).backgroundColor === 'rgb(255, 223, 85)'));
  const partialRequest = await page.evaluate(() => accessFixture.read('clark.catalogs-request.json'));
  await button('Связать с Решателем').click();
  await page.waitForFunction(old => accessFixture.read('clark.catalogs-request.json').then(r => r.requestId !== old).catch(() => false), partialRequest.requestId);
  await page.evaluate(() => accessFixture.ack()); await bound();
  await reloadAccess(); await page.evaluate(() => accessFixture.mode('empty')); await pick();
  check('empty disk clears catalog and project lists', await page.locator('#projectCatalog').isDisabled() && await button('Продолжить').isDisabled() && await page.locator('#listProject option').count() === 1);
  check('completed empty-disk selection also disables picker', await button('Выбрать диск с проектами').isDisabled());
  await reloadAccess(); await pick();
  await mkdir('/tmp/clark-disk-browser', { recursive: true });
  for (const width of [1100, 1440]) {
    await page.setViewportSize({ width, height: width === 1100 ? 600 : 900 });
    check(`dialog fits ${width}px`, await access.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }));
    check(`dialog is narrower and footer buttons remain aligned at ${width}px`, await access.evaluate(el => {
      const buttons = [...el.querySelectorAll('.task-access-actions button')].map(button => button.getBoundingClientRect());
      return el.getBoundingClientRect().width === 550 && Math.abs(buttons[0].top - buttons[1].top) < 1;
    }));
    await page.screenshot({ path: `/tmp/clark-disk-browser/access-${width}.png` });
  }
  await button('Продолжить').click();
  check('bind button is absent from main panel', !await page.getByRole('button', { name: 'Связать с Решателем', exact: true }).isVisible());
  await page.locator('#listProject').selectOption('Project');
  await page.locator('#listTask .listTask-item').filter({ hasText: /^Задание$/ }).dblclick();
  await page.waitForFunction(() => accessFixture.path()?.includes('clark.projects/Project/Задание'));
  await page.getByRole('button', { name: 'Выбор задания', exact: true }).click();
  await page.locator('#projectCatalog').selectOption('CLARK.Tests');
  await page.waitForFunction(() => [...document.querySelector('#listProject').options].some(o => o.value === 'Другой проект'));
  check('switching catalogs updates projects and preserves loaded task', await page.evaluate(() => accessFixture.path() === 'clark.projects/Project/Задание'));
  check('disk access has no icon in the main panel', await page.getByRole('button', { name: 'Доступ к проектам', exact: true }).count() === 0);
  await page.locator('#listProject').selectOption('Другой проект');
  const beforeBrowse = await page.evaluate(() => ({ catalog: document.querySelector('#projectCatalog').value, project: document.querySelector('#listProject').value, path: accessFixture.path(), calls: accessFixture.calls.length }));
  await page.getByRole('button', { name: 'Просмотр каталога с проектами', exact: true }).click();
  check('folder browses the selected catalog without changing selection or disk access', await page.evaluate(before => {
    const call = accessFixture.browseCalls.at(-1);
    return call.startIn.name === before.catalog && call.id === 'project-catalog-browse'
      && document.querySelector('#listProject').value === before.project && accessFixture.path() === before.path && accessFixture.calls.length === before.calls;
  }, beforeBrowse));
  await page.evaluate(async () => {
    let handle = await navigator.storage.getDirectory();
    for (const name of ['access-test', 'Диск Д', 'CLARK.Tests']) handle = await handle.getDirectoryHandle(name);
    await handle.getDirectoryHandle('Добавленный проект', { create: true });
  });
  await page.getByRole('button', { name: 'Обновить список проектов', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelector('#listProject').options].some(o => o.value === 'Добавленный проект'));
  check('project refresh preserves the existing selection and loaded model', await page.locator('#listProject').inputValue() === 'Другой проект' && await page.evaluate(() => accessFixture.path()) === beforeBrowse.path);
  await page.locator('#listProject').selectOption('Добавленный проект');
  await page.evaluate(async () => {
    let handle = await navigator.storage.getDirectory();
    for (const name of ['access-test', 'Диск Д', 'CLARK.Tests']) handle = await handle.getDirectoryHandle(name);
    await handle.removeEntry('Добавленный проект');
  });
  await page.getByRole('button', { name: 'Обновить список проектов', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#listProject').value === '');
  check('deleting the selected project clears its list selection, not the loaded model', await page.evaluate(() => accessFixture.path()) === beforeBrowse.path);
  for (const width of [1100, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    check(`catalog and project controls align at ${width}px`, await page.evaluate(() => {
      const a = document.querySelector('#projectCatalog'), b = document.querySelector('#listProject');
      const x = a.getBoundingClientRect(), y = b.getBoundingClientRect();
      const ca = document.querySelector('label[for="projectCatalog"]'), cb = document.querySelector('label[for="listProject"]');
      const f = getComputedStyle(ca), g = getComputedStyle(cb);
      const folder = document.querySelector('.task-project-browse').getBoundingClientRect(), refresh = document.querySelector('.task-project-actions .task-status-refresh').getBoundingClientRect();
      return Math.abs(x.left - y.left) < 1 && Math.abs(x.width - y.width) < 1 && Math.abs(x.height - y.height) < 1
        && Math.abs(ca.getBoundingClientRect().left - cb.getBoundingClientRect().left) < 1 && f.font === g.font
        && folder.right < refresh.left && Math.abs(refresh.right - y.right) < 1;
    }));
  }
  check('task refresh tooltip matches the requested text', await page.locator('.task-list-heading .task-status-refresh').getAttribute('title') === 'Обновить список заданий');
  await page.screenshot({ path: '/tmp/clark-disk-browser/catalogs.png' });
  await page.evaluate(() => localStorage.setItem('e3d.generalInformation.openAtStartup', 'false'));
  await page.reload(); await page.waitForFunction(() => window.accessFixture?.ready);
  await access.waitFor({ state: 'visible' });
  check('F5 opens access panel again', !await help.isVisible() && await page.evaluate(() => accessFixture.calls.length === 0));
  check('no browser exceptions', errors.length === 0);
  console.log(`${checks} browser checks passed`);
} finally { await browser.close(); await server.close(); await rm(profile, { recursive: true, force: true }); }
