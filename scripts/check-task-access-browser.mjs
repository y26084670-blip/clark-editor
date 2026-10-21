import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
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
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);
const errors = []; page.on('pageerror', error => errors.push(error.message));
let checks = 0;
const check = (message, value) => { assert.ok(value, message); checks++; console.log('PASS', message); };
const access = page.locator('.task-access-dialog'), help = page.locator('.general-information-dialog');
const button = name => access.getByRole('button', { name, exact: true });
const open = () => page.getByRole('button', { name: 'Доступ к проектам', exact: true }).click();
const pick = async () => {
  await button('Выбрать диск с проектами').click();
  await page.waitForFunction(() => !document.querySelector('.task-access-dialog button').disabled);
};
const bound = () => page.waitForFunction(() => document.querySelector('.task-access-notice')?.textContent.includes('связаны все'));
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__task-access`);
  await page.waitForFunction(() => window.accessFixture?.ready);
  await page.waitForLoadState("networkidle");
  check('quick start precedes disk access on first load', await help.isVisible() && !await access.isVisible());
  await help.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await access.waitFor({ state: 'visible' });
  check('only one modal and focus inside access panel', await page.locator('dialog[open]').count() === 1 && await access.evaluate(el => el.contains(document.activeElement)));
  await pick();
  await page.waitForFunction(() => document.querySelector('#projectCatalog')?.options.length === 2);
  check('service directories, clark.app and files excluded', JSON.stringify(await page.locator('#projectCatalog option').allTextContents()) === JSON.stringify(['clark.projects', 'CLARK.Tests']));
  check('one picker requests entire selected disk read-write', await page.evaluate(() => accessFixture.calls.length === 1 && accessFixture.calls[0].mode === 'readwrite'));
  await button('Связать с Решателем').click();
  await page.waitForFunction(async () => { try { return !!(await accessFixture.read('clark.catalogs-request.json')).requestId; } catch { return false; } });
  const request = await page.evaluate(() => accessFixture.read('clark.catalogs-request.json'));
  check('single request covers both catalogs', request.catalogs.length === 2 && new Set(request.catalogs.map(x => x.workspaceId)).size === 2);
  check('preparation preserves existing child markers', await page.evaluate(async () => { try { await accessFixture.marker('clark.projects'); return false; } catch (e) { return e.name === 'NotFoundError'; } }));
  await page.evaluate(() => accessFixture.ack('bound', true));
  await page.waitForTimeout(1200);
  check('stale result does not confirm binding', !(await access.locator('[role="status"]').textContent()).includes('связаны все'));
  await page.evaluate(() => accessFixture.ack()); await bound();
  check('full confirmation changes button label and color', await button('Связано с Решателем').evaluate(el => el.classList.contains('task-access-bind--bound') && getComputedStyle(el).backgroundColor === 'rgb(152, 229, 181)'));
  await button('Продолжить').click();
  check('bind button is absent from main panel', !await page.getByRole('button', { name: 'Связать с Решателем', exact: true }).isVisible());
  await page.locator('#listProject').selectOption('Project');
  await page.locator('#listTask .listTask-item').filter({ hasText: /^Задание$/ }).dblclick();
  await page.waitForFunction(() => accessFixture.path()?.includes('clark.projects/Project/Задание'));
  await page.getByRole('button', { name: 'Выбор задания', exact: true }).click();
  await page.locator('#projectCatalog').selectOption('CLARK.Tests');
  await page.waitForFunction(() => [...document.querySelector('#listProject').options].some(o => o.value === 'Другой проект'));
  check('switching catalogs updates projects and preserves loaded task', await page.evaluate(() => accessFixture.path() === 'clark.projects/Project/Задание'));
  await open();
  check('confirmation survives reopening and catalog switching', await button('Связано с Решателем').isVisible());
  for (const mode of ['cancel', 'denied']) {
    await page.evaluate(value => accessFixture.mode(value), mode); await pick();
    check(`${mode} preserves binding confirmation`, await button('Связано с Решателем').isVisible());
    check(`${mode} preserves selected catalog`, await page.locator('#projectCatalog').inputValue() === 'CLARK.Tests');
  }
  await page.evaluate(() => accessFixture.mode('disk')); await pick();
  check('new disk selection resets confirmation', await button('Связать с Решателем').evaluate(el => !el.classList.contains('task-access-bind--bound')));
  await button('Связать с Решателем').click();
  await page.waitForFunction(old => accessFixture.read('clark.catalogs-request.json').then(r => r.requestId !== old), request.requestId);
  await page.evaluate(() => accessFixture.ack('error'));
  await page.waitForFunction(() => document.querySelector('.task-access-notice')?.textContent.includes('1 из 2'));
  check('partial error remains yellow and retry is enabled', await button('Связать с Решателем').isEnabled() && await button('Связать с Решателем').evaluate(el => getComputedStyle(el).backgroundColor === 'rgb(255, 223, 85)'));
  const partialRequest = await page.evaluate(() => accessFixture.read('clark.catalogs-request.json'));
  await button('Связать с Решателем').click();
  await page.waitForFunction(old => accessFixture.read('clark.catalogs-request.json').then(r => r.requestId !== old), partialRequest.requestId);
  await page.evaluate(() => accessFixture.ack()); await bound();
  await page.evaluate(() => accessFixture.mode('empty')); await pick();
  check('empty disk clears catalog and project lists', await page.locator('#projectCatalog').isDisabled() && await button('Продолжить').isDisabled() && await page.locator('#listProject option').count() === 1);
  await page.evaluate(() => accessFixture.mode('disk')); await pick();
  await mkdir('/tmp/clark-disk-browser', { recursive: true });
  for (const width of [1100, 1440]) {
    await page.setViewportSize({ width, height: width === 1100 ? 600 : 900 });
    check(`dialog fits ${width}px`, await access.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }));
    await page.screenshot({ path: `/tmp/clark-disk-browser/access-${width}.png` });
  }
  await button('Продолжить').click();
  check('catalog dropdown and access icon fit the browser panel', await page.locator('.task-directory-buttons').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  await page.screenshot({ path: '/tmp/clark-disk-browser/catalogs.png' });
  await page.evaluate(() => localStorage.setItem('e3d.generalInformation.openAtStartup', 'false'));
  await page.reload(); await page.waitForFunction(() => window.accessFixture?.ready);
  await access.waitFor({ state: 'visible' });
  check('F5 opens access panel again', !await help.isVisible() && await page.evaluate(() => accessFixture.calls.length === 0));
  check('no browser exceptions', errors.length === 0);
  console.log(`${checks} browser checks passed`);
} finally { await browser.close(); await server.close(); }
