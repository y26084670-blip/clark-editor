import { prepareExamplesAssets } from "../scripts/prepare-examples-config.mjs";
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { expandOMContract, validateOMInputs } from "../src/services/omClientService.js";

await prepareExamplesAssets();
const root = fileURLToPath(new URL(
    "../.generated/examples/clark.projects/Open Modelica/test_circuit_with_neutral_1/",
    import.meta.url,
));
const examples = [
    { root, floatingNeutral: false, variant: "grounded" },
    { root: path.join(root, "../test_circuit_without_neutral_1"), floatingNeutral: true, variant: "floating" },
];
const read = (relativePath, taskRoot = root) => readFile(path.join(taskRoot, relativePath));
const json = async (relativePath, taskRoot = root) => JSON.parse(await read(relativePath, taskRoot));
// Canonical provenance checks belong to clark.tests; GUI validates the delivered inputs.

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

for (const example of examples) test(`${path.basename(example.root)} loads and selects the correct OM variant`, async () => {
    const [{ dataService }, { tabRegistry }, { modelValidator },
        { loadMaterialReferenceCatalog }, { collectModelConstraintDiagnostics }] = await Promise.all([
        "/src/services/dataService.js", "/src/services/tabRegistry.js",
        "/src/tabulator/validators/types/modelValidator.js",
        "/src/services/materialReferenceValidation.js", "/src/services/modelConstraintDiagnostics.js",
    ].map(name => server.ssrLoadModule(name)));
    const task = new ReadOnlyHandle(example.root);
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
    const selection = await json("input3XX/om-client.json", example.root);
    const circuit = await json(`input3XX/${selection.dataFile}`, example.root);
    const coupling = await json(`input3XX/${selection.couplingFile}`, example.root);
    const preset = JSON.parse(await readFile(new URL("../src/data/om-presets/circuit-star.json", import.meta.url)));
    assert.equal(circuit.floatingNeutral, example.floatingNeutral);
    validateOMInputs(selection, circuit, coupling, preset, model.amps);
    const contract = expandOMContract(preset.contract, circuit);
    assert.equal(contract.selectedVariant, example.variant);
    assert.deepEqual(contract.arraySizes, { branches: 3, emf: 3 });
});
