import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createServer } from "vite";
import { VALIDATION_LEVELS } from "../src/services/schemas/common/constants.js";
import { createSuccess } from "../src/tabulator/validators/common/createDiagnostic.js";
import { getValidationLevel } from "../src/tabulator/validators/common/diagnosticLevel.js";
import { isStoredProperty } from "../src/services/model/modelCompute.js";
import { propertyStoragePath } from "../src/services/model/modelSerializer.js";
import {
  createEffect,
  createRoot,
  createSignal,
  onCleanup,
} from "solid-js/dist/solid.js";

const source = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
const diagnosticSource = await readFile(new URL("../src/services/diagnosticService.js", import.meta.url), "utf8");
const createDiagnostics = new Function("createSignal", "VALIDATION_LEVELS", "createSuccess", "getValidationLevel",
  diagnosticSource.replace(/^import .*;\n/gm, "")
    .replace("export const diagnosticService", "const diagnosticService")
    + "\nreturn diagnosticService;");

function sourceRegion(startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  assert.ok(start >= 0, `App must contain ${startText.trim()}`);
  assert.ok(end > start, `App must contain ${endText.trim()} after it`);
  return source.slice(start, end);
}

// Run App's actual save state and handler with Solid's client runtime. App's
// unrelated JSX and browser services do not need to be mounted for these tests.
const createSaveRuntime = new Function("dependencies", `
  "use strict";
  const {
    createSignal, createEffect, onCleanup, selectionService, modelService,
    taskApprovalService, clearPlanarModeMarker, refreshPlanarModeMarker, writeTaskSummary, dataService, unsavedChangesService, diagnosticService,
    collectModelDiagnostics, assertJweakLocalUnchanged, createError, TABS, tabRegistry, VALIDATION_LEVELS,
    setTimeout, clearTimeout, console,
  } = dependencies;
  let modelValidationRevision = 0;
  ${sourceRegion("  const [savePending, setSavePending]", "  async function collectModelDiagnostics")}
  ${sourceRegion("  async function handleSave()", "  function runHistoryAction")}
  return { handleSave, savePending, saveFeedback, savedSummary };
`);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout(callback, delay) {
      const id = nextId++;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    tick(milliseconds) {
      const target = now + milliseconds;
      for (;;) {
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((left, right) => left[1].at - right[1].at)[0];
        if (!next) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
      }
      now = target;
    },
    get pendingCount() {
      return timers.size;
    },
  };
}

