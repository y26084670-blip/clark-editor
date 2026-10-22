import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runTaskDirectoryOperation as run, runProjectDirectoryOperation as projectRun, validateTaskName, suggestTaskCopyName } from '../src/services/taskDirectoryService.js';

// Disk-backed adapter: actual byte reads/writes/removals with injected failures.
// Browser API compatibility is additionally checked against native OPFS handles.
class Handle {
  constructor(location, kind = 'directory', hook = () => {}) { this.location = location; this.kind = kind; this.name = path.basename(location); this.hook = hook; }
  async isSameEntry(other) { return this.location === other.location; }
  async resolve(other) { const rel = path.relative(this.location, other.location); return rel.startsWith('..') ? null : rel ? rel.split(path.sep) : []; }
  async getDirectoryHandle(name, { create = false } = {}) { return this.child(name, 'directory', create); }
  async getFileHandle(name, { create = false } = {}) { return this.child(name, 'file', create); }
  async child(name, kind, create) {
    const location = path.join(this.location, name);
    let stat;
    try { stat = await fs.stat(location); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!create) throw new DOMException('Missing', 'NotFoundError');
      if (kind === 'directory') await fs.mkdir(location); else await fs.writeFile(location, new Uint8Array(), { flag: 'wx' });
      stat = await fs.stat(location);
    }
    if (stat.isDirectory() !== (kind === 'directory')) throw new DOMException('Wrong kind', 'TypeMismatchError');
    return new Handle(location, kind, this.hook);
  }
  async *entries() { for (const e of await fs.readdir(this.location, { withFileTypes: true })) yield [e.name, new Handle(path.join(this.location, e.name), e.isDirectory() ? 'directory' : 'file', this.hook)]; }
  async getFile() { await this.hook('read', this.location.replaceAll(path.sep, '/')); return new File([await fs.readFile(this.location)], this.name); }
  async createWritable() {
    let bytes;
    return { write: async value => { bytes = value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : value; },
      close: async () => { await this.hook('write', this.location.replaceAll(path.sep, '/')); await fs.writeFile(this.location, bytes); }, abort: async () => {} };
  }
  async removeEntry(name, { recursive = false } = {}) {
    await this.hook('remove', path.join(this.location, name).replaceAll(path.sep, '/'));
    const target = path.join(this.location, name);
    if (!recursive && (await fs.stat(target)).isDirectory()) await fs.rmdir(target);
    else await fs.rm(target, { recursive });
  }
}
async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'clark-task-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  let hook = () => {};
  const root = new Handle(base, 'directory', (...args) => hook(...args));
  const parent = await root.getDirectoryHandle('Project', { create: true });
  const source = await parent.getDirectoryHandle('Original', { create: true });
  const put = async (where, relative, bytes) => { const name = path.join(where.location, relative); await fs.mkdir(path.dirname(name), { recursive: true }); await fs.writeFile(name, bytes); };
  const read = (where, relative) => fs.readFile(path.join(where.location, relative), 'utf8');
  const exists = (where, relative) => fs.stat(path.join(where.location, relative)).then(() => true, () => false);
  await put(source, 'input3XX/general.txt', '{"time":1}');
  await put(source, 'input3XX/jweak_local.json', '{"parents":[1,2]}');
  await put(source, 'input3XX/FMM/local.txt', 'magnetic data');
  await put(source, 'input3XX/custom.formulas.json', '{"expression":"sin(t)"}');
  await put(source, 'output3XX/result.bin', new Uint8Array([0, 255, 127, 128]));
  await put(source, 'protocol.log', 'old log');
  await put(source, 'input3XX/a.tmp', 'temporary');
  await put(root, 'clark.tasks.txt', 'Project/Original\n*Project/Other\n');
  return { root, parent, source, put, read, exists, setHook: fn => { hook = fn; },
    run: options => run({ root, sourceParent: parent, source, destinationParent: parent, name: 'New', ...options }) };
}

