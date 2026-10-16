import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL(
    "../public/examples/clark.projects/2026 Тест цепи 204/stat_TVV320-2D_Iv=1.0n_Ia=1.0n MINI OM/",
    import.meta.url,
));
const referenceRoot = path.join(root, "comparison/reference");
const read = relativePath => readFile(path.join(root, relativePath));
const json = async relativePath => JSON.parse(await read(relativePath));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const reference = await json("comparison/reference/reference.json");

test("OM example retains the supplied numerical inputs and their provenance", async () => {
    assert.equal(reference.sourceArchive.sha256,
        "58a7bfa7227d03df027f7d7857cd36b480bd93df26130e8e3182d6d5d40590c9");
    assert.equal(reference.sourceInputs.length, 10);
    for (const input of reference.sourceInputs) {
        const bytes = await read(input.path === "input3XX/amplitudes.txt"
            ? "comparison/reference/amplitudes.txt" : input.path);
        assert.equal(bytes.length, input.bytes, input.path);
        assert.equal(sha256(bytes), input.sha256, input.path);
    }
    const originalPulses = await read("comparison/reference/amplitudes.txt");
    const workingPulses = await read("input3XX/amplitudes.txt");
    assert.deepEqual(workingPulses.subarray(0, originalPulses.length), originalPulses);
    // The supplied material is authoritative; reimporting XAP.lib changes this node.
    const e33 = await json("input3XX/xapLibFMM/E33.txt");
    assert.equal(e33.tabl[3], 0.95095);
    const general = await json("input3XX/general.txt");
    assert.equal(general.timeStep, 0.0005000000237487257);
    assert.equal(general.countTimeSteps, 20);
    assert.equal(general.doubleFloat, true);
});

test("three phase sources reference appended exact waveforms without double scaling", async () => {
    const client = await json("input3XX/om-client.json");
    assert.equal(client.schema, "clark-om-client/1");
    assert.equal(client.model, "circuit-p3-b1-grounded");
    assert.equal(client.version, "1.1.0");
    const circuit = await json(`input3XX/${client.dataFile}`);
    assert.equal(circuit.schema, "clark-circuit/2");
    assert.equal(circuit.phases, 3);
    assert.equal(circuit.parallel, 1);
    assert.equal(circuit.floatingNeutral, false);
    assert.equal(Object.hasOwn(circuit, "amplitude"), false);
    assert.deepEqual(circuit.branches, Array.from({ length: 3 }, () => ({ L_H: 100, R_Ohm: 1 })));
    assert.deepEqual(circuit.emf, [8, 9, 10].map(pulse => ({ pulse, amplitude: 100 })));
    const pulses = (await read("input3XX/amplitudes.txt")).toString("utf8")
        .trim().split(/\r?\n/u).map(line => JSON.parse(line));
    assert.equal(pulses.length, 10);
    for (let phase = 0; phase < 3; phase += 1) {
        const rows = (await read(`comparison/reference/${phase + 1}.txt`)).toString("ascii")
            .trim().split(/\r?\n/u).map(line => line.trim().split(/\s+/u));
        assert.equal(Number(rows[0][0]), 80);
        const points = rows.slice(1).map(row => row.map(Number));
        assert.equal(points.length, 80);
        assert.deepEqual(pulses[phase + 7], {
            impuls: [...points.map(point => point[0]), ...points.map(point => point[1])],
            n: points.length,
        });
    }
    const coupling = await json(`input3XX/${client.couplingFile}`);
    assert.deepEqual(coupling.inputs, [{ kind: "AMP", indices: [1, 2, 3] }]);
    assert.deepEqual(coupling.outputs, [
        { kind: "PSI", indices: [1, 2, 3] },
        { kind: "RSP", indices: [1, 2, 3] },
    ]);
});

