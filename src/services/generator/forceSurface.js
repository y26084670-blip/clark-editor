import { unpackKvVertices, validateKvVertices } from "../solver/geometryKv.js";
import { boxesMeet, bounds } from "../solver/medContactGeometry.js";
import { expandElementSymmetry } from "../solver/symmetryExpansion.js";
import { applyMatrix4ToPoint } from "../solver/rotation3d.js";
import { buildGeometryTimeModel } from "../visualization/geometryTimeModel.js";
import { encloseBodies } from "./forceSurfaceGeometry.js";

const axes = [0, 1, 2];
const mirrorEnabled = value => value === 0 || value === 1;

// Restrict original (LS/AS/PS) instances to the fundamental domain. A model
// written wholly in the negative half-space keeps its actual side as well.
function principalSides(general, selected) {
    return [general.mirrorSymmetryX, general.mirrorSymmetryY].map((setting, axis) => {
        if (!mirrorEnabled(setting)) return 0;
        return selected.every(body => body.box[axis][1] <= 0) ? -1 : 1;
    });
}

function meetsFundamentalDomain(body, sides, includeBoundary = false) {
    return sides.every((sign,d) => {
        if (!sign) return true;
        const far = sign > 0 ? body.box[d][1] : -body.box[d][0];
        return includeBoundary ? far >= 0 : far > 0;
    });
}

export function forceBodies(model) {
    const frame = buildGeometryTimeModel({general: model.general, elements: model.elements}, model.moves, 0);
    const invalidMove = frame.diagnostics.find(issue => issue.schemaId === "elements" && model.elements[issue.recordIndex]?.targ !== 3);
    if (invalidMove) throw new Error(`Элемент №${invalidMove.recordIndex + 1}. ${invalidMove.message}`);
    const cast = model.general?.doubleFloat ? Number : Math.fround;
    const bodies = [];
    for (const [index, row] of frame.model.elements.entries()) {
        if (row.targ === 3) continue;
        const problem = () => new Error(`Не удалось прочитать геометрию элемента №${index + 1}.`);
        const vectors = [row.dr, row.symR0, row.symVi];
        if (vectors.some(v => v !== undefined && (v.flat().length !== 3 || !v.flat().every(Number.isFinite)))
            || [row.symTx, row.symYa, row.symYl].some(v => v !== undefined && !Number.isFinite(v))) throw problem();
        const unpacked = unpackKvVertices(row.geo?.flat().map(cast) ?? [], row.geoType);
        if (unpacked.err || ![0, 1, 2, 3, 4].includes(row.geoType)
            || !validateKvVertices(unpacked.vertices, {doubleFloat:cast === Number})) throw problem();
        const dp = row.dp?.flat() ?? [1, 1, 1];
        if (dp.length !== 3 || dp.some(n => !Number.isSafeInteger(n) || n < 1)) throw problem();
        const images = expandElementSymmetry(row); // no EX/EY copies enter either list
        if (!images.length) throw problem();
        for (const image of images) {
            const vertices = unpacked.vertices.map(p => applyMatrix4ToPoint(image.matrix, p).map(cast));
            if (!vertices.every(p => p.every(Number.isFinite))) throw problem();
            const body = {vertices, box: bounds(vertices), index, dp};
            bodies.push(body);
        }
    }
    return {bodies, cast};
}

export function generateForceSurface(kernel, model, selectedIndices, distance, geometry = forceBodies(model)) {
    if (!(distance > 0) || !Number.isFinite(distance)) throw new Error("Введите положительное расстояние в миллиметрах.");
    const {bodies, cast} = geometry;
    const members = new Set(selectedIndices);
    const group = bodies.filter(b => members.has(b.index));
    if (!group.length || [...members].some(i => !model.elements[i] || model.elements[i].targ === 3)) throw new Error("Выберите физические элементы группы.");
    const others = bodies.filter(b => !members.has(b.index));
    const sides = principalSides(model.general ?? {}, group);
    const selected = group.filter(body => meetsFundamentalDomain(body,sides));
    if (!selected.length) throw new Error("В основном квадранте отсутствует выбранная геометрия.");
    const box = axes.map(d => [Infinity, -Infinity]);
    for (const body of selected) for (const d of axes) {
        box[d][0] = Math.min(box[d][0], body.box[d][0]);
        box[d][1] = Math.max(box[d][1], body.box[d][1]);
    }
    const reference = box.map(([lo, hi]) => lo / 2 + hi / 2);
    const outer = box.map(([lo, hi], d) => [
        sides[d] === 1 ? Math.max(0, cast(lo - distance)) : cast(lo - distance),
        sides[d] === -1 ? Math.min(0, cast(hi + distance)) : cast(hi + distance),
    ]);
    if (outer.some(([lo, hi]) => !Number.isFinite(hi-lo) || hi <= lo)) throw new Error("Заданные размеры выходят за диапазон координат модели.");
    const scale = Math.max(...outer.flat().map(Math.abs), ...box.flat().map(Math.abs));
    const precision = Math.max(Number.MIN_VALUE, scale * (cast === Number ? Number.EPSILON : 2 ** -23));
    if (outer.some(([lo, hi], d) => (lo !== 0 || sides[d] !== 1) && lo >= box[d][0]
        || (hi !== 0 || sides[d] !== -1) && hi <= box[d][1])) {
        throw new Error("Отступ меньше представимого изменения координат модели.");
    }
    const obstacles = others.filter(b => meetsFundamentalDomain(b,sides,true) && boxesMeet(b.box, outer, precision));
    const panels = encloseBodies(kernel, {selected, obstacles, outer, groupBox:box, sides, reference, distance, precision, cast});
    if (!panels.length) throw new Error("В основном полупространстве не осталось площадок.");
    return panels;
}