test('portable names reject traversal, Windows aliases and ambiguous endings', () => {
  for (const name of ['', '.', '..', '../x', 'x/y', 'x\\y', ' x', 'x ', 'x.', 'CON', 'nul.txt', 'LPT9.x', 'a:b', 'a\n', 'x'.repeat(121)]) assert.throws(() => validateTaskName(name), undefined, name);
  assert.equal(validateTaskName('Катушка 160 — вариант 2'), 'Катушка 160 — вариант 2');
});

test('project creation makes an empty direct child; conflicts and invalid names do not overwrite', async t => {
  const f = await fixture(t), before = await f.read(f.root, 'clark.tasks.txt');
  const result = await projectRun({ kind: 'create', root: f.root, name: 'Новый проект' });
  assert.deepEqual(await fs.readdir(result.handle.location), []);
  assert.equal(await f.read(f.root, 'clark.tasks.txt'), before);
  for (const name of ['Project', 'project', '../bad', 'CON', 'x.']) {
    await assert.rejects(projectRun({ kind: 'create', root: f.root, name }));
  }
  await f.put(f.root, 'occupied', 'keep');
  await assert.rejects(projectRun({ kind: 'create', root: f.root, name: 'occupied' }), /занято/);
  assert.equal(await f.read(f.root, 'occupied'), 'keep');
});

test('project rename preserves all tasks, binary results, empty folders and existing guards', async t => {
  const f = await fixture(t);
  await f.put(f.parent, 'Other/input3XX/_nogo.e3d', 'keep guard');
  await f.put(f.parent, 'Legacy/input3AA/data', 'legacy');
  await f.put(f.parent, 'project-note.txt', 'note');
  await f.parent.getDirectoryHandle('Empty', { create: true });
  const result = await projectRun({ kind: 'rename', root: f.root, source: f.parent, name: 'Renamed' });
  assert.equal(result.sourceRemoved, true);
  assert.equal(await f.exists(f.root, 'Project'), false);
  assert.equal(await f.read(result.handle, 'Other/input3XX/_nogo.e3d'), 'keep guard');
  assert.equal(await f.exists(result.handle, 'Original/input3XX/_nogo.e3d'), false);
  assert.equal(await f.exists(result.handle, 'Legacy/input3XX'), false);
  assert.deepEqual(await fs.readFile(path.join(result.handle.location, 'Original/output3XX/result.bin')), Buffer.from([0, 255, 127, 128]));
  assert.deepEqual(await fs.readdir(path.join(result.handle.location, 'Empty')), []);
  assert.equal(await f.read(result.handle, 'project-note.txt'), 'note');
  assert.equal(await f.read(f.root, 'clark.tasks.txt'), 'Renamed/Original\n*Renamed/Other\n');
});

test('project rename updates only full project segments and invalidates old launch request', async t => {
  const f = await fixture(t);
  await f.put(f.root, 'clark.tasks.txt', 'Project/Original\n*project/Other\nProject2/Task\n');
  await f.put(f.root, 'clark.launch.json', 'stale');
  await projectRun({ kind: 'rename', root: f.root, source: f.parent, name: 'Renamed' });
  assert.equal(await f.read(f.root, 'clark.tasks.txt'), 'Renamed/Original\n*Renamed/Other\nProject2/Task\n');
  assert.equal(await f.read(f.root, 'clark.launch.json'), '');
});

test('project rename rejects stale destinations, invalid list and replaced or nested source', async t => {
  for (const list of ['Project/Original\nRenamed/Stale\n', '../outside\n']) {
    const f = await fixture(t); await f.put(f.root, 'clark.tasks.txt', list);
    await assert.rejects(projectRun({ kind: 'rename', root: f.root, source: f.parent, name: 'Renamed' }));
    assert.equal(await f.exists(f.root, 'Renamed'), false);
    assert.equal(await f.exists(f.parent, 'Original'), true);
  }
  const f = await fixture(t);
  for (const source of [f.root, f.source]) await assert.rejects(projectRun({ kind: 'rename', root: f.root, source, name: 'Renamed' }), /непосредственно/);
  const get = f.root.getDirectoryHandle.bind(f.root);
  f.root.getDirectoryHandle = async (...args) => { const h = await get(...args); h.isSameEntry = async () => false; return h; };
  await assert.rejects(projectRun({ kind: 'rename', root: f.root, source: f.parent, name: 'Renamed' }), /заменён/);
});