test("reference TSV copies all 21 protocol records with the original numeric text", async () => {
    for (const file of reference.referenceFiles) {
        const bytes = await readFile(path.join(referenceRoot, file.path));
        assert.equal(sha256(bytes), file.sha256, file.path);
    }
    const protocol = (await read("comparison/reference/prot-addon-out.txt")).toString("utf8");
    const rows = [];
    let header;
    for (const line of protocol.split(/\r?\n/u)) {
        if (line.startsWith("step=")) {
            const match = line.match(/^step=(\d+) time_s=(\S+) status=(\d+) message=(.*?) residual_norm=(\S+)$/u);
            assert.ok(match, line);
            header = { step: match[1], time: match[2], status: Number(match[3]), norm: Number(match[5]) };
        } else if (line.startsWith("Current_A\t")) {
            const currents = line.split("\t").slice(1);
            assert.equal(currents.length, 3);
            assert.ok(currents.every(value => Number.isFinite(Number(value))));
            rows.push({ ...header, currents });
        }
    }
    assert.deepEqual(rows.map(row => Number(row.step)), Array.from({ length: 21 }, (_, i) => i));
    assert.equal(rows[0].status, 0);
    assert.ok(rows.slice(1).every(row => row.status === 1));
    assert.ok(rows.every(row => Number(row.time) === Number(row.step) * 0.0005000000237487257));
    assert.equal(Math.max(...rows.slice(1).map(row => row.norm)), 4.879428288920897e-5);
    const expected = "step\ttime_s\tI1_A\tI2_A\tI3_A\n"
        + rows.map(row => [row.step, row.time, ...row.currents].join("\t") + "\n").join("");
    const tsv = await read("comparison/reference/currents.tsv");
    assert.equal(tsv.toString("utf8"), expected);
    assert.equal(sha256(tsv), reference.derivedReference.sha256);
});

// Exercise the real editor loaders and validators through read-only filesystem handles.
class ReadOnlyHandle {
    constructor(filePath, kind = "directory") {
        this.path = filePath;
        this.kind = kind;
        this.name = path.basename(filePath);
    }
    async getChild(name, directory) {
        const child = path.join(this.path, name);
        let info;
        try { info = await stat(child); }
        catch (error) {
            if (error.code === "ENOENT") throw new DOMException(name, "NotFoundError");
            throw error;
        }
        if (directory ? !info.isDirectory() : !info.isFile()) {
            throw new DOMException(name, "TypeMismatchError");
        }
        return new ReadOnlyHandle(child, directory ? "directory" : "file");
    }
    getDirectoryHandle(name) { return this.getChild(name, true); }
    getFileHandle(name) { return this.getChild(name, false); }
    async getFile() { return new Blob([await readFile(this.path)]); }
    async *entries() {
        for (const child of await readdir(this.path, { withFileTypes: true })) {
            yield [child.name, new ReadOnlyHandle(path.join(this.path, child.name),
                child.isDirectory() ? "directory" : "file")];
        }
    }
}

const server = await createServer({ configFile: false, appType: "custom",
    server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] } });
after(() => server.close());

test("complete OM example loads in the editor without model, material or constraint errors", async () => {
    const [{ dataService }, { tabRegistry }, { modelValidator },
        { loadMaterialReferenceCatalog }, { collectModelConstraintDiagnostics }] = await Promise.all([
        "/src/services/dataService.js", "/src/services/tabRegistry.js",
        "/src/tabulator/validators/types/modelValidator.js",
        "/src/services/materialReferenceValidation.js", "/src/services/modelConstraintDiagnostics.js",
    ].map(name => server.ssrLoadModule(name)));
    const task = new ReadOnlyHandle(root);
    const model = {};
    const loadDiagnostics = [];
    for (const schema of tabRegistry) {
        model[schema.id] = await dataService.load(task, schema, loadDiagnostics, {});
        assert.notEqual(model[schema.id], null, schema.id);
    }
    const materials = await loadMaterialReferenceCatalog(task);
    assert.deepEqual(materials.errors, []);
    const modelDiagnostics = modelValidator({ getModel: () => model }, { materialCatalog: materials.catalog });
    const constraints = Object.values(collectModelConstraintDiagnostics(tabRegistry, model)).flat();
    assert.deepEqual([...loadDiagnostics, ...modelDiagnostics, ...constraints]
        .filter(item => item.level === "error"), []);
    assert.equal(model.amps.length, 10);
    assert.equal(model.elements.length, 24);
});
