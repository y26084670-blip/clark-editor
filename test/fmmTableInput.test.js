import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  emptyFmmRecord, parseFmmClipboardText, fmmClipboardBlock,
  firstFmmClipboardBlock, createEmptyFmmMaterial, saveFmmClipboardBlock,
} from "../src/services/materials/fmmTableInput.js";
import { createTaskMaterialLibraryService } from "../src/services/taskMaterialLibraryService.js";

const tsv = (count = 12) => Array.from({ length: count }, (_, i) => `${i}\t${100 + i}\textra`).join("\n");

test("new FMM has twelve independent zero pairs and zero hip", () => {
  const record = emptyFmmRecord();
  assert.equal(record.name, "Новая");
  assert.equal(record.hip, 0);
  assert.equal(record.comment, "");
  assert.deepEqual(record.tabl, Array.from({ length: 12 }, () => [0, 0]));
  record.tabl[0][0] = 1;
  assert.equal(record.tabl[1][0], 0);
  assert.equal(emptyFmmRecord().tabl[0][0], 0);
});

test("a chosen range uses consecutive rows and only the first two columns", () => {
  const rows = parseFmmClipboardText(tsv(24));
  const block = fmmClipboardBlock(rows, 13, 20);
  assert.equal(block.length, 8);
  assert.deepEqual(block[0], [12, 112]);
  assert.deepEqual(block[7], [19, 119]);
  assert.deepEqual(rows[12], ["12", "112", "extra"]);
});

test("all rows are retained while arbitrary extra columns are ignored", () => {
  for (const separator of ["\t", ";", " "]) {
    const lines = Array.from({ length: 507 }, (_, i) =>
      [i, 100 + i, ...Array.from({ length: i % 23 }, () => "NaN")].join(separator));
    const rows = parseFmmClipboardText(["H" + separator + "M" + separator + "comment", ...lines].join("\n"));
    const block = fmmClipboardBlock(rows, firstFmmClipboardBlock(rows));
    assert.equal(block.length, 507);
    assert.deepEqual(block, Array.from({ length: 507 }, (_, i) => [i, 100 + i]));
  }
  const rows = parseFmmClipboardText("0\t100\t\ttext\tInfinity\n1\t101\tbad\t\tNaN");
  assert.deepEqual(fmmClipboardBlock(rows), [[0, 100], [1, 101]]);
  const extraDelimiters = parseFmmClipboardText("0 100 text;annotation\n1 101 ignored\tNaN");
  assert.deepEqual(fmmClipboardBlock(extraDelimiters), [[0, 100], [1, 101]]);
});

test("spreadsheet CRLF, comma decimals and exponent notation are numeric", () => {
  const rows = parseFmmClipboardText("\uFEFF\r\n" + Array(12).fill("-1,25\t+2,5e2\tignored").join("\r\n") + "\r\n");
  assert.deepEqual(fmmClipboardBlock(rows)[0], [-1.25, 250]);
  assert.deepEqual(fmmClipboardBlock(parseFmmClipboardText(Array(12).fill(".5 1D-3 4").join("\n")))[0], [0.5, 0.001]);
  assert.deepEqual(fmmClipboardBlock(parseFmmClipboardText(Array(12).fill("1,2;3,4;text").join("\r")))[0], [1.2, 3.4]);
});

test("headers are preserved and the first full numeric block is selected", () => {
  const rows = parseFmmClipboardText("H\tM\ttext\n" + tsv(15));
  assert.equal(rows.length, 16);
  assert.equal(firstFmmClipboardBlock(rows), 2);
  assert.throws(() => fmmClipboardBlock(rows, 1), /Строка 1, колонка 1/u);
  assert.deepEqual(fmmClipboardBlock(rows, 2)[0], [0, 100]);
});