test('project copy, hash and launch write failures preserve original and block incomplete destination', async t => {
  for (const failure of ['copy', 'hash', 'list', 'launch']) {
    const f = await fixture(t); let corrupted = false;
    await f.put(f.root, 'clark.launch.json', 'stale');
    f.setHook(async (op, p) => {
      if (failure === 'copy' && op === 'write' && p.endsWith('Renamed/Original/input3XX/general.txt')) throw new Error('disk full');
      if (failure === 'hash' && !corrupted && op === 'read' && p.endsWith('Renamed/Original/input3XX/general.txt')) { corrupted = true; await fs.writeFile(p, 'bad'); }
      if (op === 'write' && ((failure === 'list' && p.endsWith('clark.tasks.txt')) || (failure === 'launch' && p.endsWith('clark.launch.json')))) throw new Error('locked');
    });
    await assert.rejects(projectRun({ kind: 'rename', root: f.root, source: f.parent, name: 'Renamed' }), error => {
      assert.equal(error.operationResult.deletionStarted, false); return true;
    });
    assert.equal(await f.read(f.source, 'input3XX/general.txt'), '{"time":1}');
    assert.equal(await f.exists(f.root, 'Renamed/Original/input3XX/_nogo.e3d'), true);
  }
});

test('source edits or launch-list changes during project copy stop deletion', async t => {
  for (const target of ['source', 'list']) {
    const f = await fixture(t); let changed = false;
    f.setHook(async (op, p) => {
      if (!changed && op === 'write' && p.endsWith('Renamed/Original/input3XX/general.txt')) {
        changed = true;
        if (target === 'source') await f.put(f.parent, 'new-file.txt', 'new');
        else await f.put(f.root, 'clark.tasks.txt', '*Project/Original\n');
      }
    });
    await assert.rejects(projectRun({ kind: 'rename', root: f.root, source: f.parent, name: 'Renamed' }), error => {
      assert.equal(error.operationResult.deletionStarted, false); return true;
    });
    assert.equal(await f.exists(f.parent, 'Original'), true);
  }
});

test('partial project deletion retains verified complete destination and reports recovery state', async t => {
  const f = await fixture(t);
  f.setHook(async (op, p) => { if (op === 'remove' && p.endsWith('/Project')) { await fs.rm(path.join(p, 'Original/input3XX/general.txt')); throw new Error('locked'); } });
  await assert.rejects(projectRun({ kind: 'rename', root: f.root, source: f.parent, name: 'Renamed' }), error => {
    assert.equal(error.operationResult.verified, true); assert.equal(error.operationResult.deletionStarted, true);
    assert.equal(error.operationResult.sourceRemoved, false); assert.match(error.message, /частично/); return true;
  });
  assert.equal(await f.read(f.root, 'Renamed/Original/input3XX/general.txt'), '{"time":1}');
  assert.equal(await f.exists(f.root, 'Renamed/Original/input3XX/_nogo.e3d'), true);
});

test('empty-project removal rejects any file or directory, including hidden files', async t => {
  const f = await fixture(t);
  for (const content of ['file', 'directory', 'hidden']) {
    const source = await f.root.getDirectoryHandle('Empty' + content, { create: true });
    if (content === 'directory') await source.getDirectoryHandle('EmptyChild', { create: true });
    else await f.put(source, content === 'hidden' ? '.keep' : 'note.txt', 'keep');
    await assert.rejects(projectRun({ kind: 'delete', root: f.root, source }), /не пуст/);
    assert.equal(await f.exists(f.root, source.name), true);
  }
});

