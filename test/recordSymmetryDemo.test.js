import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { applyMatrix4ToPoint } from "../src/services/solver/rotation3d.js";
import { buildGeometryScene } from "../src/services/visualization/geometrySceneModel.js";
import { activeSymmetryStages, snapSymmetryStage, buildRecordSymmetryStage, buildDemoVectors, demoImageNumber }
    from "../src/services/visualization/recordSymmetryDemo.js";
import { createSymmetryAxes, createSymmetryArrows } from "../src/components/geometry/SymmetryDemoLayer.js";

const settings = { mirrorSymmetryY: 0, mirrorSymmetryX: 1 };
const vec = (...v) => v.map(x => [x]);
const hex = {
    geoType: 2, geo: [[2, 3, 4]], dp: vec(1, 1, 1), dr: vec(0, 2, 0),
    symVi: vec(0, 0, 90), symR0: vec(10, 4, 0), auto: true,
    symLs: 2, symYl: 90, symAs: 2, symYa: 180, symPs: 2, symTx: 5,
    symKya: -1, symKyp: -1,
};
const stage = (n, changes = {}) => buildRecordSymmetryStage({ ...hex, ...changes }, settings, [], true, n);
function near(actual, expected) {
    assert.equal(actual.length, expected.length);
    actual.forEach((x, i) => assert.ok(Math.abs(x - expected[i]) < 1e-10, actual + " vs " + expected));
}

test("fixed positions skip absent symmetries in either direction, independently per tab", () => {
    const one = { ...hex, symLs: 1, symAs: 1, symKyp: 0 };
    const stages = activeSymmetryStages(one, { mirrorSymmetryX: 0 }, true);
    assert.deepEqual(stages, [1, 2, 4, 5, 7, 9]);
    assert.equal(snapSymmetryStage(stages, 6, true), 7);
    assert.equal(snapSymmetryStage(stages, 6, false), 5);
    assert.equal(snapSymmetryStage(stages, 8, false), 7);
    assert.deepEqual(activeSymmetryStages(hex, settings, false), [1, 2, 3, 4, 5]);
    assert.deepEqual(activeSymmetryStages(null, settings, true), []);
});

test("all nine cumulative stages follow solver coordinates, retaining the original record", () => {
    const before = structuredClone(hex);
    const expected = [
        [0, 1, 0], [0, 3, 0], [0, 0, 3], [0, 0, 3], [10, 4, 3],
        [10, -4, -3], [15, -4, -3], [15, 4, -3], [-15, 4, -3],
    ];
    const counts = [1, 1, 2, 2, 2, 4, 8, 16, 32];
    expected.forEach((point, i) => {
        const instances = stage(i + 1).scene.primitives[0].instances;
        assert.equal(instances.length, counts[i]);
        near(applyMatrix4ToPoint(instances.at(-1).matrix, [0, 1, 0]), point);
    });
    assert.deepEqual(stage(9).scene.primitives[0].instances.map(({ demoCategory, ...image }) => image),
        buildGeometryScene({ elements: [hex], general: settings }).primitives[0].instances);
    assert.deepEqual(before, hex);
});

function coneTip(mesh, i) {
    const matrix = new THREE.Matrix4();
    mesh.getMatrixAt(i, matrix);
    return new THREE.Vector3(0, 1, 0).applyMatrix4(matrix);
}

test("only the visible original has local axes, with the placed origin and half-length cones", () => {
    const data = stage(9, { auto: false });
    const layer = createSymmetryAxes(THREE, data, () => new THREE.Texture());
    const shafts = layer.children.filter(c => c.isLineSegments);
    const heads = layer.children.filter(c => c.isInstancedMesh);
    assert.equal(shafts.length, 3);
    assert.equal(heads.length, 3);
    assert.deepEqual(layer.children.filter(c => c.isPoints).map(c => c.name), ["X","X′","Y","Y′","Z","Z′"]);
    for (let i = 0; i < 3; i++) {
        const positions = shafts[i].geometry.getAttribute("position");
        assert.equal(positions.count, 4); // one thin shaft per axis in each frame
        assert.equal(shafts[i].material.linewidth, 1);
        assert.equal(heads[i].geometry.type, "ConeGeometry");
        assert.equal(heads[i].count, 2);
        const origin = new THREE.Vector3().fromBufferAttribute(positions, 2);
        near(origin.toArray(), [10, 4, 0]);
        assert.ok(Math.abs(coneTip(heads[i], 0).length() / coneTip(heads[i], 1).distanceTo(origin) - 2) < 1e-5);
    }
    const copy = buildRecordSymmetryStage(hex, settings, [], true, 9, 0, {ls: {all:false, number:2}});
    const onlyGlobal = createSymmetryAxes(THREE, copy, () => new THREE.Texture());
    assert.deepEqual(onlyGlobal.children.filter(c => c.isPoints).map(c => c.name), ["X","Y","Z"]);
    assert.ok(onlyGlobal.children.filter(c => c.isInstancedMesh).every(c => c.count === 1));
});

