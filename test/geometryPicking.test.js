import assert from "node:assert/strict";
import test from "node:test";

import {
    findPointMetadataRange,
    findVertexMetadataRange,
    formatDiscretizationPointTooltip,
    formatGeometryTooltip,
    formatSymmetryInstance,
    formatVertexTooltip,
    geometryHitInstance,
    geometryHitFace,
    pointHitMetadata,
    vertexHitMetadata,
} from "../src/services/visualization/geometryPicking.js";

test("geometry tooltip uses one-based source numbers and optional names", () => {
    assert.equal(
        formatGeometryTooltip({
            schemaId: "elements",
            recordIndex: 0,
            name: "KV 1",
        }, null, [1.25, -2, 0]),
        "Элемент №1 — KV 1\nX=1.25; Y=-2; Z=0",
    );
    assert.equal(
        formatGeometryTooltip({
            schemaId: "regions",
            recordIndex: 2,
            name: "   ",
        }),
        "Область №3",
    );
    assert.equal(
        formatGeometryTooltip({
            schemaId: "unknown",
            recordIndex: -1,
            name: 42,
        }),
        "Объект №?",
    );
});

test("vertex tooltip formats element coordinates compactly and stably", () => {
    assert.equal(
        formatVertexTooltip(
            { schemaId: "elements", recordIndex: 1, name: "KV 2" },
            0,
            [1.23456789, -0, 0.000000012345],
        ),
        "Элемент №2 — KV 2, вершина №1\n"
            + "X=1.234568; Y=0; Z=1.2345e-8",
    );
});

test("vertex tooltip supports regions, extreme and invalid coordinates", () => {
    assert.equal(
        formatVertexTooltip(
            { schemaId: "regions", recordIndex: 0 },
            3,
            new Float64Array([1.2e30, -9.87654e-15, Number.NaN]),
        ),
        "Область №1, вершина №4\n"
            + "X=1.2e+30; Y=-9.87654e-15; Z=—",
    );
    assert.equal(
        formatVertexTooltip(
            { schemaId: "elements", recordIndex: 0 },
            Number.NaN,
            [Number.POSITIVE_INFINITY, "12", null],
        ),
        "Элемент №1, вершина №?\nX=—; Y=—; Z=—",
    );
});

test("symmetry labels use compact one-based image numbers", () => {
    assert.equal(formatSymmetryInstance(null), "");
    assert.equal(
        formatSymmetryInstance({
            as: 1,
            ps: 2,
            ls: 3,
            mirrorX: 1,
            mirrorY: 1,
        }),
        "[AS=2 PS=3 LS=4 EX EY]",
    );
    assert.equal(
        formatGeometryTooltip(
            { schemaId: "elements", recordIndex: 1, name: "KV 2" },
            { as: 1, ps: 0, ls: 0, mirrorX: 1, mirrorY: 0 },
            [4, 5, 6],
        ),
        "Элемент №2 — KV 2\n[AS=2 EX] X=4; Y=5; Z=6",
    );
    assert.equal(
        formatVertexTooltip(
            { schemaId: "regions", recordIndex: 0 },
            1,
            [1, 2, 3],
            { ls: 1 },
        ),
        "Область №1, вершина №2\n[LS=2] X=1; Y=2; Z=3",
    );
});

test("geometry hit resolves the accepted symmetry instance by its span", () => {
    const instances = [
        { ls: 0 },
        { ls: 1 },
        { ls: 2 },
    ];
    const mesh = {
        object: { userData: { pick: { instances, kind: "mesh", span: 12 } } },
    };
    assert.equal(geometryHitInstance({ ...mesh, faceIndex: 0 }), instances[0]);
    assert.equal(geometryHitInstance({ ...mesh, faceIndex: 23 }), instances[1]);
    assert.equal(geometryHitInstance({ ...mesh, faceIndex: 24 }), instances[2]);

    const lines = {
        object: { userData: { pick: { instances, kind: "lines", span: 24 } } },
    };
    assert.equal(geometryHitInstance({ ...lines, index: 46 }), instances[1]);
    assert.equal(geometryHitInstance({ ...lines, index: 48 }), instances[2]);
    assert.equal(geometryHitInstance({ ...lines, index: 72 }), null);
    assert.equal(geometryHitInstance({ object: {} }), null);
});

