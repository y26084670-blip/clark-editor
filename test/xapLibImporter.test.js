import test from "node:test";
import assert from "node:assert/strict";

import {
    createFmmMaterialFile,
    fmmMaterialStorageRecord,
    parseXapLibrary,
    serializeFmmMaterial,
    XAP_RECORD_BYTES,
} from "../src/services/materialImport/xapLibImporter.js";
import {
    buildXapRecord,
    concatenateBuffers,
} from "./fixtures/materialImportFixtures.js";

test("XAP.lib parser preserves Float32 values and 12 H/M pairs", () => {
    const sourceRows = Array.from(
        { length: 12 },
        (_, index) => [index + 0.1, index * -1.25],
    );
    const [record] = parseXapLibrary(buildXapRecord({
        name: "СТАЛЬ",
        comment: "Проверка ФММ",
        rows: sourceRows,
        hip: 0.02,
    }));

    assert.equal(record.name, "СТАЛЬ");
    assert.equal(record.comment, "Проверка ФММ");
    assert.deepEqual(
        record.tabl,
        sourceRows.map(row => row.map(Math.fround)),
    );
    assert.equal(
        record.hip,
        Math.fround(Math.fround(0.02) + 1) - 1,
    );
});
test("FMM solver JSON is column-major and excludes transient name", () => {
    const [record] = parseXapLibrary(buildXapRecord({ name: "STAL3" }));
    const storage = fmmMaterialStorageRecord(record);
    const file = createFmmMaterialFile(record);

    assert.deepEqual(storage.tabl.slice(0, 12), record.tabl.map(row => row[0]));
    assert.deepEqual(storage.tabl.slice(12), record.tabl.map(row => row[1]));
    assert.equal(Object.hasOwn(storage, "name"), false);
    assert.equal(file.kind, "FMM");
    assert.equal(file.fileName, "STAL3.txt");
    assert.deepEqual(file.data, storage);
    assert.equal(file.text, serializeFmmMaterial(record));
    assert.equal(file.text.endsWith("\n"), true);
});

test("XAP.lib parser accepts a bounded TypedArray view", () => {
    const recordBuffer = buildXapRecord({ name: "VIEW" });
    const container = new Uint8Array(recordBuffer.byteLength + 8);
    container.set(new Uint8Array(recordBuffer), 4);

    const records = parseXapLibrary(
        new Uint8Array(container.buffer, 4, recordBuffer.byteLength),
    );
    assert.equal(records[0].name, "VIEW");
});

test("XAP.lib parser validates package size and all names", () => {
    assert.throws(() => parseXapLibrary(new ArrayBuffer(0)), /пуст/);
    assert.throws(
        () => parseXapLibrary(new ArrayBuffer(XAP_RECORD_BYTES - 1)),
        /не кратен/,
    );
    assert.throws(
        () => parseXapLibrary(buildXapRecord({ name: "CON" })),
        /зарезервировано Windows/,
    );
    assert.throws(
        () => parseXapLibrary(concatenateBuffers(
            buildXapRecord({ name: "Steel" }),
            buildXapRecord({ name: "steel" }),
        )),
        /конфликтуют в Windows/,
    );
});

test("XAP.lib parser rejects invalid character and numeric Float32 values", () => {
    const invalidCharacter = buildXapRecord();
    new DataView(invalidCharacter).setFloat32(0, 65.5, true);
    assert.throws(
        () => parseXapLibrary(invalidCharacter),
        /код символа 1/,
    );

    const invalidTable = buildXapRecord();
    new DataView(invalidTable).setFloat32(256 * 4, Number.NaN, true);
    assert.throws(
        () => parseXapLibrary(invalidTable),
        /H\[1\]/,
    );
});

test("FMM serializer rejects a malformed detail table", () => {
    assert.throws(
        () => serializeFmmMaterial({
            name: "bad",
            tabl: [[0, 1]],
            hip: 0,
            comment: "",
        }),
        /не менее 2 строк/,
    );
});
