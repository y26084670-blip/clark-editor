import { unpackTkVertices } from "../solver/geometryTk.js";

const motionNotice = "При движении взаимное положение элементов и площадок может измениться. Проверьте, что поверхность охватывает нужные элементы на всём интервале расчёта.";

function hasTrajectory(record) {
    return Number.isSafeInteger(record?.indMove) && record.indMove > 0;
}

// FieldS integrates all non-coil TK surfaces, including previously saved ones.
// A segment can also be written as a four-vertex TK with V1=V2 and V3=V4.
function isMovingForcePanel(region) {
    if (!hasTrajectory(region) || (region.indCoil ?? 0) !== 0
        || ![0, 1, 3].includes(region.geoType) || !Array.isArray(region.geo)) return false;
    const { vertices, err } = unpackTkVertices(region.geo.flat(), region.geoType);
    const [a, b, c, d] = vertices;
    return !err && vertices.every(p => p.every(Number.isFinite))
        && (a.some((v, i) => v !== b[i]) || c.some((v, i) => v !== d[i]));
}

export function forceSurfaceMotionWarning({ elements, selectedIndices = [], regions }) {
    const elementRows = selectedIndices.filter(i => hasTrajectory(elements?.[i])).map(i => i + 1);
    const panelRows = [];
    for (const [i, region] of (regions ?? []).entries()) {
        if (isMovingForcePanel(region)) panelRows.push(i + 1);
    }
    const sources = [];
    if (elementRows.length) sources.push(`выбранным элементам № ${elementRows.join(", ")}`);
    if (panelRows.length) sources.push(`площадкам № ${panelRows.join(", ")}`);
    return sources.length ? `Предупреждение. Траектория назначена ${sources.join(" и ")}. ${motionNotice}` : "";
}
