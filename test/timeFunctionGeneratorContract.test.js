import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentUrl = new URL(
    "../src/components/generator/TimeFunctionGenerator.jsx",
    import.meta.url,
);
const editorUrl = new URL(
    "../src/components/editors/DataEditor.jsx",
    import.meta.url,
);
const generatorCssUrl = new URL(
    "../src/components/generator/TimeFunctionGenerator.css",
    import.meta.url,
);
const editorCssUrl = new URL(
    "../src/components/editors/DataEditor.css",
    import.meta.url,
);
const detailRegionUrl = new URL(
    "../src/tabulator/views/DetailRegion.js",
    import.meta.url,
);
const graphRegionUrl = new URL(
    "../src/components/graphs/RecordGraphRegion.jsx",
    import.meta.url,
);
const tableViewUrl = new URL(
    "../src/tabulator/views/TableView.js",
    import.meta.url,
);

test("generator exposes preview, history context menu and explicit apply", async () => {
    const source = await readFile(componentUrl, "utf8");
    assert.match(source, /time-generator-section-title">Формула</u);
    assert.match(source, /Генерировать/u);
    assert.match(source, /Применить/u);
    assert.match(source, /onContextMenu=\{openContextMenu\}/u);
    assert.match(source, /saveFormulaHistory/u);
    assert.match(source, /loadFormulaHistory/u);
    assert.match(source, /setPreview\(\{/u);
    assert.match(source, /role="separator"/u);
    assert.match(source, /onPointerDown=\{beginGraphResize\}/u);
    assert.match(source, /placeholder=\{FORMULA_PLACEHOLDER\}/u);
    assert.match(source, /for \(const sourceLine of formula\(\)\.split/u);
    assert.match(source, /\.\.\.nextFormulas/u);
    assert.match(source, /Зарезервированные имена функций и констант/u);
    assert.doesNotMatch(source, /<span>Величина<\/span>/u);
    assert.doesNotMatch(source, /class="time-generator-help"/u);
    assert.match(source, /catch \(error\) \{\s*showError\(error\);/u);
});

test("DataEditor applies generated data and coordinates detail layouts", async () => {
    const [
        source,
        styles,
        detailSource,
        graphSource,
        tableViewSource,
    ] = await Promise.all([
        readFile(editorUrl, "utf8"),
        readFile(editorCssUrl, "utf8"),
        readFile(detailRegionUrl, "utf8"),
        readFile(graphRegionUrl, "utf8"),
        readFile(tableViewUrl, "utf8"),
    ]);
    assert.match(source, /applyGeneratedDependency/u);
    assert.match(source, /publishTableChanged\(false\)/u);
    assert.doesNotMatch(
        source.match(/async function applyGeneratedDependency[\s\S]*?\n  \}/u)?.[0] ?? "",
        /recordHistory:\s*true/u,
    );
    assert.match(source, /class="data-editor-horizontal-splitter"/u);
    assert.match(source, /onFieldChanged:\s*setDetailGraphField/u);
    assert.match(source, /field=\{detailGraphField\(\)\}/u);
    assert.match(source, /position:\s*"absolute"/u);
    assert.match(source, /inset:\s*"0"/u);
    assert.match(source, /data-fill-height=/u);
    assert.match(styles, /\.data-editor-main\.compact-reference/u);
    assert.match(
        styles,
        /\.data-editor-lower\.compact-reference\[data-fill-height="true"\]/u,
    );
    assert.match(detailSource, /fieldChangedHandler\?\.\(field\)/u);
    assert.match(
        graphSource,
        /recordGraphModeForProperty\(props\.schema, props\.field\)/u,
    );
    assert.doesNotMatch(graphSource, /record-graph-mode-switch/u);
    assert.match(tableViewSource, /fillsAvailableHeight\(\)/u);
    assert.match(tableViewSource, /height !== this\.lastHeight/u);
});


test("generator keeps its action row reachable when the panel is resized", async () => {
    const styles = await readFile(generatorCssUrl, "utf8");
    assert.match(
        styles,
        /\.time-generator-editor\s*\{[^}]*overflow-y:\s*auto;/u,
    );
    assert.match(
        styles,
        /\.time-generator-actions\s*\{[^}]*position:\s*sticky;[^}]*bottom:\s*0;/u,
    );
    assert.match(
        styles,
        /\.time-generator-splitter\s*\{[^}]*cursor:\s*row-resize;/u,
    );
    assert.match(styles, /\.time-generator-editor textarea\s*\{[^}]*min-height:\s*0;/u);
    assert.match(styles, /\.time-generator-editor textarea\s*\{[^}]*font-size:\s*14px;/u);
    assert.match(styles, /\.time-generator-workspace\s*\{[^}]*min-height:\s*0;/u);
    assert.match(
        styles,
        /\.time-generator-history\s*\{[^}]*padding-bottom:\s*35px;/u,
    );
    assert.match(
        styles,
        /\.time-generator-history select\s*\{[^}]*background:\s*#f2f5f7;/u,
    );
});
