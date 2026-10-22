import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createServer } from "vite";
import { analyzeMed, medDiagnostics } from "../src/services/medAnalysisService.js";
import { applyMedResult, createMedRequest, medRequestIsCurrent } from "../src/services/medAutofillService.js";
import { parseJweakLocal } from "../src/services/solver/jweakLocalValidation.js";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
after(() => server.close());
const { default: schema } = await server.ssrLoadModule("/src/services/schemas/elements.schema.js");
const { deserialize, serialize } = await server.ssrLoadModule("/src/services/model/modelSerializer.js");
const { modelService } = await server.ssrLoadModule("/src/services/modelService.js");
const { unsavedChangesService } = await server.ssrLoadModule("/src/services/unsavedChangesService.js");
const fixture = name => readFileSync(new URL(`./fixtures/team7-med/${name}`, import.meta.url));
function team7() {
    return {
        general: JSON.parse(fixture("general.txt")), moves: [],
        elements: deserialize(fixture("kvs.txt").toString("utf8").trim().split(/\r?\n/u).map(JSON.parse), schema),
        jweakLocal: { status: "ready", data: parseJweakLocal(fixture("jweak_local.json").toString("utf8")),
            bytes: new Uint8Array(fixture("jweak_local.json")) },
    };
}
test("TEAM7 native fixtures retain owner-provided SHA-256", () => {
    for (const [name, hash] of Object.entries(JSON.parse(fixture("manifest.json")).sha256)) {
        assert.equal(createHash("sha256").update(fixture(name)).digest("hex"), hash);
    }
});
test("TEAM7: all 88 parents match, 32 false errors disappear, input and MED stay identical", () => {
    const m = team7(), before = structuredClone(m);
    const ordinary = analyzeMed({ ...m, jweakLocal: { status: "absent" } });
    assert.equal(ordinary.errors.filter(e => e.code === "GRID_MISMATCH").length, 32);
    const r = analyzeMed(m);
    assert.equal(m.elements.length, 83);
    assert.deepEqual(r.errors, []);
    assert.equal(r.contacts.length, 88);
    assert.equal(r.refinedBlocks.length, 16);
    assert.equal(r.ordinaryContactGrid.status, "incompatible");
    assert.equal(r.ordinaryContactGrid.conflicts.length, 32);
    assert.equal(r.counts.freeFaces, 154);
    assert.equal(r.changes.length, 0);
    assert.equal(r.canApply, false); // Nothing needs repair.
    assert.deepEqual(medDiagnostics(r), []);
    assert.deepEqual(m, before);
    const written = serialize(m.elements, schema);
    assert.ok(written.every((row, i) => row.dp.every((v, d) => v === m.elements[i].dp[d][0])));
    assert.ok(written.every(row => !Object.hasOwn(row, "contactDp")));
});
test("attachment publishes one snapshot, invalidates stale MED and is not a dirty/history item", () => {
    modelService.clearModel();
    const m = team7();
    modelService.setModelPart({ id: "general", config: { storage: "cluster" }, properties: {} }, m.general);
    modelService.setModelPart(schema, m.elements);
    unsavedChangesService.setBaseline("elements", modelService.getModel().elements);
    const before = modelService.getModel(), key = {}, request = createMedRequest(before, key);
    modelService.setJweakLocal(m.jweakLocal);
    assert.notEqual(modelService.getModel(), before);
    assert.equal(modelService.getModel().elements, before.elements);
    assert.equal(modelService.getModelPartUpdate("jweakLocal").data, m.jweakLocal);
    assert.equal(medRequestIsCurrent(request, modelService.getModel(), key), false);
    assert.equal(unsavedChangesService.hasDirty(), false);
    assert.equal(modelService.canUndo("elements"), false);
    assert.equal(modelService.canUndo("jweakLocal"), false);
    modelService.clearModel();
    assert.equal(modelService.getModel().jweakLocal, undefined);
});
test("hierarchical MED auto-fill still has one Undo/Redo item, with parents and dp untouched", () => {
    modelService.clearModel(); const m = team7(), key = {};
    m.elements[0].med[3] = [-1]; m.elements[1].med[2] = [-1];
    modelService.setModelPart({ id: "general", config: { storage: "cluster" }, properties: {} }, m.general);
    modelService.setModelPart(schema, m.elements);
    modelService.setJweakLocal(m.jweakLocal);
    const before = modelService.getModel(), request = createMedRequest(before, key);
    const r = analyzeMed(before);
    assert.equal(r.changes.length, 2);
    assert.equal(applyMedResult({ request, result: r, modelService, schema, taskKey: key }), true);
    assert.equal(modelService.getModel().elements[0].med[3][0], 2);
    assert.equal(modelService.getModel().jweakLocal, before.jweakLocal);
    assert.deepEqual(modelService.getModel().elements.map(e => e.dp), before.elements.map(e => e.dp));
    assert.equal(modelService.undo("elements"), true);
    assert.deepEqual(modelService.getModel().elements, before.elements);
    assert.equal(modelService.redo("elements"), true);
    assert.equal(analyzeMed(modelService.getModel()).changes.length, 0);
});

test("production MED worker accepts a structured-cloned hierarchical snapshot", async () => {
    const { Worker } = await import("node:worker_threads");
    const entry = new URL("../src/workers/medAnalysis.worker.js", import.meta.url).href;
    const code = `import {parentPort} from 'node:worker_threads';
        globalThis.self = {postMessage: data => parentPort.postMessage(data)};
        await import(${JSON.stringify(entry)});
        parentPort.on('message', data => self.onmessage({data}));`;
    const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(code)}`));
    try {
        const result = await new Promise((resolve, reject) => {
            worker.once("message", resolve); worker.once("error", reject);
            worker.postMessage(team7());
        });
        assert.equal(result.error, undefined);
        assert.deepEqual(result.result.errors, []);
        assert.equal(result.result.contacts.length, 88);
        assert.equal(result.result.gridLevel, "parent");
    } finally { await worker.terminate(); }
});
