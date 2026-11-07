import assert from "node:assert/strict";
import test from "node:test";

import {
    DEFAULT_DISCRETIZATION_LIMITS,
    REGION_SURFACE_SUBDIVISION_LIMIT,
    bilinearRegionPoint,
    buildElementDiscretization,
    buildRegionDiscretization,
    countElementDiscretization,
    countRegionDiscretization,
    normalizeDiscretizationCount,
    normalizeDiscretizationCounts,
    preflightDiscretization,
    tessellateBilinearRegionSurface,
    trilinearElementPoint,
} from "../src/services/visualization/geometryDiscretization.js";

const ELEMENT_VERTICES = [
    [0, 0, 0], [2, 0, 0], [0, 3, 0], [2, 3, 0],
    [0, 0, 4], [2, 0, 4], [0, 3, 4], [2, 3, 4],
];

const WARPED_REGION_VERTICES = [
    [0, 0, 0],
    [2, 0, 0],
    [2, 2, 2],
    [0, 2, 0],
];

function plain(values) {
    return Array.from(values);
}

test("discretization counts accept BaseModel matrix scalars and reject unsafe values", () => {
    assert.equal(normalizeDiscretizationCount([[7]]), 7);
    assert.equal(normalizeDiscretizationCount(new Uint32Array([5])), 5);
    assert.equal(normalizeDiscretizationCount(0), null);
    assert.equal(normalizeDiscretizationCount(1.5), null);
    assert.equal(normalizeDiscretizationCount("3"), null);
    assert.equal(normalizeDiscretizationCount(Number.MAX_SAFE_INTEGER + 1), null);

    assert.deepEqual(
        normalizeDiscretizationCounts([[2], [3], [4]], 3),
        [2, 3, 4],
    );
    assert.deepEqual(
        normalizeDiscretizationCounts(new Uint32Array([2, 3]), 2),
        [2, 3],
    );
    assert.equal(normalizeDiscretizationCounts([[2], [0]], 2), null);
    assert.equal(normalizeDiscretizationCounts([2], 2), null);
});

test("preflight counts element faces and centres without allocating arrays", () => {
    assert.deepEqual(countElementDiscretization([[2], [3], [4]]), {
        lineSegments: 36,
        points: 24,
    });
    assert.deepEqual(countElementDiscretization([2, 3, 4], 5), {
        lineSegments: 180,
        points: 120,
    });
    assert.deepEqual(countElementDiscretization([1, 1, 1]), {
        lineSegments: 12,
        points: 1,
    });
    assert.equal(countElementDiscretization([2, 0, 4]), null);

    const accepted = preflightDiscretization({
        lineSegments: 36,
        points: 24,
    });
    assert.equal(accepted.ok, true);
    assert.equal(accepted.reason, null);
    assert.deepEqual(accepted.limits, DEFAULT_DISCRETIZATION_LIMITS);

    assert.deepEqual(
        preflightDiscretization(
            { lineSegments: 11, points: 3 },
            { lineSegments: 10, points: 3 },
        ).exceeded,
        ["lineSegments"],
    );
    assert.equal(
        preflightDiscretization(countElementDiscretization([
            Number.MAX_SAFE_INTEGER,
            1,
            1,
        ])).reason,
        "invalid-counts",
    );
});

test("trilinear element mapping follows directions 1-2, 1-3 and 1-5", () => {
    assert.deepEqual(
        trilinearElementPoint(ELEMENT_VERTICES, 0.25, 0.5, 0.75),
        [0.5, 1.5, 3],
    );
    assert.deepEqual(
        trilinearElementPoint(new Float64Array(ELEMENT_VERTICES.flat()), 1, 1, 1),
        [2, 3, 4],
    );
    assert.equal(trilinearElementPoint([], 0, 0, 0), null);
});

