import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../src/App.jsx", import.meta.url);
const panelUrl = new URL("../src/components/SidePanel.jsx", import.meta.url);

test("column visibility is absent from the shared side panel", async () => {
    const source = await readFile(panelUrl, "utf8");
    assert.doesNotMatch(source, /Вычисляемые колонки|computedColumnsMode|onComputedColumnsModeChange/u);
});

test("element side panel explains material selection", async () => {
    const source = await readFile(panelUrl, "utf8");

    assert.match(
        source,
        /Выбрать элементы в списке, нажать кнопку и выбрать/u,
    );
    assert.match(
        source,
        /характеристику в появившемся диалоге/u,
    );
});

test("element side panel clears selected material names", async () => {
    const [app, panel] = await Promise.all([
        readFile(appUrl, "utf8"),
        readFile(panelUrl, "utf8"),
    ]);

    assert.match(panel, />\s*Сделать немагнитными\s*<\/button>/u);
    assert.match(panel, /onClick=\{props\.onMakeNonmagnetic\}/u);
    assert.match(app, /function handleMakeElementsNonmagnetic/u);
    assert.match(app, /selectedElementsRequest/u);
    assert.match(app, /clearSelectedElementMaterials/u);
    assert.match(
        app,
        /onMakeNonmagnetic=\{handleMakeElementsNonmagnetic\}/u,
    );
});
