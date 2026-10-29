import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";

const server = await createServer({ configFile: false, appType: "custom",
    server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] } });
after(() => server.close());
const { clearPlanarModeMarker, refreshPlanarModeMarker } = await server.ssrLoadModule("/src/services/taskPlanarModeService.js");
const { dataService } = await server.ssrLoadModule("/src/services/dataService.js");
const { serialize } = await server.ssrLoadModule("/src/services/model/modelSerializer.js");
const { default: generalSchema } = await server.ssrLoadModule("/src/services/schemas/general.schema.js");
const { default: elementsSchema } = await server.ssrLoadModule("/src/services/schemas/elements.schema.js");
const marker = "_2d.e3d";
const missing = () => Object.assign(new Error("Missing"), { name: "NotFoundError" });
function fixture() {
    const files = new Map(), calls = [];
    const input = {
        async getFileHandle(name, options = {}) {
            calls.push(["get", name, options.create]);
            if (!files.has(name)) {
                if (!options.create) throw missing();
                files.set(name, "");
            }
            return { async getFile() { return { text: async () => files.get(name) }; } };
        },
        async removeEntry(name) { calls.push(["remove", name]); if (!files.delete(name)) throw missing(); },
    };
    const task = { async getDirectoryHandle(name) { assert.equal(name, "input3XX"); return input; } };
    const vector = a => a.map(v => [v]);
    const general = { ...dataService.createDefaultData(generalSchema), doubleFloat: true,
        fullAxialSymmetry: false, mirrorSymmetryX: -1, mirrorSymmetryY: -1 };
    const element = { ...dataService.createDefaultRecord(elementsSchema), name: "Tape", geoType: 2,
        geo: Array.from({ length: 8 }, (_, i) => i === 0 ? [20, 2, 3] : [0, 0, 0]),
        dr: vector([-10, 0, 0]), dp: vector([1, 2, 3]), symVi: vector([0, 0, 0]), symR0: vector([0, 0, 0]),
        symLs: 1, symAs: 1, symPs: 1, symTx: 0, symYl: 0, symYa: 0 };
    const writeGeometry = () => {
        files.set("general.txt", JSON.stringify(serialize(general, generalSchema)));
        files.set("kvs.txt", serialize([element], elementsSchema).map(row => JSON.stringify(row)).join("\n"));
    };
    writeGeometry();
    return { task, input, files, calls, general, element, writeGeometry };
}

test("the real saved-input loader creates and removes the marker without altering input contents", async () => {
    const f = fixture(), saved = [...f.files];
    assert.equal(await refreshPlanarModeMarker(f.task), true);
    assert.equal(f.files.has(marker), true);
    assert.deepEqual([...f.files].filter(([name]) => name !== marker), saved);
    // An in-memory edit alone must not change the persisted task's marker.
    f.element.dp[0][0] = 2;
    assert.equal(await refreshPlanarModeMarker(f.task), true);
    f.writeGeometry();
    assert.equal(await refreshPlanarModeMarker(f.task), false);
    assert.equal(f.files.has(marker), false);
    await clearPlanarModeMarker(f.task); // idempotent
});

test("malformed or missing geometry removes a stale marker instead of certifying a subset", async () => {
    for (const [name, value] of [["general.txt", "bad JSON"], ["kvs.txt", "{bad"], ["kvs.txt", ""]]) {
        const f = fixture(); f.files.set(marker, ""); f.files.set(name, value);
        assert.equal(await refreshPlanarModeMarker(f.task), false);
        assert.equal(f.files.has(marker), false);
    }
});

test("a stale validation cannot write, and an in-flight marker write finishes before Save invalidation", async () => {
    const f = fixture();
    assert.equal(await refreshPlanarModeMarker(f.task, { isCurrent: () => false }), null);
    assert.equal(f.files.has(marker), false);
    let release, entered;
    const gate = new Promise(done => { release = done; });
    const started = new Promise(done => { entered = done; });
    const get = f.input.getFileHandle;
    f.input.getFileHandle = async (name, options) => {
        if (name === marker && options?.create) { entered(); await gate; }
        return get(name, options);
    };
    const check = refreshPlanarModeMarker(f.task);
    await started;
    const clear = clearPlanarModeMarker(f.task);
    release(); await check; await clear;
    assert.equal(f.files.has(marker), false);
});

test("write failures propagate and do not poison subsequent marker operations", async () => {
    const f = fixture(), get = f.input.getFileHandle;
    f.input.getFileHandle = async (name, options) => {
        if (name === marker) throw new Error("denied");
        return get(name, options);
    };
    await assert.rejects(refreshPlanarModeMarker(f.task), /denied/);
    f.input.getFileHandle = get;
    assert.equal(await refreshPlanarModeMarker(f.task), true);
});
