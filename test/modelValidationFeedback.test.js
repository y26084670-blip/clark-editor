import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createEffect,
  createRoot,
  createSignal,
  onCleanup,
} from "solid-js/dist/solid.js";
import { createError } from "../src/tabulator/validators/common/createDiagnostic.js";

const source = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");

function sourceRegion(startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  assert.ok(start >= 0, `App must contain ${startText.trim()}`);
  assert.ok(end > start, `App must contain ${endText.trim()} after it`);
  return source.slice(start, end);
}

// Execute App's actual validation state and handler with Solid's client runtime.
// The rest of App's JSX and unrelated browser services need not be mounted.
const createValidationRuntime = new Function("dependencies", `
  "use strict";
  const {
    createSignal, createEffect, onCleanup, selectionService, modelService,
    diagnosticService, taskApprovalService, collectModelDiagnostics, createError, savePending, refreshPlanarModeMarker,
    setTimeout, clearTimeout, console,
  } = dependencies;
  let modelValidationRevision = 0;
  ${sourceRegion("  const [validationPending, setValidationPending]", "  const [savePending, setSavePending]")}
  ${sourceRegion("  async function handleModelValidation()", "  const tabs = [")}
  return {
    handleModelValidation, validationPending, validationFeedback,
    getRevision: () => modelValidationRevision,
    supersedeValidation: () => ++modelValidationRevision,
  };
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

function createHarness(t, options = {}) {
  const clock = fakeClock();
  const events = [];
  const initialTask = Object.hasOwn(options, "task") ? options.task : { name: "task-a" };
  const initialModel = { general: { value: 1 }, regions: { value: 2 } };
  let harness;
  createRoot(dispose => {
    const [task, setTask] = createSignal(initialTask);
    const [model, setModel] = createSignal(initialModel);
    const api = createValidationRuntime({
      createSignal,
      createEffect,
      onCleanup,
      selectionService: { loadedTaskHandle: task, loadedTaskIsDemo: () => Boolean(options.demo) },
      savePending: () => options.saving ?? false,
      async refreshPlanarModeMarker(handle, config) {
        events.push({ type: "planar-refresh", handle, config });
        return options.planarRefresh?.(handle, config);
      },
      modelService: { getModel: model },
      diagnosticService: {
        setValidationResult(diagnostics) {
          events.push({ type: "diagnostics", diagnostics });
        },
      },
      taskApprovalService: {
        async markUnapproved(handle) {
          events.push({ type: "mark", handle });
        },
        async clearUnapproved(handle) {
          events.push({ type: "clear", handle });
        },
      },
      async collectModelDiagnostics(handle, snapshot) {
        events.push({ type: "validate", handle, snapshot });
        return options.validate ? options.validate(handle, snapshot) : [];
      },
      createError,
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
  assert.equal(harness.validationFeedback()?.status, status);
  assert.equal(typeof harness.validationFeedback().message, "string");
  assert.ok(harness.validationFeedback().message.length > 0);
}

test("manual validation stays pending until diagnostics resolve and rejects double clicks", async t => {
  const result = deferred();
  const h = createHarness(t, { validate: () => result.promise });
  const validating = h.handleModelValidation();

  assert.equal(Boolean(h.validationPending()), true, "lock must precede the first await");
  assert.equal(h.validationPending().taskHandle, h.initialTask);
  assert.equal(h.validationPending().modelSnapshot, h.initialModel);
  assert.equal(h.validationFeedback(), null);
  assert.equal(h.getRevision(), 1);
  await h.handleModelValidation();
  assert.equal(h.getRevision(), 1, "duplicate clicks must not invalidate the active run");
  assert.equal(h.calls("validate").length, 1);
  assert.equal(h.calls("validate")[0].handle, h.initialTask);
  assert.equal(h.calls("validate")[0].snapshot, h.initialModel);
  assert.equal(h.calls("diagnostics").length, 0);
  h.clock.tick(10000);
  assert.equal(h.clock.pendingCount, 0, "feedback time starts only after completion");
  assert.equal(h.validationFeedback(), null);

  const diagnostics = [{ level: "success", message: "No errors" }];
  result.resolve(diagnostics);
  await validating;
  assert.equal(h.validationPending(), null);
  assertFeedback(h, "success");
  assert.equal(h.calls("diagnostics")[0].diagnostics, diagnostics);
  assert.deepEqual(h.events.map(event => event.type), ["validate", "planar-refresh", "diagnostics"]);
  h.clock.tick(2999);
  assertFeedback(h, "success");
  h.clock.tick(1);
  assert.equal(h.validationFeedback(), null);
  assert.equal(h.clock.pendingCount, 0);
});

test("a completed check preserves error and warning diagnostics and never changes approval", async t => {
  const diagnostics = [
    { level: "error", message: "Invalid model" },
    { level: "warning", message: "Review region" },
  ];
  const h = createHarness(t, { validate: () => diagnostics });
  await h.handleModelValidation();

  assertFeedback(h, "success");
  assert.equal(h.validationPending(), null);
  assert.equal(h.calls("diagnostics")[0].diagnostics, diagnostics);
  assert.deepEqual(h.events.map(event => event.type), ["validate", "planar-refresh", "diagnostics"]);
});

test("a validation exception becomes an error diagnostic and expiring error feedback", async t => {
  const h = createHarness(t, {
    validate: () => { throw new Error("Validation engine failed"); },
  });
  await h.handleModelValidation();

  assertFeedback(h, "error");
  assert.equal(h.validationPending(), null);
  assert.equal(h.calls("diagnostics").length, 1);
  const [diagnostic] = h.calls("diagnostics")[0].diagnostics;
  assert.equal(diagnostic.level, "error");
  assert.match(diagnostic.message, /Validation engine failed/);
  assert.deepEqual(h.events.map(event => event.type), ["validate", "diagnostics"]);
  h.clock.tick(2999);
  assertFeedback(h, "error");
  h.clock.tick(1);
  assert.equal(h.validationFeedback(), null);
  assert.equal(h.clock.pendingCount, 0);
});

test("another validation clears old feedback and starts a new three-second interval", async t => {
  const secondResult = deferred();
  let attempts = 0;
  const h = createHarness(t, {
    validate: () => ++attempts === 2 ? secondResult.promise : [],
  });
  await h.handleModelValidation();
  h.clock.tick(2000);
  assertFeedback(h, "success");

  const validating = h.handleModelValidation();
  assert.equal(h.validationFeedback(), null);
  assert.equal(h.clock.pendingCount, 0);
  h.clock.tick(1000);
  secondResult.reject(new Error("Second check failed"));
  await validating;
  assertFeedback(h, "error");
  assert.equal(h.validationPending(), null);
  assert.equal(h.clock.pendingCount, 1);
  h.clock.tick(2999);
  assertFeedback(h, "error");
  h.clock.tick(1);
  assert.equal(h.validationFeedback(), null);
  assert.equal(h.clock.pendingCount, 0);

  await h.handleModelValidation();
  assertFeedback(h, "success");
  assert.equal(h.calls("validate").length, 3, "an exception must release the lock");
});

for (const context of ["task", "snapshot", "task round trip", "snapshot round trip"]) {
  for (const outcome of ["success", "exception"]) {
    test(`a pending check discards ${outcome} after a ${context} change`, async t => {
      const result = deferred();
      const h = createHarness(t, { validate: () => result.promise });
      const validating = h.handleModelValidation();
      if (context.startsWith("snapshot")) {
        h.setModel({ ...h.initialModel, regions: { value: 9 } });
        if (context.endsWith("round trip")) h.setModel(h.initialModel);
      } else {
        h.setTask({ name: "task-b" });
        if (context.endsWith("round trip")) h.setTask(h.initialTask);
      }
      if (outcome === "exception") result.reject(new Error("Old check failed"));
      else result.resolve([{ level: "error", message: "Old model error" }]);
      await validating;

      assert.equal(h.validationPending(), null);
      assert.equal(h.validationFeedback(), null);
      assert.equal(h.calls("diagnostics").length, 0);
      assert.equal(h.clock.pendingCount, 0);
    });
  }
}

for (const outcome of ["success", "exception"]) {
  test(`a newer validation revision supersedes pending ${outcome}`, async t => {
    const result = deferred();
    const h = createHarness(t, { validate: () => result.promise });
    const validating = h.handleModelValidation();
    // Save uses this same revision to prevent older manual checks overwriting it.
    h.supersedeValidation();
    if (outcome === "exception") result.reject(new Error("Superseded check failed"));
    else result.resolve([{ level: "error", message: "Superseded diagnostic" }]);
    await validating;

    assert.equal(h.validationPending(), null);
    assert.equal(h.validationFeedback(), null);
    assert.equal(h.calls("diagnostics").length, 0);
    assert.equal(h.clock.pendingCount, 0);
  });
}

for (const context of ["task", "snapshot"]) {
  test(`a ${context} change clears visible feedback and its timer`, async t => {
    const h = createHarness(t);
    await h.handleModelValidation();
    assertFeedback(h, "success");
    if (context === "task") h.setTask({ name: "task-b" });
    else h.setModel({ ...h.initialModel, regions: { value: 9 } });
    assert.equal(h.validationFeedback(), null);
    assert.equal(h.clock.pendingCount, 0);

    await h.handleModelValidation();
    assertFeedback(h, "success");
    assert.equal(h.clock.pendingCount, 1);
  });
}

test("unmount cancels an active validation feedback timer", async t => {
  const h = createHarness(t);
  await h.handleModelValidation();
  assert.equal(h.clock.pendingCount, 1);
  h.dispose();
  assert.equal(h.validationFeedback(), null);
  assert.equal(h.clock.pendingCount, 0);
  h.clock.tick(3000);
  assert.equal(h.clock.pendingCount, 0);
});

for (const outcome of ["success", "exception"]) {
  test(`unmount discards a pending check's ${outcome} without a later timer`, async t => {
    const result = deferred();
    const h = createHarness(t, { validate: () => result.promise });
    const validating = h.handleModelValidation();
    h.dispose();
    if (outcome === "exception") result.reject(new Error("Unmounted check failed"));
    else result.resolve([]);
    await validating;

    assert.equal(h.validationPending(), null);
    assert.equal(h.validationFeedback(), null);
    assert.equal(h.calls("diagnostics").length, 0);
    assert.equal(h.clock.pendingCount, 0);
  });
}

