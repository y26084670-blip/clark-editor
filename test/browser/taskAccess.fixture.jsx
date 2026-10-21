import { render } from 'solid-js/web';
import App from '../../src/App.jsx';
import { initializeTaskDirectory } from '../../src/services/taskTemplateService.js';
import { selectionService } from '../../src/services/selectionService.js';
const opfs = await navigator.storage.getDirectory();
try { await opfs.removeEntry('access-test', { recursive: true }); } catch (error) { if (error.name !== 'NotFoundError') throw error; }
const container = await opfs.getDirectoryHandle('access-test', { create: true });
const disk = await container.getDirectoryHandle('Диск Д', { create: true });
const empty = await container.getDirectoryHandle('Пустой диск', { create: true });
const handles = {};
for (const name of ['System Volume Information', '$RECYCLE.BIN', 'clark.app', 'CLARK.Tests', 'clark.projects']) {
  const base = await disk.getDirectoryHandle(name, { create: true }); handles[name] = base;
  if (['CLARK.Tests', 'clark.projects'].includes(name)) {
    const project = await base.getDirectoryHandle(name === 'clark.projects' ? 'Project' : 'Другой проект', { create: true });
    const task = await project.getDirectoryHandle('Задание', { create: true });
    await initializeTaskDirectory(task);
  }
}
await disk.getFileHandle('clark.file', { create: true });
let mode = 'disk';
const calls = [];
window.showDirectoryPicker = async options => {
  calls.push(options);
  if (mode === 'cancel') throw new DOMException('Cancelled', 'AbortError');
  if (mode === 'denied') throw new DOMException('Denied', 'NotAllowedError');
  return mode === 'empty' ? empty : disk;
};
async function read(name, base = disk) { return JSON.parse(await (await (await base.getFileHandle(name)).getFile()).text()); }
async function put(base, name, value) { const stream = await (await base.getFileHandle(name, { create: true })).createWritable(); await stream.write(JSON.stringify(value)); await stream.close(); }
window.accessFixture = { calls, mode: value => { mode = value; }, read,
  path: () => selectionService.loadedTaskPath(),
  marker: name => read('clark.workspace.json', handles[name]),
  async ack(state = 'bound', stale = false) {
    const request = await read('clark.catalogs-request.json');
    const catalogs = state === 'error' ? request.catalogs.slice(0, 1) : request.catalogs;
    for (const item of catalogs) await put(handles[item.name], 'clark.workspace.json', {
      schemaVersion: 1, workspaceId: item.workspaceId, rootName: item.name, bindingState: 'bound', launchOptionsVersion: 1, conditionsVersion: 1,
    });
    await put(disk, 'clark.catalogs-result.json', { schemaVersion: 1, requestId: stale ? crypto.randomUUID() : request.requestId,
      state, catalogs, message: state === 'error' ? 'Проверка частичной ошибки' : '' });
  },
};
render(() => <App />, document.getElementById('root'));
window.accessFixture.ready = true;
