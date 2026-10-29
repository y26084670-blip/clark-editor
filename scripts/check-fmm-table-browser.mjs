// Real material editor, graph, clipboard and file service; controlled task handles.
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.env.CHECK_OUTPUT || '/tmp/editor-fmm-table';
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const checks = [], errors = [];
let server, browser, page;
function passed(name) { checks.push(name); console.log(`PASS ${checks.length}: ${name}`); }
const tableData = () => page.evaluate(() => guideMaterials.table().getData()[0].tabl);
const saved = () => page.evaluate(() => guideMaterials.savedFmm());
const dialog = () => page.getByRole('dialog', { name: 'Вставка характеристики из буфера' });
const text = count => ['H\tM\tComment', ...Array.from({ length: count }, (_, i) =>
  [i, 100 + i, ...Array.from({ length: i % 23 }, () => 'NaN')].join('\t'))].join('\n');
async function paste(value) {
  await page.evaluate(value => navigator.clipboard.writeText(value), value);
  await page.getByRole('button', { name: 'Из буфера', exact: true }).click();
  await dialog().waitFor();
}
async function apply(count) {
  await dialog().getByRole('button', { name: 'Применить', exact: true }).click();
  await dialog().waitFor({ state: 'hidden' });
  await page.waitForFunction(count => guideMaterials.detailTable()?.getDataCount() === count, count);
  assert.equal((await tableData()).length, count);
  assert.equal((await saved()).tabl.length, count * 2);
}
async function showDetail() {
  await page.locator('.material-library-table .tabulator-row').first().locator('[tabulator-field="tabl"]').click();
  await page.waitForFunction(() => guideMaterials.detailTable()?.getDataCount() > 0);
}

