import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import h5wasm from "h5wasm/node";
import {
  compareH5Results, compareResultFilePairs, compareTaskResults, formatComparisonReport,
  listComparisonTasks, parseFinalTimings, readComparisonTask, resultFilePairs,
} from "../src/services/taskResultsComparisonService.js";

const schemas = { MH: [3, 2, 1], JE: [3, 2, 1], AS: [3, 1, 1], FM: [3, 2, 0], PSI: [1, 1, 0], Q: [1, 1, 1], JE_work: [1, 1, 1] };
async function fixtures(body) {
  await h5wasm.ready;
  const directory = await mkdtemp(join(tmpdir(), "clark-comparison-"));
  const handles = [];
  function make(name, rows, { Type = Float64Array, steps = [0, 2], timeStep, shape } = {}) {
    const path = join(directory, `${handles.length}.h5`), file = new h5wasm.File(path, "w");
    const [columns, arrCount, hasCoo] = schemas[name];
    const header = file.create_group("HEADER");
    for (const [key, value] of Object.entries({ columns, arrCount, hasCoo })) {
      header.create_dataset({ name: key, data: BigInt64Array.of(BigInt(value)), shape: [] });
    }
    if (timeStep !== undefined) header.create_group("RANGES").create_dataset({ name: "time_step", data: timeStep });
    const stride = hasCoo * 3 + columns * arrCount;
    for (const step of steps) {
      const data = typeof rows === "function" ? rows(step) : rows;
      file.create_dataset({ name: String(step).padStart(6, "0"), data: new Type(data.flat()), shape: shape ?? [data.length, stride] });
    }
    file.close();
    const result = new h5wasm.File(path, "r"); handles.push(result);
    return result;
  }
  try { await body(make, directory); }
  finally { handles.forEach(handle => handle.close()); await rm(directory, { recursive: true, force: true }); }
}

for (const Type of [Float32Array, Float64Array]) {
  test(`real H5 ${Type.name}: separate J/E RMS includes every component, row and saved step, excludes coordinates`, async () => fixtures(make => {
    const a = make("JE", [[0, 0, 0, 0, 0, 0, 0, 0, 0], [1, 2, 3, 0, 0, 0, 0, 0, 0]], { Type });
    const b = make("JE", step => Array.from({ length: 2 }, () => [999, -999, Infinity,
      ...(step === 0 ? [1, 2, 2] : [4, 0, 0]), 10, 10, 10]), { Type });
    const result = compareH5Results("JE.h5", a, b, { chunkRows: 1 });
    assert.equal(result.records, 4);
    assert.deepEqual(result.groups.map(g => [g.label, g.unit, g.components]), [["J", "А/мм²", 12], ["E", "В/м", 12]]);
    assert.ok(Math.abs(result.groups[0].rms - Math.sqrt(25 / 6)) < 1e-12);
    assert.equal(result.groups[1].rms, 10);
    assert.deepEqual(compareH5Results("JE.h5", a, b, { chunkRows: 100 }), result);
  }));
}

test("different precision can compare directly; equal physical results give zero", async () => fixtures(make => {
  const a = make("MH", [[1, 2, 3, 1, 2, 3, 4, 5, 6]], { Type: Float32Array });
  const b = make("MH", [[9, 9, 9, 1, 2, 3, 4, 5, 6]], { Type: Float64Array });
  assert.deepEqual(compareH5Results("mh.H5", a, b).groups.map(g => [g.label, g.rms, g.unit]), [["M", 0, "кА/м"], ["H", 0, "кА/м"]]);
}));

test("force and moment retain separate physical dimensions", async () => fixtures(make => {
  const a = make("FM", [[0, 0, 0, 0, 0, 0]]), b = make("FM", [[1, 1, 1, 2, 2, 2]]);
  assert.deepEqual(compareH5Results("FM.h5", a, b).groups.map(g => [g.label, g.rms, g.unit]), [["F", 1, "Н"], ["момент", 2, "Н·м"]]);
}));

