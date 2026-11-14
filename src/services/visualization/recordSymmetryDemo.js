import { applyMatrix4ToPoint } from "../solver/rotation3d.js";
import { buildGeometryScene } from "./geometrySceneModel.js";
import { buildGeometryTimeModel } from "./geometryTimeModel.js";
import { createSourceDirectionTransform } from "./sourceVectorSceneModel.js";

export const SYMMETRY_STAGES = [
    "Геометрия", "Начальное смещение", "Локальная симметрия",
    "Поворот локальной СК", "Начало локальной СК", "Азимутальная симметрия",
    "Периодическая симметрия", "Зеркальная симметрия по Y", "Зеркальная симметрия по X",
];

const ZERO = [[0], [0], [0]];
const mirrorEnabled = value => value === 0 || value === 1;
export const NUMBERED_SYMMETRIES = [
    { stage: 3, index: "ls", count: "symLs" },
    { stage: 6, index: "as", count: "symAs" },
    { stage: 7, index: "ps", count: "symPs" },
];

export function demoImageNumber(number, count) {
    return Number.isSafeInteger(number) && Number.isSafeInteger(count) && count > 0
        ? Math.max(1, Math.min(count, number)) : 1;
}

export function activeSymmetryStages(record, general, element) {
    if (!record) return [];
    return [
        true, true, record.symLs > 1, true, true,
        element && record.symAs > 1, element && record.symPs > 1,
        element && mirrorEnabled(general?.mirrorSymmetryY),
        element && mirrorEnabled(general?.mirrorSymmetryX),
    ].flatMap((active, i) => active ? [i + 1] : []);
}

export function snapSymmetryStage(stages, requested, forward) {
    if (!stages.length) return 1;
    return forward
        ? stages.find(n => n >= requested) ?? stages.at(-1)
        : stages.findLast(n => n <= requested) ?? stages[0];
}

// Enable successive factors of the existing scene builder rather than composing
// a second chain of solver matrices. Trajectories are sampled at a fixed t=0.
export function buildRecordSymmetryStage(record, general, moves, element, stage, index = 0, choices = {}) {
    if (!record) return null;
    const group = element ? "elements" : "regions";
    const frame = buildGeometryTimeModel({ general, [group]: [record] }, moves, 0);
    const positioned = frame.model[group][0];
    const staged = {
        ...positioned,
        dr: stage >= 2 ? positioned.dr : ZERO,
        symLs: stage >= 3 ? positioned.symLs : 1,
        symVi: stage >= 4 ? positioned.symVi : ZERO,
        symR0: stage >= 5 ? positioned.symR0 : ZERO,
        symAs: stage >= 6 && element ? positioned.symAs : 1,
        symPs: stage >= 7 && element ? positioned.symPs : 1,
    };
    const settings = {
        ...general,
        mirrorSymmetryY: stage >= 8 && element ? general?.mirrorSymmetryY : -1,
        mirrorSymmetryX: stage >= 9 && element ? general?.mirrorSymmetryX : -1,
    };
    const imageIndexes = {};
    for (const family of NUMBERED_SYMMETRIES) {
        const choice = choices[family.index];
        if (stage >= family.stage && (element || family.index === "ls") && choice?.all === false) {
            imageIndexes[family.index] = demoImageNumber(choice.number, staged[family.count]) - 1;
        }
    }
    const scene = buildGeometryScene({ general: settings, [group]: [staged] }, { imageIndexes });
    const primitive = scene.primitives[0];
    const result = { scene, record: staged, general: settings, index,
        notices: [...frame.diagnostics, ...scene.diagnostics].map(d => d.message) };
    if (!primitive) return result;
    primitive.source.recordIndex = index;
    primitive.demoAddedIndex = ({ 3: "ls", 6: "as", 7: "ps", 8: "mirrorY", 9: "mirrorX" })[stage];
    if (primitive.demoAddedIndex) {
        for (const image of primitive.instances) image.demoCategory = image[primitive.demoAddedIndex] ? "copy" : "base";
    }
    const vertices = primitive.controlVertices ?? primitive.vertices;
    const center = [0, 0, 0], min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < vertices.length; i++) {
        const axis = i % 3;
        center[axis] += vertices[i] / (vertices.length / 3);
        min[axis] = Math.min(min[axis], vertices[i]);
        max[axis] = Math.max(max[axis], vertices[i]);
    }
    // Orientations applied to the geometry include DR; a coordinate frame
    // originates before that displacement. Even tilted LS images share X′.
    const frameOrigin = staged.dr.map(v => -(Array.isArray(v) ? v[0] : v));
    const axisLength = Math.hypot(...max.map((v, i) => v - min[i])) * 0.7 || 1;
    return { ...result, center, frameOrigin, axisLength };
}

// Stable, uniform directions in independent AS/PS source rows. Their mirrors
// and dependent images must reuse this direction, including after scrolling back.
function exampleDirection(index, ls, as, ps) {
    let hash = 2166136261;
    for (const n of [index, ls, as, ps]) hash = Math.imul(hash ^ n, 16777619);
    const random = () => {
        hash = (Math.imul(1664525, hash) + 1013904223) >>> 0;
        return hash / 4294967296;
    };
    const z = 2 * random() - 1, angle = 2 * Math.PI * random();
    const radius = Math.sqrt(1 - z * z);
    return [radius * Math.cos(angle), radius * Math.sin(angle), z];
}

export function buildDemoVectors(stage, components, length, kind) {
    const arrows = [];
    const primitive = stage?.scene.primitives[0];
    if (!primitive || primitive.kind !== "element-volume" || !(length > 0)
        || !components.every(Number.isFinite)) return arrows;
    const scale = Math.max(...components.map(Math.abs));
    if (!scale) return arrows;
    const normalized = components.map(v => v / scale);
    const magnitude = Math.hypot(...normalized);
    const unit = normalized.map(v => v / magnitude);
    const transform = createSourceDirectionTransform(stage.record);
    if (!transform) return arrows;
    for (const image of primitive.instances) {
        const as = stage.record.symKya === 0 ? image.as : 0;
        const ps = stage.record.symKyp === 0 ? image.ps : 0;
        const dashed = as > 0 || ps > 0;
        const source = dashed ? exampleDirection(stage.index, image.ls, as, ps) : unit;
        const direction = transform.image(transform.base(source, image.ls), image, kind, stage.general);
        if (direction) arrows.push({
            origin: applyMatrix4ToPoint(image.matrix, stage.center),
            direction, dashed, length: stage.axisLength * length / 100,
        });
    }
    return arrows;
}
