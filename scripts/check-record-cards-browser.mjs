// Run with the same external Playwright/Chromium as the other browser checks.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
import { chooseProjectDisk } from "./browser-project-access.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const server = await createServer({ root, server: { host: "127.0.0.1", port: 0 }, plugins: [{
  name: "record-card-fixture", configureServer(vite) {
    vite.middlewares.use(async (req, res, next) => {
      if (req.url !== "/__record-cards") return next();
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(await vite.transformIndexHtml(req.url,
        '<html><body><div id="root"></div><script type="module" src="/test/browser/editorFeatures.fixture.jsx"></script></body></html>'));
    });
  },
}] });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
  args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(6000);
const errors = [];
page.on("pageerror", e => { errors.push(e.message); console.error(e.message); });
const tab = name => page.locator(".tabs-header button").filter({ hasText: new RegExp("^" + name + "$") }).click();
const current = page.locator(".tab-content:visible");
const card = current.locator(".record-card-column");
const field = (name, i = 0) => card.locator('[data-field="' + name + '"]').nth(i);
const flag = name => current.getByRole("checkbox", { name, exact: true });
const visibleFields = () => current.locator(".tabulator-col[tabulator-field]:visible").evaluateAll(
  cols => cols.map(c => c.getAttribute("tabulator-field")).sort());
const value = (part, key, index = 0) => page.evaluate(([part, key, index]) =>
  window.editorFixture.model()[part][index][key], [part, key, index]);
const cardScreenshot = async name => {
  if (!process.env.CHECK_OUTPUT) return;
  await mkdir(process.env.CHECK_OUTPUT, {recursive:true});
  await page.screenshot({path: process.env.CHECK_OUTPUT + "/" + name + ".png"});
};
const commit = async (input, text, key = "Enter") => {
  await input.fill(text);
  await input.press(key);
};
const ready = (part, type, index = 0) => page.waitForFunction(([part, type, index]) =>
  window.editorFixture.model()[part]?.[index]?.geoType === type
    && Number(document.querySelector('.tab-content[style*="display: block"] .record-card-panel select[data-field=geoType]')?.value) === type,
  [part,type,index]);

