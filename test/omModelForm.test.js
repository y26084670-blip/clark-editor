import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { changeOMField, changeOMBinding, omFormGroups } from "../src/services/omModelForm.js";
import { validateOMInputs, validateOMPreset } from "../src/services/omClientService.js";

const template = JSON.parse(await readFile(new URL("../src/data/om-presets/circuit-star.json", import.meta.url)));
const fresh = () => structuredClone(template);

test("form edits round-trip unknown JSON keys and leave preset/source data untouched", () => {
  const p = fresh(); p.data.extension = { vendor: [1, 2] }; p.data.branches[0].note = "keep";
  const before = JSON.stringify(p);
  const next = changeOMField(p, p.data, p.coupling, ["branches", 0, "L_H"], 0.125);
  assert.equal(JSON.stringify(p), before);
  assert.equal(next.data.branches[0].L_H, 0.125);
  assert.equal(next.data.branches[0].note, "keep");
  assert.deepEqual(next.data.extension, p.data.extension);
  validateOMInputs(p.selection, next.data, next.coupling, p);
});

test("changing parallel count preserves phase/branch coordinates and leaves new links empty", () => {
  const p = fresh(); p.data.branches.forEach((row, i) => row.R_Ohm = 10 + i);
  const next = changeOMField(p, p.data, p.coupling, ["parallel"], 2);
  assert.deepEqual(next.data.branches.filter((_, i) => i % 2 === 0).map(row => row.R_Ohm), [10, 11, 12]);
  assert.deepEqual(next.coupling.inputs[0].indices, [1, null, 2, null, 3, null]);
  assert.deepEqual(next.coupling.outputs[0].indices, [1, null, 2, null, 3, null]);
  assert.deepEqual(next.data.emf, p.data.emf);
  assert.deepEqual(next.removed, []);
  assert.throws(() => validateOMInputs(p.selection, next.data, next.coupling, p), /индексы/);
  const labels = omFormGroups(p.contract, next.data).find(group => group.id === "branches").rows.map(row => row.label);
  assert.deepEqual(labels, ["Фаза 1 · Ветвь 1", "Фаза 1 · Ветвь 2", "Фаза 2 · Ветвь 1", "Фаза 2 · Ветвь 2", "Фаза 3 · Ветвь 1", "Фаза 3 · Ветвь 2"]);
  const reduced = changeOMField(p, next.data, next.coupling, ["parallel"], 1);
  assert.deepEqual(reduced.data, p.data);
  assert.deepEqual(reduced.coupling, p.coupling);
  assert.deepEqual(reduced.removed, ["branches"]);
});

test("phase reduction reports both removed arrays and invalid capacity changes are atomic", () => {
  const p = fresh(); p.contract.dimensions.phases.maximum = 3;
  const before = JSON.stringify(p);
  assert.deepEqual(changeOMField(p, p.data, p.coupling, ["phases"], 2).removed, ["branches", "emf"]);
  for (const value of [0, 4, null, 2.5]) assert.throws(() => changeOMField(p, p.data, p.coupling, ["phases"], value));
  assert.equal(JSON.stringify(p), before);
});

test("binding changes preserve pulse selection and other links, including repeats", () => {
  const p = fresh(), data = structuredClone(p.data);
  const result = changeOMBinding(p.coupling, "inputs", 0, 1, 1);
  assert.deepEqual(result.inputs[0].indices, [1, 1, 3]);
  assert.deepEqual(result.outputs, p.coupling.outputs);
  assert.deepEqual(p.data, data);
  assert.deepEqual(p.coupling.inputs[0].indices, [1, 2, 3]);
});

test("old presets remain valid and the descriptor rejects unsafe paths and incomplete fields", () => {
  const legacy = fresh(); delete legacy.contract.ui; validateOMPreset(legacy);
  assert.deepEqual(omFormGroups(legacy.contract, legacy.data), []);
  for (const path of [["__proto__", "polluted"], ["constructor"], ["branches", "$index", "L_H"]]) {
    const p = fresh(); p.contract.ui.groups[0].fields[0].path = path;
    assert.throws(() => validateOMPreset(p), /путь/);
  }
  const p = fresh(); p.contract.ui.groups[0].fields[0].path = ["untyped"];
  assert.throws(() => validateOMPreset(p), /тип поля/);
  assert.equal({}.polluted, undefined);
});

test("model-specific scalar fields and enum options work without circuit-name dispatch", () => {
  const p = fresh(); p.selection.model = "controller"; p.data.schema = p.contract.dataSchema = "controller/1";
  p.data.gain = 2; p.data.mode = "fast";
  p.contract.ui.groups.push({ id: "controller", label: "Регулятор", fields: [
    { path: ["gain"], label: "Усиление", type: "real", minimum: 0 },
    { path: ["mode"], label: "Режим", type: "string", options: [{ value: "fast", label: "Быстрый" }, { value: "slow", label: "Медленный" }] },
  ] });
  validateOMPreset(p);
  assert.equal(omFormGroups(p.contract, p.data).at(-1).rows[0].fields[1].type, "string");
  p.data.mode = "other";
  assert.throws(() => validateOMInputs(p.selection, p.data, p.coupling, p), /из списка/);
});
