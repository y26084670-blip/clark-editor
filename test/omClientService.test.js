import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { formatOMJson, parseOMJson, readOMTaskPulses, saveOMTask, usesTaskPulses, validateOMInputs, validateOMPreset } from "../src/services/omClientService.js";

const presets = {};
for (const name of ["circuit-single", "circuit-star", "circuit-test-204"]) {
    presets[name] = JSON.parse(await readFile(new URL(`../src/data/om-presets/${name}.json`, import.meta.url), "utf8"));
}
const fresh = (name = "circuit-single") => structuredClone(presets[name]);
const pulse = values => ({ impuls: values });
const amplitudes = [pulse([[0, 0], [1, 1], [2, -1]])];
const validate = (p, amps = amplitudes) => validateOMInputs(p.selection, p.data, p.coupling, p, amps);

function filesystem(initial = {}) {
    const files = new Map(Object.entries(initial)), writes = [];
    const fs = { files, writes, afterWrite: null };
    const missing = () => Object.assign(new Error("Missing file"), { name: "NotFoundError" });
    fs.input = {
        async getFileHandle(name, options = {}) {
            if (!files.has(name)) {
                if (!options.create) throw missing();
                files.set(name, "");
            }
            return {
                async getFile() {
                    if (!files.has(name)) throw missing();
                    const text = files.get(name);
                    return { size: Buffer.byteLength(text), text: async () => text };
                },
                async createWritable() {
                    let text;
                    return { async write(value) { text = value; }, async close() {
                        files.set(name, text); writes.push(name); fs.afterWrite?.(name);
                    }, async abort() {} };
                },
            };
        },
        async removeEntry(name) { files.delete(name); },
    };
    fs.task = { async getDirectoryHandle(name) { assert.equal(name, "input3XX"); return fs.input; } };
    return fs;
}
const diskPulse = (times = [0, 1, 2], values = [0, 1, -1]) => JSON.stringify({ n: times.length, impuls: [...times, ...values] }) + "\n";
const draft = p => ({ selection: p.selection, dataText: formatOMJson(p.data), couplingText: formatOMJson(p.coupling) });

test("model presets validate without requiring a task pulse bank", () => {
    for (const preset of Object.values(presets)) assert.equal(validateOMPreset(preset), preset);
    assert.equal(usesTaskPulses(presets["circuit-single"]), true);
    assert.equal(presets["circuit-test-204"].selection.model, "circuit-p3-b1-grounded");
    assert.deepEqual(presets["circuit-test-204"].data.emf, [8, 9, 10].map(pulse => ({ pulse, amplitude: 100 })));
});

test("pulse references validate the original read-only task table and allow signed scaling", () => {
    const p = fresh(), before = JSON.stringify(amplitudes);
    p.data.emf[0].amplitude = -220;
    assert.equal(validate(p).data, p.data);
    assert.equal(JSON.stringify(amplitudes), before);
    p.data.emf[0].amplitude = 0;
    validate(p);
});

for (const invalid of [0, -1, 1.5, "1", 2147483648]) {
    test(`invalid pulse reference ${JSON.stringify(invalid)} is rejected`, () => {
        const p = fresh(); p.data.emf[0].pulse = invalid;
        assert.throws(() => validate(p), /номер импульса/);
    });
}
test("missing task references and invalid scale are rejected", () => {
    const p = fresh();
    assert.throws(() => validate(p, []), /импульс №1 отсутствует/);
    p.data.emf[0].amplitude = Infinity;
    assert.throws(() => validate(p), /конечное число/);
    p.data.emf[0].amplitude = "220";
    assert.throws(() => validate(p), /конечное число/);
});

for (const points of [[], [[0, 1]], [[0, 1], [0, 2]], [[1, 1], [0, 2]], [[0, 1], [1, NaN]], [[0, 1], [Infinity, 2]], [[0, 1, 2], [1, 2]]]) {
    test(`invalid referenced pulse ${JSON.stringify(points)} is rejected`, () => {
        assert.throws(() => validate(fresh(), [pulse(points)]));
    });
}
test("overflow after scaling is rejected even when inputs are individually finite", () => {
    const p = fresh(); p.data.emf[0].amplitude = 1e308;
    assert.throws(() => validate(p, [pulse([[0, 1], [1, 2]])]), /после масштабирования/);
});

test("task-pulse descriptors support future model input paths without an emf special case", () => {
    const p = fresh();
    p.data.drive = { signal: 1, gain: 10 };
    p.contract.tables = [{ name: "drive", source: "task-pulse", pulsePath: ["drive", "signal"], scalePath: ["drive", "gain"] }];
    validate(p);
    p.contract.tables[0].source = "unknown";
    assert.throws(() => validate(p), /source: task-pulse/);
});

