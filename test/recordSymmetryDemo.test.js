import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { applyMatrix4ToPoint } from "../src/services/solver/rotation3d.js";
import { buildGeometryScene } from "../src/services/visualization/geometrySceneModel.js";
import { activeSymmetryStages, snapSymmetryStage, buildRecordSymmetryStage, buildDemoVectors }
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

test("local triads share their true origin, rotate regardless of auto and have half axis length", () => {
    const data = stage(5, { auto: false });
    for (const image of data.scene.primitives[0].instances) {
        near(applyMatrix4ToPoint(image.matrix, data.frameOrigin), [10, 4, 0]);
    }
    const layer = createSymmetryAxes(THREE, data, () => new THREE.Texture());
    const x = layer.children[0].geometry.getAttribute("position");
    const segment = (i, j) => new THREE.Vector3().fromBufferAttribute(x, i)
        .distanceTo(new THREE.Vector3().fromBufferAttribute(x, j));
    // Each solid arrow uses 6 segments and the two local X′ axes coincide.
    assert.equal(x.count, 24);
    assert.ok(Math.abs(segment(0, 11) / segment(12, 23) - 2) < 2e-5);
    assert.ok(layer.children[1].geometry.getAttribute("position").count > x.count);
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
    const strokeCount = a => createSymmetryArrows(THREE, [a], "current").geometry.getAttribute("position").count;
    assert.ok(strokeCount(arrows[2]) > strokeCount(arrows[0]));
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
