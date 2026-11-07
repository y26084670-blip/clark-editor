import test from "node:test";
import assert from "node:assert/strict";
import { createTaskQueueEntry, describeTaskQueue, taskQueueWindowRect } from "../src/services/taskQueueService.js";
import { readTaskList, writeTaskList } from "../src/services/taskLaunchService.js";

function workspace(name) {
  const files = new Map();
  return { name, kind: "directory", files,
    resolve: async handle => handle.root === name ? handle.parts : null,
    async getFileHandle(file, { create = false } = {}) {
      if (!files.has(file)) {
        if (!create) throw Object.assign(new Error(file), { name: "NotFoundError" });
        files.set(file, "");
      }
      return { getFile: async () => ({ text: async () => files.get(file) }),
        createWritable: async () => ({ write: async text => files.set(file, text), close: async () => {} }) };
    },
  };
}

test("queue keeps cross-catalog paths, insertion order and one copy of each task", async () => {
  const first = workspace("clark.projects"), other = workspace("CLARK.Tests");
  const disk = { resolve: async root => [root.name] };
  const source = root => ({ rootHandle: root, handle: { root: root.name, parts: ["Проект 1", "Задание"] } });
  const a = await createTaskQueueEntry(first, disk, source(first));
  const b = await createTaskQueueEntry(first, disk, source(other));
  assert.equal(a.path, "Проект 1/Задание");
  assert.equal(b.path, "../CLARK.Tests/Проект 1/Задание");
  first.files.set("clark.launch.json", "old request");
  await writeTaskList(first, [a, b, a]);
  assert.equal(first.files.get("clark.launch.json"), "");
  const result = await readTaskList(first);
  assert.deepEqual(result.entries, [a, b]);
  const described = describeTaskQueue(first, [{ name: other.name, handle: other }], result.entries);
  assert.deepEqual(described.map(entry => entry.displayPath), [
    "clark.projects/Проект 1/Задание", "CLARK.Tests/Проект 1/Задание",
  ]);
  assert.equal(described[1].rootHandle, other);
  assert.equal(described[1].taskPath, "Проект 1/Задание");
  await writeTaskList(first, result.entries.filter(entry => entry.path !== a.path));
  assert.deepEqual((await readTaskList(first)).entries, [b]);
});

test("only an actual project task under the selected disk can enter the queue", async () => {
  const root = workspace("clark.projects");
  const disk = { resolve: async () => [root.name] };
  for (const parts of [null, [], ["Проект"], ["Проект", "Задание", "Вложенный"]]) {
    await assert.rejects(createTaskQueueEntry(root, disk,
      { rootHandle: root, handle: { root: root.name, parts } }));
  }
  await assert.rejects(createTaskQueueEntry(root, { resolve: async () => null },
    { rootHandle: root, handle: { root: root.name, parts: ["Проект", "Задание"] } }));
});

test("list format admits a sibling catalog and rejects arbitrary traversal", async () => {
  const root = workspace("clark.projects");
  for (const path of ["../../clark.other/P/T", "../private/P/T", "../clark.app/P/T", "../clark.other/../T", "C:/P/T", "/P/T"]) {
    root.files.set("clark.tasks.txt", path);
    await assert.rejects(readTaskList(root), path);
  }
  root.files.set("clark.tasks.txt", "*P/disabled\nP/enabled\n");
  assert.deepEqual(describeTaskQueue(root, [], (await readTaskList(root)).entries)
    .map(entry => entry.displayPath), ["clark.projects/P/enabled"]);
});

test("default queue window covers the middle and right panels at full viewport height", () => {
  const panels = { querySelector: name => ({ getBoundingClientRect: () => name.includes("summary")
    ? { left: 550 } : { right: 1440 } }) };
  assert.deepEqual(taskQueueWindowRect(panels, { innerWidth: 1440, innerHeight: 900 }),
    { x: 550, y: 8, width: 882, height: 884 });
});
