import assert from "node:assert/strict";
import test from "node:test";
import { electricFieldNumber, graphNumber, htsGraphFormula, htsGraphModel, htsMagneticStep, htsMagneticTrace, panGraphRange, zoomGraphRange } from "../src/services/materials/htsGraphModel.js";

import { htsElectricField } from "../src/services/solver/htsMaterialLaw.js";

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


test("log E(J) samples physical positive values over decades and preserves the n+1 power slope", () => {
    for (const j_type of [1, 2]) {
        const record = { ...p, j_type };
        const graph = htsGraphModel("ej", record, 1, null, { logarithmic: true });
        assert.equal(graph.error, undefined);
        assert.ok(graph.xRange[0] > 0);
        const points = graph.datasets[0].data;
        assert.ok(points.length >= 400 && points.every(point => point.x > 0 && point.y > 0));
        assert.ok(points.some(point => point.x === 5 && point.y === 2.5));
        for (const point of points) assert.equal(point.y, htsElectricField(record, point.x, 1));
        if (j_type === 2) {
            const a = points[50], b = points[250];
            const slope = Math.log(b.y / a.y) / Math.log(b.x / a.x);
            assert.ok(Math.abs(slope - (p.j2_n + 1)) < 1e-12);
        }
    }
    assert.equal(htsGraphModel("ej", p).xRange[0], 0);
});

test("logarithmic axes report a zero branch and omit underflow zeros without fabricated positive values", () => {
    assert.match(htsGraphModel("ej", p, 2, null, { logarithmic: true }).error, /Jc = 0/);
    const record = { ...p, j_type: 2, j2_n: 80 };
    const graph = htsGraphModel("ej", record, 0, null, { logarithmic: true });
    assert.equal(graph.error, undefined);
    assert.ok(graph.datasets[0].data.every(point => point.y > 0 && point.y === htsElectricField(record, point.x, 0)));
    assert.match(graph.note, /только J > 0 и E > 0/);
    assert.match(htsGraphModel("ej", p, 0, [0, 1], { logarithmic: true }).error, /J > 0/);
});

test("log zoom and pan work in decades and keep both axis limits finite and positive", () => {
    const zoom = zoomGraphRange([1, 100], .5, undefined, false, true);
    assert.ok(Math.abs(zoom[0] - Math.sqrt(10)) < 1e-12);
    assert.ok(Math.abs(zoom[1] - Math.sqrt(1000)) < 1e-12);
    assert.deepEqual(panGraphRange([1, 100], 1, false, true), [10, 1000]);
    assert.deepEqual(panGraphRange([1, 100], -1, false, true), [.1, 10]);
    assert.deepEqual(zoomGraphRange([0, 100], .5, undefined, false, true), [0, 100]);
    assert.deepEqual(panGraphRange([1, 100], 1000, false, true), [1, 100]);
});

test("formula help follows the active electrical and magnetic models", () => {
    assert.match(htsGraphFormula("jc", p).lines.join(" "), /JC0.*JCa.*JCb/);
    const tanh = htsGraphFormula("ej", p);
    assert.match(tanh.title, /j_type = 1/);
    assert.match(tanh.lines.join(" "), /j1_delta/);
    const power = htsGraphFormula("ej", { ...p, j_type: 2 });
    assert.match(power.title, /j_type = 2/);
    assert.match(power.lines.join(" "), /j2_n \+ 1/);
    assert.doesNotMatch(power.lines.join(" "), /j1_delta/);
    assert.match(htsGraphFormula("mh", p).lines.join(" "), /m3_Mmax.*m3_a.*m3_b/);
    assert.match(htsGraphFormula("mh", { ...p, m_type: 1 }).lines.join(" "), /m1_delta/);
    assert.doesNotMatch(htsGraphFormula("mh", { ...p, m_type: 1 }).lines.join(" "), /m3_Mmax/);
    assert.match(htsGraphFormula("mh", { ...p, m_type: 2 }).lines.join(" "), /зарезервирована/);
});


test("magnetic slider steps retain hysteresis memory and reset from an independent zero state", () => {
    let point = Object.freeze({ x: 0, y: 0 });
    const points = [point];
    for (const [H, M] of [[4, -1.2], [3, -.2], [0, 2]]) {
        point = htsMagneticStep(p, H, point);
        assert.ok(Math.abs(point.y - M) < 1e-12);
        points.push(point);
    }
    assert.deepEqual(points[0], { x: 0, y: 0 });
    assert.equal(htsMagneticStep(p, 0).y, 0, "clearing discards remanent magnetization");
    const trace = htsMagneticTrace(points);
    assert.equal(trace.data, points);
    assert.equal(trace.label, "Траектория");
    assert.equal(trace.pointRadius({ dataIndex: points.length - 1 }), 3);
    assert.equal(trace.pointRadius({ dataIndex: 0 }), 0);
});

test("memoryless magnetic model ignores history and invalid magnetic steps leave the previous state intact", () => {
    const record = { ...p, m_type: 1 }, previous = Object.freeze({ x: 5, y: 99 });
    assert.equal(htsMagneticStep(record, 3, previous).y, htsMagneticStep(record, 3).y);
    assert.equal(htsMagneticStep(record, 0, previous).y, 0);
    assert.throws(() => htsMagneticStep({ ...p, m_type: 2 }, 1, previous), /зарезервирована/);
    assert.throws(() => htsMagneticStep(p, Infinity, previous), /конечными/);
    assert.deepEqual(previous, { x: 5, y: 99 });
});

test("electric field labels use compact scientific notation at very large and small magnitudes", () => {
    for (const value of [1e250, -1e250, 1e-250, -1e-250]) {
        const label = electricFieldNumber(value);
        assert.ok(label.length < 20 && label.includes("E") && label.includes("250"), label);
    }
    assert.equal(electricFieldNumber(0), graphNumber(0));
    assert.equal(electricFieldNumber(42.5), graphNumber(42.5));
    assert.equal(electricFieldNumber(Infinity), "—");
});


test("formula help substitutes max expressions directly without auxiliary U or u definitions", () => {
    for (const record of [p, { ...p, j_type: 1, m_type: 1 }, { ...p, j_type: 2 }]) {
        for (const kind of ["jc", "ej", "mh"]) {
            const text = htsGraphFormula(kind, record).lines.join(" ");
            assert.doesNotMatch(text, /\bU\(|\bu\s*=/);
            assert.match(text, /max\(0, 1 − \|x\|\^a\)/);
            assert.match(text, /b < 0/);
            assert.match(text, /b = 0/);
        }
    }
});
