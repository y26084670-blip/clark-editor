import assert from "node:assert/strict";
import test from "node:test";
import { generateSineTimeSeries } from "../src/services/generator/sineTimeFunction.js";

const defaults = { frequency: 1, phase: 0, tau1: 0, tau2: 0, countTimeSteps: 4, timeStep: 0.25 };
const generate = parameters => generateSineTimeSeries({ ...defaults, ...parameters });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} ≠ ${expected}`);

test("sine uses the complete general grid, degrees and zero-envelope branches", () => {
    const { points, expression } = generate({});
    assert.deepEqual(points.map(([t]) => t), [0, 0.25, 0.5, 0.75, 1]);
    points.forEach(([, y], i) => close(y, [0, 1, 0, -1, 0][i]));
    assert.match(expression, /A=1\nB=1/u);
    close(generate({ phase: -90 }).points[0][1], -1);
    close(generate({ phase: 450 }).points[0][1], 1);
});

test("decay and stabilization are independent, including the initial endpoint", () => {
    for (const [tau1, tau2] of [[2, 0], [0, 3], [2, 3]]) {
        const { points } = generate({ phase: 90, tau1, tau2 });
        for (const [t, value] of points) {
            const a = tau1 === 0 ? 1 : Math.exp(-t / tau1);
            const b = tau2 === 0 ? 1 : 1 - Math.exp(-t / tau2);
            close(value, a * b * Math.sin(2 * Math.PI * t + Math.PI / 2));
        }
        close(points[0][1], tau2 === 0 ? 1 : 0);
    }
});

test("zero frequency generates an exponential combination scaled by phase", () => {
    const { points } = generate({ frequency: 0, phase: 30, tau1: 2, tau2: 3 });
    for (const [t, value] of points) {
        close(value, 0.5 * (Math.exp(-t / 2) - Math.exp(-t * (1 / 2 + 1 / 3))));
    }
    assert.ok(generate({ frequency: 0 }).points.every(([, y]) => y === 0));
    assert.ok(generate({ frequency: 0, phase: 90 }).points.every(([, y]) => y === 1));
});

test("numeric strings and a zero-interval grid are supported", () => {
    assert.deepEqual(generate({ frequency: "0", phase: "90", tau1: "0", tau2: "0", countTimeSteps: 0, timeStep: 0 }).points, [[0, 1]]);
});

test("invalid parameters, grids and nonfinite computation fail before publication", () => {
    for (const name of ["frequency", "phase", "tau1", "tau2"]) {
        for (const value of ["", " ", "bad", NaN, Infinity, null, undefined]) {
            assert.throws(() => generate({ [name]: value }), /конечное число/u);
        }
    }
    for (const name of ["frequency", "tau1", "tau2"]) {
        assert.throws(() => generate({ [name]: -1 }), /неотрицательным/u);
    }
    assert.throws(() => generate({ countTimeSteps: 1.5 }), /целым/u);
    assert.throws(() => generate({ timeStep: 0 }), /положительным/u);
    assert.throws(() => generate({ frequency: Number.MAX_VALUE }), /Не удалось вычислить узел/u);
});
