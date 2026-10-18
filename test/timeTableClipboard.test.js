import assert from "node:assert/strict";
import test from "node:test";
import { parseTimeTableClipboard, timeTableClipboardPatch } from "../src/services/timeTableClipboard.js";

test("Excel TSV preserves full numeric precision, decimal commas, signs and scientific notation", () => {
  assert.deepEqual(parseTimeTableClipboard("\uFEFF0\t-60438.09105958964\r\n0,0005\t+2,5e3\r\n1D-3\t-.25\r\n", 2),
    [[0, -60438.09105958964], [.0005, 2500], [.001, -.25]]);
});

test("formatted Excel numbers accept only complete space-separated thousands groups", () => {
  assert.deepEqual(parseTimeTableClipboard("0\t1 234,5\n1\t-12\u00a0345.25\n2\t1\u202f234\u202f567", 2),
    [[0, 1234.5], [1, -12345.25], [2, 1234567]]);
  assert.throws(() => parseTimeTableClipboard("0\t1 23", 2), /Строка 1, колонка 2/);
});

test("four-column trajectories retain every XYZ component and time order without interpolation", () => {
  assert.deepEqual(parseTimeTableClipboard("-1\t10\t20\t30\r0\t-1\t0\t.3\r0\t2\t3\t4\r", 4),
    [[-1, 10, 20, 30], [0, -1, 0, .3], [0, 2, 3, 4]]);
});

test("wrong column counts and empty cells cannot silently shift the table", () => {
  for (const text of ["0\t1\t2", "0 1", "0;1", "0\t1\t", "0\t1\n\n1\t2", "\n0\t1"]) {
    assert.throws(() => parseTimeTableClipboard(text, 2), /колонки с разделением табуляцией/);
  }
  for (const text of ["0\t", "\t1", "0\t \n1\t2"]) {
    assert.throws(() => parseTimeTableClipboard(text, 2), /требуется число/);
  }
  assert.throws(() => parseTimeTableClipboard("0\t1\t2", 4), /требуется 4 колонки/);
});

test("headers, invalid values and non-finite numbers reject the whole clipboard", () => {
  for (const value of ["NaN", "Infinity", "1e999", "1,2.3", "0x12", "=1+2", "abc", "1foo", '"2"']) {
    assert.throws(() => parseTimeTableClipboard(`0\t1\n1\t${value}`, 2), /Строка 2, колонка 2/);
  }
  assert.throws(() => parseTimeTableClipboard("Время\tАмплитуда\n0\t1", 2), /без заголовка/);
  for (const text of ["", "\r\n", "\t ", undefined]) assert.throws(() => parseTimeTableClipboard(text, 2), /пуст/);
});

test("replacement patch changes only the declared table and leaves the source record intact", () => {
  const schema = { views: { clipboardTables: [{ property: "angle" }, { property: "position" }] },
    properties: { angle: { nColumns: 4 }, position: { nColumns: 4 }, other: { nColumns: 4 } } };
  const record = { angle: [[0, 1, 2, 3]], position: [[0, 4, 5, 6]], extra: "retained" };
  const original = structuredClone(record);
  const patch = timeTableClipboardPatch(schema, "position", "0\t11\t12\t13\n1\t21\t22\t23");
  const updated = { ...record, ...patch };
  assert.deepEqual(Object.keys(patch), ["position"]);
  assert.deepEqual(record, original);
  assert.deepEqual(updated.angle, original.angle);
  assert.equal(updated.extra, "retained");
  assert.deepEqual(updated.position, [[0, 11, 12, 13], [1, 21, 22, 23]]);
  assert.throws(() => timeTableClipboardPatch(schema, "other", "0\t1\t2\t3"), /не поддерживает/);
  assert.throws(() => timeTableClipboardPatch({ ...schema, properties: { angle: { readonly: true } } }, "angle", "0\t1"), /не поддерживает/);
});