test('empty-project removal drops obsolete launch rows and preserves unrelated entries', async t => {
  const f = await fixture(t), source = await f.root.getDirectoryHandle('Empty', { create: true });
  await f.put(f.root, 'clark.tasks.txt', 'Project/Original\n*Empty/Ghost\nEmpty2/Task\n');
  await projectRun({ kind: 'delete', root: f.root, source });
  assert.equal(await f.exists(f.root, 'Empty'), false);
  assert.equal(await f.read(f.root, 'clark.tasks.txt'), 'Project/Original\nEmpty2/Task\n');
});

test('file appearing immediately before empty-project deletion is never removed recursively', async t => {
  const f = await fixture(t), source = await f.root.getDirectoryHandle('Empty', { create: true });
  f.setHook(async (op, p) => { if (op === 'remove' && p.endsWith('/Empty')) await f.put(source, 'appeared.txt', 'preserve'); });
  await assert.rejects(projectRun({ kind: 'delete', root: f.root, source }));
  assert.equal(await f.read(source, 'appeared.txt'), 'preserve');
});

test('project operations without task list do not create it; empty removal write failure preserves directory', async t => {
  const f = await fixture(t); await fs.rm(path.join(f.root.location, 'clark.tasks.txt'));
  await f.put(f.root, 'clark.launch.json', 'stale');
  await projectRun({ kind: 'rename', root: f.root, source: f.parent, name: 'Renamed' });
  assert.equal(await f.exists(f.root, 'clark.tasks.txt'), false);
  assert.equal(await f.read(f.root, 'clark.launch.json'), '');
  const source = await f.root.getDirectoryHandle('Empty', { create: true });
  f.setHook((op, p) => { if (op === 'write' && p.endsWith('clark.launch.json')) throw new Error('locked'); });
  await assert.rejects(projectRun({ kind: 'delete', root: f.root, source }));
  assert.equal(await f.exists(f.root, 'Empty'), true);
});
test('copy saved inputs, binary supplements and libraries; exclude results/temp; mark unapproved', async t => {
  const f = await fixture(t); await f.put(f.source, 'input3XX/extra.bin', new Uint8Array([0, 255, 33]));
  const result = await f.run({ kind: 'copy' });
  for (const file of ['general.txt', 'jweak_local.json', 'FMM/local.txt', 'custom.formulas.json']) assert.equal(await f.read(result.handle, 'input3XX/' + file), await f.read(f.source, 'input3XX/' + file));
  assert.deepEqual(await fs.readFile(path.join(result.handle.location, 'input3XX/extra.bin')), Buffer.from([0, 255, 33]));
  for (const file of ['output3XX', 'protocol.log', 'input3XX/a.tmp']) assert.equal(await f.exists(result.handle, file), false);
  assert.ok(await f.exists(result.handle, 'input3XX/_nogo.e3d'));
  assert.ok(await f.exists(f.source, 'output3XX/result.bin'));
  assert.equal(await f.read(f.root, 'clark.tasks.txt'), 'Project/Original\n*Project/Other\n*Project/New\n');
});
test('copy defaults to next free name and rejects existing files/case-only conflicts', async t => {
  const f = await fixture(t); await f.parent.getDirectoryHandle('Original — копия', { create: true });
  assert.equal(await suggestTaskCopyName(f.parent, 'Original'), 'Original — копия 2');
  for (const name of ['original', 'Original', 'ORIGINAL']) await assert.rejects(f.run({ kind: 'copy', name }), /занято/);
  await f.put(f.parent, 'New', 'preserve'); await assert.rejects(f.run({ kind: 'copy' }), /занято/);
  assert.equal(await f.read(f.parent, 'New'), 'preserve');
});
test('create delegates to schema initializer and blocks unapproved draft', async t => {
  const f = await fixture(t);
  const result = await f.run({ kind: 'create', source: null, initialize: async target => f.put(target, 'input3XX/general.txt', '{}') });
  assert.equal(await f.read(result.handle, 'input3XX/general.txt'), '{}');
  assert.ok(await f.exists(result.handle, 'input3XX/_nogo.e3d'));
});
test('rename preserves every file, result bytes and list enabled state before removing source', async t => {
  const f = await fixture(t); const result = await f.run({ kind: 'rename' });
  assert.equal(result.sourceRemoved, true); assert.equal(await f.exists(f.parent, 'Original'), false);
  assert.equal(await f.read(result.handle, 'protocol.log'), 'old log');
  assert.deepEqual(await fs.readFile(path.join(result.handle.location, 'output3XX/result.bin')), Buffer.from([0, 255, 127, 128]));
  assert.equal(await f.exists(result.handle, 'input3XX/_nogo.e3d'), false);
  assert.equal(await f.read(f.root, 'clark.tasks.txt'), 'Project/New\n*Project/Other\n');
});
test('rename preserves existing unapproved marker bytes', async t => {
  const f = await fixture(t); await f.put(f.source, 'input3XX/_nogo.e3d', 'already blocked');
  const result = await f.run({ kind: 'rename' }); assert.equal(await f.read(result.handle, 'input3XX/_nogo.e3d'), 'already blocked');
});
test('move between projects preserves disabled state; external move removes only old list row', async t => {
  const f = await fixture(t); await f.put(f.root, 'clark.tasks.txt', '*Project/Original\nProject/Other\n');
  const project = await f.root.getDirectoryHandle('Second', { create: true });
  const result = await f.run({ kind: 'move', destinationParent: project, name: 'Original' });
  assert.equal(await f.read(f.root, 'clark.tasks.txt'), '*Second/Original\nProject/Other\n');
  const outsidePath = await fs.mkdtemp(path.join(os.tmpdir(), 'clark-outside-')); t.after(() => fs.rm(outsidePath, { recursive: true, force: true }));
  await f.run({ kind: 'move', sourceParent: project, source: result.handle, destinationParent: new Handle(outsidePath), name: 'Original' });
  assert.equal(await f.read(f.root, 'clark.tasks.txt'), 'Project/Other\n');
});
test('self/descendant destination and stale task-list destinations rejected without writes', async t => {
  const f = await fixture(t);
  await assert.rejects(f.run({ kind: 'move', destinationParent: f.source }), /внутри самого себя/);
  await f.put(f.root, 'clark.tasks.txt', 'Project/Original\n*Project/New\n');
  await assert.rejects(f.run({ kind: 'rename' }), /списке запуска/);
  assert.equal(await f.exists(f.parent, 'New'), false);
});
test('failed write never removes source; leaves destination blocked and describes partial state', async t => {
  const f = await fixture(t); f.setHook((op, p) => { if (op === 'write' && p.endsWith('New/input3XX/general.txt')) throw new Error('disk full'); });
  await assert.rejects(f.run({ kind: 'rename' }), error => {
    assert.equal(error.operationResult.verified, false); assert.equal(error.operationResult.deletionStarted, false);
    assert.match(error.message, /Источник не удалялся/); return true;
  });
  assert.equal(await f.read(f.source, 'input3XX/general.txt'), '{"time":1}');
  assert.ok(await f.exists(f.parent, 'New/input3XX/_nogo.e3d'));
  assert.equal(await f.read(f.root, 'clark.tasks.txt'), 'Project/Original\n*Project/Other\n');
});
test('silent write corruption is detected by destination hashing', async t => {
  const f = await fixture(t); let corrupted = false;
  f.setHook(async (op, p) => { if (!corrupted && op === 'read' && p.endsWith('New/input3XX/general.txt')) { corrupted = true; await fs.writeFile(p, 'corrupt'); } });
  await assert.rejects(f.run({ kind: 'rename' }), /целостности/);
  assert.ok(await f.exists(f.parent, 'Original/input3XX/general.txt'));
});
test('source edited during copy is detected before any deletion/list change', async t => {
  const f = await fixture(t); let changed = false;
  f.setHook(async (op, p) => { if (!changed && op === 'write' && p.endsWith('New/input3XX/general.txt')) { changed = true; await f.put(f.source, 'added.txt', 'external edit'); } });
  await assert.rejects(f.run({ kind: 'rename' }), /изменилось/);
  assert.equal(await f.read(f.source, 'added.txt'), 'external edit');
  assert.match(await f.read(f.root, 'clark.tasks.txt'), /Project\/Original/);
});
test('task list conflict/write failure leaves source and verified destination', async t => {
  for (const mode of ['changed', 'failed']) {
    const f = await fixture(t); let changed = false;
    f.setHook(async (op, p) => {
      if (mode === 'failed' && op === 'write' && p.endsWith('clark.tasks.txt')) throw new Error('list locked');
      if (mode === 'changed' && !changed && op === 'write' && p.endsWith('New/input3XX/general.txt')) { changed = true; await f.put(f.root, 'clark.tasks.txt', '*Project/Original\n'); }
    });
    await assert.rejects(f.run({ kind: 'rename' }), error => error.operationResult.verified && !error.operationResult.deletionStarted);
    assert.ok(await f.exists(f.parent, 'Original/input3XX/general.txt'));
  }
});
test('partial deletion exposes verified destination, protects launch, and never deletes destination', async t => {
  const f = await fixture(t);
  f.setHook(async (op, p) => { if (op === 'remove' && p.endsWith('/Original')) { await fs.rm(path.join(p, 'input3XX/general.txt')); throw new Error('source locked'); } });
  await assert.rejects(f.run({ kind: 'rename' }), error => {
    assert.equal(error.operationResult.deletionStarted, true); assert.equal(error.operationResult.verified, true);
    assert.match(error.message, /частично/); return true;
  });
  assert.equal(await f.read(f.parent, 'New/input3XX/general.txt'), '{"time":1}');
  assert.ok(await f.exists(f.parent, 'New/input3XX/_nogo.e3d'));
  assert.equal(await f.read(f.root, 'clark.tasks.txt'), 'Project/New\n*Project/Other\n');
});
test('legacy rename preserves layout without inventing input3XX; missing list stays absent', async t => {
  const f = await fixture(t); await fs.rm(path.join(f.source.location, 'input3XX'), { recursive: true }); await f.put(f.source, 'KV.in', 'legacy'); await fs.rm(path.join(f.root.location, 'clark.tasks.txt'));
  const result = await f.run({ kind: 'rename' });
  assert.equal(await f.read(result.handle, 'KV.in'), 'legacy');
  assert.equal(await f.exists(result.handle, 'input3XX'), false);
  assert.equal(await f.exists(f.root, 'clark.tasks.txt'), false);
});

