// Native OPFS handles exercise browser file streams and removal. The system picker
// is controlled; operating-system chooser permissions and Clark are out of scope.
import { render } from 'solid-js/web';
import App from '../../src/App.jsx';
import { initializeTaskDirectory } from '../../src/services/taskTemplateService.js';
import { dataService } from '../../src/services/dataService.js';
import { tabRegistry } from '../../src/services/tabRegistry.js';
import { selectionService } from '../../src/services/selectionService.js';
import { modelService } from '../../src/services/modelService.js';
import { unsavedChangesService } from '../../src/services/unsavedChangesService.js';

const opfs = await navigator.storage.getDirectory();
try { await opfs.removeEntry('clark.projects', { recursive: true }); } catch (e) { if (e.name !== 'NotFoundError') throw e; }
const root = await opfs.getDirectoryHandle('clark.projects', { create: true });
const project = await root.getDirectoryHandle('Project', { create: true });
const destination = await root.getDirectoryHandle('Second', { create: true });
const original = await project.getDirectoryHandle('Original', { create: true });
await initializeTaskDirectory(original);
const failure = await project.getDirectoryHandle('Failure', { create: true });
await initializeTaskDirectory(failure);
let failDeletion = false;
const nativeRemove = FileSystemDirectoryHandle.prototype.removeEntry;
FileSystemDirectoryHandle.prototype.removeEntry = async function(name, options) {
  if (failDeletion && name === 'Failure') {
    const input = await failure.getDirectoryHandle('input3XX');
    await nativeRemove.call(input, 'general.txt');
    throw new DOMException('Test partial deletion', 'NoModificationAllowedError');
  }
  return nativeRemove.call(this, name, options);
};
async function directory(base, parts, create = false) {
  for (const part of parts) base = await base.getDirectoryHandle(part, { create });
  return base;
}
async function put(base, path, text) {
  const parts = path.split('/'), name = parts.pop();
  const file = await (await directory(base, parts, true)).getFileHandle(name, { create: true });
  const stream = await file.createWritable(); await stream.write(text); await stream.close();
}
async function read(path) {
  const parts = path.split('/'), name = parts.pop();
  return (await (await (await directory(root, parts)).getFileHandle(name)).getFile()).text();
}
// Существующее задание с включёнными ВТСП-подсистемами должно сохранить выбор.
const originalGeneral = JSON.parse(await read('Project/Original/input3XX/general.txt'));
await put(original, 'input3XX/general.txt', JSON.stringify({ ...originalGeneral, htsMu: true, htsRo: true }));
await put(original, 'output3XX/result.bin', new Uint8Array([0, 128, 255]));
await put(original, 'input3XX/formulas-user.json', '{"formula":"sin(t)"}');
await put(original, 'input3XX/FMM/custom.json', '{"unchanged":true}');
await put(root, 'clark.tasks.txt', 'Project/Original\n');
let picker = 'root';
window.showDirectoryPicker = async options => {
  if (picker === 'cancel') throw new DOMException('Cancelled', 'AbortError');
  if (options?.id === 'clark-project-disk') return opfs;
  return picker === 'root' ? root : picker === 'wrong' ? original : destination;
};
localStorage.setItem('e3d.generalInformation.openAtStartup', 'false');
window.taskFixture = {
  failDeletion: value => { failDeletion = value; },
  read, setPicker: value => { picker = value; },
  exists: async path => { try { await read(path); return true; } catch (e) { if (e.name === 'NotFoundError') return false; throw e; } },
  snapshot: () => ({ path: selectionService.loadedTaskPath(), model: structuredClone(modelService.getModel()), dirty: unsavedChangesService.hasDirty() }),
  dirty: () => { const general = { ...modelService.getModel().general, timeStep: 42 }; modelService.setModelPart(tabRegistry.find(schema => schema.id === 'general'), general); unsavedChangesService.setExplicitDirty('general', true); },
  clean: () => { unsavedChangesService.setBaseline('general', modelService.getModel().general); unsavedChangesService.setExplicitDirty('general', false); },
  readModel: async name => {
    const handle = await project.getDirectoryHandle(name), model = {}, diagnostics = [];
    for (const schema of tabRegistry) model[schema.id] = await dataService.load(handle, schema, diagnostics);
    return { model, diagnostics };
  },
};
render(() => <App />, document.getElementById('root'));
window.taskFixture.ready = true;
