import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { createRoot, createSignal, createEffect, onCleanup } from "solid-js/dist/solid.js";
import { createServer } from "vite";
import { diagnosticService } from "../src/services/diagnosticService.js";
import { createError } from "../src/tabulator/validators/common/createDiagnostic.js";
import { TABS } from "../src/services/schemas/common/constants.js";

const server = await createServer({ configFile: false, appType: "custom",
    server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] } });
after(() => server.close());
const { modelValidator } = await server.ssrLoadModule("/src/tabulator/validators/types/modelValidator.js");
const { default: schema } = await server.ssrLoadModule("/src/services/schemas/elements.schema.js");
const { dataService } = await server.ssrLoadModule("/src/services/dataService.js");
const source = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");

function region(startText, endText) {
    const start = source.indexOf(startText), end = source.indexOf(endText, start + startText.length);
    assert.ok(start >= 0 && end > start, startText);
    return source.slice(start, end);
}

// Execute the real button handler and its real collector/modelValidator.
// Only file/catalog access is doubled; no constraint-summary refresh is used.
const buttonRuntime = new Function("deps", `
    const {createSignal, createEffect, onCleanup, selectionService, modelService,
        diagnosticService, loadMaterialReferenceCatalog, loadJweakLocal,
        modelValidator, createError, TABS, setTimeout, clearTimeout, console} = deps;
    let modelValidationRevision = 0;
    ${region("  const [validationPending, setValidationPending]", "  const [savePending, setSavePending]")}
    ${region("  async function collectModelDiagnostics(", "  const tabs = [")}
    return {handleModelValidation, collectModelDiagnostics, validationPending};
`);

function model(names) {
    return {general: {useMED: false}, amps: [], moves: [], regions: [], mhj: null,
        elements: names.map(name => ({...dataService.createDefaultRecord(schema), name}))};
}

function nameDiagnostics(snapshot) {
    return modelValidator({getModel: () => snapshot}).filter(d => d.property === "name");
}

test("full model validation reports empty and whitespace-only names at original element rows", () => {
    const invalid = ["", " ", "\t\r\n", "\u00a0", "\u2003", " \t\u3000 "];
    const snapshot = model(["Первый", ...invalid, "Последний"]), before = structuredClone(snapshot);
    const messages = nameDiagnostics(snapshot);
    assert.equal(messages.length, invalid.length);
    assert.deepEqual(messages.map(d => [d.level, d.tab.id, d.row]),
        invalid.map((_, i) => ["error", "elements", i + 2]));
    assert.ok(messages.every(d => /назван/i.test(d.message)));
    assert.deepEqual(snapshot, before);
});

test("all element purposes require a name; absent and non-string names are errors", () => {
    const snapshot = model([undefined, null, 0, " "]);
    snapshot.elements.forEach((record, targ) => { record.targ = targ; });
    assert.deepEqual(nameDiagnostics(snapshot).map(d => [d.level, d.row]),
        [["error", 1], ["error", 2], ["error", 3], ["error", 4]]);
});

test("valid loaded names are preserved and an empty element table has no name errors", () => {
    const snapshot = model(["A", " Обмотка 1 ", "α", "Катушка\t1"]);
    const before = structuredClone(snapshot);
    assert.deepEqual(nameDiagnostics(snapshot), []);
    assert.deepEqual(snapshot, before);
    assert.deepEqual(nameDiagnostics(model([])), []);
});

test("Check model button publishes name ERROR and clears it after correction without opening the indicator", async t => {
    let snapshot = model(["Сосед", " "]), app;
    const taskHandle = {name: "Task"};
    diagnosticService.clearDiagnostics();
    diagnosticService.clearLoadResult();
    createRoot(dispose => {
        t.after(dispose);
        app = buttonRuntime({createSignal, createEffect, onCleanup, diagnosticService,
            selectionService: {loadedTaskHandle: () => taskHandle},
            modelService: {getModel: () => snapshot}, modelValidator, createError,
            TABS,
            loadMaterialReferenceCatalog: async () => ({catalog: {FMM: [], HTS: []}, errors: []}),
            loadJweakLocal: async () => {}, setTimeout: () => 1, clearTimeout: () => {}, console});
    });
    t.after(() => {diagnosticService.clearDiagnostics(); diagnosticService.clearLoadResult();});
    for (const name of ["", " ", "\t\u00a0"]) {
        snapshot = model(["Сосед", name]);
        await app.handleModelValidation();
        assert.equal(diagnosticService.validationLevel(), "error");
        const messages = diagnosticService.diagnostics();
        assert.equal(messages.length, 1);
        assert.equal(messages[0].property, "name");
        assert.equal(messages[0].row, 2);
        assert.equal(diagnosticService.modelValidationChecked(), true);
        assert.equal(app.validationPending(), null);
        snapshot = model(["Сосед", "Катушка"]);
        await app.handleModelValidation();
        assert.equal(diagnosticService.validationLevel(), "success");
        assert.ok(diagnosticService.diagnostics().every(d => d.level === "success"));
        assert.equal(app.validationPending(), null);
    }
});
