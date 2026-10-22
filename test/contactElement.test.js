import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { contactElementParameters, prepareContactElement, applyContactElement } from "../src/services/generator/contactElement.js";
import { MED_FACES, physicalHex } from "../src/services/solver/medContactGeometry.js";
import { unpackKvVertices } from "../src/services/solver/geometryKv.js";
import { expandElementSymmetry } from "../src/services/solver/symmetryExpansion.js";
import { applyMatrix4ToPoint } from "../src/services/solver/rotation3d.js";
import { analyzeMed } from "../src/services/medAnalysisService.js";
import { buildGeometryScene } from "../src/services/visualization/geometrySceneModel.js";
import { buildSourceVectorScene } from "../src/services/visualization/sourceVectorSceneModel.js";

const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: "custom" });
after(() => server.close());
const { modelService } = await server.ssrLoadModule("/src/services/modelService.js");
const { default: elementSchema } = await server.ssrLoadModule("/src/services/schemas/elements.schema.js");
const { default: mhjSchema } = await server.ssrLoadModule("/src/services/schemas/mhj.schema.js");
const { dataService } = await server.ssrLoadModule("/src/services/dataService.js");
const { serialize, deserialize } = await server.ssrLoadModule("/src/services/model/modelSerializer.js");
const { recomputeModel } = await server.ssrLoadModule("/src/services/model/modelCompute.js");
const createElement = () => dataService.createDefaultRecord(elementSchema);
const params = { element: 1, face: 1, thickness: 0.1, normalCurrent: 2 };
function fixture(extra = {}) {
  return { general: { mirrorSymmetryX: -1, mirrorSymmetryY: -1, doubleFloat: true }, amps: [], moves: [],
    elements: [{ ...createElement(), geoType: 2, geo: [[10, 12, 14], ...Array.from({ length: 7 }, () => [0, 0, 0])],
      rv: 1, targ: 0, dp: [[2], [3], [4]], med: Array.from({ length: 6 }, () => [-1]), ...extra }], mhj: [] };
}
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const dot = (a, b) => a.reduce((s, x, d) => s + x * b[d], 0);

for (const doubleFloat of [false, true]) for (let face = 1; face <= 6; face++) for (const sign of [-1, 1]) {
  test(`REAL${doubleFloat ? 64 : 32}, face ${face}, signed current ${sign}: full face, outward thickness, inward current`, () => {
    const model = fixture(); model.general.doubleFloat = doubleFloat;
    const before = structuredClone(model);
    const result = prepareContactElement(model, { ...params, face, normalCurrent: 2 * sign }, createElement);
    assert.deepEqual(model, before);
    const source = result.elements[1], conductor = unpackKvVertices(model.elements[0].geo.flat(), 2).vertices;
    const targetFace = physicalHex(conductor, 1e-9).faces[face - 1];
    assert.deepEqual(source.dp, [[1], [1], [1]]); assert.equal(source.targ, 2); assert.equal(source.rv, 0);
    assert.equal(result.elements[0].med[face - 1][0], 2);
    assert.equal(source.med[(face - 1) ^ 1][0], 1);
    const inner = MED_FACES[(face - 1) ^ 1].map(i => source.geo[i]);
    for (const p of targetFace.points) assert.ok(inner.some(q => q.every((x, d) => x === p[d])));
    for (const p of MED_FACES[face - 1].map(i => source.geo[i])) close(dot(p.map((x, d) => x - targetFace.center[d]), targetFace.normal), params.thickness);
    close(dot(result.mhj[0].v[0], targetFace.normal), -2 * sign);
    assert.deepEqual(analyzeMed({ ...model, ...result }).errors, []);
  });
}

test("rotation, translation and symmetry preserve contact and current normal in every image", () => {
  const model = fixture({ symVi: [[20], [30], [40]], dr: [[40], [50], [60]], symR0: [[4], [5], [6]],
    symPs: 2, symTx: 100, symKyp: 0, symLs: 2, symYl: 180 });
  const r = prepareContactElement(model, params, createElement);
  assert.equal(r.mhj[0].v.length, 4);
  const scene = buildGeometryScene({ ...model, elements: r.elements });
  const sources = buildSourceVectorScene(scene, r.elements, r.mhj, { general: model.general });
  assert.deepEqual(sources.diagnostics, []);
  const images = expandElementSymmetry(r.elements[0], model.general);
  assert.equal(images.length, 4);
  for (const image of images) {
    const vertices = unpackKvVertices(model.elements[0].geo.flat(), 2).vertices.map(p => applyMatrix4ToPoint(image.matrix, p));
    const normal = physicalHex(vertices, 1e-9).faces[0].normal;
    // Remove the translation when transforming a vector, independently of MHJ.
    const origin = applyMatrix4ToPoint(image.matrix, [0, 0, 0]);
    const direction = applyMatrix4ToPoint(image.matrix, r.mhj[0].v[0]).map((x, d) => x - origin[d]);
    close(dot(direction, normal), -2);
    const arrow = sources.vectors.find(v => v.instance.ls === image.ls && v.instance.ps === image.ps);
    assert.ok(arrow);
    arrow.vector.forEach((x, d) => close(x, direction[d]));
  }
});

test("a free face with automatic MED=0 accepts an explicit generated contact", () => {
  const model = fixture({ med: Array.from({ length: 6 }, () => [0]) });
  const result = prepareContactElement(model, params, createElement);
  assert.equal(result.elements[0].med[0][0], 2);
  assert.deepEqual(result.elements[0].med.slice(1), Array.from({ length: 5 }, () => [0]));
});