test("old circuit schema and inline table presets are rejected without conversion", () => {
    const p = fresh(); p.data.schema = p.contract.dataSchema = "clark-circuit/1";
    assert.throws(() => validate(p), /больше не поддерживается/);
    const q = fresh(); q.contract.tables = [{ name: "emf1", path: ["emf", 0, "points"] }];
    assert.throws(() => validateOMPreset(q), /source: task-pulse/);
    const r = fresh(); r.selection.version = "1.0.0";
    assert.throws(() => validateOMInputs(r.selection, r.data, r.coupling, presets["circuit-single"], amplitudes), /модели и версии/);
});

test("saved pulse bank uses JSON Lines and column-major [all times, all values]", async () => {
    const fs = filesystem({ "amplitudes.txt": "\uFEFF" + diskPulse() + diskPulse([0, 3], [4, 5]).replace(/\n/g, "\r\n") });
    const result = await readOMTaskPulses(fs.input);
    assert.deepEqual(result.amplitudes, [...amplitudes, pulse([[0, 4], [3, 5]])]);
});

test("blank disk records and invalid unreferenced pulses are rejected consistently with native launch", async () => {
    for (const text of [diskPulse() + "\n" + diskPulse(), diskPulse() + "\n", diskPulse() + '{"n":0,"impuls":[]}', diskPulse() + diskPulse([1, 0], [0, 1])]) {
        const fs = filesystem({ "amplitudes.txt": text });
        await assert.rejects(readOMTaskPulses(fs.input));
    }
    assert.throws(() => validate(fresh(), [...amplitudes, pulse([[0, 0]])]), /Импульс №2/);
});

test("saving pulse OM data validates disk and persists compact references without altering pulses", async () => {
    const p = fresh(), original = diskPulse(), fs = filesystem({ "amplitudes.txt": original });
    await saveOMTask(fs.task, draft(p), p, { "om-client.json": null });
    assert.equal(fs.files.get("amplitudes.txt"), original);
    assert.deepEqual(JSON.parse(fs.files.get("circuit-config.json")).emf, [{ pulse: 1, amplitude: 0 }]);
    assert.equal(fs.writes.at(-1), "om-client.json");
});

test("missing or malformed disk pulse banks cause no OM writes", async () => {
    const p = fresh();
    for (const initial of [{}, { "amplitudes.txt": '{"n":2,"impuls":[0,1,2]}\n' }, { "amplitudes.txt": "" }, { "amplitudes.txt": diskPulse([0, 0], [1, 2]) }]) {
        const fs = filesystem(initial);
        await assert.rejects(saveOMTask(fs.task, draft(p), p, { "om-client.json": null }));
        assert.deepEqual(fs.writes, []);
    }
});

test("a pulse file changed during OM save aborts and restores OM files without touching the external change", async () => {
    const p = fresh(), changed = diskPulse([0, 1, 2], [5, 6, 7]);
    const fs = filesystem({ "amplitudes.txt": diskPulse() });
    fs.afterWrite = name => { if (name === "circuit-config.json") fs.files.set("amplitudes.txt", changed); };
    await assert.rejects(saveOMTask(fs.task, draft(p), p, { "om-client.json": null }), /amplitudes.txt изменён/);
    assert.equal(fs.files.get("amplitudes.txt"), changed);
    assert.equal(fs.files.has("circuit-config.json"), false);
    assert.equal(fs.files.has("om-client.json"), false);
});

test("existing external OM edits are never overwritten", async () => {
    const p = fresh(), fs = filesystem({ "amplitudes.txt": diskPulse(), "circuit-config.json": "external" });
    await assert.rejects(saveOMTask(fs.task, draft(p), p, { "om-client.json": null }), /изменён вне этого окна/);
    assert.equal(fs.files.get("circuit-config.json"), "external");
    assert.deepEqual(fs.writes, []);
});

test("actual editor validation blocks OM save until changed amplitudes are saved", async () => {
    const source = await readFile(new URL("../src/components/tasks/OMClientWindow.jsx", import.meta.url), "utf8");
    const body = source.slice(source.indexOf("  const validation = createMemo("), source.indexOf("\n  createEffect("));
    const run = new Function("props", "draft", "activePreset", "parseOMJson", "validateOMInputs", "usesTaskPulses", `
      const createMemo = fn => fn, errorText = error => error.message; ${body}; return validation();`);
    const p = fresh();
    const args = [{ amplitudes, amplitudesDirty: true }, () => draft(p), () => p, parseOMJson, validateOMInputs, usesTaskPulses];
    assert.match(run(...args), /Сначала сохраните изменения вкладки «Амплитуды»/);
    args[0].amplitudesDirty = false;
    assert.equal(run(...args), "");
    args[0].amplitudes = [];
    assert.match(run(...args), /импульс №1 отсутствует/);
});
