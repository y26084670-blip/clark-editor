import assert from "node:assert/strict";
import test from "node:test";
import { omClarkOptions, validateOMClarkBindings, omBindingParts } from "../src/services/omClarkBindings.js";

const models = {
  amps: [{}, {}, {}], moves: [{}],
  elements: [{ name: "Статор A", indCoil: 7, indAmp: 1, indMove: 1, targ: 0 },
    { name: "Статор B", indCoil: 7, indAmp: 2, targ: 0 },
    { name: "Датчик", indCoil: 2, indAmp: 1, targ: 3 }],
  regions: [{ name: "Воздух", indCoil: 7, indMove: 1 }],
};
test("coil options use unique actual numbers and only member names", () => {
  assert.deepEqual(omClarkOptions("PSI", models), [
    { value: 2, label: "№2 — Датчик" }, { value: 7, label: "№7 — Статор A, Статор B, Воздух" },
  ]);
});
test("AMP and MOVE names use existing reference semantics; measurement directions are not amplitudes", () => {
  assert.deepEqual(omClarkOptions("AMP", models), [
    { value: 1, label: "№1 — Статор A" }, { value: 2, label: "№2 — Статор B" }, { value: 3, label: "№3" },
  ]);
  assert.equal(omClarkOptions("MOVE", models)[0].label, "№1 — Статор A, Воздух");
  assert.deepEqual(omClarkOptions("FORCE", models), []);
});
test("nonexistent bindings fail without rewriting or requiring coil numbers to be consecutive", () => {
  const coupling = { inputs: [{ kind: "AMP", indices: [1, 1] }], outputs: [{ kind: "PSI", indices: [7, 2] }] };
  validateOMClarkBindings(coupling, models);
  coupling.outputs[0].indices[1] = 3;
  const before = JSON.stringify(coupling);
  assert.throws(() => validateOMClarkBindings(coupling, models), /PSI.*№3.*отсутствует/);
  assert.equal(JSON.stringify(coupling), before);
});
test("dependent task parts include the shared time grid and ignore unavailable channels", () => {
  assert.deepEqual(omBindingParts({ inputs: [], outputs: [{ kind: "PSI" }], tables: [] }).sort(), ["elements", "general", "regions"]);
});
