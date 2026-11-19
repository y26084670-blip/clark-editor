import assert from "node:assert/strict";
import test from "node:test";

import {
    HTS_LAYOUT_LIMITS,
    resizedDetailRatio,
    resizedLowerHeight,
} from "../src/services/materials/materialLibraryLayout.js";

test("horizontal material splitter keeps both regions usable", () => {
    assert.equal(resizedLowerHeight({
        startHeight: 300,
        deltaY: -80,
        availableHeight: 700,
    }), 380);
    assert.equal(resizedLowerHeight({
        startHeight: 300,
        deltaY: 500,
        availableHeight: 700,
    }), 180);
    assert.equal(resizedLowerHeight({
        startHeight: 300,
        deltaY: -500,
        availableHeight: 700,
    }), 514);
});

test("HTS splitter reserves space for three adjacent graphs", () => {
    const limits = HTS_LAYOUT_LIMITS;
    assert.equal(resizedDetailRatio({ pointerX: 400, containerLeft: 0,
        containerWidth: 1206, limits }), 1 / 3);
    assert.equal(resizedDetailRatio({ pointerX: 1200, containerLeft: 0,
        containerWidth: 1206, limits }), (1200 - 630) / 1200);
});

test("vertical material splitter preserves detail and graph minimum widths", () => {
    assert.equal(resizedDetailRatio({
        pointerX: 500,
        containerLeft: 100,
        containerWidth: 806,
    }), 0.5);
    assert.equal(resizedDetailRatio({
        pointerX: 100,
        containerLeft: 100,
        containerWidth: 806,
    }), 0.35);
    assert.equal(resizedDetailRatio({
        pointerX: 906,
        containerLeft: 100,
        containerWidth: 806,
    }), 0.65);
});


test("HTS detail table can shrink to a quarter-width layout while retaining three graph columns", () => {
    assert.equal(HTS_LAYOUT_LIMITS.detailWidth, 220);
    assert.equal(resizedDetailRatio({ pointerX: 0, containerLeft: 0, containerWidth: 1206, limits: HTS_LAYOUT_LIMITS }), 220 / 1200);
    assert.equal(resizedDetailRatio({ pointerX: 300, containerLeft: 0, containerWidth: 1206, limits: HTS_LAYOUT_LIMITS }), .25);
});