async function flushMicrotasks() {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

function createHarness(t, options = {}) {
  const clock = fakeClock();
  const events = [];
  const schemas = options.schemas ?? [
    { id: "general", title: "General", config: { required: true } },
    { id: "regions", title: "Regions", config: { required: true } },
    { id: "optional", title: "Optional", config: { required: false } },
  ];
  const initialModel = options.model ?? {
    general: { value: 1 },
    regions: { value: 2 },
    optional: { value: 3 },
  };
  const initialTask = Object.hasOwn(options, "task") ? options.task : { name: "task-a" };
  let harness;
  createRoot(dispose => {
    const [task, setTask] = createSignal(initialTask);
    const [model, setModel] = createSignal(initialModel);
    const [taskDataVersion, setTaskDataVersion] = createSignal(0);
    let loadDiagnostics = options.loadDiagnostics ?? Object.fromEntries(schemas.map(schema => [schema.id,
      [{ level: "warning", message: `missing parameters in ${schema.id}` }],
    ]));
    const api = createSaveRuntime({
      createSignal,
      createEffect,
      onCleanup,
      selectionService: { loadedTaskHandle: task, loadedTaskIsDemo: () => false, taskDataVersion },
      modelService: { getModel: model },
      async assertJweakLocalUnchanged(handle, section) {
        return options.companion?.(handle, section);
      },
      taskApprovalService: {
        async markUnapproved(handle) {
          events.push({ type: "mark", handle });
          return options.mark?.(handle);
        },
        async clearUnapproved(handle) {
          events.push({ type: "clear", handle });
          return options.clear?.(handle);
        },
      },
      async clearPlanarModeMarker(handle) {
        events.push({ type: "planar-clear", handle });
        return options.planarClear?.(handle);
      },
      async refreshPlanarModeMarker(handle) {
        events.push({ type: "planar-refresh", handle });
        return options.planarRefresh?.(handle);
      },
      async writeTaskSummary(handle, snapshot) {
        events.push({ type: "summary", handle, snapshot });
        return options.summary?.(handle, snapshot);
      },
      dataService: {
        async save(handle, schema, item) {
          events.push({ type: "write", handle, schema, item });
          if (options.save) return options.save(handle, schema, item);
          return item !== null && item !== undefined;
        },
      },
      unsavedChangesService: {
        setExplicitDirty() {},
        setBaseline(id, item) {
          events.push({ type: "baseline", id, item });
        },
      },
      diagnosticService: {
        setLoadResult(id, diagnostics) {
          events.push({ type: "load-diagnostics", id, diagnostics });
          loadDiagnostics = { ...loadDiagnostics, [id]: diagnostics };
          options.diagnostics?.setLoadResult(id, diagnostics);
        },
        setValidationResult(diagnostics) {
          events.push({ type: "diagnostics", diagnostics });
          options.diagnostics?.setValidationResult(diagnostics);
        },
      },
      async collectModelDiagnostics(handle, snapshot) {
        events.push({ type: "validate", handle, snapshot });
        return options.validate ? options.validate(handle, snapshot) : [];
      },
      createError: entry => ({ ...entry, level: "error" }),
      TABS: { ELEMENTS: { id: "elements", label: "Элементы модели" } },
      tabRegistry: schemas,
      VALIDATION_LEVELS: { ERROR: "error" },
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      console: { error() {}, warn() {} },
    });
    harness = {
      ...api,
      clock,
      events,
      initialTask,
      initialModel,
      setTask,
      setModel,
      setTaskDataVersion,
      loadDiagnostics: () => loadDiagnostics,
      dispose,
      calls: type => events.filter(event => event.type === type),
    };
    t.after(dispose);
  });
  return harness;
}

function assertFeedback(harness, status) {
  assert.equal(harness.saveFeedback()?.status, status);
  assert.equal(typeof harness.saveFeedback().message, "string");
  assert.ok(harness.saveFeedback().message.length > 0);
}

// Use the real loader/serializer, App save handler and model validator. Only the
// File System Access handles are controlled so close() can fail or stay pending.
async function createStorageHarness(t, options = {}) {
  const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true }, appType: "custom" });
  t.after(() => server.close());
  const [{ dataService }, { default: conrab }, { default: moves }, { movesValidator }] =
    await Promise.all([
      server.ssrLoadModule("/src/services/dataService.js"),
      server.ssrLoadModule("/src/services/schemas/conrab.schema.js"),
      server.ssrLoadModule("/src/services/schemas/moves.schema.js"),
      server.ssrLoadModule("/src/tabulator/validators/models/moves/movesValidator.js"),
    ]);
  const files = new Map([
    ["conrab.txt", options.conrabText ?? "{}\n{}\n"],
    ["moves.txt", JSON.stringify({ angle: [0, 0, 0, 0],
      position: [0, 1, 0, 0, 0, 0, 0, 0], n: 9 })],
  ]);
  const task = { async getDirectoryHandle() {
    return { async getFileHandle(name) {
      return {
        async getFile() { return { text: async () => files.get(name) }; },
        async createWritable() {
          let pending;
          return {
            async write(text) { pending = text; },
            async close() {
              await options.close?.(name);
              files.set(name, pending);
            },
          };
        },
      };
    } };
  } };
  const schemas = [conrab, moves], model = {}, loadDiagnostics = {};
  for (const schema of schemas) {
    loadDiagnostics[schema.id] = [];
    model[schema.id] = await dataService.load(task, schema, loadDiagnostics[schema.id]);
  }
  const diagnostics = createDiagnostics(createSignal, VALIDATION_LEVELS, createSuccess, getValidationLevel);
  for (const schema of schemas) diagnostics.setLoadResult(schema.id, loadDiagnostics[schema.id]);
  diagnostics.setConstraintResult("moves", [{ level: "error", message: "retained constraint error" }]);
  const h = createHarness(t, { schemas, model, task, loadDiagnostics, diagnostics,
    save: (...args) => dataService.save(...args),
    validate: (_task, snapshot) => {
      const messages = [];
      movesValidator({ getModel: () => snapshot }, messages);
      return messages;
    },
  });
  return { ...h, files, dataService, conrab, diagnostics };
}

