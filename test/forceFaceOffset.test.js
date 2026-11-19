import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { medBox, medModel } from "./fixtures/medContactCases.js";

test("general.txt and empty or populated tks.txt survive open, save and reopen", async t => {
    const server = await createServer({configFile:false,server:{middlewareMode:true},appType:"custom",optimizeDeps:{noDiscovery:true}});
    t.after(() => server.close());
    const load = path => server.ssrLoadModule(path);
    const [{default:general}, {default:regions}, {dataService}, {loadDemoTask}] = await Promise.all([
        load("/src/services/schemas/general.schema.js"), load("/src/services/schemas/regions.schema.js"),
        load("/src/services/dataService.js"), load("/src/services/demoTaskService.js"),
    ]);
    const bundle = {schemaVersion:1,directories:[],files:[["general.txt","{}"],["tks.txt",""]].map(
        ([path,text]) => ({path,base64:Buffer.from(text).toString("base64")}))};
    t.mock.method(globalThis,"fetch",async () => ({ok:true,json:async () => bundle}));
    const task = await loadDemoTask();
    const input = await task.getDirectoryHandle("input3XX");
    const read = async name => (await (await input.getFileHandle(name)).getFile()).text();
    const original = await dataService.load(task,general);
    assert.equal(original.forceFaceOffset,0);
    assert.equal(dataService.createDefaultData(general).forceFaceOffset,0);
    const saved = {...original,evalForce:true,forceFaceOffset:.001};
    await dataService.save(task,general,saved);
    assert.equal(JSON.parse(await read("general.txt")).forceFaceOffset,.001);
    const diagnostics = [];
    assert.deepEqual(await dataService.load(task,general,diagnostics),saved);
    assert.ok(!diagnostics.some(d => d.message.includes("forceFaceOffset")));

    const defaults = dataService.createDefaultRecord(regions);
    for (const rows of [[],[{...defaults,forceGroup:9},{...defaults,indCoil:1}]]) {
        await dataService.save(task,regions,rows);
        const before = await read("tks.txt");
        if (!rows.length) assert.equal(before,"");
        const loaded = await dataService.load(task,regions);
        assert.deepEqual(loaded.map(r => [r.name,r.forceGroup,r.indCoil]),rows.map(r => [r.name,r.forceGroup,r.indCoil]));
        await dataService.save(task,regions,loaded);
        assert.equal(await read("tks.txt"),before);
    }
});

test("external-face validation follows the 3D solver and treats TK as ordinary observations", async t => {
    const server = await createServer({configFile:false,server:{middlewareMode:true},appType:"custom",optimizeDeps:{noDiscovery:true}});
    t.after(() => server.close());
    const validators = await Promise.all(["general","elements","regions"].map(async name => {
        const module = await server.ssrLoadModule(`/src/tabulator/validators/models/${name}/${name}Validator.js`);
        return module[name+"Validator"];
    }));
    function check(offset, elements, extra={}, regions=[]) {
        const model = {...medModel(elements,{evalForce:true,forceFaceOffset:offset,...extra}),regions};
        const diagnostics = [];
        for (const validate of validators) validate({getModel:()=>model},diagnostics);
        return diagnostics.filter(d=>["forceFaceOffset","forceGroup","take"].includes(d.property));
    }
    const cube = medBox({take:7});
    assert.deepEqual(check(.001,[cube]),[]);
    assert.match(check(0,[cube])[0].message,/нет силовых площадок/);
    assert.match(check(.001,[medBox({take:0})])[0].message,/положительную силовую группу/);
    assert.ok(check(.001,[medBox({take:7,targ:3})]).some(d=>/Виртуальный/.test(d.message)));
    assert.ok(check(.001,[cube],{fullAxialSymmetry:true}).some(d=>/3D/.test(d.message)));
    assert.ok(check(.001,[medBox({take:7,origin:[-10,0,0],size:[20,1,1]})]).some(d=>/3D/.test(d.message)));
    assert.deepEqual(check(.001,[cube],{evalForce:false,fullAxialSymmetry:true}),[]);
    assert.ok(check(Infinity,[cube]).some(d=>/конечный/.test(d.message)));
    const observation = {geoType:2,forceGroup:99,indCoil:1};
    assert.deepEqual(check(.001,[cube],{},[observation]),[]);
    assert.ok(check(0,[cube],{},[observation]).some(d=>d.property==="forceGroup"));
});
