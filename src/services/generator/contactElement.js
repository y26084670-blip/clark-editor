import { unpackKvVertices } from "../solver/geometryKv.js";
import { medTolerance, physicalHex } from "../solver/medContactGeometry.js";
import { mhjLayout, isTargOrdered } from "../solver/mhjLayout.js";
import { jweakLocalLocksStructure, JWEAK_STRUCTURE_NOTICE } from "../solver/jweakLocalValidation.js";
import { analyzeMed } from "../medAnalysisService.js";

const fail = message => { throw new Error(message); };
export const CONTACT_CURRENT_NOTICE = "Перед расчётом назначьте источнику импульс с нулевым значением при t=0 и обеспечьте баланс входящего и выходящего тока проводника.";
export const CONTACT_THICKNESS_NOTICE = "Толщина — физический размер источника: его магнитное поле учитывается. Для условного носителя начните с 0,001–0,01 меньшего размера грани и проверьте результат при уменьшении толщины вдвое. Толщина должна оставаться выше численного допуска; для реального подвода задайте геометрию провода.";

export function createContactElementDefaults(model) {
  const index = model?.elements?.findIndex(e => e.targ === 0 && e.rv > 0) ?? -1;
  return { element: index >= 0 ? index + 1 : 1, face: 1, thickness: 0.1, normalCurrent: 1 };
}

// Geometry and MHJ are both in the conductor's local frame. Copying its
// placement, motion and symmetry makes the face and normal transform together.
export function contactElementParameters(model, params) {
  if (model?.general?.useMED === false) fail("Для контактного возбуждения включите «Учёт зарядов» в общих параметрах.");
  if (jweakLocalLocksStructure(model?.jweakLocal)) fail(JWEAK_STRUCTURE_NOTICE);
  const element = Number(params.element), faceNumber = Number(params.face);
  const thickness = Number(params.thickness), normalCurrent = Number(params.normalCurrent);
  if (!Number.isSafeInteger(element) || element < 1 || element > (model?.elements?.length ?? 0))
    fail("Укажите номер существующего элемента-проводника.");
  const conductor = model.elements[element - 1];
  if (conductor.targ !== 0 || !Number.isFinite(conductor.rv) || !(conductor.rv > 0)) fail("Выбранный элемент должен иметь назначение Unknown и ненулевую электропроводность.");
  if (!Number.isInteger(faceNumber) || faceNumber < 1 || faceNumber > 6) fail("Номер грани должен быть от 1 до 6 (порядок MED).");
  if (!Number.isFinite(thickness) || thickness <= 0) fail("Толщина должна быть конечным положительным числом, мм.");
  if (!Number.isFinite(normalCurrent)) fail("Нормальная плотность тока должна быть конечным числом, А/мм².");
  if (model.general?.doubleFloat !== true && !Number.isFinite(Math.fround(normalCurrent)))
    fail("Плотность тока выходит за диапазон REAL32. Уменьшите её или используйте REAL64.");
  const face = faceNumber - 1;
  const oldMed = conductor.med?.[face]?.[0];
  if (oldMed !== -1 && oldMed !== 0) fail("Грань уже имеет ссылку MED или некорректное значение. Выберите свободную грань или сначала исправьте её контакт.");
  const unpacked = unpackKvVertices(conductor.geo?.flat(), conductor.geoType);
  if (unpacked.err || unpacked.vertices?.length !== 8) fail("Не удалось построить геометрию выбранного элемента.");
  const scale = Math.max(...unpacked.vertices.flat().map(Math.abs));
  const tolerance = medTolerance(scale, model.general?.doubleFloat === true);
  const hex = physicalHex(unpacked.vertices, tolerance, model.general?.doubleFloat === true);
  if (hex.error) fail(hex.error);
  const surface = hex.faces[face];
  if (surface.collapsed || !surface.planar) fail("Для постоянного нормального тока нужна плоская невырожденная грань.");
  if (thickness <= 8 * tolerance) fail("Толщина слишком мала для выбранной разрядности и масштаба координат. Увеличьте её или используйте REAL64.");
  const axis = face < 2 ? 2 : face < 4 ? 1 : 0;
  const bit = 1 << axis, side = face % 2;
  const vertices = Array.from({ length: 8 }, (_, v) => {
    const source = (v & ~bit) | (side ? bit : 0);
    const outer = Number(Boolean(v & bit)) === side;
    return unpacked.vertices[source].map((x, d) => x + (outer ? thickness * surface.normal[d] : 0));
  });
  if (!vertices.flat().every(Number.isFinite)) fail("Координаты контактного элемента выходят за численный диапазон.");
  const donor = physicalHex(vertices, tolerance, model.general?.doubleFloat === true);
  if (donor.error) fail(`Контактный элемент: ${donor.error}`);
  return { element, face, donorFace: face ^ 1, thickness, normalCurrent, conductor, vertices,
    current: surface.normal.map(x => -normalCurrent * x || 0) };
}

