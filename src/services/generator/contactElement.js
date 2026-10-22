import { unpackKvVertices } from "../solver/geometryKv.js";
import { medTolerance, physicalHex } from "../solver/medContactGeometry.js";
import { mhjLayout } from "../solver/mhjLayout.js";
import { jweakLocalLocksStructure, JWEAK_STRUCTURE_NOTICE } from "../solver/jweakLocalValidation.js";

const fail = message => { throw new Error(message); };
export const CONTACT_CURRENT_NOTICE = "Перед расчётом назначьте источнику импульс с нулевым значением при t=0 и обеспечьте баланс входящего и выходящего тока проводника.";
export const CONTACT_THICKNESS_NOTICE = "Толщина — физический размер источника: его магнитное поле учитывается. Для условного носителя начните с 0,001–0,01 меньшего размера грани и проверьте результат при уменьшении толщины вдвое. Толщина должна оставаться выше численного допуска; для реального подвода задайте геометрию провода.";

export function createContactElementDefaults(model) {
  const index = model?.elements?.findIndex(e => e.targ === 0 && e.rv > 0) ?? -1;
  return { element: index >= 0 ? index + 1 : 1, face: 1, thickness: 0.1, normalCurrent: 1 };
}

// Keep the original text in the dialog, including unfinished '-', '0.' and
// '1e-'. Parse for validation/application without writing back into the field.
function numberInput(value) {
  const text = String(value ?? "").trim().replace(",", ".");
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text) ? Number(text) : NaN;
}

// Geometry and MHJ are both in the conductor's local frame. Copying its
// placement, motion and symmetry makes the face and normal transform together.
export function contactElementParameters(model, params) {
  if (jweakLocalLocksStructure(model?.jweakLocal)) fail(JWEAK_STRUCTURE_NOTICE);
  const element = numberInput(params.element), faceNumber = numberInput(params.face);
  const thickness = numberInput(params.thickness), normalCurrent = numberInput(params.normalCurrent);
  if (!Number.isSafeInteger(element) || element < 1 || element > (model?.elements?.length ?? 0))
    fail("Укажите номер существующего элемента-проводника.");
  const conductor = model.elements[element - 1];
  if (!Number.isInteger(faceNumber) || faceNumber < 1 || faceNumber > 6) fail("Номер грани должен быть от 1 до 6 (порядок MED).");
  if (!Number.isFinite(thickness) || thickness <= 0) fail("Толщина должна быть конечным положительным числом, мм.");
  if (!Number.isFinite(normalCurrent)) fail("Нормальная плотность тока должна быть конечным числом, А/мм².");
  const face = faceNumber - 1;
  const unpacked = unpackKvVertices(conductor.geo?.flat(), conductor.geoType);
  if (unpacked.err || unpacked.vertices?.length !== 8) fail("Не удалось построить геометрию выбранного элемента.");
  const scale = Math.max(...unpacked.vertices.flat().map(Math.abs));
  const tolerance = medTolerance(scale, model.general?.doubleFloat === true);
  const hex = physicalHex(unpacked.vertices, tolerance, model.general?.doubleFloat === true);
  if (hex.error) fail(hex.error);
  const surface = hex.faces[face];
  if (surface.collapsed || !surface.planar) fail("Для постоянного нормального тока нужна плоская невырожденная грань.");
  const axis = face < 2 ? 2 : face < 4 ? 1 : 0;
  const bit = 1 << axis, side = face % 2;
  const vertices = Array.from({ length: 8 }, (_, v) => {
    const source = (v & ~bit) | (side ? bit : 0);
    const outer = Number(Boolean(v & bit)) === side;
    return unpacked.vertices[source].map((x, d) => x + (outer ? thickness * surface.normal[d] : 0));
  });
  if (!vertices.flat().every(Number.isFinite)) fail("Координаты контактного элемента выходят за численный диапазон.");
  // A draft may fail MED/precision checks. Validate the resulting model after
  // insertion, so the user can correct geometry, material and contacts there.
  return { element, face, donorFace: face ^ 1, thickness, normalCurrent, conductor, vertices,
    current: surface.normal.map(x => -normalCurrent * x || 0) };
}

export function prepareContactElement(model, params, createElement) {
  const values = contactElementParameters(model, params);
  const elements = model.elements;
  const records = model.mhj ?? [], previous = records[0]?.v ?? [];
  if (!Array.isArray(records) || records.length > 1 || !Array.isArray(previous)
    || previous.length !== mhjLayout(elements).rows)
    fail("Невозможно определить место новых строк источника: число строк MHJ не соответствует элементам. Исправьте структуру MHJ.");
  const { conductor, vertices, element, face, donorFace, current } = values;
  const record = { ...createElement() };
  for (const key of ["dr", "symR0", "symVi", "symLs", "symYl", "symAs", "symPs", "symYa", "symTx", "symKya", "symKyp", "indMove"])
    record[key] = structuredClone(conductor[key]);
  Object.assign(record, { name: `Контакт ${element}, грань ${face + 1}`, geoType: 0, geo: vertices,
    dp: [[1], [1], [1]], targ: 2, auto: true, take: true, rv: 0, xapName: "", indAmp: 0,
    med: Array.from({ length: 6 }, (_, f) => [f === donorFace ? element : -1]) });
  const virtual = elements.findIndex(e => e.targ === 3), insertAt = virtual < 0 ? elements.length : virtual;
  record.med[donorFace][0] = element > insertAt ? element + 1 : element;
  // Keep any positive MED references stable even when virtual rows shift.
  const nextElements = elements.map((e, i) => ({ ...e, med: e.med.map(([n], f) => [
    i === element - 1 && f === face ? insertAt + 1 : n > insertAt ? n + 1 : n,
  ]) }));
  nextElements.splice(insertAt, 0, record);
  const layout = mhjLayout(nextElements), rows = layout.items.find(item => item.kvIndex === insertAt);
  if (!rows || !Number.isSafeInteger(rows.count) || rows.count <= 0 || layout.rows !== previous.length + rows.count)
    fail("Не удалось согласовать диапазон MHJ контактного элемента.");
  const nextSources = [...previous.slice(0, rows.start),
    ...Array.from({ length: rows.count }, () => [...current]), ...previous.slice(rows.start)];
  return { values, recordIndex: insertAt, elements: nextElements,
    mhj: [{ ...records[0], v: nextSources }] };
}

export function applyContactElement({ modelService, params, elementSchema, mhjSchema, createElement }) {
  const result = prepareContactElement(modelService.getModel(), params, createElement);
  modelService.setModelParts([{ schema: elementSchema, data: result.elements }, { schema: mhjSchema, data: result.mhj }], { recordHistory: true });
  return result;
}
