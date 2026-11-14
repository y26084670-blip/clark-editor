// Run with the same external Playwright/Chromium as the other browser checks.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "vite";
import { chooseProjectDisk } from "./browser-project-access.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const server = await createServer({ root, cacheDir: "node_modules/.vite-record-cards", server: { host: "127.0.0.1", port: 0, hmr: false }, plugins: [{
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
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
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
async function assertAligned(label) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const result = await current.locator(".data-editor-main-table").evaluate(table => {
    const rows = [...table.querySelectorAll(".tabulator-row")].filter(row => row.offsetWidth);
    const headers = [...table.querySelectorAll(".tabulator-col[tabulator-field]")].filter(column => column.offsetWidth);
    const issues = [];
    for (const header of headers) {
      const name = header.getAttribute("tabulator-field");
      const expected = header.getBoundingClientRect();
      for (const row of rows) {
        const cell = row.querySelector('.tabulator-cell[tabulator-field="' + name + '"]');
        const rect = cell?.getBoundingClientRect();
        if (!rect || Math.abs(rect.left - expected.left) > 1 || Math.abs(rect.width - expected.width) > 1) {
          issues.push({name, header: expected.width, cell: rect?.width});
          break;
        }
      }
    }
    return {rows: rows.length, count: headers.length, issues};
  });
  assert.ok(result.rows && result.count >= 2, label);
  assert.deepEqual(result.issues, [], label);
}

async function assertCardFrame() {
  const frame = card.locator(".record-card-frame");
  const [box, header, panel, reserve] = await Promise.all([
    frame.boundingBox(), card.locator(".record-card-info").boundingBox(),
    card.locator(".record-card-panel").boundingBox(), card.locator(".record-card-reserve").boundingBox(),
  ]);
  const border = await frame.evaluate(el => {
    const s = getComputedStyle(el);
    return [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth].map(parseFloat);
  });
  assert.ok(border.every(width => width >= 2 && width === border[0]), "continuous outer border");
  assert.equal(header.y, box.y + border[0]);
  assert.equal(panel.x, header.x);
  assert.equal(panel.y, header.y + header.height);
  assert.equal(panel.x + panel.width, box.x + box.width - border[1]);
  assert.equal(panel.y + panel.height, box.y + box.height - border[2]);
  assert.equal(reserve.y, box.y + box.height);
}

async function elementGeometryBounds() {
  const geometry = card.getByRole("group", {name: "Геометрия",exact:true});
  const material = card.getByRole("group", {name: "Электрические и магнитные свойства",exact:true});
  const [geo, mat, other, panel] = await Promise.all([
    geometry.boundingBox(), material.boundingBox(),
    card.getByRole("group", {name:"Прочие параметры",exact:true}).boundingBox(),
    card.locator(".record-card-panel").boundingBox(),
  ]);
  assert.equal(mat.y + mat.height, other.y + other.height);
  const gap = panel.y + panel.height - other.y - other.height;
  assert.ok(gap >= 0 && gap <= 10, "space below the bottom groups: " + gap);
  const spacing = await geometry.evaluate(el => {
    const legend = el.querySelector("legend").getBoundingClientRect();
    const frame = el.getBoundingClientRect();
    const controls = [...el.querySelectorAll("input")].map(input => input.getBoundingClientRect());
    return { top: Math.min(...controls.map(b => b.top)) - legend.bottom,
      bottom: frame.bottom - Math.max(...controls.map(b => b.bottom)),
      left: Math.min(...controls.map(b => b.left)) - frame.left,
      right: frame.right - Math.max(...controls.map(b => b.right)) };
  });
  assert.ok(Object.values(spacing).every(v => v >= 0), "geometry inputs fit inside the frame");
  if (await geometry.locator("input").count() < 24) {
    assert.ok(Math.abs(spacing.top - spacing.bottom) < 16, "parameter rows vertically centered");
  }
  return geo;
}

