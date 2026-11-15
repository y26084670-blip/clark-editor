import assert from "node:assert/strict";
import test from "node:test";
import {
    htsShape, htsCriticalCurrent, htsResistivity, htsElectricField,
    htsMagneticEnvelope, htsMagneticValue, htsInitialContact,
} from "../src/services/solver/htsMaterialLaw.js";

const p = Object.freeze({
    j_HC0: 2, JC0: 10, JCa: 1, JCb: 1,
    j_type: 1, j_gmin: 2, j1_delta: .1, j2_n: 3,
    m_type: 3, m_HC0: 10, m1_delta: .1, m3_Mmax: 2, m3_a: 1, m3_b: 1,
});
function close(actual, expected, tolerance = 2e-13) {
    assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
}

test("critical-current shape: compact, noncompact and solver fast paths", () => {
    close(htsShape(.5, 2, 1), .75);
    close(htsShape(-.5, 1, 10), 1 / 1024);
    close(htsShape(2, 2, -1), .2);
    close(htsShape(.5, 1, 0), 1);
    close(htsShape(2, 1, 0), 1);
    assert.equal(htsShape(1, 1, 2), 0);
    assert.equal(htsShape(2, 1, 2), 0);
    assert.equal(htsCriticalCurrent(p, 0), 10);
    assert.equal(htsCriticalCurrent(p, 1), 5);
    assert.equal(htsCriticalCurrent(p, 2), 0);
    assert.equal(htsCriticalCurrent(p, 3), 0);
});

test("tanh resistivity uses effective field independently of the J/Jc ratio", () => {
    // 2/(1+exp(u/delta)) = 1-tanh(u/(2delta)).
    close(htsResistivity(p, 5, 0), (1 - Math.tanh(2.5)) / 2);
    close(htsResistivity(p, 2.5, 1), (1 - Math.tanh(1.25)) / 2);
    assert.ok(htsResistivity(p, 2.5, 1) > htsResistivity(p, 5, 0));
    assert.equal(htsElectricField(p, 0, 0), 0);
    assert.equal(htsElectricField(p, 10, 0), 5);
    assert.equal(htsElectricField(p, 20, 0), 10);
    // The library units A/mm² and MS/m give V/m directly.
    assert.equal(htsElectricField({ ...p, j_gmin: .01 }, 10, 0), 1000);
});

test("power law has E exponent n+1 and retains the explicit zero-Jc branch", () => {
    const power = { ...p, j_type: 2 };
    close(htsElectricField(power, 5, 0), .3125);
    close(htsElectricField(power, 10, 0), 5);
    close(htsElectricField(power, 20, 0), 80);
    for (const type of [1, 2]) {
        assert.equal(htsElectricField({ ...p, j_type: type }, 20, 2), 0);
        assert.equal(htsElectricField({ ...p, j_type: type, JC0: 0 }, 20, 0), 0);
    }
});

test("virgin line ends at the actual envelope intersection, independent of plot sampling", () => {
    const contact = htsInitialContact(p);
    close(contact, 5 / 3);
    close(htsMagneticEnvelope(p, contact), contact);
    close(htsMagneticValue(p, 1), -1);
    close(htsMagneticValue(p, 4), -1.2);
    close(htsMagneticValue(p, 5, 4, -1.2), -1);
    close(htsMagneticValue(p, 3, 4, -1.2), -.2);
    assert.equal(htsMagneticEnvelope(p, 12), 0);
    assert.equal(htsInitialContact({ ...p, m3_Mmax: 0 }), 0);
    close(htsInitialContact({ ...p, m3_b: 0 }), 2);
});

test("noncompact magnetic envelope and memoryless tanh retain signed symmetry", () => {
    close(htsMagneticEnvelope({ ...p, m3_b: -1 }, 10), 1);
    close(htsInitialContact({ ...p, m3_b: -1 }), (-10 + Math.sqrt(180)) / 2);
    const tanh = { ...p, m_type: 1 };
    close(htsMagneticValue(tanh, 5), -5 * Math.tanh(2.5));
    close(htsMagneticValue(tanh, -5), 5 * Math.tanh(2.5));
    assert.equal(htsMagneticValue(tanh, 12), 0);
    assert.equal(htsMagneticValue({ ...p, m_type: 2 }, 5), 0);
});
