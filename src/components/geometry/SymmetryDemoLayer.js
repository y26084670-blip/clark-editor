import { applyMatrix4ToPoint, identityMatrix4 } from "../../services/solver/rotation3d.js";

// Batch world-space strokes per colour; a many-image record still needs just
// a few draw calls for shafts and arrowheads. Dashed arrows keep a solid tip.
function strokeLayer(THREE, positions, color) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
        color, depthTest: false, depthWrite: false, transparent: true,
    }));
    lines.renderOrder = 30;
    return lines;
}

function arrowStrokes(THREE, positions, base, direction, length, dashed) {
    const tip = base.clone().addScaledVector(direction, length);
    const neck = base.clone().addScaledVector(direction, length * 0.82);
    const segment = (start, end) => positions.push(start.x, start.y, start.z, end.x, end.y, end.z);
    if (dashed) {
        for (let i = 0; i < 6; i++) {
            segment(base.clone().lerp(neck, i / 6), base.clone().lerp(neck, (i + 0.62) / 6));
        }
    } else segment(base, neck);
    const normal = Math.abs(direction.z) < 0.8 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const side = normal.cross(direction).normalize().multiplyScalar(length * 0.055);
    const otherSide = side.clone().cross(direction);
    for (const offset of [side, otherSide]) {
        segment(tip, neck.clone().add(offset));
        segment(tip, neck.clone().sub(offset));
    }
    segment(neck, tip);
}

export function createSymmetryAxes(THREE, stage, createLabelTexture) {
    const root = new THREE.Group();
    const primitive = stage.scene.primitives[0];
    if (!primitive) return root;
    const colors = ["#ff7777", "#74dc96", "#85b6ff"];
    const positions = [[], [], []], labels = new Map();
    const seen = new Set();
    function addFrame(matrix, origin, length, suffix) {
        const base = new THREE.Vector3(...origin);
        for (let axis = 0; axis < 3; axis++) {
            const direction = new THREE.Vector3().fromArray(matrix, axis * 4);
            const label = "XYZ"[axis] + suffix;
            // Coincident X′ axes are common to all local rotations.
            const key = [label, ...origin, ...direction.toArray()].map(n =>
                typeof n === "number" ? n.toPrecision(14) : n).join("/");
            if (seen.has(key)) continue;
            seen.add(key);
            arrowStrokes(THREE, positions[axis], base, direction, length, false);
            if (!labels.has(label)) labels.set(label, []);
            const tip = base.clone().addScaledVector(direction, length * 1.13);
            labels.get(label).push(tip.x, tip.y, tip.z);
        }
    }
    addFrame(identityMatrix4(), [0, 0, 0], stage.axisLength, "");
    for (const { matrix } of primitive.instances) {
        addFrame(matrix, applyMatrix4ToPoint(matrix, stage.frameOrigin), stage.axisLength / 2, "′");
    }
    positions.forEach((values, i) => root.add(strokeLayer(THREE, values, colors[i])));
    for (const [label, tips] of labels) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(tips, 3));
        const marks = new THREE.Points(geometry, new THREE.PointsMaterial({
            map: createLabelTexture(THREE, label, colors["XYZ".indexOf(label[0])]),
            size: label.length === 1 ? 23 : 20, sizeAttenuation: false,
            transparent: true, depthTest: false, depthWrite: false,
        }));
        marks.renderOrder = 32;
        root.add(marks);
    }
    return root;
}

export function createSymmetryArrows(THREE, arrows, kind) {
    if (!arrows.length) return null;
    const positions = [];
    for (const arrow of arrows) {
        arrowStrokes(THREE, positions, new THREE.Vector3(...arrow.origin),
            new THREE.Vector3(...arrow.direction), arrow.length, arrow.dashed);
    }
    const layer = strokeLayer(THREE, positions, kind === "current" ? "#ffac70" : "#8bf1c4");
    layer.renderOrder = 31;
    return layer;
}
