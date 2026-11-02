import test from "node:test";
import assert from "node:assert/strict";

import {
    assertFixedRecordCount,
    parseFixedRecordLines,
    propertyRowsToRecords,
    recordColumnField,
    recordIndexFromColumn,
    recordsToPropertyRows,
} from "../src/tabulator/converters/recordColumns.js";
import { conrabValidator }
    from "../src/tabulator/validators/models/conrab/conrabValidator.js";

const schema = {
    config: {
        storage: "records",
        recordCount: 2,
    },
    views: {
        recordsAsColumns: {
            labels: ["Float32", "Float64"],
        },
    },
    properties: {
        EPS: {
            type: "float",
            label: "EPS — общий критерий",
            default: 0.005,
        },
        LONGD: {
            type: "integer",
            label: "LONGD",
            default: 150,
        },
        EXTRA: {
            type: "boolean",
            label: "Экстраполяция",
            default: true,
        },
    },
};

const profiles = [
    { EPS: 0.001, LONGD: 131, EXTRA: true },
    { EPS: 0.0005, LONGD: 300, EXTRA: false },
];

test("conrab accepts exactly two JSON-object records", () => {
    assert.equal(assertFixedRecordCount(profiles, 2), profiles);

    for (const invalid of [
        [],
        [profiles[0]],
        [...profiles, profiles[0]],
        [profiles[0], null],
        [profiles[0], []],
    ]) {
        assert.throws(
            () => assertFixedRecordCount(invalid, 2),
            /ожидалось записей|должна быть JSON-объектом/,
        );
    }
});

test("fixed conrab JSONL rejects blank and extra physical records", () => {
    assert.deepEqual(
        parseFixedRecordLines('{"EPS":1}\n{"EPS":2}\n'),
        [{ EPS: 1 }, { EPS: 2 }],
    );

    for (const text of [
        '{"EPS":1}\n',
        '{"EPS":1}\n\n{"EPS":2}\n',
        '{"EPS":1}\n{"EPS":2}\n\n',
    ]) {
        assert.throws(
            () => assertFixedRecordCount(
                parseFixedRecordLines(text),
                2,
            ),
            /ожидалось записей|должна содержать JSON-объект/,
        );
    }
});

test("conrab RECORDS are shown as Parameter, Float32 and Float64", () => {
    const rows = recordsToPropertyRows(schema, profiles);

    assert.deepEqual(rows, [
        {
            _property: "EPS",
            rowLabel: "EPS — общий критерий",
            _record_0: 0.001,
            _record_1: 0.0005,
        },
        {
            _property: "LONGD",
            rowLabel: "LONGD",
            _record_0: 131,
            _record_1: 300,
        },
        {
            _property: "EXTRA",
            rowLabel: "Экстраполяция",
            _record_0: true,
            _record_1: false,
        },
    ]);

    assert.deepEqual(propertyRowsToRecords(schema, rows), profiles);
});

test("conrab profile column maps to its fixed record index", () => {
    assert.equal(recordColumnField(0), "_record_0");
    assert.equal(recordColumnField(1), "_record_1");
    assert.equal(recordIndexFromColumn("_record_0"), 0);
    assert.equal(recordIndexFromColumn("_record_1"), 1);
    assert.equal(recordIndexFromColumn("rowLabel"), null);
    assert.equal(recordIndexFromColumn("_record_01"), null);
});

function validate(conrab) {
    const diagnostics = [];
    conrabValidator(
        { getModel: () => ({ conrab }) },
        diagnostics,
    );
    return diagnostics;
}

test("conrab model validation rejects every non-two-profile shape", () => {
    assert.deepEqual(validate(profiles.map(p => ({ ...p, CF_FMMEPS: 0.01, CF_HTSEPS: 0.01, DIPOLE_RTOL: 0.001 }))), []);
    assert.deepEqual(validate(null), []);

    for (const invalid of [
        [],
        [profiles[0]],
        [...profiles, profiles[0]],
        [profiles[0], null],
    ]) {
        const diagnostics = validate(invalid);
        assert.equal(diagnostics.length, 1);
        assert.equal(diagnostics[0].level, "error");
        assert.equal(diagnostics[0].tab.id, "conrab");
        assert.match(diagnostics[0].message, /ровно две записи/);
    }
});