test("vertex metadata resolves both image and source vertex", () => {
    const instances = [{ as: 0 }, { as: 1 }];
    const range = {
        start: 20,
        end: 36,
        sourceVertexCount: 8,
        instances,
    };

    assert.deepEqual(vertexHitMetadata(range, 20), {
        instance: instances[0],
        vertexIndex: 0,
    });
    assert.deepEqual(vertexHitMetadata(range, 35), {
        instance: instances[1],
        vertexIndex: 7,
    });
    assert.equal(vertexHitMetadata(range, 36), null);
    assert.equal(vertexHitMetadata(null, 20), null);
});

test("element point metadata resolves instances and D3-fastest cell indices", () => {
    const instances = [{ as: 0 }, { as: 1 }];
    const range = {
        start: 10,
        end: 34,
        sourcePointCount: 12,
        instances,
        grid: { kind: "element-cells", counts: [2, 2, 3] },
    };

    assert.deepEqual(pointHitMetadata(range, 10), {
        instance: instances[0],
        pointIndex: 0,
        gridKind: "element-cells",
        d1Index: 0,
        d2Index: 0,
        d3Index: 0,
    });
    assert.deepEqual(pointHitMetadata(range, 21), {
        instance: instances[0],
        pointIndex: 11,
        gridKind: "element-cells",
        d1Index: 1,
        d2Index: 1,
        d3Index: 2,
    });
    assert.deepEqual(pointHitMetadata(range, 27), {
        instance: instances[1],
        pointIndex: 5,
        gridKind: "element-cells",
        d1Index: 0,
        d2Index: 1,
        d3Index: 2,
    });
    assert.equal(pointHitMetadata(range, 34), null);
});

test("region point metadata uses D2-fastest ordering", () => {
    const instance = { ls: 0 };
    const range = {
        start: 4,
        end: 10,
        sourcePointCount: 6,
        instances: [instance],
        grid: { kind: "region-grid", counts: new Uint16Array([2, 3]) },
    };

    assert.deepEqual(pointHitMetadata(range, 8), {
        instance,
        pointIndex: 4,
        gridKind: "region-grid",
        d1Index: 1,
        d2Index: 1,
    });
});

test("line region point metadata keeps unique D2 nodes and collapsed D1 range", () => {
    const instances = [{ ps: 0 }, { ps: 1 }];
    const range = {
        start: 6,
        end: 12,
        sourcePointCount: 3,
        instances,
        grid: { kind: "region-line", counts: [4, 3] },
    };

    assert.deepEqual(pointHitMetadata(range, 11), {
        instance: instances[1],
        pointIndex: 2,
        gridKind: "region-line",
        d2Index: 2,
        collapsedD1Count: 4,
    });
});

test("point metadata rejects inconsistent grids and ranges", () => {
    const base = {
        start: 0,
        end: 6,
        sourcePointCount: 6,
        instances: [{}],
    };

    assert.equal(pointHitMetadata(null, 0), null);
    assert.equal(pointHitMetadata(base, 0), null);
    assert.equal(pointHitMetadata({
        ...base,
        grid: { kind: "element-cells", counts: [2, 2, 2] },
    }, 0), null);
    assert.equal(pointHitMetadata({
        ...base,
        grid: { kind: "region-grid", counts: [2, 0] },
    }, 0), null);
    assert.equal(pointHitMetadata({
        ...base,
        grid: { kind: "region-line", counts: [2, 5] },
    }, 0), null);
});

