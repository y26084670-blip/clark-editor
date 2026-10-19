import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { expandOMContract, formatOMJson, parseOMJson, readOMTask, readOMTaskPulses, saveOMTask, setOMTaskEnabled, usesTaskPulses, validateOMInputs, validateOMPreset } from "../src/services/omClientService.js";

const presets = {};
for (const name of ["circuit-single", "circuit-star"]) {
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
        async removeEntry(name) { fs.beforeRemove?.(name); files.delete(name); },
    };
    fs.task = { async getDirectoryHandle(name) { assert.equal(name, "input3XX"); return fs.input; } };
    return fs;
}
const diskPulse = (times = [0, 1, 2], values = [0, 1, -1]) => JSON.stringify({ n: times.length, impuls: [...times, ...values] }) + "\n";
const draft = p => ({ selection: p.selection, dataText: formatOMJson(p.data), couplingText: formatOMJson(p.coupling) });

function storedModel(enabled = true) {
    const p = fresh();
    return filesystem({ [enabled ? "om-client.json" : "_om-client.json"]: JSON.stringify(p.selection),
        [p.selection.dataFile]: formatOMJson(p.data), [p.selection.couplingFile]: formatOMJson(p.coupling),
        "amplitudes.txt": diskPulse() });
}

test("missing, active and disabled models read distinctly; duplicate selectors are a conflict", async () => {
    const none = await readOMTask(filesystem().task);
    assert.equal(none.selection, null);
    for (const enabled of [true, false]) {
        const fs = storedModel(enabled), result = await readOMTask(fs.task);
        assert.equal(result.enabled, enabled);
        assert.equal(result.selection.model, "circuit");
        assert.equal(result.baseline[enabled ? "_om-client.json" : "om-client.json"], null);
        fs.files.set(enabled ? "_om-client.json" : "om-client.json", JSON.stringify(fresh().selection));
        await assert.rejects(readOMTask(fs.task), /одновременно/);
    }
});

test("disconnect and reconnect preserve selector bytes, parameters, links and pulses", async () => {
    const fs = storedModel(), original = new Map(fs.files);
    let snapshot = await readOMTask(fs.task);
    snapshot = await setOMTaskEnabled(fs.task, false, snapshot.baseline);
    assert.equal(snapshot.enabled, false);
    assert.equal(fs.files.has("om-client.json"), false);
    assert.equal(fs.files.get("_om-client.json"), original.get("om-client.json"));
    snapshot = await setOMTaskEnabled(fs.task, true, snapshot.baseline);
    assert.equal(snapshot.enabled, true);
    assert.deepEqual(fs.files, original);
});

test("saving disabled model data never reconnects it", async () => {
    const fs = storedModel(false), snapshot = await readOMTask(fs.task), p = fresh();
    const data = parseOMJson(snapshot.dataText); data.branches[0].L_H = 7;
    const saved = await saveOMTask(fs.task, { ...snapshot, dataText: formatOMJson(data) }, p, snapshot.baseline);
    assert.equal(saved.enabled, false);
    assert.equal(fs.files.has("om-client.json"), false);
    assert.equal(parseOMJson(fs.files.get(p.selection.dataFile)).branches[0].L_H, 7);
    await setOMTaskEnabled(fs.task, true, saved.baseline);
    assert.equal(fs.files.has("_om-client.json"), false);
});

test("toggle rejects stale data or an occupied destination before writing", async () => {
    for (const name of ["_om-client.json", "circuit-config.json", "om-client.json"]) {
        const fs = storedModel(), snapshot = await readOMTask(fs.task);
        fs.files.set(name, "external");
        const before = new Map(fs.files);
        await assert.rejects(setOMTaskEnabled(fs.task, false, snapshot.baseline), /изменён/);
        assert.deepEqual(fs.files, before);
        assert.deepEqual(fs.writes, []);
    }
});

test("failed removal rolls back the copied selector without changing model data", async () => {
    const fs = storedModel(), snapshot = await readOMTask(fs.task), before = new Map(fs.files);
    fs.beforeRemove = name => { if (name === "om-client.json") throw new Error("Denied"); };
    await assert.rejects(setOMTaskEnabled(fs.task, false, snapshot.baseline), /Denied/);
    assert.deepEqual(fs.files, before);
});

