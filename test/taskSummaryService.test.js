import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  TASK_SUMMARY_TEXT,
  readTaskSummary,
} from "../src/services/taskSummaryService.js";

const tasksUrl = new URL("../src/tabs/Tasks.jsx", import.meta.url);
const tasksStylesUrl = new URL("../src/tabs/Tasks.css", import.meta.url);

function missing(name = "NotFoundError") {
  return Object.assign(new Error(name), { name });
}

function fileHandle(content) {
  return {
    async getFile() {
      return {
        async text() {
          return content;
        },
      };
    },
  };
}

function directoryHandle({ directories = {}, files = {} } = {}) {
  return {
    async getDirectoryHandle(name) {
      if (Object.hasOwn(directories, name)) return directories[name];
      throw missing();
    },
    async getFileHandle(name) {
      if (Object.hasOwn(files, name)) return files[name];
      throw missing();
    },
  };
}

test("selected task exposes summary text without loading the task", async () => {
  const input = directoryHandle({
    files: { "_summary.txt": fileHandle("Элементов: 12\nОбластей: 3") },
  });
  const task = directoryHandle({ directories: { input3XX: input } });

  assert.deepEqual(await readTaskSummary(task), {
    summaryText: "Элементов: 12\nОбластей: 3",
  });
});

test("missing summary is reported while input3XX exists", async () => {
  const task = directoryHandle({
    directories: { input3XX: directoryHandle() },
  });

  assert.deepEqual(await readTaskSummary(task), {
    summaryText: TASK_SUMMARY_TEXT.NO_INFORMATION,
  });
});

test("missing input3XX is reported", async () => {
  const task = directoryHandle();

  assert.deepEqual(await readTaskSummary(task), {
    summaryText: TASK_SUMMARY_TEXT.NO_CURRENT_FORMAT,
  });
});

test("task tab renders readonly summary and ignores stale reads", async () => {
  const [source, styles] = await Promise.all([
    readFile(tasksUrl, "utf8"),
    readFile(tasksStylesUrl, "utf8"),
  ]);

  assert.match(source, /readOnly/u);
  assert.match(source, /task-summary-text/u);
  assert.match(source, /taskInfoRevision/u);
  assert.match(source, /requestId !== taskInfoRevision/u);
  assert.match(styles, /\.task-summary-panel/u);
  assert.match(styles, /\.task-summary-text/u);
});

const { formatTaskSummary, writeTaskSummary } = await import("../src/services/taskSummaryService.js");
const savedAt = new Date("2026-09-20T12:00:00Z");
const summaryModel = {
  general:{doubleFloat:true,htsMu:true,htsRo:true,htsRegimFC:false,evalForce:true,timeStep:0.125,countTimeSteps:4},
  elements:[
    {targ:0,model:2,rv:1,xapName:"HTS",dp:[[2],[3],[1]],symLs:2,symAs:3,symPs:4,symKya:-1,symKyp:0},
    {targ:1,model:0,rv:0,xapName:"",dp:[[1],[1],[1]]},
    {targ:2,model:0,rv:0,xapName:"",dp:[[2],[1],[1]]},
    {targ:3,indCoil:-7,dp:[[100],[100],[100]]},
  ],
  regions:[{indCoil:3}], amps:[{},{}], moves:[{}],
};
test("editor summary matches solver counters, independent images and original roles", () => {
  const original=structuredClone(summaryModel);
  const text=formatTaskSummary(summaryModel,savedAt);
  for (const line of ["Сохранено редактором: 2026-09-20T12:00:00.000Z", "Число элементов: 3",
    "Число областей: 1", "Число изм катушек: 7", "Число импульсов: 2", "Число траекторий: 1",
    "Число компонент плотн тока J (PPJ): 150", "Число компонент намагниченности M (PPM): 147",
    "ВТСП: Режим ZFC", "Число интервалов по времени: 4", "Разрядность вычислений - Double Float"]) assert.ok(text.includes(line),line);
  assert.doesNotMatch(text,/Старт расчета|Полное время/);
  assert.deepEqual(summaryModel,original);
  const empty=formatTaskSummary({general:{doubleFloat:false,timeStep:0,countTimeSteps:0}},savedAt);
  assert.match(empty,/Single Float/); assert.doesNotMatch(empty,/ВТСП|PPJ|PPM/);
});
test("summary overwrites the input file and is readable through the existing reader", async () => {
  let content="old", pending="", aborted=false;
  const input={async getFileHandle(name, options){
    assert.equal(name,"_summary.txt");
    return {async createWritable(){return {async write(text){pending=text},async close(){content=pending},async abort(){aborted=true}}},async getFile(){return {text:async()=>content}}};
  }};
  const handle={async getDirectoryHandle(name){assert.equal(name,"input3XX");return input}};
  await writeTaskSummary(handle,summaryModel,savedAt);
  assert.equal((await readTaskSummary(handle)).summaryText,formatTaskSummary(summaryModel,savedAt));
  assert.equal(aborted,false);
});
test("summary aborts a failed write and propagates the error", async () => {
  let aborted=false;
  const handle={getDirectoryHandle:async()=>({getFileHandle:async()=>({createWritable:async()=>({write:async()=>{throw new Error("disk full")},abort:async()=>{aborted=true}})})})};
  await assert.rejects(writeTaskSummary(handle,summaryModel,savedAt),/disk full/);
  assert.ok(aborted);
});