test("one-based selectors compose across stages, keep real transforms, signs and independent arrows", () => {
    const record = { ...hex, symAs: 4, symKya: 0, symPs: 3 };
    const before = structuredClone(record);
    const choices = { ls:{all:false, number:2}, as:{all:false, number:3}, ps:{all:true, number:3} };
    const project = (n, choices) => buildRecordSymmetryStage(record, settings, [], true, n, 0, choices);
    for (const n of [2,3,4,5,6,7,8,9]) {
        const full = project(n, {}), part = project(n, choices);
        const matches = i => (n < 3 || i.ls === 1) && (n < 6 || i.as === 2);
        const all = full.scene.primitives[0].instances;
        assert.deepEqual(part.scene.primitives[0].instances, all.filter(matches));
        assert.equal(part.scene.counts.instances, all.filter(matches).length);
        const arrows = s => buildDemoVectors(s, [2,3,5], 40, "current");
        assert.deepEqual(arrows(part), arrows(full).filter((_, i) => matches(all[i])));
    }
    const single = project(7, { ...choices, ps:{all:false, number:2} }).scene;
    const [image] = single.primitives[0].instances;
    assert.deepEqual([image.ls,image.as,image.ps], [1,2,1]);
    assert.equal(single.counts.instances, 1);
    assert.deepEqual(record, before);
    assert.equal(demoImageNumber(8, 2), 2);
    assert.equal(demoImageNumber(-3, 4), 1);
    assert.equal(demoImageNumber(undefined, 4), 1);
});

test("large single-image requests do not expand the full product and region selection uses LS only", () => {
    const count = 1000000, pick = {all:false, number:count};
    const data = buildRecordSymmetryStage({...hex, symLs:count, symAs:count, symPs:count},
        settings, [], true, 7, 0, {ls:pick, as:pick, ps:pick});
    assert.equal(data.scene.counts.instances, 1);
    const image = data.scene.primitives[0].instances[0];
    assert.deepEqual([image.ls,image.as,image.ps], [count-1,count-1,count-1]);
    const region = {...hex, dp:vec(2, 1), geo:[[0,0,0],[1,2,3]], symLs:6};
    const projected = buildRecordSymmetryStage(region, settings, [], false, 5, 0, {ls:pick, as:pick, ps:pick});
    assert.equal(projected.scene.counts.instances, 1);
    assert.equal(projected.scene.primitives[0].instances[0].ls, 5);
});

test("M/J mirror parity, field parity, local auto and zero slider are independent", () => {
    const v = [0, 1, 0];
    const directions = (n, kind, overrides = {}) =>
        buildDemoVectors(stage(n, overrides), v, 50, kind);
    near(directions(3, "current").at(-1).direction, [0, 0, 1]);
    near(directions(3, "current", { auto: false }).at(-1).direction, v);
    near(directions(4, "current", { auto: false }).at(-1).direction, [-1, 0, 0]);
    const sixth = directions(6, "current"), seventh = directions(7, "current");
    near(sixth[1].direction, [1, 0, 0]);
    near(seventh[3].direction, [-1, 0, 0]);
    const m = directions(9, "magnetization"), j = directions(9, "current");
    near(j[1].direction, m[1].direction.map(x => -x));
    near(j[2].direction, m[2].direction.map(x => -x));
    near(j[3].direction, m[3].direction);
    assert.equal(buildDemoVectors(stage(9), v, 0, "current").length, 0);
    assert.equal(buildDemoVectors(stage(9), [0, 0, 0], 50, "current").length, 0);
});

test("independent example arrows are dashed, stable and propagate to dependent copies", () => {
    const seventh = stage(7, { symKya: 0 });
    const sample = frame => buildDemoVectors(frame, [1, -2, 3], 70, "current");
    const arrows = sample(seventh);
    assert.equal(arrows[0].dashed, false);
    assert.equal(arrows[2].dashed, true);
    near(arrows[3].direction, arrows[2].direction.map(x => -x));
    assert.deepEqual(sample(stage(6, { symKya: 0 }))[1].direction, arrows[2].direction);
    near(sample(stage(9, { symKya: 0 }))[8].direction, arrows[2].direction);
    const drawn = createSymmetryArrows(THREE, [arrows[0], arrows[2]], "current");
    const [shafts, cones] = drawn.children;
    assert.equal(shafts.geometry.getAttribute("position").count, 2 + 6*2);
    assert.equal(shafts.material.linewidth, 1);
    assert.equal(cones.geometry.type, "ConeGeometry");
    assert.equal(cones.count, 2);
    for (const [i, arrow] of [arrows[0], arrows[2]].entries()) {
        const expected = new THREE.Vector3(...arrow.origin).addScaledVector(new THREE.Vector3(...arrow.direction), arrow.length);
        assert.ok(coneTip(cones, i).distanceTo(expected) < 2e-5);
    }
    assert.equal(arrows[0].length, arrows[2].length);
});

test("regions use local images only and apply a trajectory at fixed t=0", () => {
    const record = { ...hex, geo: [[0, 0, 0], [1, 2, 3]], dp: vec(3, 1), indMove: 1 };
    const moves = [{ angle: [[0, 0, 0, 0], [1, 0, 0, 90]], position: [[0, 1, 2, 3], [1, 10, 20, 30]] }];
    const data = buildRecordSymmetryStage(record, settings, moves, false, 5);
    assert.equal(data.scene.primitives[0].instances.length, 2);
    assert.deepEqual(data.record.symR0, vec(11, 6, 3));
    assert.equal(buildDemoVectors(data, [1, 0, 0], 50, "current").length, 0);
});
