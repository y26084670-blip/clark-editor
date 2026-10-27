import { chooseProjectDisk } from "./browser-project-access.mjs";
// Requires npm ci, Playwright and Chromium. No production entrypoint is changed.
// PLAYWRIGHT_MODULE and CHROMIUM_EXECUTABLE optionally locate external tooling.
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.resolve(process.env.CHECK_OUTPUT ?? '/tmp/clark-project-browser');
await mkdir(out, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const server = await createServer({ root, cacheDir: path.join(out, 'vite-cache'), server: { host: '127.0.0.1', port: 0 }, base: '/clark-editor/',
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
const choose = async name => { await page.locator('#listTask .listTask-item').filter({ hasText: new RegExp(`(?:^|▶\\s*)${name}$`) }).click(); };
const open = async name => { await button('Выбор задания').click(); await button('Открыть дополнительные функции').click(); if (['Создать проект', 'Переименовать проект', 'Удалить пустой проект'].includes(name)) { const section = page.locator('.side-panel details').filter({ hasText: 'Работа с проектами' }); if (!await section.evaluate(e => e.open)) await section.locator('summary').click(); } await page.locator('.side-panel').getByRole('button', { name, exact: true }).click(); await dialog.waitFor({ state: 'visible' }); };
const submit = async name => { await dialog.getByRole('button', { name, exact: true }).click(); };
const done = async () => { await dialog.waitFor({ state: 'hidden' }); };
const state = () => page.evaluate(() => taskFixture.snapshot());
const read = value => page.evaluate(value => taskFixture.read(value), value);
const confirm = async name => { await dialog.locator('input[type="checkbox"]').check(); await submit(name); };
const projectExists = name => page.evaluate(name => taskFixture.projectExists(name), name);
try {
  await page.goto(base + '/clark-editor/__task-fixture');
  await page.waitForFunction(() => window.taskFixture?.ready);
  await page.locator('.task-access-dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await button('Открыть дополнительные функции').click();
  const section = page.locator('.side-panel details').filter({ hasText: 'Работа с проектами' });
  check('project section is collapsed by default and above task section', !await section.evaluate(e => e.open)
    && await page.locator('.side-panel-section-title').allTextContents().then(t => t.indexOf('Работа с проектами') < t.indexOf('Работа с заданиями')));
  await section.locator('summary').click();
  check('project commands disabled without catalog', await button('Создать проект').isDisabled() && await button('Переименовать проект').isDisabled());
  check('task commands have explicit names', await button('ZIP по эскизу для ИИ').count() === 1
    && await button('Переименовать задание').count() === 1 && await button('Создать задание').count() === 1);
  await page.screenshot({ path: path.join(out, 'project-menu.png') });
  await button('Закрыть дополнительные функции').click();
  await chooseProjectDisk(page);
  await open('Создать проект');
  await dialog.locator('input[name="projectName"]').fill('Project'); await submit('Создать проект');
  await dialog.getByRole('alert').filter({ hasText: 'уже занято' }).waitFor();
  check('existing project cannot be overwritten', await read('Project/Original/input3XX/formulas-user.json') === '{"formula":"sin(t)"}');
  await dialog.locator('input[name="projectName"]').fill('AEmpty'); await submit('Создать проект'); await done();
  check('new project selected and empty without creating a task', await page.locator('#listProject').inputValue() === 'AEmpty'
    && (await page.evaluate(() => taskFixture.projectEntries('AEmpty'))).length === 0 && (await state()).path === null);
  await open('Удалить пустой проект');
  check('empty-project delete requires confirmation and names project', await dialog.getByRole('button', { name: 'Удалить пустой проект', exact: true }).isDisabled()
    && (await dialog.textContent()).includes('AEmpty'));
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click(); await done();
  check('cancel preserves empty project', await projectExists('AEmpty'));
  await page.evaluate(() => taskFixture.put('clark.tasks.txt', 'Project/Original\n*AEmpty/Ghost\n'));
  await open('Удалить пустой проект'); await confirm('Удалить пустой проект'); await done();
  check('empty project deleted and selection cleared; obsolete list row removed', !await projectExists('AEmpty')
    && await page.locator('#listProject').inputValue() === '' && !(await read('clark.tasks.txt')).includes('AEmpty/'));

  await open('Создать проект');
  await dialog.locator('input[name="projectName"]').fill('FileOnly'); await submit('Создать проект'); await done();
  await page.evaluate(() => taskFixture.put('FileOnly/.keep', 'preserve'));
  await open('Удалить пустой проект'); await confirm('Удалить пустой проект');
  await dialog.getByRole('alert').filter({ hasText: 'не пуст' }).waitFor();
  check('project with a hidden file is not considered empty', await read('FileOnly/.keep') === 'preserve');
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click(); await done();

  await page.locator('#listProject').selectOption('Project'); await choose('Original');
  await button('Загрузить для редактирования').click();
  await page.waitForFunction(() => taskFixture.snapshot().model.general);
  await page.evaluate(() => taskFixture.dirty());
  const before = await state();
  await open('Переименовать проект'); await dialog.locator('input[name="projectName"]').fill('RenamedProject');
  await confirm('Переименовать проект');
  await dialog.getByRole('alert').filter({ hasText: 'Сначала сохраните' }).waitFor();
  check('dirty loaded task blocks renaming its entire project', JSON.stringify(await state()) === JSON.stringify(before) && await projectExists('Project') && !await projectExists('RenamedProject'));
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click(); await done();

  await open('Создать проект'); await dialog.locator('input[name="projectName"]').fill('AAA'); await submit('Создать проект'); await done();
  check('creating another project preserves dirty loaded model', JSON.stringify(await state()) === JSON.stringify(before));
  const bookmark = JSON.parse(await read('clark.editor-last-task.json'));
  const names = await page.locator('#listProject option').evaluateAll(elements => elements.filter(e => e.value).map(e => e.value));
  check('last-opened marker follows shifted project ordering', names[bookmark.projectIndex - 1] === 'Project');
  await open('Переименовать проект'); await dialog.locator('input[name="projectName"]').fill('ZZZ'); await confirm('Переименовать проект'); await done();
  check('renaming a different project preserves dirty loaded model', JSON.stringify(await state()) === JSON.stringify(before) && await projectExists('ZZZ'));
  await open('Удалить пустой проект'); await confirm('Удалить пустой проект'); await done();
  check('deleting unrelated empty project preserves loaded model', JSON.stringify(await state()) === JSON.stringify(before));

  await page.evaluate(() => taskFixture.clean());
  await page.locator('#listProject').selectOption('Project'); await choose('Original');
  await page.evaluate(() => taskFixture.put('clark.tasks.txt', 'Project/Original\n*Project/Failure\n*Second/Missing\n'));
  await open('Переименовать проект');
  await dialog.locator('input[name="projectName"]').fill('Second'); await confirm('Переименовать проект');
  await dialog.getByRole('alert').filter({ hasText: 'уже занято' }).waitFor();
  await dialog.locator('input[name="projectName"]').fill('RenamedProject'); await submit('Переименовать проект'); await done();
  await page.waitForFunction(() => taskFixture.snapshot().path === 'clark.projects/RenamedProject/Original' && taskFixture.snapshot().model.general);
  check('rename updates loaded and selected task paths and every launch row', !await projectExists('Project')
    && await page.locator('#listProject').inputValue() === 'RenamedProject'
    && await read('clark.tasks.txt') === 'RenamedProject/Original\n*RenamedProject/Failure\n*Second/Missing\n');
  check('rename preserves inputs and binary result', await read('RenamedProject/Original/input3XX/formulas-user.json') === '{"formula":"sin(t)"}'
    && await page.evaluate(() => taskFixture.exists('RenamedProject/Original/output3XX/result.bin')));
  const afterBookmark = JSON.parse(await read('clark.editor-last-task.json'));
  const renamedNames = await page.locator('#listProject option').evaluateAll(elements => elements.filter(e => e.value).map(e => e.value));
  check('last-opened marker follows renamed project', renamedNames[afterBookmark.projectIndex - 1] === 'RenamedProject');

  await page.evaluate(() => taskFixture.failProjectDeletion(true));
  await open('Переименовать проект'); await dialog.locator('input[name="projectName"]').fill('RecoveredProject');
  await confirm('Переименовать проект');
  await dialog.getByRole('alert').filter({ hasText: 'частично' }).waitFor();
  await page.waitForFunction(() => taskFixture.snapshot().path === 'clark.projects/RecoveredProject/Original' && taskFixture.snapshot().model.general);
  check('partial source removal switches loaded task to verified copy and prevents retry',
    await dialog.getByRole('button', { name: 'Переименовать проект', exact: true }).isDisabled()
    && await page.evaluate(() => taskFixture.exists('RecoveredProject/Original/input3XX/general.txt')));
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click(); await done();
  await page.evaluate(() => taskFixture.failProjectDeletion(false));
  await page.screenshot({ path: path.join(out, 'project-renamed.png') });
  check('no uncaught browser errors', errors.length === 0);
} finally {
  await writeFile(path.join(out, 'results.json'), JSON.stringify({ passed: checks.length, checks, errors,
    scope: 'Real App, native Chromium OPFS; controlled directory chooser and partial removal failure',
    notTested: ['Native Windows chooser/permissions', 'Concurrent external filesystem writers', 'Running solver or Viewer during rename'] }, null, 2));
  await browser.close(); await server.close();
}