test("validation without a loaded task leaves the revision and UI state untouched", async t => {
  const h = createHarness(t, { task: null });
  await h.handleModelValidation();
  assert.equal(h.getRevision(), 0);
  assert.equal(h.validationPending(), null);
  assert.equal(h.validationFeedback(), null);
  assert.deepEqual(h.events, []);
  assert.equal(h.clock.pendingCount, 0);
});

test("the validation button preserves its accessible name and exposes progress and results", async () => {
  const bar = await readFile(new URL("../src/TaskInfoBar.jsx", import.meta.url), "utf8");
  const button = bar.match(/<button\s+class="validate-button model-validation-button"[\s\S]*?<\/button>/u)?.[0];
  assert.ok(button, "the model validation action must have its own feedback classes");
  assert.match(source, /validationBusy=\{Boolean\(validationPending\(\)\)\}/u);
  assert.match(source, /validationFeedback=\{validationFeedback\(\)\}/u);
  assert.match(button, /disabled=\{!props\.path \|\| props\.validationBusy\}/u);
  assert.match(button, /onClick=\{props\.onValidate\}/u);
  assert.match(button, /aria-label="Проверить модель"/u);
  assert.match(button, /aria-busy=\{Boolean\(props\.validating\)\}/u);
  assert.match(button, /class="validation-button-label">Проверить модель<\/span>/u);
  assert.match(button, /class="validation-button-confirmation" aria-hidden="true"/u);
  assert.match(button, /props\.validationFeedback\?\.status === "success" \? "✓" : "!"/u);
  assert.match(bar, /class="validation-feedback-announcement" role="status" aria-live="polite"/u);
});

