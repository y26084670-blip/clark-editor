import assert from "node:assert/strict";
import test from "node:test";

import { buildGeometryScene }
    from "../src/services/visualization/geometrySceneModel.js";
import { GEOMETRY_MATERIAL_KINDS }
    from "../src/services/visualization/geometryMaterialStyle.js";

import { buildSourceVectorScene } from "../src/services/visualization/sourceVectorSceneModel.js";

function vector(values) {
    return values.map(value => [value]);
}

function geometryRows(values, rowCount) {
    const flat = [
        ...values,
        ...new Array(rowCount * 3 - values.length).fill(0),
    ];

    return Array.from(
        { length: rowCount },
        (_, index) => flat.slice(index * 3, index * 3 + 3),
    );
}

function element(overrides = {}) {
    return {
        name: "KV 1",
        geoType: 2,
        geo: geometryRows([2, 3, 4], 8),
        dr: vector([0, 0, 0]),
        dp: vector([2, 3, 4]),
        symVi: vector([0, 0, 0]),
        symR0: vector([0, 0, 0]),
        symYl: 0,
        symYa: 0,
        symTx: 0,
        symLs: 1,
        symAs: 1,
        symPs: 1,
        symKya: 0,
        symKyp: 0,
        ...overrides,
    };
}

function region(overrides = {}) {
    return {
        name: "TK 1",
        geoType: 2,
        geo: geometryRows([1, 2, 3, 4, 5, 6], 4),
        dr: vector([0, 0, 0]),
        dp: vector([1, 5]),
        symVi: vector([0, 0, 0]),
        symR0: vector([0, 0, 0]),
        symYl: 0,
        symLs: 1,
        ...overrides,
    };
}

function plain(value) {
    return Array.from(value);
}