test("element overlay has 12 main edges, internal lines and D3-fast centre order", () => {
    const result = buildElementDiscretization(
        ELEMENT_VERTICES,
        [[2], [1], [2]],
    );

    assert.equal(result.ok, true);
    assert.deepEqual(result.counts, { lineSegments: 20, points: 4 });
    assert.equal(result.lines.length, 20 * 2 * 3);
    assert.deepEqual(plain(result.lines.slice(0, 12 * 2 * 3)), [
        0, 0, 0, 2, 0, 0,
        0, 0, 4, 2, 0, 4,
        0, 3, 0, 2, 3, 0,
        0, 3, 4, 2, 3, 4,
        0, 0, 0, 0, 3, 0,
        0, 0, 4, 0, 3, 4,
        2, 0, 0, 2, 3, 0,
        2, 0, 4, 2, 3, 4,
        0, 0, 0, 0, 0, 4,
        0, 3, 0, 0, 3, 4,
        2, 0, 0, 2, 0, 4,
        2, 3, 0, 2, 3, 4,
    ]);
    assert.deepEqual(plain(result.points), [
        0.5, 1.5, 1,
        0.5, 1.5, 3,
        1.5, 1.5, 1,
        1.5, 1.5, 3,
    ]);
    assert.deepEqual(result.pointMetadata, [
        { kind: "element-center", d1: 1, d2: 1, d3: 1 },
        { kind: "element-center", d1: 1, d2: 1, d3: 2 },
        { kind: "element-center", d1: 2, d2: 1, d3: 1 },
        { kind: "element-center", d1: 2, d2: 1, d3: 2 },
    ]);

    for (let offset = 12 * 2 * 3; offset < result.lines.length; offset += 6) {
        const start = plain(result.lines.slice(offset, offset + 3));
        const end = plain(result.lines.slice(offset + 3, offset + 6));
        const varyingAxes = start.filter((value, axis) => value !== end[axis]);
        assert.equal(varyingAxes.length, 1);

        // An external cuboid edge has two boundary-valued fixed axes. Every
        // generated line instead has one internal fixed coordinate.
        const internalFixedAxes = start.filter((value, axis) =>
            value === end[axis]
            && value !== 0
            && value !== [2, 3, 4][axis]
        );
        assert.equal(internalFixedAxes.length >= 1, true);
    }
});

test("large valid layers contain every line and centre in solver order", () => {
    const counts = [65_537, 2, 1];
    const grid = buildElementDiscretization(ELEMENT_VERTICES, counts, { includeMetadata: false });
    assert.equal(grid.ok, true);
    assert.equal(grid.lines.length / 6, 262_160);
    assert.equal(grid.points.length / 3, 131_074);
    assert.deepEqual(grid.pointMetadata, []);
    assert.deepEqual(Array.from(grid.points.slice(-3)), trilinearElementPoint(
        ELEMENT_VERTICES, (counts[0] - .5) / counts[0], .75, .5,
    ));
});

test("element line and point layers have independent budgets and allocation", () => {
    const mainEdgesBlocked = buildElementDiscretization(
        ELEMENT_VERTICES,
        [1, 1, 1],
        {
            includePoints: false,
            limits: { lineSegments: 11, points: 0 },
        },
    );
    assert.equal(mainEdgesBlocked.reason, "budget-exceeded");
    assert.deepEqual(mainEdgesBlocked.preflight.exceeded, ["lineSegments"]);

    const linesOnly = buildElementDiscretization(
        ELEMENT_VERTICES,
        [100, 100, 100],
        { includePoints: false },
    );
    assert.equal(linesOnly.ok, true);
    assert.deepEqual(linesOnly.counts, {
        lineSegments: 1_200,
        points: 0,
    });
    assert.equal(linesOnly.lines.length, 1_200 * 6);
    assert.equal(linesOnly.points.length, 0);
    assert.deepEqual(linesOnly.pointMetadata, []);

    const lineBudget = { lineSegments: 20, points: 100 };
    const blocked = buildElementDiscretization(
        ELEMENT_VERTICES,
        [10, 1, 1],
        { limits: lineBudget },
    );
    assert.equal(blocked.reason, "budget-exceeded");
    assert.deepEqual(blocked.preflight.exceeded, ["lineSegments"]);

    const pointsOnly = buildElementDiscretization(
        ELEMENT_VERTICES,
        [10, 1, 1],
        { includeLines: false, limits: lineBudget },
    );
    assert.equal(pointsOnly.ok, true);
    assert.deepEqual(pointsOnly.counts, { lineSegments: 0, points: 10 });
    assert.equal(pointsOnly.lines.length, 0);
    assert.equal(pointsOnly.points.length, 10 * 3);
    assert.equal(pointsOnly.pointMetadata.length, 10);
});

