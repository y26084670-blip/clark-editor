import test from "node:test";
import assert from "node:assert/strict";
import { loadJweakLocal, createJweakLocalLoader } from "../src/services/jweakLocalService.js";
const spec = { version: 1, coarse_divisions: [[1, 1, 4]] };
const bytes = value => new TextEncoder().encode(JSON.stringify(value));
const namedError = name => Object.assign(new Error(name), { name });
function directory(initial = bytes(spec)) {
    let value = initial;
    const calls = [];
    const handle = { async getDirectoryHandle(name, options) {
        calls.push(["directory", name, options]);
        if (handle.directoryError) throw handle.directoryError;
        return { async getFileHandle(name, options) {
            calls.push(["file", name, options]);
            if (handle.fileError) throw handle.fileError;
            if (value === null) throw namedError("NotFoundError");
            return { async getFile() {
                calls.push(["read"]);
                const copy = new Uint8Array(value);
                return { arrayBuffer: async () => copy.buffer, lastModified: 1 };
            } };
        } };
    } };
    return { handle, calls, set: next => { value = next; } };
}

test("companion load reads only, retains exact bytes and never creates files", async () => {
    const fs = directory();
    const section = await loadJweakLocal(fs.handle);
    assert.equal(section.status, "ready");
    assert.deepEqual(section.data, spec);
    assert.deepEqual(section.bytes, bytes(spec));
    assert.ok(fs.calls.filter(c => c[0] !== "read").every(c => c[2] === undefined));
    assert.deepEqual(fs.calls.filter(c => c[0] === "file").map(c => c[1]), ["jweak_local.json"]);
});
test("only a missing companion, not a missing input directory, means ordinary mode", async () => {
    const fs = directory(null);
    const absent = await loadJweakLocal(fs.handle);
    assert.deepEqual(absent, { status: "absent" });
    fs.handle.directoryError = namedError("NotFoundError");
    assert.equal((await loadJweakLocal(fs.handle)).status, "error");
});
test("permission errors, malformed JSON, unsupported version and invalid UTF-8 do not fall back", async () => {
    const fs = directory();
    fs.handle.fileError = namedError("NotAllowedError");
    assert.equal((await loadJweakLocal(fs.handle)).status, "error");
    delete fs.handle.fileError;
    for (const value of [new TextEncoder().encode("{"), bytes({ ...spec, version: 2 }), new Uint8Array([255])]) {
        fs.set(value);
        const result = await loadJweakLocal(fs.handle);
        assert.equal(result.status, "error");
    }
});
test("external addition, editing and removal are read as current input without a conflict", async () => {
    const fs = directory(null);
    assert.equal((await loadJweakLocal(fs.handle)).status, "absent");
    fs.set(bytes(spec));
    assert.deepEqual((await loadJweakLocal(fs.handle)).data, spec);
    const edited = { ...spec, coarse_divisions: [[1, 1, 8]] };
    fs.set(bytes(edited));
    assert.deepEqual((await loadJweakLocal(fs.handle)).data, edited);
    fs.set(null);
    assert.equal((await loadJweakLocal(fs.handle)).status, "absent");
});
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; }
test("task replacement, reload and disposal discard late companion reads", async () => {
    const a = deferred(), b = deferred(), out = [];
    const loader = createJweakLocalLoader(value => out.push(value), key => key.promise);
    const first = loader.load(a), second = loader.load(b);
    const latest = { status: "ready", data: spec };
    b.resolve(latest); await second;
    a.resolve({ status: "absent" }); await first;
    assert.equal(out.at(-1), latest);
    const c = deferred(), third = loader.load(c);
    await loader.load(null);
    c.resolve(latest); await third;
    assert.equal(out.at(-1), null);
    const d = deferred(), fourth = loader.load(d);
    loader.dispose(); const count = out.length;
    d.resolve(latest); await fourth;
    assert.equal(out.length, count);
});
test("load rejection is published as an error, not an unhandled promise", async () => {
    const out = [];
    await createJweakLocalLoader(value => out.push(value), async () => { throw new Error("disk"); }).load({});
    assert.equal(out.at(-1).status, "error");
});