test("discretization point tooltip formats element centers and symmetry", () => {
    assert.equal(
        formatDiscretizationPointTooltip(
            { schemaId: "elements", recordIndex: 3 },
            {
                instance: { as: 1, mirrorX: 1 },
                pointIndex: 8,
                gridKind: "element-cells",
                d1Index: 1,
                d2Index: 0,
                d3Index: 2,
            },
            new Float64Array([1.23456789, -0, 0.000000012345]),
        ),
        "Элемент №4, центр ЭО (D1=2; D2=1; D3=3)\n[AS=2 EX] "
            + "X=1.234568; Y=0; Z=1.2345e-8",
    );
});

test("discretization point tooltip formats region and line nodes", () => {
    assert.equal(
        formatDiscretizationPointTooltip(
            { schemaId: "regions", recordIndex: 1 },
            {
                instance: { ls: 1 },
                pointIndex: 2,
                gridKind: "region-line",
                d2Index: 2,
                collapsedD1Count: 4,
            },
            new Float64Array([1, 2, 3]),
        ),
        "Область №2, узел (D1=1…4; D2=3)\n[LS=2] X=1; Y=2; Z=3",
    );
    assert.equal(
        formatDiscretizationPointTooltip(
            { schemaId: "regions", recordIndex: 0 },
            {
                instance: {},
                pointIndex: 0,
                gridKind: "region-line",
                d2Index: 0,
                collapsedD1Count: 1,
            },
            [Number.NaN, Number.POSITIVE_INFINITY, -9.87654e-15],
        ),
        "Область №1, узел (D1=1; D2=1)\nX=—; Y=—; Z=-9.87654e-15",
    );
});

test("metadata range lookup uses half-open boundaries", () => {
    const ranges = [
        { start: 0, end: 8, source: "first" },
        { start: 8, end: 12, source: "second" },
        { start: 20, end: 24, source: "third" },
    ];

    assert.equal(findVertexMetadataRange(ranges, 0), ranges[0]);
    assert.equal(findVertexMetadataRange(ranges, 7), ranges[0]);
    assert.equal(findVertexMetadataRange(ranges, 8), ranges[1]);
    assert.equal(findVertexMetadataRange(ranges, 11), ranges[1]);
    assert.equal(findVertexMetadataRange(ranges, 12), null);
    assert.equal(findVertexMetadataRange(ranges, 19), null);
    assert.equal(findVertexMetadataRange(ranges, 20), ranges[2]);
    assert.equal(findVertexMetadataRange(ranges, 24), null);
    assert.equal(findPointMetadataRange(ranges, 8), ranges[1]);
});

test("metadata range lookup rejects invalid input", () => {
    assert.equal(findVertexMetadataRange([], 0), null);
    assert.equal(findVertexMetadataRange(null, 0), null);
    assert.equal(findVertexMetadataRange([], -1), null);
    assert.equal(findVertexMetadataRange([], 1.5), null);
    assert.equal(
        findVertexMetadataRange([{ start: 4, end: 4 }], 4),
        null,
    );
});


test("face tooltip is optional and only applies to element surfaces", () => {
    const element = { schemaId: "elements", recordIndex: 0 };
    assert.equal(formatGeometryTooltip(element, null, null, 6), "Элемент №1, грань №6");
    assert.equal(formatGeometryTooltip(element, null, null), "Элемент №1");
    assert.equal(formatGeometryTooltip({ ...element, schemaId: "regions" }, null, null, 6), "Область №1");
});

test("face lookup resolves triangle metadata across symmetry batches without assigning faces to lines or invalid hits", () => {
    const pick = { kind: "mesh", span: 12, triangleFaces: [5,5,6,6,1,1,2,2,3,3,4,4], instances: [{ ls: 0 }, { ls: 1, mirrorX: 1 }] };
    const object = { userData: { source: { schemaId: "elements" }, pick } };
    for (let i = 0; i < 24; i++) assert.equal(geometryHitFace({ object, faceIndex: i }), pick.triangleFaces[i % 12]);
    for (const faceIndex of [-1, 0.5, 24, undefined]) assert.equal(geometryHitFace({ object, faceIndex }), null);
    pick.kind = "lines"; assert.equal(geometryHitFace({ object, faceIndex: 0, index: 0 }), null);
});
