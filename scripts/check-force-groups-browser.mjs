// Run with Node 24 and Playwright. The existing Editor fixture uses a real
// project directory in Chromium's private filesystem and the production App.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chooseProjectDisk } from "./browser-project-access.mjs";

const root = fileURLToPath(new URL("../",import.meta.url));
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const server = await createServer({root,server:{host:"127.0.0.1",port:0},
    plugins:[{name:"force-groups-fixture",configureServer(dev) {
        dev.middlewares.use(async (req,res,next) => {
            if (req.url !== "/__force-groups") return next();
            res.setHeader("Content-Type","text/html");
            res.end(await dev.transformIndexHtml(req.url,
                '<html><body><div id="root"></div><script type="module" src="/test/browser/editorFeatures.fixture.jsx"></script></body></html>'));
        });
    }}]});
await server.listen();
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE || undefined,
    args:["--no-sandbox","--disable-dev-shm-usage","--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
const url = `http://127.0.0.1:${server.httpServer.address().port}/__force-groups`;

async function checkMode(offset) {
    const page = await browser.newPage({viewport:{width:1500,height:1000}});
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    try {
        await page.goto(url);
        await page.waitForFunction(() => window.editorFixture?.ready);
        const initialRegions = await page.evaluate(async delta => {
            const {dataService} = await import("/src/services/dataService.js");
            const {serialize} = await import("/src/services/model/modelSerializer.js");
            const {recomputeModel} = await import("/src/services/model/modelCompute.js");
            const {default:elements} = await import("/src/services/schemas/elements.schema.js");
            const {default:regions} = await import("/src/services/schemas/regions.schema.js");
            const task = window.editorFixture;
            const general = JSON.parse(await task.read("input3XX/general.txt"));
            await task.put("input3XX/general.txt",JSON.stringify({...general,evalForce:true,forceFaceOffset:delta}));
            const rows = [0,7,0,0].map((take,i) => ({...dataService.createDefaultRecord(elements),
                name:`ШГ ${i+1}`,targ:0,geoType:0,take,dp:[[2],[2],[2]],
                geo:Array.from({length:8},(_,j)=>[6*i+(j&1),(j>>1)&1,(j>>2)&1])}));
            await task.put("input3XX/kvs.txt",serialize(rows,elements).map(r=>JSON.stringify(r)).join("\n"));
            const original = [{name:"Старая оболочка",forceGroup:7},{name:"Измерение",indCoil:1}].map(
                values=>({...dataService.createDefaultRecord(regions),geoType:0,
                    geo:[[0,4,0],[0,4,1],[1,4,1],[1,4,0]],...values}));
            const stored = serialize(recomputeModel(regions,original).model,regions);
            await task.put("input3XX/tks.txt",stored.map(r=>JSON.stringify(r)).join("\n"));
            return stored;
        },offset);
        await chooseProjectDisk(page);
        await page.locator("#listProject").selectOption("Project");
        await page.locator("#listTask .task-status-label").filter({hasText:/^Task$/}).dblclick();
        await page.waitForFunction(() => editorFixture.model().elements?.length === 4 && editorFixture.model().regions?.length === 2);
        await page.locator(".tabs-header button").getByText("Элементы",{exact:true}).click();
        const open = async () => {
            await page.getByRole("button",{name:"Открыть дополнительные функции"}).click();
            await page.locator(".side-panel").getByRole("button",{name:"Поверхность для расчета силы/момента"}).click();
            await windowBox.waitFor();
        };
        const windowBox = page.locator(".force-surface-window");
        const button = label => windowBox.getByRole("button",{name:label,exact:true});
        const select = index => page.evaluate(i => {
            const table = editorFixture.tables(".tabulator").find(t=>t.getData().some(r=>r.name==="ШГ 1"));
            table.deselectRow();
            table.getRows()[i].select();
        },index);
        const waitIds = expected => page.waitForFunction(ids =>
            editorFixture.model().elements.every((row,i) => row.take === ids[i]),expected);
        await open();
        for (const index of [1,3]) {
            await select(index);
            await button("Перевести в группу 0").click();
            const modal = page.getByRole("dialog",{name:"Элементы группы 0 запомнены",exact:true});
            await modal.waitFor();
            assert.ok(await modal.evaluate(d=>d.matches(":modal")));
            assert.deepEqual(await page.evaluate(()=>editorFixture.model().elements.map(e=>e.take)),[0,0,0,0]);
            assert.equal(await page.evaluate(()=>editorFixture.model().regions.length),2);
            await modal.getByRole("button",{name:"ОК"}).click();
            if (index === 1) {
                await page.evaluate(() => editorFixture.tables(".tabulator").find(t=>t.getData().some(r=>r.name==="ШГ 1"))
                    .getRows()[2].getCell("name").setValue("ШГ 3а"));
                await page.waitForFunction(()=>editorFixture.model().elements[2].name==="ШГ 3а");
                assert.match(await windowBox.innerText(),/Запомнены для группы 0: 2/);
            }
        }
        assert.match(await windowBox.innerText(),/Запомнены для группы 0: 2, 4/);
        assert.equal(await windowBox.getByLabel("Шаг по узлам, мм").isVisible(),offset === 0);
        await button("Построить").click();
        await waitIds([1,0,2,0]);
        const savedCount = await page.evaluate(()=>editorFixture.writes.filter(x=>x==="general.txt").length);
        await page.keyboard.press("Control+s");
        await page.waitForFunction(n=>editorFixture.writes.filter(x=>x==="general.txt").length>n,savedCount);
        await page.waitForFunction(async () =>
            (await editorFixture.read("input3XX/kvs.txt")).trim().split("\n").map(s=>JSON.parse(s).take).join() === "1,0,2,0");
        const saved = await page.evaluate(async () => ({
            general:JSON.parse(await editorFixture.read("input3XX/general.txt")),
            regions:(await editorFixture.read("input3XX/tks.txt")).trim().split("\n").filter(Boolean).map(s=>JSON.parse(s)),
        }));
        assert.equal(saved.general.forceFaceOffset,offset);
        if (offset) assert.deepEqual(saved.regions,initialRegions);
        else {
            assert.deepEqual(saved.regions.filter(r => r.indCoil === 1),[initialRegions[1]]);
            assert.deepEqual([...new Set(saved.regions.filter(r=>r.forceGroup).map(r=>r.forceGroup))],[1,2]);
        }
        await button("Закрыть").click();
        await open();
        assert.doesNotMatch(await windowBox.innerText(),/Запомнены для группы 0:/);
        await button("Построить").click();
        await waitIds([1,2,3,4]);
        if (offset) {
            await select(2);
            await windowBox.getByRole("radio",{name:"Вручную по выделенным элементам"}).check();
            await windowBox.getByLabel("Номер группы").fill("17");
            await button("Построить").click();
            await waitIds([1,2,17,4]);
            assert.equal(await page.evaluate(()=>editorFixture.model().regions.length),2);
        }
        await windowBox.getByRole("radio",{name:"Автоматически по контактам"}).check();
        await select(1);
        await button("Перевести в группу 0").click();
        await page.getByRole("dialog",{name:"Элементы группы 0 запомнены"}).getByRole("button",{name:"ОК"}).click();
        await select(1);
        await page.getByTitle("Переместить выделенные вверх",{exact:true}).filter({visible:true}).click();
        await windowBox.getByText(/порядок строк изменился/).waitFor();
        assert.doesNotMatch(await windowBox.innerText(),/Запомнены для группы 0:/);
        assert.deepEqual(errors,[]);
        console.log(`PASS group-0 selection, modal, rebuild, save and reopen; offset=${offset}`);
    } finally {
        await page.close();
    }
}

try {
    await checkMode(0);
    await checkMode(.001);
} finally {
    await browser.close();
    await server.close();
}
