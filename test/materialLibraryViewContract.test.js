import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { HTS_PARAMETER_NAMES } from
    "../src/services/materials/materialConstants.js";
import {
    createHtsMaterialDetailSchema,
    decodeFmmTable,
} from "../src/services/materials/materialLibraryModel.js";

test("FMM detail projection preserves a long H-M table", () => {
    const storage = [
        ...Array.from({ length: 894 }, (_, index) => index),
        ...Array.from({ length: 894 }, (_, index) => 100 + index),
    ];
    const rows = decodeFmmTable(storage);

    assert.equal(rows.length, 894);
    assert.ok(rows.every(row => row.length === 2));
    assert.deepEqual(rows[4], [4, 104]);
});

test("HTS detail contract lists eighteen current scalar parameters", () => {
    assert.equal(HTS_PARAMETER_NAMES.length, 18);
    assert.deepEqual(
        HTS_PARAMETER_NAMES.slice(3, 6),
        ["JCb", "j_ani", "j_type"],
    );
    assert.deepEqual(
        HTS_PARAMETER_NAMES.slice(-3),
        ["KHabc", "Diag", "M3D"],
    );

    const detailSchema = createHtsMaterialDetailSchema({
        id: "htsLibrary",
        config: {},
        views: {},
        properties: Object.fromEntries(
            HTS_PARAMETER_NAMES.map(name => [name, {
                type: "float",
                label: name,
                readonly: true,
            }]),
        ),
    });
    assert.deepEqual(
        Object.keys(detailSchema.properties),
        HTS_PARAMETER_NAMES,
    );
    assert.ok(
        Object.values(detailSchema.properties)
            .every(property => property.readonly === false),
    );
    assert.deepEqual(
        detailSchema.views.recordsAsColumns.labels,
        ["Значение"],
    );
});

test("material details have content-sized defaults and HTS comments", () => {
    const registry = readFileSync(
        new URL("../src/services/materialTabRegistry.js", import.meta.url),
        "utf8",
    );
    const tab = readFileSync(
        new URL("../src/tabs/MaterialLibraryTab.jsx", import.meta.url),
        "utf8",
    );
    const schema = readFileSync(
        new URL("../src/services/schemas/htsLibrary.schema.js", import.meta.url),
        "utf8",
    );
    const detailView = readFileSync(
        new URL("../src/tabulator/views/HtsMaterialDetailView.js", import.meta.url),
        "utf8",
    );

    assert.match(registry, /property:\s*"tabl",\s*defaultHeight:\s*400,/u);
    assert.match(registry, /type:\s*"record",\s*defaultHeight:\s*540,/u);
    assert.match(tab, /definition\.detail\.defaultHeight \?\? 360/u);
    assert.match(schema, /"j_HC0",\s*"Критическая индукция/u);
    assert.match(schema, /"j_type",\s*"Тип модели: 1 — tanh, 2 — степенная"/u);
    assert.match(schema, /"M3D",\s*"Использовать режим 3D"/u);
    assert.match(detailView, /columns\[0\]\.tooltip/u);
    assert.match(detailView, /properties\[propertyName\]\?\.description/u);
});

test("material library waits for Tabulator before its initial data load", () => {
    const source = readFileSync(
        new URL("../src/tabs/MaterialLibraryTab.jsx", import.meta.url),
        "utf8",
    );
    const creationStart = source.indexOf("function createTable()");
    const loadStart = source.indexOf("async function loadRecords");
    const mountStart = source.indexOf("onMount(() =>");
    const effectStart = source.indexOf("createEffect(() =>", mountStart);
    const tableCreation = source.slice(creationStart, loadStart);
    const mount = source.slice(mountStart, effectStart);

    assert.ok(creationStart >= 0 && loadStart > creationStart);
    assert.ok(mountStart >= 0 && effectStart > mountStart);
    assert.ok(
        tableCreation.indexOf("new Tabulator")
            < tableCreation.indexOf('table.on("tableBuilt"'),
    );
    assert.match(
        tableCreation,
        /table\.on\("tableBuilt",[\s\S]*setTableReady\(true\)/,
    );
    assert.doesNotMatch(mount, /setTableReady\(true\)/);
});