test("validation shares save animations and retains static feedback with reduced motion", async () => {
  const styles = await readFile(new URL("../src/TaskInfoBar.css", import.meta.url), "utf8");
  function rule(css, selector) {
    const match = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
      .find(candidate => candidate[1].split(",").some(item => item.trim() === selector));
    assert.ok(match, `CSS must define ${selector}`);
    return match[2];
  }

  for (const [saveSelector, validationSelector, animation] of [
    [".save-button-saving", ".validation-button-running", "model-save-pulse .8s ease-in-out infinite"],
    [".save-button-success", ".validation-button-success", "model-save-success 3s ease-in-out both"],
    [".save-button-error", ".validation-button-error", "model-save-error 3s ease-in-out both"],
    [".save-button-confirmation", ".validation-button-confirmation", "model-save-confirmation 3s ease-in-out both"],
  ]) {
    assert.equal(rule(styles, validationSelector), rule(styles, saveSelector));
    assert.ok(rule(styles, validationSelector).includes(`animation: ${animation};`));
  }
  assert.match(rule(styles, ".validation-button-confirmation"), /color:\s*#ffd600;/u);
  assert.match(rule(styles, ".validation-button-success .validation-button-label"), /visibility:\s*hidden;/u);
  const reducedMotion = [...styles.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/gu)]
    .map(match => match[1]).find(block => block.includes(".validation-button-running"));
  assert.ok(reducedMotion, "reduced motion must cover validation feedback");
  for (const selector of [".validation-button-running", ".validation-button-success", ".validation-button-error", ".validation-button-confirmation"]) {
    assert.match(rule(reducedMotion, selector), /animation:\s*none;/u);
  }
  assert.match(rule(reducedMotion, ".validation-button-success"), /box-shadow:\s*0 0 0 3px #ffd600;/u);
  assert.match(rule(reducedMotion, ".validation-button-error"), /box-shadow:\s*0 0 0 3px #dc2626;/u);
});


test("manual Check refreshes the saved marker independently of MED diagnostics, but never writes a demo", async t => {
  const h = createHarness(t, { validate: () => [{ level: "error", message: "MED" }] });
  await h.handleModelValidation();
  assert.equal(h.calls("planar-refresh").length, 1);
  assert.equal(h.calls("planar-refresh")[0].config.isCurrent(), true);
  const demo = createHarness(t, { demo: true });
  await demo.handleModelValidation(); assert.equal(demo.calls("planar-refresh").length, 0);
  const saving = createHarness(t, { saving: true });
  await saving.handleModelValidation(); assert.deepEqual(saving.events, []);
});