test("vector potential is reported in physical T*m units; scalar flux and work residuals stay scalar", async () => fixtures(make => {
  const a = make("AS", [[0, 0, 0, 0, 0, 0]]), b = make("AS", [[0, 0, 0, 1, 1, 1]]);
  const result = compareH5Results("AS.h5", a, b).groups[0];
  assert.equal(result.unit, "Тл·м"); assert.equal(result.rms, 4 * Math.PI * 1e-7);
  for (const name of ["PSI", "JE_work"]) {
    const coo = name === "PSI" ? [] : [1, 2, 3];
    const x = make(name, [[...coo, 1], [...coo, 3]]), y = make(name, [[...coo, 2], [...coo, 4]]);
    assert.equal(compareH5Results(`${name}.h5`, x, y).groups[0].rms, 1);
  }
}));

test("record mismatch is detected before numeric arrays are read", async () => fixtures(make => {
  const a = make("PSI", [[1]]), b = make("PSI", [[1], [2]]);
  const protect = file => ({ keys: () => file.keys(), get(key) {
    const dataset = file.get(key);
    return /^\d+$/.test(key) ? { shape: dataset.shape, slice() { assert.fail("numeric data were read"); } } : dataset;
  } });
  assert.match(compareH5Results("PSI.h5", protect(a), protect(b)).message, /число записей различается: 2 \/ 4/);
}));

test("equal total counts cannot hide different step numbers, point distribution or time grids", async () => fixtures(make => {
  const a = make("PSI", [[1]], { steps: [0, 1], timeStep: .1 });
  const b = make("PSI", [[1]], { steps: [0, 2], timeStep: .1 });
  const c = make("PSI", [[1]], { steps: [0, 1], timeStep: .2 });
  const d = make("PSI", [[1], [1]], { steps: [0] });
  assert.match(compareH5Results("PSI.h5", a, b).message, /номера шагов/);
  assert.match(compareH5Results("PSI.h5", a, c).message, /шаг по времени/);
  assert.match(compareH5Results("PSI.h5", a, d).message, /число временных записей/);
}));

test("empty files, unsupported units and malformed layouts never produce a misleading zero", async () => fixtures(make => {
  const a = make("MH", [], { steps: [] }), b = make("MH", [], { steps: [] });
  assert.match(compareH5Results("MH.h5", a, b).message, /нет записей/);
  const c = make("PSI", [[1]]), d = make("PSI", [[2]]);
  assert.match(compareH5Results("unknown.h5", c, d).message, /неизвестны физические/);
  assert.match(compareH5Results("MH.h5", c, d).message, /структура колонок/);
  assert.throws(() => compareH5Results("PSI.h5", c, d, { chunkRows: 0 }), /размер/);
}));

test("stable RMS preserves tiny/large finite residuals and rejects NaN", async () => fixtures(make => {
  const a = make("PSI", [[0]]);
  for (const delta of [1e-200, 1e200]) assert.equal(compareH5Results("PSI.h5", a, make("PSI", [[delta]])).groups[0].rms, delta);
  assert.throws(() => compareH5Results("PSI.h5", a, make("PSI", [[NaN]])), /нечисловые/);
}));

test("all H5 filenames form a natural ordered union, including files present in one task only", () => {
  const pairs = resultFilePairs([{ name: "JE.h5" }, { name: "file10.h5" }], [{ name: "je.H5" }, { name: "file2.h5" }]);
  assert.deepEqual(pairs.map(p => [p.name, !!p.first, !!p.second]), [["file2.h5", false, true], ["file10.h5", true, false], ["JE.h5", true, true]]);
});

test("a bad file cannot prevent comparison of later files; every opened H5 is closed", async () => fixtures((make, directory) => {
  const left = make("PSI", [[1]]), right = make("PSI", [[2]]);
  let closed = 0;
  const wrap = file => ({ keys: () => file.keys(), get: key => file.get(key), close() { closed++; } });
  const first = [{ name: "bad.h5" }, { name: "only.h5" }, { name: "PSI.h5" }];
  const second = [{ name: "bad.h5" }, { name: "PSI.h5" }];
  const lines = compareResultFilePairs(first, second, (side, file) => {
    if (file.name === "bad.h5") throw new Error("повреждён");
    return wrap(side === 0 ? left : right);
  });
  assert.match(lines[0], /bad.h5 — ошибка: повреждён/);
  assert.match(lines[1], /only.h5 — есть только в задании 1/);
  assert.match(lines[2], /PSI.h5 — Ψ: 1.000000e\+0 Вб/);
  assert.equal(closed, 2);
}));