test("empty first columns and interior empty rows do not shift the block", () => {
  const rows = parseFmmClipboardText("\t2\t3\n" + tsv(12));
  assert.equal(rows[0][0], "");
  assert.throws(() => fmmClipboardBlock(rows), /колонка 1/u);
  const separated = parseFmmClipboardText(tsv(6) + "\n\n" + tsv(6));
  assert.equal(separated.length, 13);
  assert.throws(() => fmmClipboardBlock(separated), /Строка 7/u);
});

test("short, invalid and out-of-range blocks are rejected", () => {
  assert.throws(() => parseFmmClipboardText(""), /пуст/u);
  assert.throws(() => parseFmmClipboardText(tsv(1)), /получено 1/u);
  const rows = parseFmmClipboardText(tsv());
  for (const start of [0, -1, 12, 1.5, NaN]) assert.throws(() => fmmClipboardBlock(rows, start));
  for (const end of [0, 1, 13, 1.5, NaN]) assert.throws(() => fmmClipboardBlock(rows, 1, end));
  for (const cell of ["", "NaN", "Infinity", "1e309", "1x", "1 2"]) {
    const invalid = rows.map(row => [...row]);
    invalid[11][1] = cell;
    assert.throws(() => fmmClipboardBlock(invalid), /Строка 12, колонка 2/u);
  }
});

test("clipboard defaults to all data after the header, including tables shorter and longer than twelve", () => {
  for (const count of [2, 11, 12, 13, 507, 894]) {
    const rows = parseFmmClipboardText("H\tM\n" + tsv(count));
    const start = firstFmmClipboardBlock(rows);
    assert.equal(start, 2);
    const block = fmmClipboardBlock(rows, start);
    assert.equal(block.length, count);
    assert.deepEqual(block.at(-1), [count - 1, 99 + count]);
  }
  const rows = parseFmmClipboardText("H\tM\n" + tsv(507) + "\nИтого\tне число");
  assert.throws(() => fmmClipboardBlock(rows, 2), /Строка 509/u);
  assert.equal(fmmClipboardBlock(rows, 2, 508).length, 507);
  rows[300][1] = "ошибка";
  assert.throws(() => fmmClipboardBlock(rows, 2, 508), /Строка 301, колонка 2/u);
});

function missing() {
  return Object.assign(new Error("missing"), { name: "NotFoundError" });
}
class MemoryDirectory {
  kind = "directory";
  directories = new Map();
  files = new Map();
  async getDirectoryHandle(name, { create = false } = {}) {
    if (!this.directories.has(name)) {
      if (!create) throw missing();
      this.directories.set(name, new MemoryDirectory());
    }
    return this.directories.get(name);
  }
  async getFileHandle(name, { create = false } = {}) {
    if (!this.files.has(name)) {
      if (!create) throw missing();
      this.files.set(name, new MemoryFile());
    }
    return this.files.get(name);
  }
  async *entries() { yield* this.files; yield* this.directories; }
  async removeEntry(name) { if (!this.files.delete(name)) throw missing(); }
}
class MemoryFile {
  kind = "file";
  bytes = new Uint8Array();
  fail = false;
  async getFile() { return { arrayBuffer: async () => this.bytes.slice().buffer }; }
  async createWritable() {
    let next;
    return {
      write: async bytes => { if (this.fail) throw new Error("write failed"); next = new Uint8Array(bytes); },
      close: async () => { this.bytes = next; },
      abort: async () => {},
    };
  }
}
async function setup() {
  const taskHandle = new MemoryDirectory();
  await taskHandle.getDirectoryHandle("input3XX", { create: true });
  const service = createTaskMaterialLibraryService({ cryptoImpl: webcrypto });
  const record = await createEmptyFmmMaterial({ taskHandle, service });
  const dir = await (await taskHandle.getDirectoryHandle("input3XX")).getDirectoryHandle("xapLibFMM");
  return { taskHandle, service, record, dir };
}
const payload = file => JSON.parse(new TextDecoder().decode(file.bytes));

