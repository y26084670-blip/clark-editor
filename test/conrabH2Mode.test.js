import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { FIELD_TYPES, STORAGE_TYPES, TABS, FILES } from "../src/services/schemas/common/constants.js";
import { GEOMETRY_VALIDATION_DEFAULTS } from "../src/services/solver/geometryValidationSettings.js";
import { deserialize, serialize } from "../src/services/model/modelSerializer.js";
import { recordsToPropertyRows, propertyRowsToRecords } from "../src/tabulator/converters/recordColumns.js";
import { conrabValidator } from "../src/tabulator/validators/models/conrab/conrabValidator.js";
import { enumEditor } from "../src/tabulator/editors/types/enumEditor.js";

const declaration = readFileSync(new URL("../src/services/schemas/conrab.schema.js", import.meta.url), "utf8")
    .replace(/import\s+[\s\S]*?from\s+["'][^"']+["'];\s*/g, "")
    .replace("export default createSchema", "createSchema");
const descriptor = runInNewContext(declaration, {
    GEOMETRY_VALIDATION_DEFAULTS, FIELD_TYPES, STORAGE_TYPES, TABS, FILES, createSchema: d => d,
});
const schema = {
    properties: descriptor.properties, views: descriptor.views,
    config: { storage: descriptor.storage, recordCount: descriptor.recordCount },
};
const property = schema.properties.H2_MODE;

test("H2 settings expose three named string modes and default old profiles to off", () => {
    assert.equal(property.type, FIELD_TYPES.ENUM);
    assert.deepEqual(Array.from(property.enum, o => o.value), ["off", "on", "check"]);
    assert.equal(property.default, "off");
    for (const option of property.enum) assert.ok(option.label.startsWith(option.value));
    const input = [{}, { H2_MODE: "check" }];
    const model = deserialize(input, schema);
    assert.deepEqual(model.map(p => p.H2_MODE), ["off", "check"]);
    assert.equal(Object.hasOwn(input[0], "H2_MODE"), false);
    assert.deepEqual(deserialize([{}, {}], schema).map(p => p.H2_MODE), ["off", "off"]);
});

test("H2 modes edit and round-trip independently in both conrab profiles", () => {
    for (const first of ["off", "on", "check"]) {
        for (const second of ["off", "on", "check"]) {
            const original = deserialize([{}, {}], schema);
            const rows = recordsToPropertyRows(schema, original);
            const row = rows.find(r => r._property === "H2_MODE");
            row._record_0 = first;
            row._record_1 = second;
            const edited = propertyRowsToRecords(schema, rows);
            const text = serialize(edited, schema).map(JSON.stringify).join("\n");
            const loaded = deserialize(text.split("\n").map(JSON.parse), schema);
            assert.deepEqual(loaded.map(p => p.H2_MODE), [first, second]);
            assert.deepEqual(original.map(p => p.H2_MODE), ["off", "off"]);
            for (const precision of [false, true]) {
                const index = descriptor.views.recordsAsColumns.activeRecord.index({
                    model: { conrab: loaded, general: { doubleFloat: precision } },
                });
                assert.equal(loaded[index].H2_MODE, precision ? second : first);
            }
            const diagnostics = [];
            conrabValidator({ getModel: () => ({ conrab: loaded }) }, diagnostics);
            assert.deepEqual(diagnostics, []);
        }
    }
});

test("H2 validation identifies invalid values in either profile", () => {
    for (const row of [0, 1]) {
        for (const invalid of [true, false, 0, 1, "", "ON", " on ", "auto", null, undefined, [], {}]) {
            const model = deserialize([{}, {}], schema);
            model[row].H2_MODE = invalid;
            const diagnostics = [];
            conrabValidator({ getModel: () => ({ conrab: model }) }, diagnostics);
            assert.equal(diagnostics.length, 1);
            assert.equal(diagnostics[0].property, "H2_MODE");
            assert.equal(diagnostics[0].row, row + 1);
        }
    }
});

test("H2 dropdown returns the stored mode string", () => {
    const previous = globalThis.document;
    const make = tag => ({ tag, children: [], events: {}, value: "0",
        appendChild(child) { this.children.push(child); },
        addEventListener(name, callback) { this.events[name] = callback; },
        focus() {},
    });
    globalThis.document = { createElement: make };
    try {
        let selected;
        const select = enumEditor({ getValue: () => "off" }, () => {},
            value => { selected = value; }, () => assert.fail("editor cancelled"), property);
        assert.equal(select.children.length, 3);
        for (let index = 0; index < 3; index++) {
            select.value = String(index);
            select.events.change();
            assert.equal(selected, property.enum[index].value);
            assert.equal(typeof selected, "string");
        }
    } finally {
        if (previous === undefined) delete globalThis.document;
        else globalThis.document = previous;
    }
});