async function regionGeometryBounds() {
  const rect = label => card.getByRole("group",{name: label,exact:true}).boundingBox();
  const [geo, coil, local, type, panel] = await Promise.all([
    rect("Геометрия"),rect("Катушка и движение"),rect("Локальная система координат"),
    field("geoType").locator("..").boundingBox(),
    card.locator(".record-card-panel").boundingBox(),
  ]);
  const equal = (a,b) => assert.ok(Math.abs(a-b) <= 1, a + " vs " + b);
  equal(geo.y + geo.height, coil.y + coil.height);
  equal(geo.x, local.x); equal(geo.width,local.width);
  equal(type.x,local.x); equal(type.width,local.width);
  const gap = panel.y + panel.height - local.y - local.height;
  assert.ok(gap >= 0 && gap <= 12, "empty space below local coordinates: " + gap);
  return geo;
}

const ready = (part, type, index = 0) => page.waitForFunction(([part, type, index]) =>
  window.editorFixture.model()[part]?.[index]?.geoType === type
    && Number(document.querySelector('.tab-content[style*="display: block"] .record-card-panel select[data-field=geoType]')?.value) === type,
  [part,type,index]);

try {
  await page.goto("http://127.0.0.1:" + server.httpServer.address().port + "/__record-cards");
  await page.waitForFunction(() => window.editorFixture?.ready, undefined, { timeout: 30000 });
  await chooseProjectDisk(page);
  await page.locator("#listProject").selectOption("Project");
  await page.locator("#listTask .task-status-label").filter({hasText:/^Task$/}).dblclick();
  await page.waitForFunction(() => window.editorFixture.model().elements && window.editorFixture.model().regions);
  await tab("Элементы");
  await current.getByTitle("Добавить запись", {exact:true}).click();
  await ready("elements",0);
  assert.deepEqual(await visibleFields(), ["name","rowLabel"]);
  assert.equal(await field("geo",23).count(),1);
  await assertCardFrame();
  const hexBounds = await elementGeometryBounds();
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
  assert.deepEqual(await elementGeometryBounds(), hexBounds);
  await commit(card.getByLabel("R2",{exact:true}),"25");
  assert.equal((await value("elements","geo")).flat()[3],25);
  await cardScreenshot("elements-sector");
  for (const [type,count] of [[2,3],[3,5],[4,7],[0,24]]) {
    await field("geoType").selectOption(String(type)); await ready("elements",type);
    assert.equal(await card.locator("input[data-field=geo]").count(),count);
    assert.deepEqual(await elementGeometryBounds(), hexBounds);
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
  await commit(gamma,"1.234567890123456");
  assert.equal(await gamma.inputValue(),"1.23456789");
  for (const key of ["Tab","Enter","Escape"]) {
    await gamma.click(); await gamma.press(key);
    assert.equal(await value("elements","rv"),1.234567890123456);
  }
  const x1=field("geo");
  await commit(x1,"-1.2345678909876e-30");
  assert.equal(await x1.inputValue(),"-1.234567891e-30");
  await x1.click(); await gamma.click();
  assert.equal((await value("elements","geo"))[0][0],-1.2345678909876e-30);
  await commit(x1,"1");
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
  await current.locator('.tabulator-row .tabulator-cell[tabulator-field="dp"]').first().click();
  await page.waitForFunction(()=>document.activeElement?.dataset.field==="dp");
  assert.equal(await field("med").count(),0);
  assert.equal(await current.locator(".data-editor-lower").count(),0);
  console.log("PASS Numeric caret, double click, arrows, Home/End, Escape, Tab, Enter and blur");

  // Prepare one physical image with a matching 1 × 1 contact grid on each side.
  await commit(field("dp",0),"1"); await commit(field("dp",1),"1");
  await commit(field("symLs"),"1"); await commit(field("symAs"),"1");
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
  assert.equal(await card.evaluate(el => el.scrollHeight > el.clientHeight),true);
  await field("indAmp").scrollIntoViewIfNeeded();
  await page.setViewportSize({width:1440,height:1000});
  assert.equal(await card.evaluate(el => el.scrollHeight > el.clientHeight),false);
  assert.equal(await card.locator(".record-card-panel").evaluate(el => el.scrollHeight > el.clientHeight),false);
  const drawer=page.locator(".side-panel");
  const openDrawer=()=>page.getByRole("button",{name:"Открыть дополнительные функции",exact:true}).click();
  // Shift the second cube by its edge length so
  // both the report links and explicit navigation can be verified on an actual contact.
  const vertices = await value("elements","geo",1);
  const widthX = Math.max(...vertices.map(p=>p[0])) - Math.min(...vertices.map(p=>p[0]));
  await commit(field("dr"), String(widthX));
  await commit(field("rv"),"2");
  // The MED column is a summary; all manual changes belong to the Autofill window.
  await current.locator('.tabulator-row .tabulator-cell[tabulator-field="med"]').nth(1).click();
  const medWindow=page.getByRole("dialog",{name:"Автозаполнение MED",exact:true});
  const manual=medWindow.locator(".med-manual");
  const writeFaces=manual.getByRole("button",{name:"Записать грани"});
  await writeFaces.waitFor();
  assert.equal(await manual.getByRole("combobox").inputValue(),"2");
  await manual.getByLabel("MED ξ+").fill("-1");
  assert.equal((await value("elements","med",1)).flat()[5],0);
  await writeFaces.click();
  await page.waitForFunction(()=>editorFixture.model().elements[1].med[5][0]===-1);
  assert.equal((await value("elements","med",0)).flat()[5],0);
  await medWindow.getByText("Закрыть",{exact:true}).click();
  await openDrawer(); await drawer.getByRole("button",{name:/Отменить/}).click();
  await page.waitForFunction(()=>editorFixture.model().elements[1].med[5][0]===0);
  await drawer.getByRole("button",{name:/Повторить/}).click();
  await page.waitForFunction(()=>editorFixture.model().elements[1].med[5][0]===-1);
  await drawer.getByRole("button",{name:"Автозаполнение MED",exact:true}).click();
  await manual.locator("summary").click();
  const faceLink = medWindow.locator("table button.med-element-link").filter({hasText:/·/}).first();
  await faceLink.waitFor();
  const linked = (await faceLink.innerText()).match(/ШГ (\d+) · (.+)/);
  assert.ok(linked, "expected an element and face in the contact report");
  await faceLink.click();
  await page.waitForFunction(name => document.activeElement?.getAttribute("aria-label") === "MED " + name, linked[2]);
  assert.equal(await manual.getByRole("combobox").inputValue(),linked[1]);
  await manual.getByRole("combobox").selectOption("2");
  assert.equal(await manual.getByLabel("MED ξ+").inputValue(),"-1");
  await manual.getByLabel("MED ξ+").fill("-2"); await writeFaces.click();
  assert.equal(await manual.getByLabel("MED ξ+").evaluate(input=>input.validity.rangeUnderflow),true);
  await medWindow.getByText("Закрыть",{exact:true}).click();
  console.log("PASS Manual editing and undo through the Autofill MED window; single short-window scrollbar");
  console.log("PASS Active row, single-record material assignment and fixed-size card");

  await tab("Области");
  await current.getByTitle("Добавить запись",{exact:true}).click();
  await ready("regions",0);
  assert.equal(await card.locator("input[data-field=geo]").count(),12);
  assert.deepEqual(await visibleFields(),["name","rowLabel"]);
  await assertCardFrame();
  const expectedBounds=await regionGeometryBounds();
  await flag("Разбиение").check(); await flag("Симметрии").check();
  await flag("Индексы катушки и траектории").check();
  assert.deepEqual(await visibleFields(),["dp","epCount","indCoil","indMove","name","rowLabel","symLs","symYl","wCoil"]);
  await field("geoType").selectOption("1"); await ready("regions",1);
  assert.deepEqual(await regionGeometryBounds(),expectedBounds);
  await commit(card.getByLabel("Проекция на X",{exact:true}),"21.5");
  await commit(card.getByLabel("Раскрытие, °",{exact:true}),"11");
  assert.deepEqual((await value("regions","geo")).flat().slice(0,4),[0,0,11,21.5]);
  await field("geoType").selectOption("2"); await ready("regions",2);
  assert.deepEqual(await regionGeometryBounds(),expectedBounds);
  await commit(card.getByLabel("Y B",{exact:true}),"13");
  assert.equal((await value("regions","geo")).flat()[4],13);
  await field("geoType").selectOption("3"); await ready("regions",3);
  assert.deepEqual(await regionGeometryBounds(),expectedBounds);
  await commit(card.getByLabel("Высота H",{exact:true}),"19");
  assert.equal((await value("regions","geo")).flat()[1],19);
  await commit(card.getByLabel("Разбиение D2 (n41)",{exact:true}),"4"); await commit(field("symLs"),"360");
  assert.equal(await value("regions","epCount"),1440);
  assert.match(await card.locator("header").innerText(),/dp41=4, dp21=1/);
  assert.equal(await current.locator(".data-editor-lower").count(),0);
  console.log("PASS Four region geometries, sector order, endpoints, subdivision direction and EP count");
  await cardScreenshot("regions-rectangle");
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
  // Reload populated files through the normal entry point. Vary the values in
  // each column so intrinsic per-cell widths would visibly disagree.
  const demoRecord = async file => JSON.parse((await readFile(root + "data/demo/" + file,"utf8")).split("\n")[0]);
  await page.evaluate(async ([element,region]) => {
    for (const [file,base,count] of [["kvs.txt",element,80],["tks.txt",region,70]]) {
      const records = Array.from({length:count}, (_,i) => JSON.stringify({...base,
        name:"Запись "+i, rv:i%2 ? 1.23456789 : 938234.15,
        dp:file==="kvs.txt" ? [i%5+1,i%9+1,1] : [i%15+1,2], indMove:i%4, indCoil:i%3,
        sym:{...base.sym,ls:i%7+1}}));
      await editorFixture.put("input3XX/"+file, records.join("\n"));
    }
    const {selectionService} = await import("/src/services/selectionService.js");
    selectionService.notifyTaskDataChanged();
  }, await Promise.all([demoRecord("kvs.txt"),demoRecord("tks.txt")]));
  await page.waitForFunction(()=>editorFixture.model().elements?.length===80 && editorFixture.model().regions?.length===70);
  for (const part of ["Элементы","Области"]) {
    await tab(part);
    for (const input of await current.locator(".record-card-filters input").all()) await input.uncheck();
    await flag("Показать все").check();
    await assertAligned(part+" all");
  }
  await tab("Элементы"); await flag("Показать все").uncheck(); await flag("Симметрии").check();
  await current.locator(".tabulator-tableholder").evaluate(el=>{el.scrollLeft=540;el.scrollTop=630;});
  await assertAligned("Element rows after scrolling");
  await tab("Области"); await flag("Показать все").uncheck(); await assertAligned("Regions minimal");
  await tab("Элементы"); await flag("Показать все").check(); await assertAligned("Element columns after reopening");
  await tab("Области"); await flag("Разбиение").check(); await flag("Индексы катушки и траектории").check();
  await assertAligned("Region columns after reopening");
  await tab("Элементы"); await tab("Области"); await flag("Показать все").check();
  await assertAligned("Region full table after returning");
  console.log("PASS Aligned headers, frozen columns and rows after repeated group, scroll and tab changes");
  const existingCounts = {};
  for (const [tabName,part,sourceRow] of [["Элементы","elements",7],["Области","regions",4]]) {
    await tab(tabName);
    await current.locator('.tabulator-cell[tabulator-field="rowLabel"]').filter({
      hasText:new RegExp("^" + sourceRow + "$"),
    }).click();
    existingCounts[part] = await value(part,"symLs",sourceRow-1);
    await commit(field("symLs"), "-2");
  }
  const indicator=page.locator(".validation-indicator > div[title]");
  const popup=page.locator(".diagnostic-popup");
  await indicator.click();
  for (const [tabName,sourceRow] of [["Элементы",7],["Области",4]]) {
    const summary=popup.locator(".constraint-summary").filter({hasText:"Вкладка: "+tabName+" -"});
    assert.equal(await summary.getByText("Строка № "+sourceRow+" · Образы локальной симметрии",{exact:true}).count(),1);
  }
  await indicator.click();
  for (const [tabName,part] of [["Элементы","elements"],["Области","regions"]]) {
    await tab(tabName);
    await commit(field("symLs"),String(existingCounts[part]));
  }
  await indicator.click();
  assert.equal(await popup.locator(".constraint-summary").count(),0);
  await indicator.click();
  console.log("PASS Element and region constraint messages show the source row and clear after correction");

  await tab("Элементы");
  const row = i => current.locator('.tabulator-cell[tabulator-field="rowLabel"]').filter({ hasText: new RegExp("^" + i + "$") }).click();
  await row(1);
  await field("geoType").selectOption("2");
  for (const [i, n] of [11, 8, 5].entries()) await commit(field("geo", i), String(n));
  await commit(field("dr",2), "8");
  for (const [name, n] of Object.entries({symLs:2, symAs:1, symPs:1, symYl:72})) await commit(field(name), String(n));
  await field("targ").selectOption("0");
  const modelBefore = await page.evaluate(() => editorFixture.model());
  const writesBeforeDemo = await page.evaluate(() => editorFixture.writes.length);
  await flag("3D").check();
  const demo = current.locator(".record-demo-card"), viewport = current.locator(".record-demo-view");
  const slide = demo.getByRole("slider", { name:"Стадия построения" });
  const length = demo.getByRole("slider", { name:"Длина демо-вектора" });
  const transparency = demo.getByRole("slider", { name:"Прозрачность", exact:true });
  const edges = demo.getByRole("checkbox", { name:"Ребра", exact:true });
  const allImages = family => demo.getByRole("checkbox", { name:"Все образы: " + family, exact:true });
  const imageNumber = family => demo.getByRole("textbox", { name:"Номер образа: " + family, exact:true });
  const local = "Локальная симметрия", azimuthal = "Азимутальная симметрия", periodic = "Периодическая симметрия";
  const kind = demo.getByRole("combobox", { name:"Тип демо-вектора" });
  const stageButton = n => demo.locator('button[data-stage="' + n + '"]');
  const image = async () => {
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
    return viewport.locator("canvas").screenshot();
  };
  try {
    await viewport.locator("canvas").waitFor({timeout:20000});
  } catch (error) {
    console.error("3D-панель:", await viewport.innerText(), "карточка:", await card.locator("header").innerText());
    throw error;
  }
  assert.equal((await viewport.boundingBox()).width, 660, "element preview opens at double width");
  await page.setViewportSize({width:1050,height:1000});
  assert.equal((await viewport.boundingBox()).width, 360, "narrow screens get twice the old 180 px minimum");
  await page.setViewportSize({width:1440,height:1000});
  assert.equal((await viewport.boundingBox()).width, 660);
  assert.equal(await demo.evaluate(e => getComputedStyle(e).borderLeftWidth), "3px");
  const groups = await demo.locator(".record-demo-list").evaluateAll(columns =>
    columns.map(el => [...el.querySelectorAll("[data-stage]")].map(b => +b.dataset.stage)));
  assert.deepEqual(groups, [[1,2,3,4,5],[6,7,8,9]]);
  for (const family of [local, azimuthal, periodic]) {
    assert.equal(await allImages(family).isChecked(), true);
    assert.equal(await imageNumber(family).inputValue(), "1");
    assert.equal(await imageNumber(family).isDisabled(), true);
  }
  assert.ok(await allImages(azimuthal).isDisabled() && await allImages(periodic).isDisabled());
  const [fadeBox, lengthBox, edgeBox] = await Promise.all(
    [transparency, length, edges].map(control => control.boundingBox()));
  assert.ok(fadeBox.x < lengthBox.x && Math.abs(fadeBox.y - lengthBox.y) < 2);
  assert.ok(edgeBox.y < fadeBox.y);
  assert.equal(await edges.isChecked(), true);
  assert.equal(await transparency.inputValue(), "58");
  assert.equal(await kind.isEnabled(),true);
  await kind.selectOption("current");
  await commit(demo.getByLabel("Демо-вектор Y",{exact:true}), "2.5");
  await stageButton(3).click();
  await length.press("End");
  const withArrows = await image();
  await allImages(local).uncheck();
  assert.equal(await imageNumber(local).isEnabled(), true);
  const firstOnly = await image();
  assert.ok(!withArrows.equals(firstOnly));
  await commit(imageNumber(local), "2");
  assert.ok(!firstOnly.equals(await image()));
  await commit(imageNumber(local), "9"); assert.equal(await imageNumber(local).inputValue(), "2");
  await allImages(local).check();
  assert.ok(await imageNumber(local).isDisabled());
  assert.ok(withArrows.equals(await image()), "returning to all images restores the same geometry");
  const edged = await image();
  await edges.uncheck();
  assert.ok(!edged.equals(await image()), "the edge checkbox affects rendered pixels");
  await edges.check();
  await transparency.press("End"); assert.equal(await transparency.inputValue(), "100");
  const arrowsAndAxes = await image();
  assert.ok(!edged.equals(arrowsAndAxes), "fully transparent geometry disappears");
  await length.press("Home");
  assert.ok(!arrowsAndAxes.equals(await image()), "demo arrows remain visible at full transparency");
  await transparency.press("Home"); assert.equal(await transparency.inputValue(), "0");
  await length.press("End");
  await transparency.evaluate(input => {
    input.value = "58"; input.dispatchEvent(new Event("input", { bubbles:true }));
  });
  await length.press("Home");
  assert.ok(!withArrows.equals(await image()), "zero length removes arrows from rendered WebGL pixels");
  await viewport.focus(); await page.keyboard.press("x");
  const alongX = await image();
  await page.keyboard.press("Control+x");
  assert.ok(!alongX.equals(await image()), "opposite orthographic views differ");
  await page.keyboard.press("Control+a");
  await slide.press("End");
  assert.equal(await slide.inputValue(), "5");
  assert.ok(await stageButton(6).isDisabled() && await stageButton(9).isDisabled());
  const size = await viewport.boundingBox();
  const handle = current.getByRole("separator",{name:"Ширина 3D-панели"});
  const grip = await handle.boundingBox();
  await page.mouse.move(grip.x+3, grip.y+20); await page.mouse.down();
  await page.mouse.move(grip.x-40, grip.y+20); await page.mouse.up();
  const draggedWidth = (await viewport.boundingBox()).width;
  assert.ok(Math.abs((size.width - draggedWidth) - 43) <= 1, "splitter tracks the pointer from the full initial width");
  await handle.press("ArrowRight");
  assert.equal((await viewport.boundingBox()).width, draggedWidth + 16);
  await assertAligned("Element columns after the 3D splitter drag");
  assert.deepEqual(await page.evaluate(() => editorFixture.model()),modelBefore);
  assert.equal(await page.evaluate(() => editorFixture.writes.length),writesBeforeDemo);
  await commit(field("symPs"),"2"); await slide.press("ArrowRight");
  assert.equal(await slide.inputValue(),"7");
  await commit(field("symTx"),"16"); await field("symKyp").selectOption("0");
  await length.press("End");
  await cardScreenshot("element-symmetry-demo");
  await allImages(periodic).uncheck(); await commit(imageNumber(periodic), "2");
  assert.ok(await allImages(local).isChecked());
  await image();
  await cardScreenshot("element-symmetry-one-image");
  await allImages(periodic).check();
  await slide.press("ArrowLeft"); assert.equal(await slide.inputValue(),"5");
  await stageButton(7).click(); await commit(field("symPs"),"1");
  assert.equal(await slide.inputValue(),"5");
  await row(2); await commit(field("symLs"),"1");
  assert.ok(await stageButton(3).isDisabled());
  assert.ok(await allImages(local).isDisabled() && await imageNumber(local).isDisabled());
  assert.equal(await imageNumber(local).inputValue(),"1");
  await field("targ").selectOption("1");
  assert.ok(await kind.isDisabled()); assert.equal(await kind.inputValue(),"magnetization");
  await field("targ").selectOption("2"); assert.equal(await kind.inputValue(),"current");
  await tab("Общие параметры");
  await page.evaluate(async () => {
    const general = JSON.parse(await editorFixture.read("input3XX/general.txt"));
    await editorFixture.put("input3XX/general.txt", JSON.stringify({...general, mirrorSymmetryY:0, mirrorSymmetryX:1}));
    const { selectionService } = await import("/src/services/selectionService.js");
    selectionService.notifyTaskDataChanged();
  });
  await page.waitForFunction(() => editorFixture.model().general?.mirrorSymmetryY === 0);
  await tab("Элементы");
  await slide.press("End"); assert.equal(await slide.inputValue(),"9");
  await slide.press("ArrowLeft"); assert.equal(await slide.inputValue(),"8");
  await tab("Области"); await flag("3D").check();
  await viewport.locator("canvas").waitFor({timeout:20000});
  assert.equal((await viewport.boundingBox()).width, 660, "region and element previews open at the same width");
  await page.setViewportSize({width:1050,height:1000});
  assert.equal((await viewport.boundingBox()).width,360);
  await page.setViewportSize({width:1440,height:1000});
  await handle.press("ArrowLeft"); assert.equal((await viewport.boundingBox()).width,644);
  await handle.press("ArrowRight"); assert.equal((await viewport.boundingBox()).width,660);
  await assertAligned("Region columns after resizing the 3D preview");
  assert.equal(await demo.locator("[data-stage]").count(),5);
  assert.equal(await demo.locator(".record-demo-vector").count(),0);
  assert.equal(await kind.count(),0);
  assert.equal(await length.count(),0);
  assert.ok(await edges.isChecked() && await transparency.isEnabled());
  assert.equal(await demo.locator(".record-demo-all").count(),1);
  const normalLength = demo.getByRole("group", {name:"Нормаль к площадке"}).getByRole("slider", {name:"Длина нормали", exact:true});
  const [regionFade, regionLength] = await Promise.all([transparency.boundingBox(), normalLength.boundingBox()]);
  assert.ok(regionFade.x < regionLength.x && Math.abs(regionFade.y - regionLength.y) < 2);
  assert.equal(await normalLength.inputValue(), "45");
  assert.ok(await normalLength.isEnabled(), "a sector has a surface normal");
  await field("geoType").selectOption("0");
  for (const [i, n] of [0,0,0, 8,0,0, 8,5,0, 0,5,0].entries()) await commit(field("geo",i),String(n));
  await commit(field("symLs"), "1");
  await stageButton(2).click(); await slide.press("ArrowRight");
  assert.equal(await slide.inputValue(),"4"); assert.ok(await allImages(local).isDisabled());
  await stageButton(1).click();
  await normalLength.press("End"); const planarWithNormal = await image();
  await normalLength.press("Home"); assert.ok(!planarWithNormal.equals(await image()), "zero length hides the center normal");
  await normalLength.press("End"); assert.ok(planarWithNormal.equals(await image()));
  await commit(card.getByLabel("V3 Z", {exact:true}), "4");
  await commit(field("symYl"), "72");
  await commit(field("symLs"), "3"); await stageButton(3).click();
  const regionBefore = await page.evaluate(() => editorFixture.model().regions);
  const regionWrites = await page.evaluate(() => editorFixture.writes.length);
  const warpedAll = await image();
  await allImages(local).uncheck(); await commit(imageNumber(local), "3");
  assert.equal(await imageNumber(local).inputValue(), "3");
  const warpedOne = await image();
  assert.ok(!warpedAll.equals(warpedOne), "local image selection changes the region scene");
  await normalLength.press("Home"); assert.ok(!warpedOne.equals(await image()), "corner normals follow the selected image");
  await normalLength.press("End");
  await allImages(local).check(); assert.ok(warpedAll.equals(await image()));
  await cardScreenshot("region-warped-normals");
  await edges.uncheck(); assert.ok(!warpedAll.equals(await image()), "region edges toggle independently of normals");
  await transparency.press("End");
  const normalsAndAxes = await image();
  await normalLength.press("Home"); assert.ok(!normalsAndAxes.equals(await image()));
  await slide.press("End"); assert.equal(await slide.inputValue(),"5");
  assert.deepEqual(await page.evaluate(() => editorFixture.model().regions),regionBefore);
  assert.equal(await page.evaluate(() => editorFixture.writes.length),regionWrites);
  await field("geoType").selectOption("2");
  await commit(card.getByLabel("Y B", {exact:true}),"3");
  assert.ok(await normalLength.isDisabled(), "a line has no surface normal");
  await field("geoType").selectOption("3");
  await commit(card.getByLabel("Основание L", {exact:true}),"4");
  await commit(card.getByLabel("Высота H", {exact:true}),"2");
  assert.ok(await normalLength.isEnabled(), "a rectangle restores the normal control");
  await flag("3D").uncheck();
  await tab("Элементы"); assert.equal(await flag("3D").isChecked(),true);
  assert.equal(await length.inputValue(), "100");
  assert.equal(await transparency.inputValue(), "58"); assert.ok(await edges.isChecked());
  await flag("3D").uncheck();
  assert.equal(await current.locator(".record-demo-card, .record-demo-view").count(),0);
  console.log("PASS Local region stages, surface normals, edges and length; element M/J, orthographic WebGL, default widths and splitters");
  assert.deepEqual(errors,[]);
} finally {
  await browser.close();
  await server.close();
}
