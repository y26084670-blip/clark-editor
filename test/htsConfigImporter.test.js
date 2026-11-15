import test from "node:test";
import assert from "node:assert/strict";

import {
    createHtsMaterialFile,
    HTS_PROPERTY_KEYS,
    htsMaterialStorageRecord,
    parseHtsConfig,
    parseHtsMaterial,
    serializeHtsMaterial,
} from "../src/services/materialImport/htsConfigImporter.js";
import {
    buildHtsConfig,
    utf8Bytes,
    windows1251Bytes,
} from "./fixtures/materialImportFixtures.js";

for (const version of [201, 202, 203, 204]) {
    test(`HTS config version ${version} produces canonical current property`, () => {
        const parsed = parseHtsConfig(buildHtsConfig(version));

        assert.equal(parsed.version, version);
        assert.equal(parsed.property.j_HC0, 2300);
        assert.equal(parsed.property.JC0, 150);
        assert.equal(parsed.property.j_ani, true);
        assert.equal(parsed.property.j_gmin, Math.fround(0.01));
        assert.equal(parsed.property.j1_delta, Math.fround(0.03));
        assert.equal(parsed.property.j2_n, 21);
        assert.equal(parsed.property.m_type, 3);
        assert.equal(parsed.property.m3_Mmax, 460);
        assert.equal(parsed.property.m3_a, version >= 202 ? 1 : 2);
        assert.equal(parsed.property.m3_b, version >= 202 ? 10 : 1);
        assert.equal(parsed.property.KHabc, 1);
        assert.equal(parsed.property.M3D, false);
        assert.equal(Object.hasOwn(parsed.property, "m2_dh"), false);
        assert.equal(Object.hasOwn(parsed.property, "KFC"), false);
        assert.equal(Object.hasOwn(parsed.property, "KMS"), false);
    });
}

test("HTS parser ignores non-ASCII config descriptions", () => {
    const bytes = utf8Bytes(buildHtsConfig(203));
    const headerStart = bytes.indexOf(0x0a) + 1;
    bytes[headerStart] = 0xff;

    assert.equal(parseHtsConfig(bytes).version, 203);
});

test("HTS material uses first comment line and supports CP1251 fallback", () => {
    const utf8 = parseHtsMaterial({
        name: "ВТСП 1",
        config: buildHtsConfig(203),
        comment: utf8Bytes("Первая строка\r\nВторая строка"),
    });
    assert.equal(utf8.record.comment, "Первая строка");

    const cp1251 = parseHtsMaterial({
        name: "ВТСП 2",
        config: buildHtsConfig(203),
        comment: windows1251Bytes("Комментарий"),
    });
    assert.equal(cp1251.record.comment, "Комментарий");
});

test("HTS material requires a nonempty comment file", () => {
    assert.throws(
        () => parseHtsMaterial({
            name: "ВТСП",
            config: buildHtsConfig(203),
            comment: new Uint8Array(),
        }),
        /comment\.txt пуст/,
    );
});

test("HTS serializer writes current keys only and excludes transient metadata", () => {
    const { version, record } = parseHtsMaterial({
        name: "ВТСП",
        config: buildHtsConfig(204),
        comment: "Описание",
    });
    const storage = htsMaterialStorageRecord(record);
    const file = createHtsMaterialFile(record, { version });

    assert.deepEqual(Object.keys(storage), HTS_PROPERTY_KEYS);
    assert.equal(Object.hasOwn(storage, "name"), false);
    assert.equal(Object.hasOwn(storage, "legacyVersion"), false);
    assert.equal(file.kind, "HTS");
    assert.equal(file.fileName, "ВТСП.txt");
    assert.equal(file.legacyVersion, 204);
    assert.deepEqual(file.data, storage);
    assert.equal(file.text, serializeHtsMaterial(record));
    assert.equal(file.text.endsWith("\n"), true);
});

test("HTS parser rejects unsupported, malformed and truncated configs", () => {
    assert.throws(
        () => parseHtsConfig(buildHtsConfig(205)),
        /Неподдерживаемая версия/,
    );

    const noTab = buildHtsConfig(203).replace("2300\tfixture", "2300 fixture");
    assert.throws(() => parseHtsConfig(noTab), /разделитель табуляции/);

    const truncated = buildHtsConfig(204).split(/\r?\n/).slice(0, 20).join("\n");
    assert.throws(() => parseHtsConfig(truncated), /оборван/);
});

test("HTS serializer defaults missing j_ani and rejects non-boolean values", () => {
    const record = Object.fromEntries(
        HTS_PROPERTY_KEYS.map(key => [
            key,
            key === "comment" ? "Описание" : key === "M3D" ? false : 1,
        ]),
    );
    delete record.j_ani;
    assert.equal(htsMaterialStorageRecord(record).j_ani, true);
    for (const value of [true, false]) {
        record.j_ani = value;
        assert.equal(JSON.parse(serializeHtsMaterial(record)).j_ani, value);
    }
    for (const value of [0, 1, "false", null, undefined]) {
        record.j_ani = value;
        assert.throws(
            () => serializeHtsMaterial(record),
            /j_ani.*логическим значением/u,
        );
    }
});

test("HTS material parser does not require unrelated version 204 circuit data", () => {
    const materialSectionOnly = buildHtsConfig(204)
        .split(/\r?\n/)
        .slice(0, 26)
        .join("\n");

    const parsed = parseHtsConfig(materialSectionOnly);
    assert.equal(parsed.version, 204);
    assert.equal(parsed.property.JC0, 150);
    assert.equal(parsed.property.m3_b, 10);
});

test("HTS parser rejects nonintegral model selectors", () => {
    assert.throws(
        () => parseHtsConfig(buildHtsConfig(203, { m_type: 1.5 })),
        /Mtype.*ожидалось целое/,
    );
    assert.throws(
        () => parseHtsConfig(buildHtsConfig(203, { j2_n: 20.5 })),
        /JMOD2N.*ожидалось целое/,
    );
});

test("Float32-backed HTS integer fields are not narrowed to Int32", () => {
    const parsed = parseHtsConfig(buildHtsConfig(203, {
        m_type: 3000000000,
        j2_n: 3000000000,
    }));

    assert.equal(parsed.property.m_type, Math.fround(3000000000));
    assert.equal(parsed.property.j2_n, Math.fround(3000000000));
});

test("extended and short positional configs give the same material", () => {
    const full = buildHtsConfig(204);
    const short = full.split(/\r?\n/).filter((_, i) => i !== 11).join("\n");
    assert.deepEqual(parseHtsConfig(full), parseHtsConfig(short));
});
