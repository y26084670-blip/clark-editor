import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { FIELD_TYPES, STORAGE_TYPES, TABS, FILES } from "../src/services/schemas/common/constants.js";
import { modelGeometrySettings }
    from "../src/services/solver/geometryValidationSettings.js";
import { deserialize, serialize } from "../src/services/model/modelSerializer.js";
import { conrabValidator } from "../src/tabulator/validators/models/conrab/conrabValidator.js";

const declaration=readFileSync(new URL("../src/services/schemas/conrab.schema.js",import.meta.url),"utf8")
    .replace(/import\s+[\s\S]*?from\s+["'][^"']+["'];\s*/g,"")
    .replace("export default createSchema","createSchema");
const descriptor=runInNewContext(declaration,{
    FIELD_TYPES,STORAGE_TYPES,TABS,FILES,createSchema:d=>d,
});
const schema={properties:descriptor.properties,views:descriptor.views,
    config:{storage:descriptor.storage,recordCount:descriptor.recordCount}};

test("legacy angular and stripe settings are ignored in both profiles", () => {
    const old = [{KPY: 18, LONGD: 300, GEO_ANGLE: .1, EPS: .015},
                 {KPY: "unused", LONGD: 2000, GEO_ANGLE: null, EPS: .002}];
    const model = deserialize(old, schema);
    const diagnostics = [];
    conrabValidator({getModel: () => ({conrab: model})}, diagnostics);
    assert.deepEqual(diagnostics, []);
    const saved = serialize(model, schema);
    assert.deepEqual(saved.map(record => record.EPS), [.015, .002]);
    for (const key of ["KPY", "LONGD", "GEO_ANGLE"]) {
        assert.ok(descriptor.obsoleteStoragePaths.includes(key));
        assert.ok(!Object.hasOwn(descriptor.properties, key));
        for (const record of [...model, ...saved]) assert.ok(!Object.hasOwn(record, key));
    }
});

test("geometry uses the working precision even for incomplete legacy settings", () => {
    for (const doubleFloat of [false, true]) {
        const model = {general: {doubleFloat}, conrab: [{}]};
        assert.equal(modelGeometrySettings(model).settings.doubleFloat, doubleFloat);
    }
});