test("external edits during toggle are preserved; an external destination is never removed", async () => {
    for (const name of ["om-client.json", "_om-client.json"]) {
        const fs = storedModel(), snapshot = await readOMTask(fs.task);
        fs.afterWrite = () => fs.files.set(name, "external");
        await assert.rejects(setOMTaskEnabled(fs.task, false, snapshot.baseline));
        assert.equal(fs.files.get(name), "external");
        if (name === "om-client.json") assert.equal(fs.files.has("_om-client.json"), false);
        else assert.equal(fs.files.get("om-client.json"), snapshot.baseline["om-client.json"]);
    }
});

test("model presets validate without requiring a task pulse bank", () => {
    for (const preset of Object.values(presets)) assert.equal(validateOMPreset(preset), preset);
    assert.equal(usesTaskPulses(presets["circuit-single"]), true);
    assert.equal(Object.keys(presets).length, 2);
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
    delete p.contract.ui; // Legacy/custom descriptor without a presentation extension.
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
    delete q.contract.ui;
    assert.throws(() => validateOMPreset(q), /source: task-pulse/);
    const r = fresh(); r.selection.version = "1.0.0";
    validateOMInputs(r.selection, r.data, r.coupling, presets["circuit-single"], amplitudes);
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
    assert.match(run(...args), /Сначала сохраните изменения вкладки «Импульсы»/);
    args[0].amplitudesDirty = false;
    assert.equal(run(...args), "");
    args[0].amplitudes = [];
    assert.match(run(...args), /импульс №1 отсутствует/);
});

for (const [phases, parallel, floating] of [[1,1,false],[3,2,false],[1,2,true],[3,1,true],[6,4,true]]) {
  test(`one preset accepts active ${phases}x${parallel}, floating=${floating}`, () => {
    const p = fresh(), n = phases * parallel;
    p.contract.dimensions.phases.maximum = 6;
    p.contract.dimensions.parallel.maximum = 4;
    Object.assign(p.data, { phases, parallel, floatingNeutral: floating,
      branches: Array.from({ length: n }, () => ({ L_H: 0, R_Ohm: 1 })),
      emf: Array.from({ length: phases }, () => ({ pulse: 1, amplitude: 0 })) });
    for (const side of ["inputs", "outputs"]) for (const group of p.coupling[side]) group.indices = Array.from({ length: n }, (_, i) => i + 1);
    validate(p);
    const contract = expandOMContract(p.contract, p.data);
    assert.equal(contract.selectedVariant, floating ? "floating" : "grounded");
    assert.equal(contract.inputs[0].variables.length, n);
    assert.equal(contract.inputs[0].variables.at(-1), `fieldPort.current[${n}]`);
    assert.equal(contract.tables.length, phases);
    assert.equal(contract.parameterBindings.length, 3 + 2 * n);
    assert.equal(p.contract.inputs[0].variables.length, 1);
  });
}

test("capacity overflow, ambiguous neutral, unused entries and isolated single branch are rejected", () => {
  const p = fresh();
  p.contract.dimensions.phases.maximum = 6;
  p.data.phases = 7;
  assert.throws(() => validate(p), /пакет допускает не более 6/);
  p.data.phases = 1; p.data.floatingNeutral = true;
  assert.throws(() => validate(p), /минимум 2/);
  p.data.floatingNeutral = "false";
  assert.throws(() => validate(p), /однозначно/);
  p.data.floatingNeutral = false;
  p.data.branches.push({ L_H: 0, R_Ohm: 0 });
  assert.throws(() => validate(p), /branches: требуется 1/);
  p.schema = "clark-om-preset/1";
  assert.throws(() => validateOMPreset(p), /clark-om-preset\/2/);
});

test("model version is optional information and does not select a preset", () => {
    const p = fresh();
    for (const version of [undefined, "old-build", "2.0.0", "../informational text"]) {
        const selection = { ...p.selection, version };
        if (version === undefined) delete selection.version;
        validateOMInputs(selection, p.data, p.coupling, p, amplitudes);
    }
    assert.throws(() => validateOMInputs({ ...p.selection, model: "different" }, p.data, p.coupling, p, amplitudes), /пресет/);
});

test("Newton increment defaults for existing tasks and rejects invalid values", () => {
    const p = fresh(); delete p.data.currentIncrement;
    validate(p);
    for (const value of [0, -1, NaN, "10"]) {
        p.data.currentIncrement = value;
        assert.throws(() => validate(p));
    }
});
