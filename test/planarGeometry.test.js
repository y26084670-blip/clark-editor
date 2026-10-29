import assert from "node:assert/strict";
import test from "node:test";
import { buildGeometryScene } from "../src/services/visualization/geometrySceneModel.js";

const vector = values => values.map(value => [value]);
const rows = values => Array.from({ length: 8 }, (_, i) => [0, 1, 2].map(j => values[3 * i + j] ?? 0));
function element(overrides = {}) {
    return {
        geoType: 2, geo: rows([20, 2, 3]), dr: vector([-10, 0, 0]), dp: vector([1, 2, 3]),
        symVi: vector([0, 0, 0]), symR0: vector([0, 0, 0]), symLs: 1, symAs: 1, symPs: 1,
        symYl: 0, symYa: 0, symTx: 0, symKya: 0, symKyp: 0, ...overrides,
    };
}
const general = { doubleFloat: true, fullAxialSymmetry: false, mirrorSymmetryX: -1, mirrorSymmetryY: -1 };
const scene = (elements = [element()], changes = {}, regions = []) => buildGeometryScene({ general: { ...general, ...changes }, elements, regions });

test("a centered, uniformly extruded system with one longitudinal cell is planar", () => {
    assert.equal(scene().planar2D, true);
    assert.equal(scene([element(), element({ symR0: vector([0, 3, 0]) })]).planar2D, true);
    assert.equal(scene([], {}).planar2D, false);
    assert.equal(buildGeometryScene().planar2D, false);
});

test("each agreed criterion independently disables 2D, and restoring it enables 2D", () => {
    for (const [name, elements, changes] of [
        ["longitudinal divisions", [element({ dp: vector([2, 2, 3]) })], {}],
        ["off-center ends", [element({ dr: vector([-9, 0, 0]) })], {}],
        ["different lengths", [element(), element({ geo: rows([22, 2, 3]), dr: vector([-11, 0, 0]) })], {}],
        ["inclined extrusion", [element({ symVi: vector([0, 5, 0]) })], {}],
        ["changing cross-section", [element({ geoType: 3, geo: rows([20, 2, 3, 4, 5]) })], {}],
        ["length equals twice the transverse size", [element({ geo: rows([6, 2, 3]), dr: vector([-3, 0, 0]) })], {}],
        ["mirror X symmetric", [element()], { mirrorSymmetryX: 0 }],
        ["mirror X antisymmetric", [element()], { mirrorSymmetryX: 1 }],
        ["full axial symmetry", [element()], { fullAxialSymmetry: true }],
    ]) {
        assert.equal(scene(elements, changes).planar2D, false, name);
        assert.equal(scene().planar2D, true, `restore after ${name}`);
    }
});

test("global X may correspond to another local discretization direction", () => {
    assert.equal(scene([element({ geo: rows([2, 20, 3]), dr: vector([0, -10, 0]),
        dp: vector([2, 3, 1]), symVi: vector([0, 0, 90]) })]).planar2D, true);
});

test("physical symmetry images, prescribed sources and total transverse span participate", () => {
    assert.equal(scene([element({ symLs: 4, symYl: 90, symAs: 2, symYa: 45 })]).planar2D, true);
    assert.equal(scene([element()], { mirrorSymmetryY: 0 }).planar2D, true);
    assert.equal(scene([element({ symPs: 2, symTx: 1 })]).planar2D, false);
    assert.equal(scene([element(), element({ symR0: vector([0, 20, 0]), rv: false, mv: false })]).planar2D, false);
    // The base sector alone is long enough; its rotated image doubles the width.
    assert.equal(scene([element({ geo: rows([10, 2, 3]), dr: vector([-5, 0, 0]), symAs: 2, symYa: 180 })]).planar2D, false);
});

test("observation regions and display filters do not determine the 2D convention", () => {
    const region = { geoType: 2, geo: rows([10000, 10000, 10000, 20000, 20000, 20000]).slice(0, 4),
        dr: vector([0, 0, 0]), dp: vector([1, 2]), symVi: vector([0, 0, 0]), symR0: vector([0, 0, 0]), symLs: 1, symYl: 0 };
    assert.equal(scene([element()], {}, [region]).planar2D, true);
});

test("centered virtual elements may be shorter or longer without defining the physical extent", () => {
    for (const length of [0.5, 20, 2000]) {
        const virtual = element({ targ: 3, geo: rows([length, 200, 300]), dr: vector([-length / 2, 0, 0]),
            symLs: 4, symYl: 90, symAs: 2, symYa: 45 });
        const model = scene([element(), virtual]);
        assert.equal(model.planar2D, true, `Virtual length ${length}`);
        assert.equal(model.primitives.length, 2, "virtual geometry remains visible");
        // The record index remains its original index when virtual rows precede physical rows.
        assert.equal(scene([virtual, element()]).planar2D, true);
    }
    assert.equal(scene([element({ targ: 3 })]).planar2D, false, "virtual geometry alone is not a physical 2D task");
});

test("changing Virtual to a physical purpose restores all physical geometry requirements", () => {
    const probe = element({ targ: 3, geo: rows([40, 2, 3]), dr: vector([-20, 0, 0]) });
    assert.equal(scene([element(), probe]).planar2D, true);
    for (const targ of [0, 1, 2]) {
        assert.equal(scene([element(), { ...probe, targ }]).planar2D, false, `physical purpose ${targ}`);
    }
    assert.equal(scene([element(), probe]).planar2D, true);
    assert.equal(scene([element({ dp: vector([2, 2, 3]) }), probe]).planar2D, false);
    assert.equal(scene([element(), probe], { mirrorSymmetryX: 0 }).planar2D, false);
    assert.equal(scene([element(), probe], { fullAxialSymmetry: true }).planar2D, false);
});

test("invalid or omitted physical elements cannot produce a false 2D label", () => {
    for (const bad of [element({ dp: vector([0, 2, 3]) }), element({ geoType: 99 }),
        element({ geo: rows([20, 0, 0]) }), element({ symPs: 20001 }),
        element({ symR0: vector([NaN, 0, 0]) })]) {
        assert.equal(scene([element(), bad]).planar2D, false);
    }
});

test("roundoff follows input precision, independently of solver convergence EPS", () => {
    const almostCentered = element({ dr: vector([-10 + 1e-5, 0, 0]) });
    assert.equal(scene([almostCentered], { doubleFloat: false }).planar2D, true);
    assert.equal(scene([almostCentered], { doubleFloat: true }).planar2D, false);
    assert.equal(scene([almostCentered], { doubleFloat: true, eps: 1 }).planar2D, false);
});

test("collapsed triangular prisms keep their nonzero cross-section", () => {
    const vertices = [[-10, 0, 0], [10, 0, 0], [-10, 2, 0], [10, 2, 0],
        [-10, 0, 3], [10, 0, 3], [-10, 0, 3], [10, 0, 3]];
    assert.equal(scene([element({ geoType: 0, geo: vertices, dr: vector([0, 0, 0]) })]).planar2D, true);
});
