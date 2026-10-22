import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chooseProjectDisk } from './browser-project-access.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = process.env.CHECK_OUTPUT ?? '/tmp/editor-layout-browser';
await mkdir(out, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [{
  name: 'editor-layout-fixture', configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (req.url?.split('?')[0] !== '/__editor-layout') return next();
      res.setHeader('Content-Type', 'text/html');
      res.end(await server.transformIndexHtml(req.url, '<html><body><div id="root"></div><script type="module" src="/test/browser/editorFeatures.fixture.jsx"></script></body></html>'));
    });
  },
}] });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
  headless: true, ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);
const checks = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
const check = (name, value) => { assert.ok(value, name); checks.push(name); console.log('PASS', name); };
const header = page.locator('.tabs-header');
const tab = name => header.locator('button').filter({ hasText: new RegExp(`^${name}$`) });
const panels = page.locator('.tasks-layout > .task-browser-panel, .tasks-layout > .task-summary-panel, .tasks-layout > .task-results-panel');
const sizes = () => panels.evaluateAll(elements => elements.map(el => el.getBoundingClientRect().width));
const closeTo = (a, b) => Math.abs(a - b) < 2;
const handles = page.locator('.task-panel-splitter');
async function drag(index, delta) {
  const box = await handles.nth(index).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + delta, box.y + 80, { steps: 8 });
  await page.mouse.up();
}
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__editor-layout`);
  await page.waitForFunction(() => window.editorFixture?.ready);
  await chooseProjectDisk(page);
  const names = await header.locator('.tab-label').allTextContents();
  check('renamed tabs and Settings last', JSON.stringify(names) === JSON.stringify([
    'Выбор задания', 'Общие параметры', 'Элементы', 'Области', 'Импульсы', 'Траектории',
    'Заданные источники', 'Материалы ФММ', 'Материалы ВТСП', 'Настройки',
  ]));
  check('exactly two accessible vertical separators', await handles.count() === 2);
  const initial = await sizes();
  await drag(0, 65);
  let after = await sizes();
  check('first separator transfers width only between first two panels', closeTo(after[0], initial[0] + 65) && closeTo(after[1], initial[1] - 65) && closeTo(after[2], initial[2]));
  await drag(1, 65);
  const second = await sizes();
  check('second separator transfers width only between last two panels', closeTo(second[0], after[0]) && closeTo(second[1], after[1] + 65) && closeTo(second[2], after[2] - 65));
  await handles.nth(0).focus();
  await page.keyboard.press('Home');
  check('Home clamps first panel to readable minimum', closeTo((await sizes())[0], 360));
  await page.keyboard.press('End');
  check('End clamps middle panel to readable minimum', closeTo((await sizes())[1], 320));
  await handles.nth(1).dblclick();
  check('double click restores initial proportions', (await sizes()).every((width, i) => closeTo(width, initial[i])));
  await handles.nth(0).focus();
  await page.keyboard.press('ArrowRight');
  check('keyboard moves separator by 10 pixels', closeTo((await sizes())[0], initial[0] + 10));
  const beforeSwitch = await sizes();
  await tab('Элементы').click(); await tab('Выбор задания').click();
  check('tab switching retains panel widths', (await sizes()).every((width, i) => closeTo(width, beforeSwitch[i])));
  for (const width of [1100, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(100);
    check(`page fits ${width}px without caption-driven overflow`, await page.locator('.tasks-scroll-viewport').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    check(`body stays within ${width}px`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `${out}/layout-${width}.png` });
  }
  await page.setViewportSize({ width: 900, height: 500 });
  await page.locator('.tasks-scroll-viewport').evaluate(el => { el.scrollLeft = 100; el.scrollTop = 100; });
  const contentScroll = await page.locator('.tasks-scroll-viewport').evaluate(el => [el.scrollLeft, el.scrollTop]);
  check('narrow short viewport scrolls content in both directions', contentScroll.every(value => value > 0));
  await header.evaluate(el => { el.scrollLeft = 0; });
  const heading = await header.boundingBox();
  await page.mouse.move(heading.x + 450, heading.y + 15);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(heading.x + 350, heading.y + 15, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  check('right button drag still scrolls tab captions', await header.evaluate(el => el.scrollLeft > 0));
  await header.evaluate(el => { el.scrollLeft = el.scrollWidth; });
  check('tab caption scrolling is independent of content', await header.evaluate(el => el.scrollLeft > 0)
    && JSON.stringify(await page.locator('.tasks-scroll-viewport').evaluate(el => [el.scrollLeft, el.scrollTop])) === JSON.stringify(contentScroll));
  await page.setViewportSize({ width: 1440, height: 900 });
  await tab('Настройки').click();
  check('last Settings tab opens correct data editor', await page.locator('.tab-content:visible .tabulator').count() > 0);
  await tab('Выбор задания').click();
  await page.locator('#listProject').selectOption('Project');
  await page.locator('#listTask .listTask-item').filter({ hasText: /^Task$/ }).dblclick();
  await page.waitForFunction(() => editorFixture.model().general && editorFixture.model().elements);
  await page.locator('button.geometry-button').click();
  const viewer = page.locator('.geometry-viewer-window');
  await viewer.waitFor();
  await viewer.getByRole('button', { name: 'Общие опции отображения', exact: true }).click();
  await viewer.getByRole('checkbox', { name: 'Производительность', exact: true }).check();
  await viewer.getByRole('button', { name: 'Общие опции отображения', exact: true }).click();
  const overlay = viewer.locator('.geometry-performance-overlay');
  check('performance panel starts 8px from top and left of 3D canvas', await overlay.evaluate(el => {
    const a = el.getBoundingClientRect(), b = el.parentElement.getBoundingClientRect();
    return Math.abs(a.left - b.left - 8) < 2 && Math.abs(a.top - b.top - 8) < 2;
  }));
  await page.screenshot({ path: `${out}/performance-top-left.png` });
  check('no uncaught browser errors', errors.length === 0);
} finally {
  await page.screenshot({ path: `${out}/last-state.png` }).catch(() => {});
  await writeFile(`${out}/results.json`, JSON.stringify({ passed: checks.length, checks, errors,
    scope: 'Actual App, Chromium OPFS, controlled directory picker; no installed Clark or Windows permission dialogs' }, null, 2));
  console.log('Browser errors:', JSON.stringify(errors));
  await browser.close(); await server.close();
}