test("summary accepts absent optional time tables represented by null", async () => {
  const { formatTaskSummary } = await import("../src/services/taskSummaryService.js");
  const model = {general:{doubleFloat:true,timeStep:1,countTimeSteps:0},elements:[],regions:[],amps:null,moves:null};
  const before = structuredClone(model);
  const text = formatTaskSummary(model, new Date("2026-09-20T00:00:00Z"));
  assert.match(text, /Число импульсов: 0/);
  assert.match(text, /Число траекторий: 0/);
  assert.deepEqual(model, before);
});

test("matrix sizes use unknown rows and all J/M source columns with the solver's Float32 storage", () => {
  // 48 independent HTS cells, 1 prescribed M cell, 2 prescribed J cells:
  // PPJN=PPMN=144, PPJ=150, PPM=147. Each dense matrix has 42,768
  // coefficients = 171,072 bytes, regardless of the working precision.
  for (const doubleFloat of [false, true]) {
    const model = structuredClone(summaryModel);
    model.general.doubleFloat = doubleFloat;
    const before = structuredClone(model);
    const text = formatTaskSummary(model, savedAt);
    assert.match(text, /Матрица J: 144 × 297; 0\.163147 MiB \(суммарно по MPI, Float32\)/);
    assert.match(text, /Матрица M: 144 × 297; 0\.163147 MiB \(суммарно по MPI, Float32\)/);
    assert.match(text, /без рабочих буферов, векторов и слабых операторов/);
    assert.deepEqual(model, before);
  }
});

test("J and M have different row counts, with independent images counted only once", () => {
  const text = formatTaskSummary({ general: {}, elements: [
    // Geometrical AS and PS images are independent: 2×2×3×4 = 48 cells.
    { targ: 0, rv: 1, xapName: "", dp: [[2], [1], [1]], symLs: 2,
      symAs: 3, symPs: 4, symKya: 0, symKyp: 0 },
    // Full AS/PS symmetry folds these images: 5×2 = 10 cells.
    { targ: 0, rv: 0, xapName: "FMM", dp: [[5], [1], [1]], symLs: 2,
      symAs: 3, symPs: 4, symKya: 1, symKyp: -1 },
    { targ: 2, dp: [[2], [1], [1]] },
    { targ: 1, dp: [[3], [1], [1]] },
    // A materialless unknown and a virtual element contribute no components.
    { targ: 0, rv: 0, xapName: " ", dp: [[99], [99], [99]] },
    { targ: 3, rv: 1, xapName: "ignored", dp: [[99], [99], [99]] },
  ] }, savedAt);
  // PPJ=150, PPM=39, PPJN=144, PPMN=30.
  assert.match(text, /Матрица J: 144 × 189; 0\.103821 MiB/);
  assert.match(text, /Матрица M: 30 × 189; 0\.021629 MiB/);
});

test("prescribed sources have zero matrix rows and absent source families add no matrix", () => {
  const model = { general: {}, elements: [{ targ: 2, dp: [[2], [1], [1]] }] };
  const knownJ = formatTaskSummary(model, savedAt);
  assert.match(knownJ, /Матрица J: 0 × 6; 0\.000000 MiB/);
  assert.doesNotMatch(knownJ, /Матрица M/);
  model.elements.push({ targ: 1, dp: [[3], [1], [1]] });
  const knownJM = formatTaskSummary(model, savedAt);
  assert.match(knownJM, /Матрица J: 0 × 15; 0\.000000 MiB/);
  assert.match(knownJM, /Матрица M: 0 × 15; 0\.000000 MiB/);
  const empty = formatTaskSummary({ general: {}, elements: [] }, savedAt);
  assert.doesNotMatch(empty, /Матриц[аы]|Объём матриц/);
});

test("matrix estimates use the actual fine grid and handle large dimensions without allocating it", () => {
  const model = { general: { doubleFloat: true },
    elements: [{ targ: 0, rv: 1, dp: [[3], [3], [100]] }],
    jweakLocal: { status: "ready", data: { version: 1, coarse_divisions: [[1, 1, 100]] } },
  };
  assert.match(formatTaskSummary(model, savedAt), /Матрица J: 2700 × 2700; 27\.809143 MiB/);
  delete model.jweakLocal;
  model.elements[0].dp = [[300], [300], [100]];
  const text = formatTaskSummary(model, savedAt);
  assert.match(text, /Матрица J: 27000000 × 27000000; 2780914306\.640625 MiB/);
  assert.doesNotMatch(text, /Матрица M/);
});