test("timings come only from the last final block, never from intermediate steps", () => {
  const text = "Матрица (мин): 999\nИтого за расчет:\nПолное время (мин): 8\nМатрица (мин): 7\n"
    + "Итого за расчёт:\nПолное время (мин): 1,25\nМатрица (мин): 0.5\nРасчет источников (мин): 0.25\nРасчёт поля (мин): 0.2\n";
  assert.deepEqual(parseFinalTimings(text), [1.25, .5, .25, .2]);
  assert.deepEqual(parseFinalTimings("Матрица (мин): 999"), [null, null, null, null]);
  assert.deepEqual(parseFinalTimings("Итого за расчет:\nМатрица (мин): -2\nРасчет поля (мин): NaN"), [null, null, null, null]);
});

const absent = () => new DOMException("missing", "NotFoundError");
function file(name, data) { return { name, kind: "file", async getFile() { return new File([data], name); } }; }
function directory(name, children = []) {
  return { name, kind: "directory", async *entries() { for (const child of children) yield [child.name, child]; },
    async getDirectoryHandle(name, options) { assert.equal(options, undefined); const found = children.find(c => c.name === name && c.kind === "directory"); if (!found) throw absent(); return found; },
    async getFileHandle(name, options) { assert.equal(options, undefined); const found = children.find(c => c.name === name && c.kind === "file"); if (!found) throw absent(); return found; } };
}
const task = (label = "Project / Task") => ({ label, handle: directory("Task", [directory("output3XX", [file("PSI.h5", "fixture"), file("timing.txt", "Итого за расчет:\nПолное время (мин): 1")])]) });

test("both selectors can enumerate tasks from every project in the current list, naturally sorted", async () => {
  const result = await listComparisonTasks([{ name: "Project10", handle: directory("Project10", [directory("Task10"), file("ignore", "")]) },
    { name: "Project2", handle: directory("Project2", [directory("Task2")]) }]);
  assert.deepEqual(result.tasks.map(t => t.key), ["Project2/Task2", "Project10/Task10"]);
});

test("task scanning is read-only, includes every H5 extension and handles missing output/timing", async () => {
  const result = await readComparisonTask(task());
  assert.deepEqual(result.files.map(f => f.name), ["PSI.h5"]); assert.deepEqual(result.timings, [1, null, null, null]);
  const empty = await readComparisonTask({ label: "empty", handle: directory("empty") });
  assert.deepEqual(empty.files, []); assert.deepEqual(empty.timings, [null, null, null, null]);
});

test("report contains separately dimensioned residuals and exactly four timing rows with two values", () => {
  const report = formatComparisonReport({ label: "a", timings: [1, 2, 3, 4] }, { label: "b", timings: [5, 6, null, 8] }, ["JE.h5 — J: 0 А/мм²; E: 1 В/м"]);
  assert.match(report, /JE.h5.*А\/мм².*В\/м/);
  assert.match(report, /Полное:\t1\t5\nМатрицы:\t2\t6\nИсточники:\t3\tнет данных\nПоле:\t4\t8$/);
});

test("closing or changing the comparison terminates its worker and rejects the obsolete result", async () => {
  const controller = new AbortController(); let started, worker;
  const begun = new Promise(resolve => { started = resolve; });
  const result = compareTaskResults(task("a"), task("b"), { signal: controller.signal, workerFactory: () => (worker = {
    postMessage() { started(); }, terminate() { this.stopped = true; },
  }) });
  await begun; controller.abort();
  await assert.rejects(result, { name: "AbortError" }); assert.equal(worker.stopped, true); assert.equal(worker.onmessage, null);
});

test("successful worker report releases worker resources and uses final timings", async () => {
  let worker;
  const result = await compareTaskResults(task("a"), task("b"), { workerFactory: () => (worker = {
    postMessage() { queueMicrotask(() => this.onmessage({ data: { type: "complete", lines: ["PSI.h5 — Ψ: 0 Вб"] } })); },
    terminate() { this.stopped = true; },
  }) });
  assert.equal(worker.stopped, true); assert.match(result, /PSI.h5 — Ψ: 0 Вб/); assert.match(result, /Полное:\t1\t1/);
});
