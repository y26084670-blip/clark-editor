import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentUrl = new URL(
    "../src/components/editors/DataEditor.jsx",
    import.meta.url,
);

test("record list actions require a loaded task and editing requires a writable task", async () => {
    const source = await readFile(componentUrl, "utf8");
    const disabled = source.match(/disabled=\{(?:props\.readOnly \|\| )?!hasActiveTask\(\)(?: \|\| jweakStructureLocked\(\))?\}/gu) ?? [];

    assert.equal(disabled.length, 6);
    assert.equal((source.match(/disabled=\{props\.readOnly \|\| !hasActiveTask\(\) \|\| jweakStructureLocked\(\)\}/gu) ?? []).length, 5);
    assert.match(source, /get mutable\(\) \{ return !props\.readOnly && !hasRecordColumns && !jweakStructureLocked\(\); \}/u);
    assert.match(source, /if \(!hasActiveTask\(\)\) return;/u);
    assert.match(source, /Сначала загрузите задание/u);
});

test("generator-enabled data tabs expose an accessible vertical splitter", async () => {
    const source = await readFile(componentUrl, "utf8");

    assert.match(source, /schema\.views\?\.generator/u);
    assert.match(source, /class="data-editor-main-splitter"/u);
    assert.match(source, /role="separator"/u);
    assert.match(source, /onPointerDown=\{beginMainResize\}/u);
    assert.match(source, /onKeyDown=\{handleMainSplitterKey\}/u);
});

test("main record selections are reported by stable zero-based row labels", async () => {
    const source = await readFile(componentUrl, "utf8");

    assert.match(source, /const reportsRecordSelection =/u);
    assert.match(source, /schema\.config\.storage === STORAGE_TYPES\.RECORDS/u);
    assert.match(source, /!hasMainView/u);
    assert.match(source, /!hasRecordColumns/u);
    assert.match(
        source,
        /Number\(row\?\.getData\?\.\(\)\?\.rowLabel\) - 1/u,
    );
    assert.match(source, /props\.onRecordSelectionChange\?\.\(/u);
    assert.match(source, /notifyRecordSelection\(rows\)/u);
    assert.match(source, /await table\.setData\(rows\);\s+notifyRecordSelection\(\);/u);
    assert.match(source, /await table\.replaceData\(rows\);\s+notifyRecordSelection\(\);/u);
    assert.match(source, /const update = publishTableChanged\(true\);\s+notifyRecordSelection\(\);/u);
});
