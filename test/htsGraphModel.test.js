import assert from "node:assert/strict";
import test from "node:test";
import { htsGraphModel, panGraphRange, zoomGraphRange } from "../src/services/materials/htsGraphModel.js";

const p = Object.freeze({ j_HC0: 2, JC0: 10, JCa: 1, JCb: 1,
    j_type: 1, j_gmin: 2, j1_delta: .1, j2_n: 3,
    m_type: 3, m_HC0: 10, m1_delta: .1, m3_Mmax: 2, m3_a: 1, m3_b: 1 });

test("requested initial ranges and physical knots are represented exactly", () => {
    const jc = htsGraphModel("jc", p);
    const ej = htsGraphModel("ej", p);
    const mh = htsGraphModel("mh", p);
    assert.deepEqual(jc.xRange, [0, 3]);
    assert.deepEqual(ej.xRange, [0, 20]);
    assert.deepEqual(mh.xRange, [-12, 12]);
    assert.ok(jc.datasets[0].data.some(point => point.x === 2 && point.y === 0));
    assert.ok(ej.datasets[0].data.some(point => point.x === 10 && point.y === 5));
    assert.equal(mh.datasets.length, 2);
    const initial = mh.datasets[1].data;
    assert.deepEqual(initial[0], { x: 0, y: 0 });
    assert.ok(Math.abs(initial[1].x - 5 / 3) < 1e-13);
    assert.equal(initial[1].y, -initial[1].x);
    const loop = mh.datasets[0].data;
    assert.ok(loop.some(point => point.x === 0 && point.y === 2));
    assert.ok(loop.some(point => point.x === 0 && point.y === -2));
    assert.deepEqual(loop[0], loop.at(-1));
});

test("cursor changes E using both Jc and the effective field", () => {
    const before = htsGraphModel("ej", p, 0).datasets[0].data;
    const after = htsGraphModel("ej", p, 1).datasets[0].data;
    assert.equal(before.find(point => point.x === 10).y, 5);
    assert.equal(after.find(point => point.x === 5).y, 2.5);
    assert.ok(after.find(point => point.x === 2.5).y > before.find(point => point.x === 2.5).y);
    assert.match(htsGraphModel("ej", p, 2).note, /нулевая ветвь/u);
    assert.ok(htsGraphModel("ej", p, 2).datasets[0].data.every(point => point.y === 0));
});

test("zoom resamples the visible domain without moving the virgin-line endpoint", () => {
    assert.equal(htsGraphModel("jc", p, 0, [0, 6]).datasets[0].data.at(-1).x, 6);
    const mh = htsGraphModel("mh", p, 0, [-24, 24]);
    assert.equal(mh.datasets[0].data[0].x, -24);
    assert.ok(Math.abs(mh.datasets[1].data[1].x - 5 / 3) < 1e-13);
    const noncompact = htsGraphModel("mh", { ...p, m3_b: -1 });
    assert.equal(noncompact.datasets[0].data.filter(point => point.y === null).length, 1);
});

test("per-graph diagnostics do not silently replace unsupported or invalid material laws", () => {
    assert.match(htsGraphModel("mh", { ...p, m_type: 2 }).error, /зарезервирована/u);
    assert.match(htsGraphModel("ej", { ...p, j_gmin: 0 }).error, /j_gmin/u);
    assert.match(htsGraphModel("jc", { ...p, j_HC0: 0 }).error, /j_HC0/u);
    assert.match(htsGraphModel("jc", { ...p, JCa: NaN }).error, /JCa/u);
    assert.match(htsGraphModel("ej", { ...p, j_type: 2, j2_n: 10000 }).error, /числовой диапазон/u);
    assert.ok(htsGraphModel("jc", { ...p, j_gmin: 0 }).datasets);
    assert.ok(htsGraphModel("mh", { ...p, j_gmin: 0 }).datasets);
    assert.equal(htsGraphModel("mh", { ...p, m_type: 1 }).datasets.length, 1);
});

test("zoom and pan keep nonnegative current domains and reject collapsed numeric ranges", () => {
    assert.deepEqual(zoomGraphRange([0, 10], .5), [2.5, 7.5]);
    assert.deepEqual(zoomGraphRange([0, 10], 2, 0, true), [0, 20]);
    assert.deepEqual(zoomGraphRange([-10, 10], .5), [-5, 5]);
    assert.deepEqual(panGraphRange([0, 10], -5, true), [0, 10]);
    assert.deepEqual(panGraphRange([-10, 10], -5), [-15, 5]);
    assert.deepEqual(zoomGraphRange([1, 2], 0), [1, 2]);
    assert.deepEqual(zoomGraphRange([1, 2], Infinity), [1, 2]);
    assert.deepEqual(panGraphRange([1, 2], Infinity), [1, 2]);
});

test("log E preserves positive physical values and hides zeros without an artificial floor", () => {
    const material = { ...p, j_type: 2, j2_n: 24 };
    const linear = htsGraphModel("ej", material, .5);
    const log = htsGraphModel("ej", material, .5, null, true);
    assert.equal(log.logY, true);
    assert.equal(log.datasets[0].data[0].y, null);
    assert.ok(log.yRange[0] > 0 && log.yRange[1] > log.yRange[0]);
    assert.deepEqual(log.datasets[0].data.filter(v => v.y !== null), linear.datasets[0].data.filter(v => v.y > 0));
    assert.match(htsGraphModel("ej", material, 2, null, true).error, /Нет положительных значений E/u);
    assert.ok(htsGraphModel("ej", material, 2).datasets[0].data.every(v => v.y === 0));
    assert.equal(htsGraphModel("jc", material, 0, null, true).logY, false);
    assert.equal(htsGraphModel("mh", material, 0, null, true).logY, false);
});

test("logarithmic zoom and pan operate in decades and reject underflow and overflow", () => {
    const zoom = zoomGraphRange([1e-8, 1e4], .5, 1e-2, false, true);
    assert.ok(Math.abs(Math.log10(zoom[0]) + 5) < 1e-12);
    assert.ok(Math.abs(Math.log10(zoom[1]) - 1) < 1e-12);
    assert.deepEqual(panGraphRange([1e-8, 1e4], 2, false, true), [1e-6, 1e6]);
    assert.deepEqual(panGraphRange([1e-8, 1e4], 400, false, true), [1e-8, 1e4]);
    assert.deepEqual(panGraphRange([1e-8, 1e4], -400, false, true), [1e-8, 1e4]);
    assert.deepEqual(zoomGraphRange([1e-8, 1e4], Infinity, undefined, false, true), [1e-8, 1e4]);
    assert.deepEqual(zoomGraphRange([0, 1], .5, undefined, false, true), [0, 1]);
});