test("bundled demo has all canonical profile keys and loads without missing-parameter warnings", async t => {
  const conrabText = await readFile(new URL("../data/demo/conrab.txt", import.meta.url), "utf8");
  const h = await createStorageHarness(t, { conrabText });
  const expected = Object.entries(h.conrab.properties)
    .filter(([, property]) => isStoredProperty(property))
    .map(([key, property]) => propertyStoragePath(key, property)).sort();
  const records = conrabText.trim().split("\n").map(JSON.parse);
  assert.equal(records.length, 2);
  for (const record of records) {
    assert.deepEqual(Object.keys(record).sort(), expected);
    assert.equal(record.DIPOLE_RTOL, 0.001);
    assert.equal(record.H2_MODE, "off");
    assert.equal(record.fullJNewton, false);
  }
  assert.deepEqual(h.loadDiagnostics().conrab, []);
});

test("actual file round trip removes missing defaults and keeps unresolved motion model errors", async t => {
  const closed = deferred();
  const h = await createStorageHarness(t, {
    close: name => name === "conrab.txt" ? closed.promise : undefined,
  });
  assert.ok(h.loadDiagnostics().conrab.some(d => d.message.includes("DIPOLE_RTOL")));
  const saving = h.handleSave();
  await flushMicrotasks();
  assert.equal(h.files.get("conrab.txt"), "{}\n{}\n");
  assert.equal(h.calls("load-diagnostics").length, 0);
  closed.resolve();
  await saving;
  assert.deepEqual(h.loadDiagnostics().conrab, []);
  const saved = h.files.get("conrab.txt").trim().split("\n").map(JSON.parse);
  assert.equal(saved.length, 2);
  assert.ok(saved.every(record => record.DIPOLE_RTOL === 0.001));
  assert.ok(saved.every(record => record.H2_MODE === "off"));
  assert.ok(saved.every(record => Object.keys(record).length === 13));
  const freshDiagnostics = [];
  await h.dataService.load(h.initialTask, h.conrab, freshDiagnostics);
  assert.deepEqual(freshDiagnostics, []);
  assert.ok(h.calls("diagnostics")[0].diagnostics.some(d =>
    d.level === "error" && d.property === "position"));
  assert.ok(h.diagnostics.diagnostics().some(d => d.property === "position"));
  assert.ok(h.diagnostics.diagnostics().some(d => d.message === "retained constraint error"));
  assert.ok(h.diagnostics.diagnostics().every(d => d.level === "error"));
  assert.equal(h.calls("clear").length, 0);
});

test("actual close failure preserves original file and its load warning", async t => {
  const h = await createStorageHarness(t, { close(name) {
    if (name === "conrab.txt") throw new Error("controlled close failure");
  } });
  await h.handleSave();
  assert.equal(h.files.get("conrab.txt"), "{}\n{}\n");
  assert.ok(h.loadDiagnostics().conrab.some(d => d.message.includes("DIPOLE_RTOL")));
  assert.deepEqual(h.loadDiagnostics().moves, []);
  assertFeedback(h, "error");
});

