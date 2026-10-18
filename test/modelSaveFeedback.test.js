import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createEffect,
  createRoot,
  createSignal,
  onCleanup,
} from "solid-js/dist/solid.js";

const source = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");

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
    taskApprovalService, writeTaskSummary, dataService, unsavedChangesService, diagnosticService,
    collectModelDiagnostics, assertJweakLocalUnchanged, createError, TABS, tabRegistry, VALIDATION_LEVELS,
    setTimeout, clearTimeout, console,
  } = dependencies;
  let modelValidationRevision = 0;
  ${sourceRegion("  const [savePending, setSavePending]", "  async function collectModelDiagnostics")}
  ${sourceRegion("  async function handleSave()", "  function runHistoryAction")}
  return { handleSave, savePending, saveFeedback };
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
    const api = createSaveRuntime({
      createSignal,
      createEffect,
      onCleanup,
      selectionService: { loadedTaskHandle: task, loadedTaskIsDemo: () => false, taskDataVersion: () => 0 },
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
        setValidationResult(diagnostics) {
          events.push({ type: "diagnostics", diagnostics });
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
    "mark", "write", "baseline", "write", "baseline", "write", "baseline",
    "summary", "validate", "diagnostics", "clear",
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
