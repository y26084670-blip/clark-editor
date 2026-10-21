// Requires npm ci, Playwright and Chromium. No production entrypoint is changed.
// PLAYWRIGHT_MODULE and CHROMIUM_EXECUTABLE optionally locate external tooling.
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.resolve(process.env.CHECK_OUTPUT ?? '/tmp/clark-task-browser');
await mkdir(out, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0 }, base: '/clark-editor/',
  plugins: [{ name: 'task-fixture-route', configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.split('?')[0].endsWith('/__task-fixture')) return next();
      res.setHeader('Content-Type', 'text/html');
      res.end(await server.transformIndexHtml(req.url, '<html><body><div id="root"></div><script type="module" src="/test/browser/taskOperations.fixture.jsx"></script></body></html>'));
    });
  } }],
});
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
  headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000);
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') console.error('Browser:', message.text()); });
const check = (name, condition) => { assert.ok(condition, name); checks.push(name); console.log('PASS', name); };
const button = name => page.getByRole('button', { name, exact: true });
const dialog = page.locator('.task-operation-dialog');
const choose = async name => { await page.locator('#listTask .listTask-item').filter({ hasText: new RegExp(`^${name}$`) }).click(); };
const open = async name => { await button('Открыть дополнительные функции').click(); await page.locator('.side-panel').getByRole('button', { name, exact: true }).click(); await dialog.waitFor({ state: 'visible' }); };
const submit = async name => { await dialog.getByRole('button', { name, exact: true }).click(); };
const done = async () => { await dialog.waitFor({ state: 'hidden' }); };
const state = () => page.evaluate(() => taskFixture.snapshot());
const read = value => page.evaluate(value => taskFixture.read(value), value);
try {
  await page.goto(base + '/clark-editor/__task-fixture');
  await page.waitForFunction(() => window.taskFixture?.ready);
  await button('Открыть дополнительные функции').click();
  check('commands disabled without project', await page.locator('.side-panel').getByRole('button', { name: 'Создать задание', exact: true }).isDisabled());
  check('delete disabled without a selected task', await page.locator('.side-panel').getByRole('button', { name: 'Удалить задание', exact: true }).isDisabled());
  await button('Закрыть дополнительные функции').click();
  const documentation = page.locator('.documentation-button');
  const size = await documentation.boundingBox(), validation = await button('Проверить модель').boundingBox();
  check('documentation width matches validation', size.width === validation.width);
  const help = await button('Быстрый старт').boundingBox(), about = await button('О программе').boundingBox();
  check('documentation is between two rightmost buttons', help.x < size.x && size.x < about.x);
  check('documentation is blue and BASE_URL-aware', await documentation.evaluate(e => getComputedStyle(e).backgroundColor === 'rgb(37, 99, 235)' && e.getAttribute('href') === '/clark-editor/user-guide/index.html'));
  const popupPromise = page.waitForEvent('popup'); await documentation.click(); const popup = await popupPromise; await popup.waitForLoadState();
  check('documentation opens new tab', popup.url() === base + '/clark-editor/user-guide/index.html');
  check('guide explains JWeak1 and names both HTS approximations', await popup.locator('#jweak1').count() === 1
    && (await popup.locator('#title-model-hts').textContent()) === '16.5. Аппроксимация для токовой подсистемы ВТСП'
    && await popup.locator('#model-hts-power').count() === 1 && await popup.locator('#model-hts-tanh').count() === 1);
  for (const width of [390, 768, 1440]) {
    await popup.setViewportSize({ width, height: 1000 });
    await popup.locator('#model-hts-tanh').scrollIntoViewIfNeeded();
    check(`HTS formulas stay inside guide page at ${width}px`, await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await popup.locator('#model-hts .equation').last().scrollIntoViewIfNeeded();
    await popup.screenshot({ path: path.join(out, `hts-approximations-${width}.png`) });
  }
  await popup.close();
  await button('Быстрый старт').click();
  check('old dialog link removed', await page.locator('.general-information-guide-link').count() === 0);
  await page.locator('.general-information-dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await button('Выбрать каталог с проектами').click();
  await page.locator('#listProject').selectOption('Project');
  await open('Создать задание');
  await dialog.locator('input[name="taskName"]').fill('Created'); await submit('Создать задание'); await done();
  const created = await page.evaluate(() => taskFixture.readModel('Created'));
  const savedGeneral = JSON.parse(await read('Project/Created/input3XX/general.txt'));
  check('new task saves and reloads both HTS subsystems disabled', savedGeneral.htsMu === false && savedGeneral.htsRo === false
    && created.model.general.htsMu === false && created.model.general.htsRo === false);
  check('new task reloads all schema files', created.diagnostics.every(item => item.level !== 'error') && Object.values(created.model).every(x => x !== null));
  check('new task has no fabricated geometry and two conrab profiles', created.model.elements.length === 0 && created.model.regions.length === 0 && created.model.conrab.length === 2);
  check('new task has valid empty prescribed source object', JSON.parse(await read('Project/Created/input3XX/mhj.txt')).v.length === 0);
  check('new task guarded and not opened', (await state()).path === null && await page.evaluate(() => taskFixture.exists('Project/Created/input3XX/_nogo.e3d')));
  await choose('Original'); await button('Загрузить для редактирования').click();
  await page.waitForFunction(() => taskFixture.snapshot().model.general);
  check('existing task loads enabled HTS subsystems unchanged', (await state()).model.general.htsMu === true && (await state()).model.general.htsRo === true);
  await page.evaluate(() => taskFixture.dirty());
  const dirty = await state();
  await open('Создать копию'); await dialog.locator('input[name="taskName"]').fill('Copy'); await submit('Создать копию'); await done();
  const afterCopy = await state();
  const copiedGeneral = JSON.parse(await read('Project/Copy/input3XX/general.txt'));
  check('copy preserves enabled HTS subsystems', copiedGeneral.htsMu === true && copiedGeneral.htsRo === true);
  check('copy preserves unsaved loaded model', dirty.path === afterCopy.path && afterCopy.dirty && afterCopy.model.general.timeStep === 42);
  check('copy contains saved state, library and formulas', JSON.parse(await read('Project/Copy/input3XX/general.txt')).timeStep !== 42 && await read('Project/Copy/input3XX/FMM/custom.json') === '{"unchanged":true}' && await read('Project/Copy/input3XX/formulas-user.json') === '{"formula":"sin(t)"}');
  check('copy excludes results', !await page.evaluate(() => taskFixture.exists('Project/Copy/output3XX/result.bin')));
  await choose('Original'); await open('Переименовать');
  await dialog.locator('input[type="checkbox"]').check(); await dialog.locator('input[name="taskName"]').fill('Renamed'); await submit('Переименовать');
  await page.waitForFunction(() => document.querySelector('.task-operation-error').textContent.includes('Сначала сохраните'));
  check('dirty rename rejected', await page.evaluate(() => taskFixture.exists('Project/Original/input3XX/general.txt')));
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  await page.evaluate(() => taskFixture.clean());
  await open('Переименовать'); await dialog.locator('input[type="checkbox"]').check();
  await dialog.locator('input[name="taskName"]').fill('Copy'); await submit('Переименовать');
  await page.waitForFunction(() => document.querySelector('.task-operation-error').textContent.includes('уже занято'));
  check('conflict stays in dialog and preserves source', await page.evaluate(() => taskFixture.exists('Project/Original/input3XX/general.txt')));
  await dialog.locator('input[name="taskName"]').fill('Renamed'); await submit('Переименовать'); await done();
  await page.waitForFunction(() => taskFixture.snapshot().path?.endsWith('/Renamed') && taskFixture.snapshot().model.general);
  check('rename updates loaded path and task list', (await state()).path.endsWith('/Renamed') && (await read('clark.tasks.txt')).includes('Project/Renamed\n'));
  check('rename preserves result and removes old directory', await page.evaluate(() => taskFixture.exists('Project/Renamed/output3XX/result.bin')) && !await page.evaluate(() => taskFixture.exists('Project/Original/input3XX/general.txt')));
  await open('Перенести в другой каталог'); await dialog.locator('input[type="checkbox"]').check();
  await page.evaluate(() => taskFixture.setPicker('cancel')); await submit('Выбрать каталог назначения');
  await page.waitForFunction(() => !document.querySelector('.task-operation-dialog button[type="submit"]').disabled);
  check('picker cancellation keeps source and dialog', await dialog.isVisible() && await page.evaluate(() => taskFixture.exists('Project/Renamed/input3XX/general.txt')));
  await page.evaluate(() => taskFixture.setPicker('root')); await submit('Выбрать каталог назначения');
  await page.waitForFunction(() => document.querySelector('.task-operation-error').textContent.includes('каталог проекта'));
  check('root is rejected as destination project', await page.evaluate(() => taskFixture.exists('Project/Renamed/input3XX/general.txt')));
  await page.evaluate(() => taskFixture.setPicker('destination')); await submit('Выбрать каталог назначения'); await done();
  await page.waitForFunction(() => taskFixture.snapshot().path === 'clark.projects/Second/Renamed');
  check('move updates loaded path and enabled launch entry', (await read('clark.tasks.txt')).includes('Second/Renamed\n') && !await page.evaluate(() => taskFixture.exists('Project/Renamed/input3XX/general.txt')));
  await page.locator('#listProject').selectOption('Second');
  await page.locator('#listTask .listTask-item').filter({ hasText: /^Renamed$/ }).waitFor({ state: 'visible' });
  check('destination list refreshed after project selection', await page.locator('#listTask .listTask-item').filter({ hasText: /^Renamed$/ }).count() === 1);
  await choose('Renamed');
  await page.evaluate(() => taskFixture.dirty());
  await open('Удалить задание');
  check('delete confirmation names selected task, warns about results and dirty changes',
    (await dialog.textContent()).includes('Second/Renamed') && (await dialog.textContent()).includes('несохранённые изменения')
    && (await dialog.textContent()).includes('результаты расчёта') && await dialog.locator('input[name="taskName"]').count() === 0);
  check('delete requires stopped-writers confirmation', await dialog.getByRole('button', { name: 'Удалить задание', exact: true }).isDisabled());
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click(); await done();
  check('cancel delete preserves directory, loaded dirty model and launch row',
    await page.evaluate(() => taskFixture.exists('Second/Renamed/input3XX/general.txt'))
    && (await state()).dirty && (await state()).model.general.timeStep === 42 && (await read('clark.tasks.txt')).includes('Second/Renamed'));
  // Удаление другого выделенного задания не должно закрывать открытое.
  await page.locator('#listProject').selectOption('Project'); await choose('Copy');
  const beforeOtherDelete = await state();
  await open('Удалить задание'); await dialog.locator('input[type="checkbox"]').check(); await submit('Удалить задание'); await done();
  check('delete selected unloaded task keeps loaded task and unsaved model', JSON.stringify(await state()) === JSON.stringify(beforeOtherDelete));
  check('delete refreshes project list and preserves sibling', await page.locator('#listTask .listTask-item').filter({ hasText: /^Copy$/ }).count() === 0
    && await page.evaluate(() => taskFixture.exists('Project/Created/input3XX/general.txt')) && !(await read('clark.tasks.txt')).includes('Project/Copy'));
  await page.locator('#listProject').selectOption('Second'); await choose('Renamed');
  await open('Удалить задание'); await dialog.locator('input[type="checkbox"]').check(); await submit('Удалить задание'); await done();
  await page.waitForFunction(() => !taskFixture.snapshot().path && !taskFixture.snapshot().model.general && !taskFixture.snapshot().dirty);
  check('delete loaded task clears editor and list including last row', await page.locator('#listTask .listTask-item').count() === 0
    && !(await read('clark.tasks.txt')).includes('Second/Renamed') && !await page.evaluate(() => taskFixture.exists('Second/Renamed/output3XX/result.bin')));
  await page.locator('#listProject').selectOption('Project'); await choose('Failure');
  await button('Загрузить для редактирования').click(); await page.waitForFunction(() => taskFixture.snapshot().model.general);
  await page.evaluate(() => taskFixture.failDeletion(true));
  await open('Удалить задание'); await dialog.locator('input[type="checkbox"]').check(); await submit('Удалить задание');
  await page.waitForFunction(() => document.querySelector('.task-operation-error').textContent.includes('частично'));
  check('partial deletion closes affected editor, refreshes remaining directory and prevents retry',
    !(await state()).path && await page.locator('#listTask .listTask-item').filter({ hasText: /^Failure$/ }).count() === 1
    && await dialog.getByRole('button', { name: 'Удалить задание', exact: true }).isDisabled());
  await page.screenshot({ path: path.join(out, 'task-delete-error.png') });
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click(); await done();
  await page.evaluate(() => taskFixture.failDeletion(false));
  await page.screenshot({ path: path.join(out, 'task-commands.png') });
  check('no uncaught browser errors', errors.length === 0);
} finally {
  await writeFile(path.join(out, 'results.json'), JSON.stringify({ passed: checks.length, checks, errors, scope: 'Native Chromium OPFS handles, actual App/Tasks/SidePanel/TaskInfoBar; controlled system picker', notTested: ['Windows directory permissions and chooser', 'clark://', 'concurrent external filesystem writers'] }, null, 2));
  if (errors.length) console.error(errors);
  await browser.close(); await server.close();
}