test("successful file close clears its obsolete read warnings without clearing model diagnostics", async t => {
  const closed = deferred();
  const modelError = { level: "error", message: "invalid current model" };
  const h = createHarness(t, {
    save: (_handle, schema) => schema.id === "general" ? closed.promise : true,
    validate: () => [modelError],
  });
  const saving = h.handleSave();
  await flushMicrotasks();
  assert.equal(h.calls("load-diagnostics").length, 0);
  assert.equal(h.loadDiagnostics().general.length, 1);
  closed.resolve(true);
  await saving;
  for (const messages of Object.values(h.loadDiagnostics())) assert.deepEqual(messages, []);
  assert.deepEqual(h.calls("diagnostics")[0].diagnostics, [modelError]);
  assert.equal(h.calls("clear").length, 0, "model errors still prevent approval");
});

for (const failure of ["throw", "skip"]) {
  test(`unwritten file retains read warnings after ${failure}, while written files clear theirs`, async t => {
    const h = createHarness(t, { save: (_handle, schema) => {
      if (schema.id !== "regions") return true;
      if (failure === "throw") throw new Error("close failed");
      return false;
    } });
    await h.handleSave();
    assert.deepEqual(h.loadDiagnostics().general, []);
    assert.equal(h.loadDiagnostics().regions.length, 1);
    assert.deepEqual(h.loadDiagnostics().optional, []);
  });
}

for (const change of ["task", "task round trip", "reload", "snapshot"]) {
  test(`an older save cannot clear load warnings after ${change}`, async t => {
    const closed = deferred();
    const h = createHarness(t, { save: (_handle, schema) => schema.id === "general" ? closed.promise : true });
    const saving = h.handleSave();
    await flushMicrotasks();
    if (change === "reload") h.setTaskDataVersion(1);
    else if (change === "snapshot") h.setModel({ ...h.initialModel, general: { value: 9 } });
    else {
      h.setTask({ name: "task-b" });
      if (change === "task round trip") h.setTask(h.initialTask);
    }
    await flushMicrotasks();
    closed.resolve(true);
    await saving;
    assert.equal(h.calls("load-diagnostics").length, 0);
    for (const messages of Object.values(h.loadDiagnostics())) assert.equal(messages.length, 1);
  });
}

test("every successful save publishes a fresh summary notification; failed writes do not", async t => {
  const h = createHarness(t);
  assert.equal(h.savedSummary(), null);
  await h.handleSave();
  const first = h.savedSummary();
  assert.equal(first.taskHandle, h.initialTask);
  await h.handleSave();
  assert.notEqual(h.savedSummary(), first);
  const failed = createHarness(t, { summary: () => { throw new Error("write failed"); } });
  await failed.handleSave();
  assert.equal(failed.savedSummary(), null); assertFeedback(failed, "error");
});

test("save stays pending until the last write and rejects duplicate clicks", async t => {
  const marker = deferred();
  const lastWrite = deferred();
  const h = createHarness(t, {
    mark: () => marker.promise,
    save: (_handle, schema) => schema.id === "optional" ? lastWrite.promise : true,
  });

  const saving = h.handleSave();
  assert.equal(Boolean(h.savePending()), true, "lock must be acquired before the first await");
  assert.equal(h.saveFeedback(), null);
  await h.handleSave();
  assert.equal(h.calls("mark").length, 1);
  assert.equal(h.calls("write").length, 0);

  marker.resolve();
  await flushMicrotasks();
  assert.equal(h.calls("write").length, 3);
  assert.deepEqual(h.calls("baseline").map(event => event.id), ["general", "regions"]);
  assert.equal(Boolean(h.savePending()), true);
  assert.equal(h.saveFeedback(), null, "a pending file must not show success");
  assert.equal(h.clock.pendingCount, 0);

  lastWrite.resolve(true);
  await saving;
  assertFeedback(h, "success");
  assert.equal(h.savePending(), null);
  assert.equal(h.calls("baseline").length, 3);
  assert.deepEqual(h.events.map(event => event.type), [
    "mark", "planar-clear", "write", "baseline", "load-diagnostics",
    "write", "baseline", "load-diagnostics", "write", "baseline", "load-diagnostics",
    "planar-refresh", "summary", "validate", "diagnostics", "clear",
  ]);
});