try {
  server = await createServer({ root, cacheDir: path.join(output, 'vite-cache'),
    server: { host: '127.0.0.1', port: 0 }, plugins: [{
      name: 'fmm-table-fixture', configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url?.split('?')[0] !== '/__fmm-table') return next();
          res.setHeader('Content-Type', 'text/html');
          res.end(await server.transformIndexHtml(req.url, '<html><body><div id="root"></div><script type="module" src="/test/browser/guideMaterials.fixture.jsx"></script></body></html>'));
        });
      },
    }] });
  await server.listen();
  browser = await chromium.launch({ headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  page = await browser.newPage({ viewport: { width: 1360, height: 980 } });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__fmm-table`);
  await page.waitForFunction(() => window.guideMaterials);
  await page.evaluate(() => guideMaterials.mount('FMM', 'A'));
  await page.waitForFunction(() => guideMaterials.table()?.initialized);
  await page.evaluate(() => guideMaterials.setActive(true));
  await page.waitForFunction(() => document.querySelector('.material-library-source select'));
  await page.locator('.material-library-source select').selectOption('task');
  await page.waitForFunction(() => guideMaterials.snapshot().rows?.[0]?.source === 'task');
  await showDetail();
  for (const count of [507, 894]) {
    await paste(text(count));
    assert.equal(await dialog().getByLabel('Начальная строка').inputValue(), '2');
    assert.equal(await dialog().getByLabel('Конечная строка').inputValue(), String(count + 1));
    assert.equal(await dialog().locator('tbody tr').count(), count);
    assert.equal(await dialog().locator('td').first().evaluate(el => getComputedStyle(el).color), 'rgb(237, 242, 247)');
    assert.ok(await dialog().locator('.fmm-clipboard-preview-scroll').evaluate(el => el.scrollHeight > el.clientHeight));
    assert.ok(await dialog().getByRole('button', { name: 'Применить', exact: true }).isEnabled());
    await page.screenshot({ path: path.join(output, `paste-${count}.png`) });
    await apply(count);
    assert.deepEqual((await tableData()).at(-1), [count - 1, count + 99]);
    const stored = await saved();
    assert.equal(stored.tabl[count - 1], count - 1);
    assert.equal(stored.tabl.at(-1), count + 99);
    assert.equal(stored.comment, 'Local test');
    passed(`${count} rows: all data and only first two columns, scrollable preview, complete column-major save`);
  }
  // Native graph must retain the last point, rather than just the visible rows.
  assert.equal(await page.evaluate(() => guideMaterials.graphPointCounts()[0]), 894);
  passed('graph uses all 894 points');
  await page.evaluate(() => guideMaterials.refresh());
  await page.waitForFunction(() => guideMaterials.table()?.getData()[0]?.tabl?.length === 894);
  await showDetail();
  assert.deepEqual((await tableData()).at(-1), [893, 993]);
  passed('saved long characteristic reloads without loss');

  const before = await saved();
  await paste(text(20) + '\n20\tbad\tignored');
  assert.match(await dialog().getByRole('alert').innerText(), /Строка 22, колонка 2/);
  assert.ok(await dialog().getByRole('button', { name: 'Применить', exact: true }).isDisabled());
  assert.deepEqual(await saved(), before);
  await dialog().getByLabel('Начальная строка').fill('4');
  await dialog().getByLabel('Конечная строка').fill('10');
  await apply(7);
  assert.deepEqual((await tableData())[0], [2, 102]);
  assert.deepEqual((await tableData()).at(-1), [8, 108]);
  passed('invalid first-two-column values block writing; explicit shorter range replaces the whole table');

  await page.evaluate(() => guideMaterials.detailTable().getRows().at(-1).select());
  await page.locator('.material-library-detail button[title="Добавить строку"]').click();
  await page.waitForFunction(() => guideMaterials.table().getData()[0].tabl.length === 8);
  await page.evaluate(() => guideMaterials.detailTable().getRows().at(-1).getCell('c0').edit());
  let editor = page.locator('.material-library-detail .tabulator-editing input');
  await editor.fill('9'); await editor.press('Enter');
  await page.evaluate(() => guideMaterials.detailTable().getRows().at(-1).getCell('c1').edit());
  editor = page.locator('.material-library-detail .tabulator-editing input');
  await editor.fill('109'); await editor.press('Enter');
  await page.waitForFunction(() => guideMaterials.table().getData()[0].tabl.at(-1)[1] === 109);
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.waitForFunction(async () => (await guideMaterials.savedFmm()).tabl.length === 16);
  assert.deepEqual((await tableData()).at(-1), [9, 109]);
  passed('manual row addition and editing save eight points');
  await page.waitForFunction(() => guideMaterials.snapshot().busy === 'false');
  await showDetail();

  await page.evaluate(() => { const table = guideMaterials.detailTable(); table.deselectRow(); table.getRows().at(-1).select(); });
  await page.locator('.material-library-detail button[title="Удалить выделенные"]').click();
  await page.waitForFunction(() => guideMaterials.table().getData()[0].tabl.length === 7);
  await page.evaluate(() => guideMaterials.history('undo'));
  await page.waitForFunction(() => guideMaterials.table().getData()[0].tabl.length === 8);
  await page.evaluate(() => guideMaterials.history('redo'));
  await page.waitForFunction(() => guideMaterials.table().getData()[0].tabl.length === 7);
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.waitForFunction(async () => (await guideMaterials.savedFmm()).tabl.length === 14);
  passed('manual deletion, Undo/Redo and save preserve variable row counts');
  await page.waitForFunction(() => guideMaterials.snapshot().busy === 'false');
  await showDetail();
  await paste('0\t100\tbad\n1\t101\tNaN'); await apply(2);
  passed('two-point characteristic works');
  const twoPoints = await saved();
  await page.evaluate(() => { const table = guideMaterials.detailTable(); table.deselectRow(); table.getRows().at(-1).select(); });
  await page.locator('.material-library-detail button[title="Удалить выделенные"]').click();
  await page.waitForFunction(() => guideMaterials.table().getData()[0].tabl.length === 1);
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'не менее 2 строк' }).waitFor();
  assert.deepEqual(await saved(), twoPoints);
  await page.evaluate(() => guideMaterials.history('undo'));
  await page.waitForFunction(() => guideMaterials.table().getData()[0].tabl.length === 2);
  passed('fewer than two rows cannot overwrite the saved characteristic; Undo restores the table');
  await page.locator('.material-library-source select').selectOption('default');
  await page.waitForFunction(() => guideMaterials.snapshot().rows?.[0]?.source === 'default');
  await showDetail();
  assert.equal(await page.locator('.material-library-detail button[title="Добавить строку"]').count(), 0);
  passed('base library remains read-only');
  assert.deepEqual(errors, []);
} catch (error) {
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') });
  throw error;
} finally {
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ checks, errors }, null, 2));
  await browser?.close(); await server?.close();
}