try {
  await page.goto("http://127.0.0.1:" + server.httpServer.address().port + "/__record-cards");
  await page.waitForFunction(() => window.editorFixture?.ready);
  await chooseProjectDisk(page);
  await page.locator("#listProject").selectOption("Project");
  await page.locator("#listTask .task-status-label").filter({hasText:/^Task$/}).dblclick();
  await page.waitForFunction(() => window.editorFixture.model().elements && window.editorFixture.model().regions);
  await tab("Элементы");
  await current.getByTitle("Добавить запись", {exact:true}).click();
  await ready("elements",0);
  assert.deepEqual(await visibleFields(), ["name","rowLabel"]);
  assert.equal(await field("geo",23).count(),1);
  await commit(field("name"),"Статор внешний");
  await flag("Разбиение").check();
  assert.deepEqual(await visibleFields(), ["dp","eoCount","eoRange","name","rowLabel"]);
  await flag("Симметрии").check();
  for (const key of ["yc1","yc2","yc3","yc4"]) assert.ok((await visibleFields()).includes(key));
  await flag("Свойства").check();
  await flag("Импульсы и траектории").check();
  for (const key of ["med","auto","take","isAnisotropic","isMagnetic","isConductive","indAmp","indMove"])
    assert.ok((await visibleFields()).includes(key),key);
  await flag("Показать все").check();
  assert.ok((await visibleFields()).includes("geoType"));
  const holder = current.locator(".tabulator-tableholder");
  const pinned = current.locator('.tabulator-col[tabulator-field="name"]');
  const xBefore = (await pinned.boundingBox()).x;
  await holder.evaluate(el => { el.scrollLeft = 450; });
  await page.waitForFunction(()=>[...document.querySelectorAll(".tabulator-tableholder")].some(el=>el.scrollLeft>100));
  assert.equal((await pinned.boundingBox()).x,xBefore);
  await holder.evaluate(el => { el.scrollLeft = 0; });
  assert.ok(!('eoCountAll' in (await page.evaluate(() => window.editorFixture.model().elements[0]))));
  assert.equal(await flag("Разбиение").isDisabled(),true);
  await flag("Показать все").uncheck();
  assert.equal(await flag("Разбиение").isChecked(),true);
  assert.ok(!(await visibleFields()).includes("geoType"));
  console.log("PASS Element groups, all computed fields and restored group choices");

  await field("geoType").click();
  await field("geoType").press("ArrowDown");
  await field("geoType").press("Enter");
  await ready("elements",1);
  assert.equal(await card.locator("input[data-field=geo]").count(),9);
  await commit(card.getByLabel("R2",{exact:true}),"25");
  assert.equal((await value("elements","geo")).flat()[3],25);
  await cardScreenshot("elements-sector");
  for (const [type,count] of [[2,3],[3,5],[4,7],[0,24]]) {
    await field("geoType").selectOption(String(type)); await ready("elements",type);
    assert.equal(await card.locator("input[data-field=geo]").count(),count);
  }
  await commit(field("dp",0),"12");
  await commit(field("dp",1),"3","Tab");
  await commit(field("symLs"),"2");
  assert.equal(await value("elements","eoCount"),72);
  await commit(field("symAs"),"5");
  await field("symKya").selectOption("-1");
  assert.equal(await value("elements","eoCount"),72);
  await field("symKya").selectOption("0");
  assert.equal(await value("elements","eoCount"),360);
  console.log("PASS Five element geometries, independent EO count and symmetry types");

  const gamma=field("rv");
  await commit(gamma,"12345.678");
  await gamma.click({position:{x:20,y:8}});
  let pos=await gamma.evaluate(e=>[e.selectionStart,e.selectionEnd]);
  assert.equal(pos[0],pos[1]); assert.ok(pos[0]>0&&pos[0]<9);
  await gamma.dblclick();
  assert.deepEqual(await gamma.evaluate(e=>[e.selectionStart,e.selectionEnd]),[0,9]);
  await gamma.press("ArrowLeft"); assert.equal(await gamma.evaluate(e=>e.selectionStart),8);
  await gamma.dblclick(); await gamma.press("ArrowRight");
  assert.equal(await gamma.evaluate(e=>e.selectionStart),1);
  await gamma.press("End"); assert.equal(await gamma.evaluate(e=>e.selectionStart),9);
  await gamma.press("Home"); assert.equal(await gamma.evaluate(e=>e.selectionStart),0);
  await gamma.dblclick(); await gamma.pressSequentially("9");
  assert.equal(await gamma.inputValue(),"9");
  await gamma.press("Escape"); assert.equal(await value("elements","rv"),12345.678);
  await gamma.fill("1,625"); await field("name").click();
  assert.equal(await value("elements","rv"),1.625);
  await current.locator('.tabulator-row .tabulator-cell[tabulator-field="med"]').first().click();
  await page.waitForFunction(()=>document.activeElement?.dataset.field==="med");
  assert.equal(await current.locator(".data-editor-lower").count(),0);
  console.log("PASS Numeric caret, double click, arrows, Home/End, Escape, Tab, Enter and blur");

  await current.getByTitle("Добавить запись",{exact:true}).click();
  await commit(field("name"),"Вторая запись");
  assert.equal(await value("elements","name",1),"Вторая запись");
  await field("xapName").click();
  await page.locator(".material-dialog-list").selectOption("2.00");
  await page.locator(".material-dialog").getByText("Назначить",{exact:true}).click();
  await page.waitForFunction(()=>editorFixture.model().elements[1].xapName==="2.00");
  assert.equal(await value("elements","xapName",0),"");
  const height=()=>card.locator(".record-card-panel").evaluate(el=>el.offsetHeight);
  const reserve=()=>card.locator(".record-card-reserve").evaluate(el=>el.offsetHeight);
  const h=await height(), initialReserve=await reserve();
  await page.setViewportSize({width:1300,height:740});
  assert.equal(await height(),h); assert.ok(await reserve()<initialReserve);
  const width=await card.evaluate(el=>el.offsetWidth);
  assert.equal(await card.locator(".record-card-reserve").evaluate(el=>el.offsetWidth),width);
  await page.setViewportSize({width:1050,height:540});
  assert.equal(await height(),h);
  await field("med",5).scrollIntoViewIfNeeded();
  await commit(field("med",5),"-1");
  assert.equal((await value("elements","med",1)).flat()[5],-1);
  await page.setViewportSize({width:1440,height:1000});
  console.log("PASS Active row, single-record material assignment and fixed-size card");

  await tab("Области");
  await current.getByTitle("Добавить запись",{exact:true}).click();
  await ready("regions",0);
  assert.equal(await card.locator("input[data-field=geo]").count(),12);
  assert.deepEqual(await visibleFields(),["name","rowLabel"]);
  await flag("Разбиение").check(); await flag("Симметрии").check();
  await flag("Индексы катушки и траектории").check();
  assert.deepEqual(await visibleFields(),["dp","epCount","indCoil","indMove","name","rowLabel","symLs","symYl","wCoil"]);
  await field("geoType").selectOption("1"); await ready("regions",1);
  await commit(card.getByLabel("Проекция на X",{exact:true}),"21.5");
  await commit(card.getByLabel("Раскрытие, °",{exact:true}),"11");
  assert.deepEqual((await value("regions","geo")).flat().slice(0,4),[0,0,11,21.5]);
  await field("geoType").selectOption("2"); await ready("regions",2);
  await commit(card.getByLabel("Y B",{exact:true}),"13");
  assert.equal((await value("regions","geo")).flat()[4],13);
  await field("geoType").selectOption("3"); await ready("regions",3);
  await commit(card.getByLabel("Высота H",{exact:true}),"19");
  assert.equal((await value("regions","geo")).flat()[1],19);
  await commit(card.getByLabel("Разбиение D2 (n41)",{exact:true}),"4"); await commit(field("symLs"),"360");
  assert.equal(await value("regions","epCount"),1440);
  assert.match(await card.locator("header").innerText(),/dp41=4, dp21=1/);
  assert.equal(await current.locator(".data-editor-lower").count(),0);
  console.log("PASS Four region geometries, sector order, endpoints, subdivision direction and EP count");
  await cardScreenshot("regions-rectangle");
  const openDrawer=()=>page.getByRole("button",{name:"Открыть дополнительные функции",exact:true}).click();
  const drawer=page.locator(".side-panel");
  await openDrawer();
  assert.equal(await drawer.getByText("Вычисляемые колонки",{exact:true}).count(),0);
  await drawer.getByRole("button",{name:/Отменить/}).click();
  await page.waitForFunction(()=>editorFixture.model().regions[0].epCount===4);
  await drawer.getByRole("button",{name:/Повторить/}).click();
  await page.waitForFunction(()=>editorFixture.model().regions[0].epCount===1440);
  await drawer.getByRole("button",{name:"Закрыть дополнительные функции"}).click();
  const writesBefore = await page.evaluate(() => editorFixture.writes.filter(name=>name==="tks.txt").length);
  await page.keyboard.press("Control+s");
  await page.waitForFunction(n=>editorFixture.writes.filter(name=>name==="tks.txt").length>n,writesBefore);
  await page.waitForFunction(()=>!document.querySelector(".save-button")?.disabled);
  assert.deepEqual(await page.evaluate(async()=>JSON.parse(await editorFixture.read("input3XX/tks.txt")).dp),[1,4]);
  const store=await page.evaluate(async()=>(await editorFixture.read("input3XX/kvs.txt")).split("\n").map(JSON.parse));
  assert.equal(store[0].rv,1.625);
  assert.equal(store[1].med[5],-1);
  assert.equal(store[1].xapName,"2.00");

  // Change the actual directory handle. A checkbox belongs to its tab, not its task.
  await page.evaluate(async () => {
    const {initializeTaskDirectory}=await import("/src/services/taskTemplateService.js");
    const {selectionService}=await import("/src/services/selectionService.js");
    const parent=await navigator.storage.getDirectory();
    const second=await parent.getDirectoryHandle("cards-second",{create:true});
    await initializeTaskDirectory(second);
    selectionService.setLoadedTaskHandle(second);
  });
  await page.waitForFunction(()=>editorFixture.model().regions?.length===0 && editorFixture.model().elements?.length===0);
  assert.equal(await flag("Разбиение").isChecked(),true);
  await tab("Элементы");
  for(const label of ["Разбиение","Симметрии","Свойства","Импульсы и траектории"])
    assert.equal(await flag(label).isChecked(),true);
  await page.evaluate(()=>editorFixture.setLoaded(true));
  await page.waitForFunction(()=>editorFixture.model().elements?.[1]?.med?.[5]?.[0]===-1);
  assert.ok(!(await visibleFields()).includes("eoCountAll"));
  console.log("PASS Undo, redo, serialized records, another task and independent tab settings");
  assert.deepEqual(errors,[]);
} finally {
  await browser.close();
  await server.close();
}
