import assert from "node:assert/strict";
import test from "node:test";

import {
    decodeFmmTable,
    toFmmLibraryModel,
    toHtsLibraryModel,
} from "../src/services/materials/materialLibraryModel.js";
import { HTS_PARAMETER_NAMES } from "../src/services/materials/materialConstants.js";
import { createHtsMaterialFile } from "../src/services/materialImport/htsConfigImporter.js";
import { serializeFmmMaterial } from "../src/services/materialImport/xapLibImporter.js";

test("FMM default-library records become 12x2 RECORDS details", () => {
    const h = Array.from({ length: 12 }, (_, index) => index + 1);
    const m = Array.from({ length: 12 }, (_, index) => 101 + index);

    const model = toFmmLibraryModel([{
        kind: "FMM",
        name: "STAL",
        relativePath: "xapLibFMM/STAL.txt",
        sha256: "a".repeat(64),
        data: {
            tabl: [...h, ...m],
            hip: 7.5,
            comment: "Тест",
        },
    }]);

    assert.deepEqual(model, [{
        _libraryRecord: {
            kind: "FMM",
            name: "STAL",
            relativePath: "xapLibFMM/STAL.txt",
            sha256: "a".repeat(64),
            data: {
                tabl: [...h, ...m],
                hip: 7.5,
                comment: "Тест",
            },
        },
        name: "STAL",
        tabl: h.map((value, index) => [value, m[index]]),
        hip: 7.5,
        comment: "Тест",
    }]);
});

test("FMM importer BaseModel with a matrix stays a matrix", () => {
    const rows = Array.from(
        { length: 12 },
        (_, index) => [index, index * 2],
    );

    assert.deepEqual(
        decodeFmmTable(rows),
        rows,
    );
    assert.notEqual(decodeFmmTable(rows), rows);
});

test("browser-import material is adapted without a default-library source", () => {
    const values = Array.from({ length: 24 }, (_, index) => index);
    const [record] = toFmmLibraryModel([{
        kind: "FMM",
        name: "Импорт",
        fileName: "Импорт.txt",
        data: {
            tabl: values,
            hip: 0,
            comment: "",
        },
    }]);

    assert.equal(record.name, "Импорт");
    assert.equal(record._libraryRecord, undefined);
});

test("task-local material keeps separate transient file metadata", () => {
    const [record] = toFmmLibraryModel([{
        source: "task",
        kind: "FMM",
        name: "Локальная",
        fileName: "Локальная.txt",
        relativePath: "input3XX/xapLibFMM/Локальная.txt",
        sha256: "c".repeat(64),
        data: {
            tabl: Array.from({ length: 24 }, (_, index) => index),
            hip: 1,
            comment: "",
        },
    }]);

    assert.equal(record._libraryRecord, undefined);
    assert.equal(record._taskLibraryRecord.source, "task");
    assert.equal(
        record._taskLibraryRecord.relativePath,
        "input3XX/xapLibFMM/Локальная.txt",
    );
    assert.equal(record.name, "Локальная");
});

test("malformed FMM table is rejected before rendering", () => {
    assert.throws(
        () => decodeFmmTable(Array(23).fill(0)),
        /чётное число значений/,
    );
    assert.throws(
        () => decodeFmmTable([[1, 2, 3]]),
        /не менее 2 строк и две колонки/,
    );
    assert.throws(
        () => decodeFmmTable([[1, 2]]),
        /не менее 2 строк и две колонки/,
    );
    assert.throws(
        () => decodeFmmTable([
            ...Array(23).fill(0),
            Number.NaN,
        ]),
        /конечные числовые/,
    );
});

test("FMM variable-length tables survive load, edit, save and reload without truncation", () => {
    for (const count of [2, 11, 12, 13, 507, 894]) {
        const tabl = Array.from({ length: count }, (_, i) => [i / 10, i * 2.5]);
        const record = { name: "Сталь", tabl, hip: 0, comment: "Все узлы" };
        const loaded = toFmmLibraryModel([{ name: record.name, data: JSON.parse(serializeFmmMaterial(record)) }])[0];
        assert.deepEqual(loaded.tabl, tabl);
        loaded.tabl[count - 1][1] = 12345;
        const reloaded = decodeFmmTable(JSON.parse(serializeFmmMaterial(loaded)).tabl);
        assert.equal(reloaded.length, count);
        assert.deepEqual(reloaded[count - 1], [(count - 1) / 10, 12345]);
        assert.equal(tabl[count - 1][1], (count - 1) * 2.5);
    }
    for (const value of [[], [1, 2], [[0, 0], [1]], [0, 1, 2], [[0, 0], [1, Infinity]]]) {
        assert.throws(() => decodeFmmTable(value));
    }
});