test("the save lock covers validation and marker removal before feedback starts", async t => {
  const validation = deferred();
  const markerRemoval = deferred();
  const h = createHarness(t, {
    validate: () => validation.promise,
    clear: () => markerRemoval.promise,
  });

  const saving = h.handleSave();
  await flushMicrotasks();
  assert.equal(h.calls("baseline").length, 3);
  assert.equal(h.saveFeedback(), null);
  assert.equal(Boolean(h.savePending()), true);
  await h.handleSave();
  assert.equal(h.calls("mark").length, 1);
  assert.equal(h.calls("write").length, 3);
  h.clock.tick(10000);
  assert.equal(h.clock.pendingCount, 0);

  validation.resolve([]);
  await flushMicrotasks();
  assert.equal(h.calls("clear").length, 1);
  assert.equal(Boolean(h.savePending()), true);
  assert.equal(h.saveFeedback(), null);
  await h.handleSave();
  assert.equal(h.calls("mark").length, 1);
  markerRemoval.resolve();
  await saving;
  assert.equal(h.savePending(), null);
  assertFeedback(h, "success");
  h.clock.tick(2999);
  assertFeedback(h, "success");
  h.clock.tick(1);
  assert.equal(h.saveFeedback(), null);
});

for (const failure of ["false", "throw"]) {
  test(`partial write failure (${failure}) reports error and preserves successful baselines`, async t => {
    const h = createHarness(t, {
      save: (_handle, schema) => {
        if (schema.id !== "regions") return true;
        if (failure === "throw") throw new Error("write failed");
        return false;
      },
    });

    await h.handleSave();
    assertFeedback(h, "error");
    assert.equal(h.savePending(), null);
    assert.equal(h.calls("write").length, 3, "later tabs must still be attempted");
    assert.deepEqual(h.calls("baseline").map(event => event.id), ["general", "optional"]);
    assert.equal(h.calls("validate").length, 0);
    assert.equal(h.calls("clear").length, 0);
    h.clock.tick(3000);
    assert.equal(h.saveFeedback(), null);
  });
}

for (const missing of [null, undefined]) {
  test(`missing optional data (${missing}) does not hide successful writes`, async t => {
    const h = createHarness(t, {
      model: { general: {}, regions: {}, optional: missing },
    });

    await h.handleSave();
    assertFeedback(h, "success");
    assert.deepEqual(h.calls("baseline").map(event => event.id), ["general", "regions"]);
    // The existing fail-safe algorithm still retains _nogo on a false save.
    assert.equal(h.calls("validate").length, 0);
    assert.equal(h.calls("clear").length, 0);
  });
}

test("missing required data reports an error even when other tabs were saved", async t => {
  const h = createHarness(t, { model: { general: null, regions: {}, optional: {} } });
  await h.handleSave();
  assertFeedback(h, "error");
  assert.equal(h.calls("clear").length, 0);
});

test("no successful file writes cannot produce success feedback", async t => {
  const h = createHarness(t, {
    schemas: [{ id: "optional", config: { required: false } }],
    model: { optional: null },
  });
  await h.handleSave();
  assertFeedback(h, "error");
  assert.equal(h.calls("baseline").length, 0);
  assert.equal(h.calls("clear").length, 0);
  assert.equal(h.savePending(), null);
});

test("marker creation failure reports an error before any file is written", async t => {
  const h = createHarness(t, { mark: () => { throw new Error("marker denied"); } });
  await h.handleSave();
  assertFeedback(h, "error");
  assert.equal(h.savePending(), null);
  assert.equal(h.calls("write").length, 0);
  assert.equal(h.calls("validate").length, 0);
  assert.equal(h.calls("clear").length, 0);
});