test("source rows append before virtual elements and other active contacts stay unchanged", () => {
  let model = fixture();
  const first = prepareContactElement(model, params, createElement);
  model = { ...model, elements: [...first.elements, { ...createElement(), targ: 3 }], mhj: first.mhj };
  const second = prepareContactElement(model, { ...params, face: 2, normalCurrent: -2 }, createElement);
  assert.equal(second.recordIndex, 2); assert.equal(second.elements[3].targ, 3);
  assert.equal(second.elements[0].med[0][0], 2); assert.equal(second.elements[0].med[1][0], 3);
  assert.deepEqual(second.elements[1], first.elements[1]);
  assert.deepEqual(second.mhj[0].v[0], first.mhj[0].v[0]);
});

test("only unbuildable input and unmappable source structure reject without mutations", () => {
  const attempts = [
    [fixture(), { ...params, element: 0 }, /существующего/],
    [fixture(), { ...params, face: 7 }, /от 1 до 6/],
    [fixture(), { ...params, thickness: 0 }, /положительным/],
    [fixture(), { ...params, normalCurrent: NaN }, /конечным/],
    [{ ...fixture(), jweakLocal: { status: "valid" } }, params, /зафиксированы/],
    [{ ...fixture(), mhj: [{ v: [[1, 2, 3]] }] }, params, /MHJ/],
    [fixture({ symLs: 0 }), params, /MHJ/],
  ];
  const bad = fixture(); const vertices = unpackKvVertices(bad.elements[0].geo.flat(), 2).vertices;
  vertices[0][1] += 1;
  bad.elements[0] = { ...bad.elements[0], geoType: 0, geo: vertices };
  attempts.push([bad, params, /плоская|Невыпуклый/]);
  for (const [model, input, expected] of attempts) {
    const before = structuredClone(model);
    assert.throws(() => prepareContactElement(model, input, createElement), expected);
    assert.deepEqual(model, before);
  }
});

test("decimal comma, signed scientific notation and whitespace parse as complete values", () => {
  for (const [text, expected] of [["-0.05", -0.05], ["+0,05", 0.05], ["-.2e-3", -0.0002],
    [" 1,25E+2 ", 125], ["0.", 0], ["-0", -0]]) {
    const value = contactElementParameters(fixture(), { ...params, thickness: "1e-2", normalCurrent: text });
    assert.equal(value.thickness, 0.01); assert.equal(value.normalCurrent, expected);
  }
  for (const text of ["", " ", "-", ".", "1e", "1e-", "NaN", "Infinity", "1e309", "0x10", "1,2,3", "1.2.3", "2mm"]) {
    assert.throws(() => contactElementParameters(fixture(), { ...params, normalCurrent: text }), /конечным/);
  }
});

test("correctable model errors and unresolved thickness do not prevent draft insertion", () => {
  const attempts = [
    [{ ...fixture(), general: { useMED: false } }, params],
    [{ ...fixture(), general: { doubleFloat: false } }, { ...params, normalCurrent: 1e100 }],
    [fixture(), { ...params, thickness: 1e-20 }],
    [fixture({ rv: 0 }), params],
    [fixture({ med: [[999], [-1], [-1], [-1], [-1], [-1]] }), params],
  ];
  for (const [model, input] of attempts) {
    const before = structuredClone(model), result = prepareContactElement(model, input, createElement);
    assert.deepEqual(model, before);
    assert.equal(result.elements.length, 2);
    assert.equal(result.elements[0].med[0][0], 2);
    assert.equal(result.elements[1].med[1][0], 1);
    assert.equal(result.mhj[0].v.length, 1);
  }
});

test("overlaps remain diagnosable after insertion instead of throwing a repeated error list", () => {
  const model = fixture(); model.elements.push({ ...model.elements[0], dr: [[0], [12], [0]] });
  const before = structuredClone(model), result = prepareContactElement(model, params, createElement);
  assert.deepEqual(model, before); assert.equal(result.elements.length, 3);
  assert.ok(analyzeMed({ ...model, ...result }).errors.length > 0);
  assert.deepEqual(result.mhj[0].v, [[0, -2, 0]]);
});

test("unordered targets retain source row ownership and renumber both sides of inserted contact", () => {
  const model = fixture({ targ: 3 });
  model.elements.push({ ...fixture().elements[0], targ: 2, dp: [[1], [1], [1]] });
  model.mhj = [{ v: [[NaN, 5, 6]] }]; // An existing value error must not block insertion.
  const result = prepareContactElement(model, { ...params, element: 2 }, createElement);
  assert.equal(result.recordIndex, 0); assert.equal(result.elements[1].targ, 3);
  assert.equal(result.elements[0].med[1][0], 3);
  assert.equal(result.elements[2].med[0][0], 1);
  assert.deepEqual(result.mhj[0].v, [[0, -2, 0], [NaN, 5, 6]]);
});

test("atomic history and native serialization preserve geometry, reciprocal MED and MHJ", () => {
  const model = fixture(); modelService.clearModel();
  for (const [id, data] of Object.entries(model)) modelService.setModelPart(id === "elements" ? elementSchema : id === "mhj" ? mhjSchema : { id, config: { storage: Array.isArray(data) ? "records" : "cluster" }, properties: {} }, data);
  const before = structuredClone(modelService.getModel());
  const result = applyContactElement({ modelService, params, elementSchema, mhjSchema, createElement });
  const after = structuredClone(modelService.getModel());
  assert.deepEqual(recomputeModel(elementSchema, deserialize(serialize(result.elements, elementSchema), elementSchema)).model, recomputeModel(elementSchema, result.elements).model);
  assert.deepEqual(deserialize(serialize(result.mhj, mhjSchema), mhjSchema), result.mhj);
  assert.equal(modelService.undo("mhj"), true); assert.deepEqual(modelService.getModel(), before);
  assert.equal(modelService.redo("elements"), true); assert.deepEqual(modelService.getModel(), after);
});