test("scene converts BaseModel arrays and preserves solver face topology", () => {
    const model = {
        general: {
            mirrorSymmetryX: -1,
            mirrorSymmetryY: -1,
        },
        elements: [element({ dr: vector([10, 0, 0]) })],
        regions: [region()],
    };
    const before = structuredClone(model);
    const scene = buildGeometryScene(model);

    assert.deepEqual(model, before);
    assert.equal(scene.diagnostics.length, 0);
    assert.equal(scene.primitives.length, 2);

    const [volume, line] = scene.primitives;
    assert.equal(volume.kind, "element-volume");
    assert.equal(
        volume.materialKind,
        GEOMETRY_MATERIAL_KINDS.NEUTRAL,
    );
    assert.deepEqual(volume.source, {
        schemaId: "elements",
        recordIndex: 0,
        name: "KV 1",
    });
    assert.equal(volume.discretization.counts instanceof Uint32Array, true);
    assert.deepEqual(volume.discretization, {
        kind: "element-cells",
        counts: new Uint32Array([2, 3, 4]),
    });
    assert.equal(volume.vertices instanceof Float64Array, true);
    assert.deepEqual(plain(volume.vertices), [
        0, 3, 0,
        2, 3, 0,
        0, 3, 4,
        2, 3, 4,
        0, 0, 0,
        2, 0, 0,
        0, 0, 4,
        2, 0, 4,
    ]);
    assert.deepEqual(plain(volume.indices), [
        0, 4, 6, 0, 6, 2,
        1, 3, 7, 1, 7, 5,
        0, 2, 3, 0, 3, 1,
        4, 5, 7, 4, 7, 6,
        0, 1, 5, 0, 5, 4,
        2, 6, 7, 2, 7, 3,
    ]);
    assert.deepEqual(plain(volume.edgeIndices), [
        0, 1, 2, 3, 4, 5, 6, 7,
        0, 2, 1, 3, 4, 6, 5, 7,
        0, 4, 1, 5, 2, 6, 3, 7,
    ]);
    assert.equal(volume.instances[0].matrix instanceof Float64Array, true);

    assert.equal(line.kind, "region-line");
    assert.equal(Object.hasOwn(line, "materialKind"), false);
    assert.deepEqual(line.source, {
        schemaId: "regions",
        recordIndex: 0,
        name: "TK 1",
    });
    assert.deepEqual(line.discretization, {
        kind: "region-line",
        counts: new Uint32Array([1, 5]),
    });
    assert.deepEqual(plain(line.vertices), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(plain(line.indices), [0, 1]);
    assert.deepEqual(plain(line.edgeIndices), [0, 1]);

    assert.deepEqual(plain(scene.bounds.min), [1, 0, 0]);
    assert.deepEqual(plain(scene.bounds.max), [12, 5, 6]);
    assert.deepEqual(scene.counts, {
        elements: 1,
        regions: 1,
        primitives: 2,
        instances: 2,
        vertices: 10,
        triangles: 12,
        lines: 1,
        skipped: 0,
    });
});

test("scene carries element material categories from BaseModel properties", () => {
    const scene = buildGeometryScene({
        general: {
            htsMu: false,
            htsRo: true,
        },
        elements: [
            element({ targ: 3, model: 2, xapName: "ignored", rv: 10 }),
            element({ targ: 0, model: 2 }),
            element({ targ: 0, model: 0, xapName: "Steel", rv: 10 }),
        ],
        regions: [region()],
    });

    assert.deepEqual(
        scene.primitives.slice(0, 3).map(item => item.materialKind),
        [
            GEOMETRY_MATERIAL_KINDS.VIRTUAL,
            GEOMETRY_MATERIAL_KINDS.HTSC_CURRENT,
            GEOMETRY_MATERIAL_KINDS.FMM_CONDUCTIVE,
        ],
    );
    assert.equal(
        Object.hasOwn(scene.primitives[3], "materialKind"),
        false,
    );
});

test("general mirrors apply only to elements; regions use local copies", () => {
    const scene = buildGeometryScene({
        general: {
            mirrorSymmetryX: 0,
            mirrorSymmetryY: 1,
        },
        elements: [element({
            geo: geometryRows([1, 1, 1], 8),
            symR0: vector([2, 3, 4]),
        })],
        regions: [region({
            symLs: 2,
            symYl: 90,
        })],
    });

    const [volume, line] = scene.primitives;
    assert.deepEqual(
        volume.instances.map(({ mirrorX, mirrorY }) => [mirrorX, mirrorY]),
        [[0, 0], [1, 0], [0, 1], [1, 1]],
    );
    assert.deepEqual(
        line.instances.map(({ ls, as, ps, mirrorX, mirrorY }) => ({
            ls,
            as,
            ps,
            mirrorX,
            mirrorY,
        })),
        [
            { ls: 0, as: 0, ps: 0, mirrorX: 0, mirrorY: 0 },
            { ls: 1, as: 0, ps: 0, mirrorX: 0, mirrorY: 0 },
        ],
    );
    assert.deepEqual(plain(scene.bounds.min), [-3, -6, 2]);
    assert.deepEqual(plain(scene.bounds.max), [4, 5, 6]);
    assert.deepEqual(scene.counts, {
        elements: 1,
        regions: 1,
        primitives: 2,
        instances: 6,
        vertices: 36,
        triangles: 48,
        lines: 2,
        skipped: 0,
    });
});

test("surface regions use bilinear tessellation and compact dp metadata", () => {
    const scene = buildGeometryScene({
        regions: [region({
            geoType: 3,
            geo: geometryRows([2, 3], 4),
            symLs: 3,
            dp: vector([20, 30]),
        })],
    });
    const [surface] = scene.primitives;

    assert.equal(surface.kind, "region-surface");
    assert.deepEqual(surface.discretization, {
        kind: "region-grid",
        counts: new Uint32Array([20, 30]),
    });
    assert.equal(surface.vertices instanceof Float64Array, true);
    assert.equal(surface.indices instanceof Uint32Array, true);
    assert.deepEqual(plain(surface.edgeIndices), [
        0, 1, 1, 2, 2, 3, 3, 0,
    ]);
    assert.deepEqual(plain(surface.controlVertices), [
        0, 0, 0,
        0, 0, 3,
        0, 2, 3,
        0, 2, 0,
    ]);
    assert.equal(surface.vertices.length > 4 * 3, true);
    assert.equal(surface.indices.length > 2 * 3, true);
    assert.deepEqual(plain(surface.vertices.slice(0, 3)), [0, 0, 0]);
    assert.deepEqual(plain(surface.vertices.slice(-3)), [0, 2, 3]);
    assert.equal(surface.instances.length, 3);
    assert.equal(
        scene.counts.triangles,
        surface.indices.length / 3 * surface.instances.length,
    );
});

test("non-planar region quads retain their bilinear surface", () => {
    const scene = buildGeometryScene({
        regions: [region({
            geoType: 0,
            geo: [
                [0, 0, 0],
                [1, 0, 0],
                [1, 1, 1],
                [0, 1, 0],
            ],
            dp: vector([3, 4]),
        })],
    });
    const [surface] = scene.primitives;
    const points = Array.from(
        { length: surface.vertices.length / 3 },
        (_, index) => plain(surface.vertices.slice(index * 3, index * 3 + 3)),
    );

    assert.equal(points.some(point =>
        point[0] > 0
        && point[0] < 1
        && point[1] > 0
        && point[1] < 1
        && point[2] > 0
        && point[2] < 1
    ), true);
});

test("invalid discretization hides only its overlay, not base geometry", () => {
    const scene = buildGeometryScene({
        elements: [
            element({ dp: vector([1.5, 2, 3]) }),
            element({ dp: vector([1, 2, 0x1_0000_0000]) }),
            element({ dp: vector([0, 0, 0]) }),
        ],
        regions: [
            region({ dp: vector([0, 2]) }),
            region({ dp: vector([1, Number.NaN]) }),
        ],
    });

    assert.equal(scene.primitives.length, 5);
    assert.equal(
        scene.primitives.every(item => !Object.hasOwn(item, "discretization")),
        true,
    );
    assert.equal(scene.counts.elements, 3);
    assert.equal(scene.counts.regions, 2);
    assert.equal(scene.counts.skipped, 0);
    assert.deepEqual(
        scene.diagnostics.map(item => [item.property, item.code]),
        [
            ["dp", "invalid-discretization"],
            ["dp", "invalid-discretization"],
            ["dp", "invalid-discretization"],
            ["dp", "invalid-discretization"],
            ["dp", "invalid-discretization"],
        ],
    );
});

test("bad records are skipped with diagnostics instead of throwing", () => {
    const scene = buildGeometryScene({
        elements: [
            element({ geoType: 99 }),
            element({
                geo: geometryRows([Number.NaN, 2, 3], 8),
            }),
            element({ symLs: 0 }),
        ],
        regions: [
            region({
                geoType: 0,
                geo: geometryRows([Number.NaN], 4),
            }),
            region({ symVi: vector([Number.POSITIVE_INFINITY, 0, 0]) }),
        ],
    });

    assert.deepEqual(scene.primitives, []);
    assert.equal(scene.bounds, null);
    assert.deepEqual(
        scene.diagnostics.map(item => [
            item.schemaId,
            item.recordIndex,
            item.code,
        ]),
        [
            ["elements", 0, "unsupported-geometry"],
            ["elements", 1, "invalid-geometry"],
            ["elements", 2, "invalid-symmetry"],
            ["regions", 0, "invalid-geometry"],
            ["regions", 1, "invalid-transform"],
        ],
    );
    assert.deepEqual(scene.counts, {
        elements: 0,
        regions: 0,
        primitives: 0,
        instances: 0,
        vertices: 0,
        triangles: 0,
        lines: 0,
        skipped: 5,
    });
});

test("degenerate objects remain in the detached scene model", () => {
    const scene = buildGeometryScene({
        elements: [element({
            geo: geometryRows([0, 2, 3], 8),
        })],
        regions: [region({
            geo: geometryRows([1, 2, 3, 1, 2, 3], 4),
        })],
    });

    assert.equal(scene.primitives.length, 2);
    assert.equal(scene.primitives[0].kind, "element-volume");
    assert.equal(scene.primitives[1].kind, "region-line");
    assert.deepEqual(scene.diagnostics, []);
    assert.deepEqual(plain(scene.bounds.min), [0, 0, 0]);
    assert.deepEqual(plain(scene.bounds.max), [1, 2, 3]);
    assert.deepEqual(scene.counts, {
        elements: 1,
        regions: 1,
        primitives: 2,
        instances: 2,
        vertices: 10,
        triangles: 12,
        lines: 1,
        skipped: 0,
    });
});

test("all supported types enter the scene after finite unpacking", () => {
    const scene = buildGeometryScene({
        elements: [0, 1, 2, 3, 4].map(geoType => element({
            geoType,
            geo: geometryRows([], 8),
        })),
        regions: [0, 1, 2, 3].map(geoType => region({
            geoType,
            geo: geometryRows([], 4),
        })),
    });

    assert.equal(scene.primitives.length, 9);
    assert.deepEqual(scene.diagnostics, []);
    assert.equal(scene.counts.elements, 5);
    assert.equal(scene.counts.regions, 4);
    assert.equal(scene.counts.skipped, 0);
});

test("large translated direct geometry stays representable", () => {
    const offset = [1e14, 3e14, -2e14];
    const vertices = [
        [0, 1, 0], [1, 1, 0], [0, 1, 1], [1, 1, 1],
        [0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1],
    ].map(vertex => vertex.map((value, axis) => value + offset[axis]));
    const scene = buildGeometryScene({
        elements: [element({
            geoType: 0,
            geo: vertices,
        })],
    });

    assert.equal(scene.primitives.length, 1);
    assert.deepEqual(scene.diagnostics, []);
});

test("symmetry preflight rejects unrepresentable counts before expansion", () => {
    const scene = buildGeometryScene({
        elements: [
            element({ symLs: 1e20 }),
            element({ symLs: 2 ** 32 }),
            element({ symYa: Number.NaN }),
            element({ symPs: 3, symTx: 1e308 }),
        ],
        regions: [region({ symYl: Number.POSITIVE_INFINITY })],
    });

    assert.deepEqual(scene.primitives, []);
    assert.deepEqual(
        scene.diagnostics.map(item => item.code),
        [
            "invalid-symmetry",
            "invalid-symmetry",
            "invalid-transform",
            "invalid-transform",
            "invalid-transform",
        ],
    );
});

test("coordinates outside the Float32 render range are skipped", () => {
    const scene = buildGeometryScene({
        regions: [region({
            geo: geometryRows([1e308, 0, 0, 0, 0, 0], 4),
            dr: vector([1e308, 0, 0]),
        })],
    });

    assert.deepEqual(scene.primitives, []);
    assert.equal(scene.bounds, null);
    assert.equal(scene.diagnostics[0].code, "invalid-transform");
});

test("empty and non-array model parts produce an empty scene", () => {
    const scene = buildGeometryScene({
        elements: null,
        regions: {},
    });

    assert.deepEqual(scene.primitives, []);
    assert.deepEqual(scene.diagnostics, []);
    assert.equal(scene.bounds, null);
    assert.deepEqual(scene.counts, {
        elements: 0,
        regions: 0,
        primitives: 0,
        instances: 0,
        vertices: 0,
        triangles: 0,
        lines: 0,
        skipped: 0,
    });
});

test("all selected symmetry images survive the former per-record and scene caps", () => {
    const model = { elements: [element({ symPs: 20_001, symTx: 2 }), element()] };
    const full = buildGeometryScene(model);
    assert.deepEqual(full.diagnostics, []);
    assert.equal(full.counts.instances, 20_002);
    assert.equal(full.primitives[0].instances.at(-1).ps, 20_000);
    const original = buildGeometryScene(model, { originalOnly: true });
    assert.equal(original.counts.instances, 2);
    assert.deepEqual(original.primitives[0].instances[0], full.primitives[0].instances[0]);
});

test("all prescribed MHJ rows and their physical images retain their row indices", () => {
    const cells = 100_001;
    const record = element({ targ: 1, dp: vector([cells, 1, 1]), symPs: 2, symTx: 3, symKyp: 1 });
    const scene = buildGeometryScene({ elements: [record] });
    const values = Array(cells).fill([0, 0, 0]);
    values[cells - 1] = [1, 0, 0];
    const last = buildSourceVectorScene(scene, [record], [{ v: values }]);
    assert.equal(last.vectors.length, 2);
    assert.ok(last.vectors.every(v => v.sourceRowIndex === cells - 1));
    values.fill([1, 0, 0], 0, 50_001);
    const all = buildSourceVectorScene(scene, [record], [{ v: values }]);
    assert.equal(all.vectors.length, 100_004);
    assert.equal(all.truncated, false);
});