export function prepareContactElement(model, params, createElement) {
  const values = contactElementParameters(model, params);
  const elements = model.elements;
  if (!isTargOrdered(elements)) fail("Сначала исправьте порядок элементов по назначению targ.");
  const records = model.mhj ?? [], previous = records[0]?.v ?? [];
  if (!Array.isArray(records) || records.length > 1 || !Array.isArray(previous)
    || previous.length !== mhjLayout(elements).rows
    || previous.some(row => !Array.isArray(row) || row.length !== 3 || !row.every(Number.isFinite)))
    fail("Число или значения заданных источников не соответствуют элементам. Сначала исправьте MHJ.");
  const { conductor, vertices, element, face, donorFace, current } = values;
  const record = { ...createElement() };
  for (const key of ["dr", "symR0", "symVi", "symLs", "symYl", "symAs", "symPs", "symYa", "symTx", "symKya", "symKyp", "indMove"])
    record[key] = structuredClone(conductor[key]);
  Object.assign(record, { name: `Контакт ${element}, грань ${face + 1}`, geoType: 0, geo: vertices,
    dp: [[1], [1], [1]], targ: 2, auto: true, take: true, rv: 0, xapName: "", indAmp: 0,
    med: Array.from({ length: 6 }, (_, f) => [f === donorFace ? element : -1]) });
  const virtual = elements.findIndex(e => e.targ === 3), insertAt = virtual < 0 ? elements.length : virtual;
  // Keep any positive MED references stable even when virtual rows shift.
  const nextElements = elements.map((e, i) => ({ ...e, med: e.med.map(([n], f) => [
    i === element - 1 && f === face ? insertAt + 1 : n > insertAt ? n + 1 : n,
  ]) }));
  nextElements.splice(insertAt, 0, record);
  const layout = mhjLayout(nextElements), rows = layout.items.find(item => item.kvIndex === insertAt);
  if (!rows || rows.start !== previous.length || layout.rows !== previous.length + rows.count)
    fail("Не удалось согласовать диапазон MHJ контактного элемента.");
  const analysis = analyzeMed({ ...model, elements: nextElements });
  if (analysis.errors.length) fail(analysis.errors.map(e => e.message).join("\n"));
  if (values.thickness <= 8 * analysis.tolerance)
    fail("Толщина слишком мала относительно координат всей модели. Увеличьте её или используйте REAL64.");
  for (const [block, f, neighbor] of [[element, face, insertAt + 1], [insertAt + 1, donorFace, element]]) {
    const found = analysis.faces.find(row => row.block === block && row.face === f);
    if (found?.proposed !== neighbor) fail("Не подтверждён полный однозначный контакт выбранных граней во всех образах симметрии.");
  }
  if (analysis.faces.some(row => row.block === insertAt + 1 && row.face !== donorFace && row.neighbors.length))
    fail("Контактный элемент касается другого проводника. Уменьшите толщину или выберите другую грань.");
  return { values, recordIndex: insertAt, elements: nextElements,
    mhj: [{ ...records[0], v: [...previous, ...Array.from({ length: rows.count }, () => [...current])] }] };
}

export function applyContactElement({ modelService, params, elementSchema, mhjSchema, createElement }) {
  const result = prepareContactElement(modelService.getModel(), params, createElement);
  modelService.setModelParts([{ schema: elementSchema, data: result.elements }, { schema: mhjSchema, data: result.mhj }], { recordHistory: true });
  return result;
}
