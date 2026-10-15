import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";
import { medModel, medBox } from "./fixtures/medContactCases.js";

test("AC requires useMED=false and suppresses the charge warning without changing input", async () => {
    const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: "custom" });
    try {
        const { default: schema } = await server.ssrLoadModule("/src/services/schemas/general.schema.js");
        const { deserialize } = await server.ssrLoadModule("/src/services/model/modelSerializer.js");
        const { generalValidator } = await server.ssrLoadModule("/src/tabulator/validators/models/general/generalValidator.js");
        for (const fullAxialSymmetry of [false, true]) {
            for (const useMED of [false, true, undefined]) {
                for (const conducting of [false, true]) {
                    const general = deserialize({ fullAxialSymmetry,
                        ...(useMED === undefined ? {} : { useMED }) }, schema);
                    const model = { general, elements: conducting ? [medBox()] : [] };
                    const before = structuredClone(model), messages = [];
                    generalValidator({ getModel: () => model }, messages);
                    const chargeMessages = messages.filter(d => d.property === "useMED");
                    const conflict = fullAxialSymmetry && useMED !== false;
                    const warning = !fullAxialSymmetry && useMED === false && conducting;
                    assert.equal(chargeMessages.length, conflict || warning ? 1 : 0);
                    if (conflict) {
                        assert.equal(chargeMessages[0].level, "error");
                        assert.equal(chargeMessages[0].tab.id, "general");
                        assert.match(chargeMessages[0].message, /Осесимметричная \(AC\)/u);
                        assert.match(chargeMessages[0].message, /useMED=false/u);
                    } else if (warning) {
                        assert.equal(chargeMessages[0].level, "warning");
                    }
                    assert.deepEqual(model, before);
                }
            }
        }
        const messages = [];
        generalValidator({ getModel: () => ({ general: { fullAxialSymmetry: true } }) }, messages);
        assert.ok(messages.some(d => d.property === "useMED" && d.level === "error"));
    } finally {
        await server.close();
    }
});

test("useMED: defaults, file round trip, new task, demo and nonblocking diagnostics", async () => {
    const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: "custom" });
    const oldFetch = globalThis.fetch;
    try {
        const { default: schema } = await server.ssrLoadModule("/src/services/schemas/general.schema.js");
        const { deserialize, serialize } = await server.ssrLoadModule("/src/services/model/modelSerializer.js");
        const { generalValidator } = await server.ssrLoadModule("/src/tabulator/validators/models/general/generalValidator.js");
        const { elementsValidator } = await server.ssrLoadModule("/src/tabulator/validators/models/elements/elementsValidator.js");
        assert.equal(deserialize({}, schema).useMED, true);
        for (const useMED of [true, false]) {
            const value = deserialize({ useMED }, schema);
            assert.equal(JSON.parse(JSON.stringify(serialize(value, schema))).useMED, useMED);
        }
        const model = medModel([medBox(), medBox({ origin: [1,.25,.25], size: [1,.5,.5] })]);
        const check = () => {
            const messages = [];
            generalValidator({ getModel: () => model }, messages);
            elementsValidator({ getModel: () => model }, messages);
            return messages;
        };
        model.general.countTimeSteps = 1; model.general.timeStep = 1;
        assert.ok(check().some(d => d.code === "PARTIAL_CONTACT"));
        model.general.useMED = false;
        const before = structuredClone(model);
        const messages = check();
        assert.equal(messages.filter(d => d.property === "useMED" && d.level === "warning").length, 1);
        assert.ok(!messages.some(d => d.code === "PARTIAL_CONTACT"));
        assert.deepEqual(model, before);
        model.general.useMED = true;
        assert.ok(check().some(d => d.code === "PARTIAL_CONTACT"));
        model.general.useMED = false;
        model.elements = [medBox({ rv: 0 }), medBox({ targ: 1 })];
        assert.ok(!check().some(d => d.property === "useMED"));

        const generalText = await readFile(new URL("../data/demo/general.txt", import.meta.url), "utf8");
        const bundle = { schemaVersion: 1, directories: [], files: [{ path: "general.txt", base64: Buffer.from(generalText).toString("base64") }] };
        globalThis.fetch = async () => ({ ok: true, json: async () => bundle });
        const { loadDemoTask } = await server.ssrLoadModule("/src/services/demoTaskService.js");
        const task = await loadDemoTask();
        const input = await task.getDirectoryHandle("input3XX");
        const readGeneral = async () => JSON.parse(await (await (await input.getFileHandle("general.txt")).getFile()).text());
        assert.equal((await readGeneral()).useMED, true);
        const { initializeTaskDirectory } = await server.ssrLoadModule("/src/services/taskTemplateService.js");
        await initializeTaskDirectory(task);
        assert.equal((await readGeneral()).useMED, true);
        const { dataService } = await server.ssrLoadModule("/src/services/dataService.js");
        const value = deserialize({ useMED: false }, schema);
        assert.equal(await dataService.save(task, schema, value), true);
        assert.equal((await readGeneral()).useMED, false);
        assert.equal((await dataService.load(task, schema)).useMED, false);
    } finally {
        globalThis.fetch = oldFetch;
        await server.close();
    }
});
