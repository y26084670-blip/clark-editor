import test from "node:test";
import assert from "node:assert/strict";
import { forceSurfaceMotionWarning } from "../src/services/generator/forceSurfaceMotion.js";
import { regionsValidator } from "../src/tabulator/validators/models/regions/regionsValidator.js";

const geo = [[0,0,0], [0,2,0], [0,2,1], [0,0,1]];
const panel = (indMove, patch = {}) => ({geoType: 0, geo, indMove, indCoil: 0, ...patch});

test("warn for an assigned trajectory on either side, including a common trajectory", () => {
    for (const [elementMove, panelMove] of [[0,0], [2,0], [0,3], [2,2], [2,3]]) {
        const elements = [{indMove: 7}, {indMove: elementMove}, {indMove: 0}];
        const message = forceSurfaceMotionWarning({elements, selectedIndices: [1,2], regions: [panel(0), panel(0), panel(panelMove)]});
        assert.equal(Boolean(message), Boolean(elementMove || panelMove));
        assert.equal(message.includes("элементам № 2"), Boolean(elementMove));
        assert.equal(message.includes("площадкам № 3"), Boolean(panelMove));
        assert.doesNotMatch(message, /элементам № 1/);
    }
});

test("only force integration areas contribute, including loaded rectangles and sectors", () => {
    const region = panel(1);
    const regions = [panel(1,{indCoil: 2}), panel(2,{geoType: 2}),
        panel(3,{geo: [geo[0],geo[0],geo[2],geo[2]]}), region,
        panel(2,{geoType: 3, geo:[[2,1,0]]}), panel(3,{geoType: 1, geo:[[2,2,30],[1,0,0]]})];
    const message = forceSurfaceMotionWarning({regions});
    assert.match(message, /площадкам № 4, 5, 6\./);
    assert.equal(forceSurfaceMotionWarning({}), "");
    assert.equal(forceSurfaceMotionWarning({regions: [panel(-1),panel(0),panel(1.5)]}), "");
});

test("model validation warns for edited and reloaded force areas even with a constant trajectory and evalForce off", () => {
    const moves = [{angle:[[0,0,0,0]], position:[[0,0,0,0]]}];
    const zero = [[0],[0],[0]];
    const original = panel(0, {symVi:zero, symR0:zero, dr:zero, dp:[[3],[3]], symYl:0, symLs:1});
    const model = {general:{evalForce:false}, moves, regions:[original, structuredClone(original)]};
    function validate(snapshot) {
        const diagnostics = [];
        regionsValidator({getModel: () => snapshot}, diagnostics);
        return diagnostics;
    }
    assert.deepEqual(validate(model), []);
    model.regions[0].indMove = model.regions[1].indMove = 1;
    const diagnostics = validate(JSON.parse(JSON.stringify(model)));
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].level, "warning");
    assert.equal(diagnostics[0].property, "indMove");
    assert.match(diagnostics[0].message, /площадкам № 1, 2\./);
    model.regions.forEach(record => { record.indMove = 0; });
    assert.deepEqual(validate(model), []);
});
