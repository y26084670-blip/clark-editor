import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import {
    FIELD_TYPES, STORAGE_TYPES, TABS, FILES,
} from "../src/services/schemas/common/constants.js";
import {
    deserialize, serialize,
} from "../src/services/model/modelSerializer.js";
import {
    parseFixedRecordLines,
    recordColumnField,
    recordsToPropertyRows,
    propertyRowsToRecords,
} from "../src/tabulator/converters/recordColumns.js";
import {
    booleanFormatter,
} from "../src/tabulator/formatters/types/booleanFormatter.js";

// Read the actual schema declaration without requiring the Vite import resolver.
// This is a declaration/JSON presentation contract test, not a browser build.
const schemaPath = new URL("../src/services/schemas/conrab.schema.js", import.meta.url);
const declaration = readFileSync(schemaPath, "utf8")
    .replace(/import\s+[\s\S]*?from\s+["'][^"']+["'];\s*/g, "")
    .replace("export default createSchema", "createSchema");
const descriptor = runInNewContext(declaration, {
    FIELD_TYPES, STORAGE_TYPES, TABS, FILES,
    createSchema: definition => definition,
}, { filename: schemaPath.pathname });
const schema = {
    id: descriptor.id,
    config: {
        storage: descriptor.storage,
        recordCount: descriptor.recordCount,
    },
    properties: descriptor.properties,
    views: descriptor.views,
};
const property = schema.properties.fullJNewton;

test("fullJNewton is the last model parameter with names, states and complete help", () => {
    const names = Object.keys(schema.properties);
    assert.equal(names.at(-2), "CF_HTSEPS");
    assert.equal(names.at(-1), "fullJNewton");
    assert.equal(names.length, 11);
    assert.equal(property.type, FIELD_TYPES.BOOLEAN);
    assert.equal(property.default, false);
    assert.match(property.label, /fullJNewton/);
    assert.match(property.label, /J\/λ/);
    assert.equal(property.textOn, "Полный Newton");
    assert.equal(property.textOff, "Упрощённый Newton");
    assert.equal(
        booleanFormatter({ getValue: () => true }, { property }),
        "🟢 Полный Newton",
    );
    assert.equal(
        booleanFormatter({ getValue: () => false }, { property }),
        "⚫ Упрощённый Newton",
    );
    for (const wording of [
        /линейными электропроводящими/,
        /true — полный/, /false — упрощённая/,
        /3×3/, /Шура/, /GMRES/,
        /ВТСП/, /смешанной задаче/,
        /всегда используется полный метод независимо/,
        /htsRo/, /Float32/, /Float64/,
        /умолчанию false/, /отсутствии поля в conrab\.txt/,
    ]) {
        assert.match(property.description, wording);
    }
    assert.equal(Object.hasOwn(schema.properties, "method"), false);
    assert.equal(Object.hasOwn(schema.properties, "useFullJNewton"), false);
});

test("missing flag defaults independently in each loaded profile", () => {
    const input = [{ fullJNewton: true }, {}];
    const model = deserialize(input, schema);
    assert.equal(model[0].fullJNewton, true);
    assert.equal(model[1].fullJNewton, false);
    assert.notEqual(model[0], model[1]);
    assert.equal(Object.hasOwn(input[1], "fullJNewton"), false);
    const fresh = deserialize([{}, {}], schema);
    assert.deepEqual(fresh.map(profile => profile.fullJNewton), [false, false]);
    fresh[0].fullJNewton = true;
    assert.equal(fresh[1].fullJNewton, false);
    assert.equal(deserialize([{}, {}], schema)[0].fullJNewton, false);
});

for (const first of [false, true]) {
    for (const second of [false, true]) {
        test(`fullJNewton profiles ${first}/${second}: edit and JSONL round trip`, () => {
            const model = deserialize([
                { fullJNewton: first, EPS: 0.02 },
                { fullJNewton: second, EPS: 0.003 },
            ], schema);
            const rows = recordsToPropertyRows(schema, model);
            const row = rows.at(-1);
            assert.equal(row._property, "fullJNewton");
            assert.equal(row.rowLabel, property.label);
            assert.equal(row[recordColumnField(0)], first);
            assert.equal(row[recordColumnField(1)], second);
            row[recordColumnField(1)] = !second;
            const edited = propertyRowsToRecords(schema, rows);
            assert.deepEqual(edited.map(profile => profile.fullJNewton), [first, !second]);
            assert.deepEqual(edited.map(profile => profile.EPS), [0.02, 0.003]);
            assert.deepEqual(model.map(profile => profile.fullJNewton), [first, second]);
            const stored = serialize(edited, schema);
            const jsonl = stored.map(profile => JSON.stringify(profile)).join("\n") + "\n";
            const restored = deserialize(parseFixedRecordLines(jsonl), schema);
            assert.deepEqual(restored, edited);
            for (const profile of stored) {
                assert.equal(typeof profile.fullJNewton, "boolean");
                assert.equal(Object.keys(profile).at(-1), "fullJNewton");
                assert.equal(Object.hasOwn(profile, "_property"), false);
                assert.equal(Object.hasOwn(profile, "rowLabel"), false);
                assert.equal(Object.hasOwn(profile, "_record_0"), false);
            }
        });
    }
}

test("precision selection does not overwrite either configured flag", () => {
    const profiles = deserialize([{ fullJNewton: false }, { fullJNewton: true }], schema);
    const active = schema.views.recordsAsColumns.activeRecord;
    assert.deepEqual(Array.from(schema.views.recordsAsColumns.labels), ["Float32", "Float64"]);
    for (const doubleFloat of [false, true, false]) {
        const index = active.index({ model: { [TABS.GENERAL.id]: { doubleFloat } } });
        assert.equal(index, Number(doubleFloat));
        assert.equal(profiles[index].fullJNewton, doubleFloat);
        assert.deepEqual(profiles.map(profile => profile.fullJNewton), [false, true]);
    }
});