test('delete removes the selected tree only and cleans launch references before removal', async t => {
  const f = await fixture(t);
  await f.put(f.parent, 'Other/keep.txt', 'keep');
  await f.put(f.root, 'clark.launch.json', 'old request');
  f.setHook(async (op, p) => {
    if (op === 'remove' && p.endsWith('/Original')) {
      assert.equal(await f.read(f.root, 'clark.tasks.txt'), '*Project/Other\n');
      assert.equal(await f.read(f.root, 'clark.launch.json'), '');
    }
    if (op === 'read' && p.includes('/Original/')) throw new Error('Deletion must not read/hash task data');
  });
  const result = await f.run({ kind: 'delete' });
  assert.equal(result.sourceRemoved, true);
  assert.equal(await f.exists(f.parent, 'Original'), false);
  assert.equal(await f.read(f.parent, 'Other/keep.txt'), 'keep');
});
test('delete legacy task without a task list does not create one and invalidates launch request', async t => {
  const f = await fixture(t);
  await fs.rm(path.join(f.source.location, 'input3XX'), { recursive: true });
  await fs.rm(path.join(f.root.location, 'clark.tasks.txt'));
  await f.put(f.root, 'clark.launch.json', 'old request');
  await f.run({ kind: 'delete' });
  assert.equal(await f.exists(f.parent, 'Original'), false);
  assert.equal(await f.exists(f.root, 'clark.tasks.txt'), false);
  assert.equal(await f.read(f.root, 'clark.launch.json'), '');
});
test('delete refuses root, project, nested child and a task from another project', async t => {
  const f = await fixture(t);
  const nested = await f.source.getDirectoryHandle('input3XX');
  const other = await f.root.getDirectoryHandle('Second', { create: true });
  for (const options of [{ source: f.root }, { source: f.parent, sourceParent: f.root },
    { source: nested, sourceParent: f.source }, { sourceParent: other }, { root: null }]) {
    await assert.rejects(f.run({ kind: 'delete', ...options }), /текущего проекта/);
  }
  assert.ok(await f.exists(f.source, 'input3XX/general.txt'));
  assert.equal(await f.read(f.root, 'clark.tasks.txt'), 'Project/Original\n*Project/Other\n');
});
test('delete refuses a replaced handle without modifying files or task list', async t => {
  const f = await fixture(t);
  const get = f.parent.getDirectoryHandle.bind(f.parent);
  f.parent.getDirectoryHandle = async (...args) => {
    const handle = await get(...args); handle.isSameEntry = async () => false; return handle;
  };
  await assert.rejects(f.run({ kind: 'delete' }), /заменён/);
  assert.ok(await f.exists(f.source, 'input3XX/general.txt'));
  assert.equal(await f.read(f.root, 'clark.tasks.txt'), 'Project/Original\n*Project/Other\n');
});
test('delete list write or launch invalidation failure preserves the task', async t => {
  for (const target of ['clark.tasks.txt', 'clark.launch.json']) {
    const f = await fixture(t); await f.put(f.root, 'clark.launch.json', 'old');
    f.setHook((op, p) => { if (op === 'write' && p.endsWith(target)) throw new Error('locked'); });
    await assert.rejects(f.run({ kind: 'delete' }), error => {
      assert.equal(error.operationResult.deletionStarted, false);
      assert.match(error.message, /не удалялся/); return true;
    });
    assert.ok(await f.exists(f.source, 'input3XX/general.txt'));
  }
});
test('delete rejects invalid or concurrently changed launch list before removal', async t => {
  for (const invalid of [true, false]) {
    const f = await fixture(t); let reads = 0;
    if (invalid) await f.put(f.root, 'clark.tasks.txt', '../outside\n');
    else f.setHook(async (op, p) => {
      if (op === 'read' && p.endsWith('clark.tasks.txt') && ++reads === 2) await f.put(f.root, 'clark.tasks.txt', '*Project/Original\n');
    });
    await assert.rejects(f.run({ kind: 'delete' }));
    assert.ok(await f.exists(f.source, 'input3XX/general.txt'));
  }
});
test('partial delete reports remaining files and does not keep a runnable list row', async t => {
  const f = await fixture(t);
  f.setHook(async (op, p) => {
    if (op === 'remove' && p.endsWith('/Original')) {
      await fs.rm(path.join(p, 'input3XX/general.txt')); throw new Error('access denied');
    }
  });
  await assert.rejects(f.run({ kind: 'delete' }), error => {
    assert.equal(error.operationResult.deletionStarted, true);
    assert.equal(error.operationResult.sourceRemoved, false);
    assert.match(error.message, /частично/); return true;
  });
  assert.equal(await f.read(f.source, 'protocol.log'), 'old log');
  assert.equal(await f.read(f.root, 'clark.tasks.txt'), '*Project/Other\n');
});
