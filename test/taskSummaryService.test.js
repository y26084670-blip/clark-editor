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