test("marker removal failure does not erase successful-write feedback", async t => {
  const h = createHarness(t, { clear: () => { throw new Error("marker locked"); } });
  await h.handleSave();
  assertFeedback(h, "success");
  assert.equal(h.savePending(), null);
  assert.equal(h.calls("clear").length, 1);
});

test("validation diagnostics retain the marker and keep successful-write feedback", async t => {
  const diagnostics = [{ level: "error", message: "invalid model" }];
  const h = createHarness(t, { validate: () => diagnostics });
  await h.handleSave();
  assertFeedback(h, "success");
  assert.equal(h.savePending(), null);
  assert.equal(h.calls("diagnostics")[0].diagnostics, diagnostics);
  assert.equal(h.calls("clear").length, 0);
});

test("validation exception retains the marker and keeps successful-write feedback", async t => {
  const h = createHarness(t, { validate: () => { throw new Error("validation failed"); } });
  await h.handleSave();
  assertFeedback(h, "success");
  assert.equal(h.savePending(), null);
  assert.equal(h.calls("diagnostics").length, 0);
  assert.equal(h.calls("clear").length, 0);
});

test("a new save clears old feedback and starts a fresh three-second interval", async t => {
  const secondMarker = deferred();
  let marks = 0;
  const h = createHarness(t, {
    mark: () => ++marks === 2 ? secondMarker.promise : undefined,
  });
  await h.handleSave();
  h.clock.tick(2000);
  assertFeedback(h, "success");

  const saving = h.handleSave();
  assert.equal(h.saveFeedback(), null);
  assert.equal(h.clock.pendingCount, 0);
  h.clock.tick(1000);
  secondMarker.resolve();
  await saving;
  assertFeedback(h, "success");
  assert.equal(h.clock.pendingCount, 1);
  h.clock.tick(2999);
  assertFeedback(h, "success");
  h.clock.tick(1);
  assert.equal(h.saveFeedback(), null);
  assert.equal(h.clock.pendingCount, 0);
});

for (const context of ["task", "snapshot", "task round trip"]) {
  test(`a pending save cannot publish feedback after a ${context} change`, async t => {
    const lastWrite = deferred();
    const h = createHarness(t, {
      save: (_handle, schema) => schema.id === "optional" ? lastWrite.promise : true,
    });
    const saving = h.handleSave();
    await flushMicrotasks();
    if (context === "snapshot") h.setModel({ ...h.initialModel, regions: { value: 9 } });
    else {
      h.setTask({ name: "task-b" });
      if (context === "task round trip") h.setTask(h.initialTask);
    }
    lastWrite.resolve(true);
    await saving;

    assert.equal(h.saveFeedback(), null);
    assert.equal(h.clock.pendingCount, 0);
    assert.equal(h.savePending(), null);
    assert.ok(h.calls("write").every(event => event.handle === h.initialTask));
    assert.ok(h.calls("write").every(event => event.item === h.initialModel[event.schema.id]));
    if (context !== "task round trip") assert.equal(h.calls("diagnostics").length, 0);
  });
}

test("an old task's failed write cannot show an error in the new task", async t => {
  const write = deferred();
  const h = createHarness(t, {
    save: (_handle, schema) => schema.id === "general" ? write.promise : true,
  });
  const saving = h.handleSave();
  await flushMicrotasks();
  h.setTask({ name: "task-b" });
  write.reject(new Error("old task write failed"));
  await saving;
  assert.equal(h.saveFeedback(), null);
  assert.equal(h.clock.pendingCount, 0);
  assert.equal(h.savePending(), null);
});

for (const context of ["task", "snapshot"]) {
  test(`a ${context} change clears visible feedback and its timer`, async t => {
    const h = createHarness(t);
    await h.handleSave();
    assertFeedback(h, "success");
    if (context === "task") h.setTask({ name: "task-b" });
    else h.setModel({ ...h.initialModel, regions: { value: 9 } });
    assert.equal(h.saveFeedback(), null);
    assert.equal(h.clock.pendingCount, 0);

    await h.handleSave();
    assertFeedback(h, "success");
    assert.equal(h.clock.pendingCount, 1);
  });
}