test("creation writes a current-format file and never replaces an existing Новая", async () => {
  const { taskHandle, service, record, dir } = await setup();
  const file = dir.files.get("Новая.txt");
  assert.deepEqual(payload(file), { tabl: Array(24).fill(0), hip: 0, comment: "" });
  assert.match(record._taskLibraryRecord.sha256, /^[a-f0-9]{64}$/u);
  const before = file.bytes.slice();
  await assert.rejects(createEmptyFmmMaterial({ taskHandle, service }), /уже существует/u);
  assert.deepEqual(file.bytes, before);
  assert.equal(dir.files.size, 1);
});

test("creation detects case-insensitive names and cancels a stale session before writing", async () => {
  const { taskHandle, service, dir } = await setup();
  dir.files.set("НОВАЯ.txt", dir.files.get("Новая.txt"));
  dir.files.delete("Новая.txt");
  await assert.rejects(createEmptyFmmMaterial({ taskHandle, service }), /уже существует/u);
  const count = dir.files.size;
  assert.equal(await createEmptyFmmMaterial({ taskHandle, service, isCurrent: () => false }), null);
  assert.equal(dir.files.size, count);
});

test("clipboard autosave uses column-major storage, preserves metadata and leaves the source untouched", async () => {
  const { taskHandle, service, record, dir } = await setup();
  record.hip = 3;
  record.comment = "keep";
  const before = structuredClone(record);
  const saved = await saveFmmClipboardBlock({ taskHandle, service, record, rows: parseFmmClipboardText(tsv(20)), startRow: 3 });
  const stored = payload(dir.files.get("Новая.txt"));
  assert.deepEqual(stored.tabl, [...Array.from({ length: 18 }, (_, i) => i + 2), ...Array.from({ length: 18 }, (_, i) => i + 102)]);
  assert.equal(stored.hip, 3);
  assert.equal(stored.comment, "keep");
  assert.notEqual(saved._taskLibraryRecord.sha256, record._taskLibraryRecord.sha256);
  assert.deepEqual(record, before);
  const reloaded = await service.loadMaterials({ taskHandle, kind: "FMM" });
  assert.deepEqual(reloaded[0].data, stored);
});

test("long clipboard autosave and a later shorter paste preserve exactly the selected rows", async () => {
  const { taskHandle, service, record, dir } = await setup();
  const rows = parseFmmClipboardText(tsv(894));
  const saved = await saveFmmClipboardBlock({ taskHandle, service, record, rows, startRow: 1 });
  assert.equal(saved.tabl.length, 894);
  assert.equal(payload(dir.files.get("Новая.txt")).tabl.length, 1788);
  const shorter = await saveFmmClipboardBlock({ taskHandle, service, record: saved, rows, startRow: 100, endRow: 106 });
  assert.equal(shorter.tabl.length, 7);
  assert.deepEqual(shorter.tabl[0], [99, 199]);
  assert.deepEqual(shorter.tabl.at(-1), [105, 205]);
  assert.equal(payload(dir.files.get("Новая.txt")).tabl.length, 14);
});

test("invalid paste and failed writes preserve data; explicit save accepts external edits", async () => {
  const { taskHandle, service, record, dir } = await setup();
  const file = dir.files.get("Новая.txt"), before = file.bytes.slice(), model = structuredClone(record);
  const rows = parseFmmClipboardText(tsv());
  rows[0][0] = "bad";
  await assert.rejects(saveFmmClipboardBlock({ taskHandle, service, record, rows, startRow: 1 }));
  assert.deepEqual(file.bytes, before);
  rows[0][0] = "0";
  file.fail = true;
  await assert.rejects(saveFmmClipboardBlock({ taskHandle, service, record, rows, startRow: 1 }), /write failed/u);
  assert.deepEqual(file.bytes, before);
  file.fail = false;
  file.bytes = new TextEncoder().encode('{"external":true}\n');
  await saveFmmClipboardBlock({ taskHandle, service, record, rows, startRow: 1 });
  assert.equal(payload(file).external, undefined);
  assert.deepEqual(record, model);
});
