import { cross, norm, sub } from "../solver/geometryShape.js";
import { unpackTkVertices } from "../solver/geometryTk.js";

const motionNotice = "При движении взаимное положение элементов и площадок может измениться. Проверьте, что поверхность охватывает нужные элементы на всём интервале расчёта.";

function hasTrajectory(record) {
    return Number.isSafeInteger(record?.indMove) && record.indMove > 0;
}

// The cross product of the diagonals gives twice the oriented area.
// A line can also be stored as a four-vertex TK.
export function isForcePanel(region) {
    if (!region || (region.indCoil ?? 0) !== 0
        || ![0, 1, 3].includes(region.geoType) || !Array.isArray(region.geo)) return false;
    const { vertices, err } = unpackTkVertices(region.geo.flat(), region.geoType);
    const [a, b, c, d] = vertices;
    return !err && vertices.every(p => p.every(Number.isFinite))
        && norm(cross(sub(c, a), sub(d, b))) > 0;
}

export function forceSurfaceMotionWarning({ elements, selectedIndices = [], regions }) {
    const elementRows = selectedIndices.filter(i => hasTrajectory(elements?.[i])).map(i => i + 1);
    const panelRows = [];
    for (const [i, region] of (regions ?? []).entries()) {
        if (hasTrajectory(region) && isForcePanel(region)) panelRows.push(i + 1);
    }
    const sources = [];
    if (elementRows.length) sources.push(`выбранным элементам № ${elementRows.join(", ")}`);
    if (panelRows.length) sources.push(`площадкам № ${panelRows.join(", ")}`);
    return sources.length ? `Предупреждение. Траектория назначена ${sources.join(" и ")}. ${motionNotice}` : "";
}