test("unmount cancels the feedback timer", async t => {
  const h = createHarness(t);
  await h.handleSave();
  assert.equal(h.clock.pendingCount, 1);
  h.dispose();
  assert.equal(h.clock.pendingCount, 0);
  h.clock.tick(3000);
  assert.equal(h.clock.pendingCount, 0);
});

test("unmount invalidates an in-flight save without scheduling later feedback", async t => {
  const lastWrite = deferred();
  const h = createHarness(t, {
    save: (_handle, schema) => schema.id === "optional" ? lastWrite.promise : true,
  });
  const saving = h.handleSave();
  await flushMicrotasks();
  h.dispose();
  lastWrite.resolve(true);
  await saving;
  assert.equal(h.saveFeedback(), null);
  assert.equal(h.clock.pendingCount, 0);
});

test("save with no loaded task has no side effects or pending state", async t => {
  const h = createHarness(t, { task: null });
  await h.handleSave();
  assert.equal(h.savePending(), null);
  assert.equal(h.saveFeedback(), null);
  assert.deepEqual(h.events, []);
  assert.equal(h.clock.pendingCount, 0);
});

test("summary uses the saved snapshot and holds the save lock until committed", async t => {
  const pending = deferred();
  const h = createHarness(t, {summary: () => pending.promise});
  const saving = h.handleSave(); await flushMicrotasks();
  assert.equal(h.calls("summary").length, 1);
  assert.equal(h.calls("summary")[0].snapshot, h.initialModel);
  assert.ok(h.savePending()); assert.equal(h.calls("clear").length, 0);
  pending.resolve(); await saving;
  assertFeedback(h, "success"); assert.equal(h.calls("clear").length, 1);
});

test("failed summary write reports failure and keeps the approval marker", async t => {
  const h = createHarness(t, {summary: () => {throw new Error("disk full")}});
  await h.handleSave(); assertFeedback(h, "error");
  assert.match(h.saveFeedback().message, /_summary.txt.*disk full/);
  assert.equal(h.calls("clear").length,0);
});

test("failed input write cannot replace the old summary", async t => {
  const h = createHarness(t, {save: () => {throw new Error("denied")}});
  await h.handleSave(); assert.equal(h.calls("summary").length,0);
});


test("external companion changes no longer block an explicit save", async t => {
  const h = createHarness(t, { companion: async () => { throw new Error("obsolete byte comparison called"); } });
  await h.handleSave();
  assert.equal(h.calls("write").length, 3);
  assert.equal(h.calls("clear").length, 1);
  assertFeedback(h, "success");
});


test("a failed input save leaves the 2D marker removed; failed marker invalidation stops writes", async t => {
  const partial = createHarness(t, { save: (_h, schema) => schema.id !== "regions" });
  await partial.handleSave();
  assert.equal(partial.calls("planar-clear").length, 1);
  assert.equal(partial.calls("planar-refresh").length, 0);
  const denied = createHarness(t, { planarClear: () => { throw new Error("denied"); } });
  await denied.handleSave();
  assert.equal(denied.calls("write").length, 0); assertFeedback(denied, "error");
});

test("2D marker follows saved geometry even with MED errors; marker write failures report failure", async t => {
  const med = createHarness(t, { validate: () => [{ level: "error", message: "MED" }] });
  await med.handleSave();
  assert.equal(med.calls("planar-refresh").length, 1);
  assert.equal(med.calls("clear").length, 0);
  const denied = createHarness(t, { planarRefresh: () => { throw new Error("denied"); } });
  await denied.handleSave(); assertFeedback(denied, "error");
  assert.match(denied.saveFeedback().message, /_2d.e3d/);
  assert.equal(denied.calls("clear").length, 0);
});
