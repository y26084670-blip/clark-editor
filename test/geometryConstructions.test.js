import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
  buildConstructionLayer, CONSTRUCTIONS_FILE, constructionCoordinate,
  moveConstructionNode, newConstruction, openGeometryConstructions,
} from "../src/services/visualization/geometryConstructions.js";

function taskWithFile(initial = null) {
  let text = initial, fail = false;
  const handle = {
    getFile: async () => new Blob([text]),
    async createWritable() {
      if (fail) throw new Error("write denied");
      let buffer;
      return { async write(s) { buffer = s; }, async close() { text = buffer; }, async abort() {} };
    },
  };
  const input = {
    async getFileHandle(name, { create } = {}) {
      assert.equal(name, CONSTRUCTIONS_FILE);
      if (text === null && !create) throw new DOMException("Missing file", "NotFoundError");
      if (text === null) text = "";
      return handle;
    },
    async removeEntry(name) { assert.equal(name, CONSTRUCTIONS_FILE); text = null; },
  };
  return {
    async getDirectoryHandle(name) { assert.equal(name, "input3XX"); return input; },
    read: () => text, deny: value => { fail = value; },
  };
}

test("coordinates accept decimal commas and exponents while rejecting incomplete or unrenderable values", () => {
  for (const [text, value] of [["-1,25", -1.25], [" 2E-4 ", 0.0002], [".5", 0.5], ["0", 0]]) {
    assert.equal(constructionCoordinate(text), value);
  }
  for (const value of ["", " ", "-", "1,2,3", "1e", "Infinity", "NaN", "1e100", "0xFF"]) {
    assert.equal(constructionCoordinate(value), null);
  }
});

test("line order, colour, closure threshold and individual points reach Three.js", () => {
  const nodes = [[0, 0, 0], [1, 2, 3], [-2, 4, 1]];
  const drawn = (points, closed) => buildConstructionLayer(THREE, [
    { ...newConstruction(), color: "#ab238f", nodes: points, closed },
  ]).children;
  assert.equal(drawn([], true).length, 0);
  assert.equal(drawn(nodes.slice(0, 1), true)[0].isPoints, true);
  assert.equal(drawn(nodes.slice(0, 2), true)[1].type, "Line");
  assert.equal(drawn(nodes, true)[1].type, "LineLoop");
  assert.equal(drawn(nodes, false)[1].type, "Line");
  assert.equal(newConstruction().visible, true);
  assert.equal(buildConstructionLayer(THREE, [{ ...newConstruction(), visible: false, nodes }]).children.length, 0);
  const moved = moveConstructionNode(nodes, 0, 2);
  assert.deepEqual(moved, [nodes[1], nodes[2], nodes[0]]);
  assert.equal(moveConstructionNode(nodes, -1, 2), nodes);
  const line = drawn(moved, true)[1];
  assert.equal(line.material.color.getHexString(), "ab238f");
  assert.deepEqual(Array.from(line.geometry.attributes.position.array), moved.flat());
});

test("queued saves and a quick reopen keep the newest edit in the correct task", async () => {
  const first = taskWithFile(), second = taskWithFile();
  const file = await openGeometryConstructions(first);
  assert.deepEqual(file.cells, []);
  assert.equal(first.read(), null);
  const cell = newConstruction(), edited = { ...cell, nodes: [[1, 2, 3]] };
  const one = file.save([cell]), two = file.save([edited]), reopen = openGeometryConstructions(first);
  await Promise.all([one, two]);
  assert.deepEqual((await reopen).cells, [edited]);
  assert.deepEqual((await openGeometryConstructions(second)).cells, []);
  await file.save([]);
  assert.deepEqual((await openGeometryConstructions(first)).cells, []);
});

test("failed first save can retry and independent stale sessions preserve the existing file", async () => {
  const task = taskWithFile();
  const first = await openGeometryConstructions(task), second = await openGeometryConstructions(task);
  const cell = newConstruction();
  task.deny(true);
  await assert.rejects(first.save([cell]), /write denied/);
  assert.equal(task.read(), null);
  task.deny(false);
  await first.save([cell]);
  task.deny(true);
  await assert.rejects(first.save([]), /write denied/);
  task.deny(false);
  await assert.rejects(second.save([]), /другом окне/);
  assert.deepEqual((await openGeometryConstructions(task)).cells, [cell]);
});

test("invalid or future-format files cannot silently become empty constructions", async () => {
  const cell = newConstruction();
  for (const text of ["", "{}", '{"version":2,"cells":[]}',
    JSON.stringify({ version: 1, cells: [cell, cell] }),
    JSON.stringify({ version: 1, cells: [{ ...cell, visible: "false" }] }),
    JSON.stringify({ version: 1, cells: [{ ...cell, nodes: [[1, null, 3]] }] })]) {
    const task = taskWithFile(text);
    await assert.rejects(openGeometryConstructions(task));
    assert.equal(task.read(), text);
  }
});

test("older cells default to visible, and explicit visibility survives the next load", async () => {
  const cell = newConstruction();
  delete cell.visible;
  const task = taskWithFile(JSON.stringify({ version: 1, cells: [cell] }));
  const loaded = await openGeometryConstructions(task);
  assert.equal(loaded.cells[0].visible, true);
  await loaded.save([{ ...loaded.cells[0], visible: false }]);
  assert.equal((await openGeometryConstructions(task)).cells[0].visible, false);
});
