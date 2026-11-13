import test from "node:test";
import assert from "node:assert/strict";

import {
    eoCount,
    epCount,
    kvFlags,
    nodeCount,
    symYc,
} from "../src/services/solver/kvDerived.js";

test("symYc reproduces symmetry enable flags and signs", () => {
    assert.deepEqual(symYc(0, 0), [1, 1, 1, 1]);
    assert.deepEqual(symYc(-1, 2), [0, 0, -1, 1]);
});

test("EO count includes independent symmetry images", () => {
    const record = {
        dp: [[2], [3], [1]],
        symLs: 2,
        symAs: 4,
        symPs: 5,
        symKya: 0,
        symKyp: 0,
    };

    assert.equal(eoCount(record), 240);
    assert.equal(eoCount({
        ...record,
        symKya: 1,
        symKyp: -1,
    }), 12);
});

test("EO count also accepts nested solver symmetry fields", () => {
    assert.equal(eoCount({
        dp: [2, 3, 1],
        sym: {
            ls: 2,
            as: 4,
            ps: 5,
            kya: 0,
            kyp: 0,
        },
    }), 240);
});

test("material flags follow element purpose", () => {
    assert.deepEqual(
        kvFlags({
            targ: 0,
            rv: 1,
            xapName: "steel",
            vkan: [0, 0, 2],
        }),
        { rv: true, mv: true, ani: true },
    );
    assert.deepEqual(
        kvFlags({ targ: 1, vkan: [0, 0, 0] }),
        { rv: false, mv: true, ani: false },
    );
    assert.deepEqual(
        kvFlags({ targ: 2, vkan: [0, 0, 1] }),
        { rv: true, mv: false, ani: true },
    );
    assert.deepEqual(
        kvFlags({ targ: 3, rv: 1, xapName: "ignored" }),
        { rv: false, mv: false, ani: false },
    );
});

test("EP and table node counts use BaseModel row shape", () => {
    assert.equal(epCount({
        dp: [[3], [4], [9]],
        symLs: 2,
    }), 24);
    assert.equal(nodeCount([[1, 2], [3, 4]]), 2);
    assert.equal(nodeCount(null), 0);
});
