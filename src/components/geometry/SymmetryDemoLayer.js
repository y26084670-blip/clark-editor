import { applyMatrix4ToPoint, identityMatrix4 } from "../../services/solver/rotation3d.js";

// Keep one-pixel shafts and batch solid cone tips by colour, including those
// on dashed independent-source vectors. The unit cone has its apex at Y=1.
function addArrows(root, THREE, arrows, color, renderOrder) {
    const materialOptions = { color, depthTest: false, depthWrite: false, transparent: true };
    const cones = new THREE.InstancedMesh(
        new THREE.ConeGeometry(1, 1, 16).translate(0, 0.5, 0),
        new THREE.MeshLambertMaterial(materialOptions), arrows.length,
    );
    const positions = [];
    const up = new THREE.Vector3(0, 1, 0), direction = new THREE.Vector3();
    const base = new THREE.Vector3(), neck = new THREE.Vector3(), scale = new THREE.Vector3();
    const rotation = new THREE.Quaternion(), matrix = new THREE.Matrix4();
    const start = new THREE.Vector3(), end = new THREE.Vector3();
    for (const [i, {origin, direction: components, length, dashed}] of arrows.entries()) {
        base.fromArray(origin);
        direction.fromArray(components).normalize();
        const headLength = length * 0.18, radius = length * 0.055;
        neck.copy(base).addScaledVector(direction, length - headLength);
        rotation.setFromUnitVectors(up, direction);
        cones.setMatrixAt(i, matrix.compose(neck, rotation, scale.set(radius, headLength, radius)));
        const segments = dashed ? 6 : 1;
        for (let j = 0; j < segments; j++) {
            start.lerpVectors(base, neck, j / segments);
            end.lerpVectors(base, neck, (j + (dashed ? 0.62 : 1)) / segments);
            positions.push(start.x, start.y, start.z, end.x, end.y, end.z);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const shafts = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial(materialOptions));
    shafts.renderOrder = cones.renderOrder = renderOrder;
    cones.instanceMatrix.needsUpdate = true;
    root.add(shafts, cones);
}

export function createSymmetryAxes(THREE, stage, createLabelTexture) {
    const root = new THREE.Group();
    const primitive = stage.scene.primitives[0];
    if (!primitive) return root;
    const frames = [{matrix: identityMatrix4(), origin: [0, 0, 0], length: stage.axisLength, suffix: ""}];
    const original = primitive.instances.find(i => !i.ls && !i.as && !i.ps && !i.mirrorX && !i.mirrorY);
    if (original) frames.push({
        matrix: original.matrix, origin: applyMatrix4ToPoint(original.matrix, stage.frameOrigin),
        length: stage.axisLength / 2, suffix: "′",
    });
    const colors = ["#ff7777", "#74dc96", "#85b6ff"];
    for (const [axis, color] of colors.entries()) {
        const arrows = [];
        for (const {matrix, origin, length, suffix} of frames) {
            const direction = new THREE.Vector3().fromArray(matrix, axis * 4);
            const label = "XYZ"[axis] + suffix;
            arrows.push({origin, length, direction: direction.toArray()});
            const point = new THREE.Vector3(...origin).addScaledVector(direction, length * 1.13);
            const marks = new THREE.Points(new THREE.BufferGeometry().setFromPoints([point]), new THREE.PointsMaterial({
                map: createLabelTexture(THREE, label, color), size: suffix ? 20 : 23,
                sizeAttenuation: false, transparent: true, depthTest: false, depthWrite: false,
            }));
            marks.name = label;
            marks.renderOrder = 32;
            root.add(marks);
        }
        addArrows(root, THREE, arrows, color, 30);
    }
    return root;
}

export function createSymmetryArrows(THREE, arrows, kind) {
    if (!arrows.length) return null;
    const root = new THREE.Group();
    addArrows(root, THREE, arrows, kind === "current" ? "#ffac70" : "#8bf1c4", 31);
    return root;
}