test("bilinear region mapping and node parameters match solver rules", () => {
    assert.deepEqual(
        bilinearRegionPoint(WARPED_REGION_VERTICES, 0.5, 0.5),
        [1, 1, 0.5],
    );
    assert.deepEqual(countRegionDiscretization([3, 1]), {
        lineSegments: 6,
        points: 3,
    });
    assert.deepEqual(countRegionDiscretization([2, 2]), {
        lineSegments: 4,
        points: 4,
    });

    const result = buildRegionDiscretization(
        WARPED_REGION_VERTICES,
        [[3], [1]],
    );
    assert.equal(result.ok, true);
    assert.deepEqual(result.counts, { lineSegments: 6, points: 3 });
    assert.deepEqual(plain(result.lines), [
        0, 0, 0,
        2, 0, 0,
        0, 2, 0,
        2, 2, 2,
        0, 0, 0,
        0, 2, 0,
        2, 0, 0,
        2, 2, 2,
        1, 0, 0,
        1, 2, 1,
        0, 1, 0,
        2, 1, 1,
    ]);
    assert.deepEqual(plain(result.points), [
        0, 1, 0,
        1, 1, 0.5,
        2, 1, 1,
    ]);
    assert.deepEqual(result.pointMetadata, [
        { kind: "region-node", d1: 1, d2: 1 },
        { kind: "region-node", d1: 2, d2: 1 },
        { kind: "region-node", d1: 3, d2: 1 },
    ]);

    const boundaryOnly = buildRegionDiscretization(
        WARPED_REGION_VERTICES,
        [2, 2],
    );
    assert.deepEqual(boundaryOnly.counts, { lineSegments: 4, points: 4 });
    assert.deepEqual(plain(boundaryOnly.lines), [
        0, 0, 0,
        2, 0, 0,
        0, 2, 0,
        2, 2, 2,
        0, 0, 0,
        0, 2, 0,
        2, 0, 0,
        2, 2, 2,
    ]);
    assert.deepEqual(plain(boundaryOnly.points), [
        0, 0, 0,
        0, 2, 0,
        2, 0, 0,
        2, 2, 2,
    ]);

    const boundariesBlocked = buildRegionDiscretization(
        WARPED_REGION_VERTICES,
        [2, 2],
        {
            includePoints: false,
            limits: { lineSegments: 3, points: 0 },
        },
    );
    assert.equal(boundariesBlocked.reason, "budget-exceeded");
    assert.deepEqual(boundariesBlocked.preflight.exceeded, ["lineSegments"]);
});

test("region-line ignores collapsed D1 and returns unique D2 nodes", () => {
    assert.deepEqual(
        countRegionDiscretization([99, 3], {
            isLine: true,
            instanceCount: 2,
        }),
        { lineSegments: 0, points: 6 },
    );

    const result = buildRegionDiscretization(
        [[1, 2, 3], [7, 8, 9]],
        [99, 3],
        true,
    );
    assert.equal(result.ok, true);
    assert.equal(result.lines.length, 0);
    assert.deepEqual(plain(result.points), [
        1, 2, 3,
        4, 5, 6,
        7, 8, 9,
    ]);
    assert.deepEqual(result.pointMetadata, [
        { kind: "region-node", d2: 1 },
        { kind: "region-node", d2: 2 },
        { kind: "region-node", d2: 3 },
    ]);
});

test("bilinear surface tessellation is fixed-quality and axis-capped", () => {
    const surface = tessellateBilinearRegionSurface(WARPED_REGION_VERTICES);

    assert.equal(REGION_SURFACE_SUBDIVISION_LIMIT, 4);
    assert.equal(surface.vertices.length, 25 * 3);
    assert.equal(surface.indices.length, 4 * 4 * 6);
    assert.deepEqual(plain(surface.vertices.slice(36, 39)), [1, 1, 0.5]);
    assert.deepEqual(plain(surface.indices.slice(0, 6)), [0, 5, 6, 0, 6, 1]);
    assert.deepEqual(plain(surface.vertices.slice(-3)), [2, 2, 2]);

    const capped = tessellateBilinearRegionSurface(
        WARPED_REGION_VERTICES,
        [99, 2],
    );
    assert.equal(capped.vertices.length, (4 + 1) * (2 + 1) * 3);
    assert.equal(capped.indices.length, 4 * 2 * 6);
    assert.equal(capped.indices instanceof Uint32Array, true);
});