test("HTS model keeps scalar JSON fields and transient filename name", () => {
    const [material] = toHtsLibraryModel([{
        kind: "HTS",
        name: "ВТСП",
        fileName: "ВТСП.txt",
        relativePath: "xapLibHTS/ВТСП.txt",
        sha256: "b".repeat(64),
        data: {
            j_HC0: 2300,
            M3D: true,
            comment: "Описание",
        },
    }]);

    assert.deepEqual(material._libraryRecord, {
        kind: "HTS",
        name: "ВТСП",
        fileName: "ВТСП.txt",
        relativePath: "xapLibHTS/ВТСП.txt",
        sha256: "b".repeat(64),
        data: {
            j_HC0: 2300,
            M3D: true,
            comment: "Описание",
        },
    });
    assert.equal(material.name, "ВТСП");
    assert.equal(material.j_HC0, 2300);
    assert.equal(material.KHabc, 1);
    assert.equal(material.Diag, 0);
    assert.equal(material.M3D, true);
    assert.equal(material.comment, "Описание");
    assert.deepEqual(
        Object.keys(material).filter(key => !key.startsWith("_")),
        ["name", ...HTS_PARAMETER_NAMES, "comment"],
    );
});

test("HTS model drops legacy fields and supplies solver defaults", () => {
    const [material] = toHtsLibraryModel([{
        kind: "HTS",
        name: "Legacy",
        data: {
            j_HC0: 2300,
            m2_dh: 0.5,
            m2_n: 4,
            comment: "Описание",
        },
    }]);

    assert.equal(Object.hasOwn(material, "m2_dh"), false);
    assert.equal(Object.hasOwn(material, "m2_n"), false);
    assert.equal(material.KHabc, 1);
    assert.equal(material.Diag, 0);
    assert.equal(material.M3D, false);
    assert.equal(material.j_ani, true);
});

test("normalized legacy HTS material serializes as the current local format", () => {
    const legacyProperty = Object.fromEntries(
        HTS_PARAMETER_NAMES
            .filter(name => !["j_ani", "KHabc", "Diag", "M3D"].includes(name))
            .map((name, index) => [name, index + 1]),
    );
    const [material] = toHtsLibraryModel([{
        kind: "HTS",
        name: "Legacy",
        data: {
            ...legacyProperty,
            m2_dh: 0.5,
            m2_dm: 0.25,
            m2_n: 4,
            comment: "Описание",
        },
    }]);

    const file = createHtsMaterialFile(material);
    assert.deepEqual(
        Object.keys(file.data),
        [...HTS_PARAMETER_NAMES, "comment"],
    );
    assert.equal(file.data.KHabc, 1);
    assert.equal(file.data.Diag, 0);
    assert.equal(file.data.M3D, false);
    assert.equal(file.data.j_ani, true);
    assert.equal(file.text.includes("m2_dh"), false);
});

test("isotropic HTS choice survives model projection, save and reload", () => {
    const legacyProperty = Object.fromEntries(
        HTS_PARAMETER_NAMES
            .filter(name => !["j_ani", "KHabc", "Diag", "M3D"].includes(name))
            .map((name, index) => [name, index + 1]),
    );
    const [material] = toHtsLibraryModel([{
        name: "Изотропная ВТСП",
        data: { ...legacyProperty, j_ani: false },
    }]);
    assert.equal(material.j_ani, false);
    const file = createHtsMaterialFile(material);
    const data = JSON.parse(file.text);
    assert.equal(data.j_ani, false);
    const [reloaded] = toHtsLibraryModel([{ name: material.name, data }]);
    assert.equal(reloaded.j_ani, false);
});
