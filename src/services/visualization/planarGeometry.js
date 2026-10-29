import { applyMatrix4ToPoint } from "../solver/rotation3d.js";

// Keep identical in Editor and Viewer. Mirrors solver/src/task/04_planar_geometry.jl.
// Examine all physical images, before any viewport visibility filters. Observation
// regions do not define the extent of the infinite-X system.
function longitudinalAxis(vertices, divisions, tolerance) {
    for (let axis = 0; axis < 3; axis++) {
        if (divisions[axis] !== 1) continue;
        const bit = 1 << axis;
        const starts = Array.from({ length: 8 }, (_, i) => i).filter(i => !(i & bit));
        const dx = vertices[starts[0] + bit][0] - vertices[starts[0]][0];
        if (Math.abs(dx) <= tolerance) continue;
        if (starts.every(i => Math.abs(vertices[i][0] + dx / 2) <= tolerance
            && Math.abs(vertices[i + bit][0] - vertices[i][0] - dx) <= tolerance
            && Math.abs(vertices[i + bit][1] - vertices[i][1]) <= tolerance
            && Math.abs(vertices[i + bit][2] - vertices[i][2]) <= tolerance)) {
            return { axis, length: Math.abs(dx) };
        }
    }
    return null;
}

function hasCrossSection(vertices, axis) {
    const bits = [0, 1, 2].filter(a => a !== axis).map(a => 1 << a);
    const ids = [0, bits[0], bits[0] + bits[1], bits[1]];
    // Shift before the area sum to avoid cancelling large global coordinates.
    const points = ids.map(i => [vertices[i][1] - vertices[0][1], vertices[i][2] - vertices[0][2]]);
    const area = points.reduce((sum, p, i) => {
        const q = points[(i + 1) % points.length];
        return sum + p[0] * q[1] - p[1] * q[0];
    }, 0);
    return Number.isFinite(area) && area !== 0;
}

export function detectPlanarGeometry(primitives, general = {}, elementCount = 0) {
    if (general.fullAxialSymmetry || general.mirrorSymmetryX >= 0 || elementCount === 0) return null;
    const elements = primitives.filter(p => p.kind === "element-volume");
    // Incomplete/invalid scenes must never label a subset as the complete 2D task.
    if (elements.length !== elementCount) return null;
    const epsilon = general.doubleFloat ? Number.EPSILON : 2 ** -23;
    const lower = [Infinity, Infinity], upper = [-Infinity, -Infinity];
    let length = null;
    for (const element of elements) {
        const divisions = element.discretization?.counts;
        if (!divisions || divisions.length !== 3 || !element.instances?.length) return null;
        const vertices = Array.from({ length: 8 }, (_, i) => Array.from(element.vertices.slice(3 * i, 3 * i + 3)));
        let blockAxis = null;
        for (const instance of element.instances) {
            const physical = vertices.map(p => applyMatrix4ToPoint(instance.matrix, p));
            if (!physical.every(p => p.every(Number.isFinite))) return null;
            const scale = Math.max(...physical.flat().map(Math.abs), Number.MIN_VALUE);
            const tolerance = 64 * epsilon * scale;
            const extrusion = longitudinalAxis(physical, divisions, tolerance);
            if (!extrusion || (blockAxis !== null && blockAxis !== extrusion.axis)) return null;
            blockAxis = extrusion.axis;
            length ??= extrusion.length;
            if (Math.abs(extrusion.length - length) > tolerance || !hasCrossSection(physical, blockAxis)) return null;
            for (const p of physical) {
                for (let i = 0; i < 2; i++) {
                    lower[i] = Math.min(lower[i], p[i + 1]);
                    upper[i] = Math.max(upper[i], p[i + 1]);
                }
            }
        }
    }
    const width = upper.map((value, i) => value - lower[i]);
    const transverseSize = Math.max(...width), radius = Math.hypot(...width) / 2;
    return length > 2 * transverseSize && Number.isFinite(radius) && radius > 0
        ? { length, transverseSize, radius } : null;
}
