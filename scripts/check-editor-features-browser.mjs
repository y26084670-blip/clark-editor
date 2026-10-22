import { chooseProjectDisk } from "./browser-project-access.mjs";
// Node 24 + installed dependencies; Playwright and Chromium supplied externally.
// Native OPFS checks actual writes. Windows file picker / permissions are not covered.
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const out=path.resolve(process.env.CHECK_OUTPUT??'/tmp/editor-features-browser');await mkdir(out,{recursive:true});
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const server=await createServer({root,server:{host:'127.0.0.1',port:0},plugins:[{name:'editor-feature-fixture',configureServer(server){
  server.middlewares.use(async(req,res,next)=>{if(req.url?.split('?')[0]!=='/__editor-features')return next();
    res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,'<html><body><div id="root"></div><script type="module" src="/test/browser/editorFeatures.fixture.jsx"></script></body></html>'));});
}}]});await server.listen();
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1500,height:1050}});page.setDefaultTimeout(12000);
const checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
const check=(name,ok)=>{assert.ok(ok,name);checks.push(name);console.log('PASS',name);};
const tabNames=['Выбор задания','Общие параметры','Элементы','Области','Амплитуды','Траектории','Заданные источники','Настройки','Материалы ФММ','Материалы ВТСП'];
const button=name=>tabNames.includes(name)?page.locator('.tabs-header button').filter({hasText:new RegExp('^'+name+'$')}):page.getByRole('button',{name,exact:true});
const read=file=>page.evaluate(path=>editorFixture.read(path),file);
const current=()=>page.evaluate(()=>editorFixture.model());
const openDrawer=async()=>{await button('Открыть дополнительные функции').click();};
const openMu=async()=>{await openDrawer();const menu=page.locator('.side-panel details').filter({hasText:'Характеристики ФММ'});if(!await menu.evaluate(e=>e.open))await menu.locator('summary').click();await page.locator('.side-panel').getByRole('button',{name:'Создать таблицу μ = const',exact:true}).click();await page.locator('.constant-mu-dialog').waitFor({state:'visible'});};
const dialog=page.locator('.constant-mu-dialog');
async function waitSave(before){await page.waitForFunction(n=>editorFixture.writes.filter(v=>v==='general.txt').length>n,before);await page.waitForFunction(()=>!document.querySelector('.save-button')?.disabled);await page.waitForTimeout(150);}
try{
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__editor-features`);
  await page.waitForFunction(()=>window.editorFixture?.ready);
  await chooseProjectDisk(page);await page.locator('#listProject').selectOption('Project');
  await page.locator('#listTask .listTask-item').filter({hasText:/^Task$/}).dblclick();
  await page.waitForFunction(()=>editorFixture.model().general&&editorFixture.model().elements&&editorFixture.model().conrab);
  await page.waitForTimeout(300);
  await button('Элементы').click();
  await openDrawer();await page.locator('.side-panel').getByRole('button',{name:'Катушка однородного поля',exact:true}).click();
  const coil=page.locator('.uniform-field-coil');await coil.waitFor();
  check('coil default L=100, dvi=20, Russian name',await coil.getByLabel('L, мм',{exact:true}).inputValue()==='100'&&await coil.getByLabel('Раскрытие, град',{exact:true}).inputValue()==='20'&&(await coil.locator('input').first().inputValue())==='Катушка однородного поля');
  const direction=coil.locator('fieldset .coil-input-row').first().locator('input');
  await direction.nth(0).fill('2');await direction.nth(1).fill('3');await direction.nth(2).fill('4');
  const displayed=await coil.locator('.coil-orientation-angles input').evaluateAll(v=>v.map(e=>Number(e.value)));
  check('orientation indicators are readonly and follow vector projections',await coil.locator('.coil-orientation-angles input').evaluateAll(v=>v.every(e=>e.readOnly))&&Math.abs(displayed[1]+47.96888623)<1e-8&&Math.abs(displayed[2]-56.30993247)<1e-8);
  check('default dvi=20 does not warn about an incomplete winding',!await coil.locator('.coil-sector-notice').isVisible());
  for(const [dvi,n] of [[10,36],[30,12],[17,21]]) {
    await coil.getByLabel('Раскрытие, град',{exact:true}).fill(String(dvi));
    check(`dvi=${dvi} previews ${n} local images without modifying the model`,(await coil.innerText()).includes(`локальных образов: ${n}`)&&(await current()).elements.length===0);
  }
  check('dvi=17 warns about the unfilled 3-degree remainder',await coil.locator('.coil-sector-notice').isVisible()&&(await coil.locator('.coil-sector-notice').innerText()).includes('Остаток 3°'));
  await coil.getByLabel('Раскрытие, град',{exact:true}).fill('20');
  check('dvi=20 restores full coverage without a sector warning',!await coil.locator('.coil-sector-notice').isVisible());
  await page.waitForTimeout(400);
  check('coil analytic table has readable text on its dark panel',await coil.locator('td').first().evaluate(e=>getComputedStyle(e).color==='rgb(237, 242, 247)'));
  await page.screenshot({path:path.join(out,'coil-dvi.png')});
  await coil.getByRole('button',{name:'Добавить катушку',exact:true}).click();
  await page.waitForFunction(()=>editorFixture.model().elements.length===1);
  const model=await current();
  check('dvi=20 creates the unchanged 20-degree sector, 18 images and 18 Jy rows',model.elements[0].geo.flat()[8]===20&&model.elements[0].symLs===18&&model.elements[0].symYl===20&&model.mhj[0].v.length===18&&model.mhj[0].v.every(v=>v[0]===0&&v[1]<0&&v[2]===0));
  check('indicated angles equal generated local coordinate rotations',model.elements[0].symVi.flat().every((v,i)=>Math.abs(v-displayed[i])<6e-9));
  // Changing the generator parameter must not rewrite previously added coils.
  let previousRows=model.mhj[0].v,expectedElements=1;
  for(const [dvi,n] of [[30,12],[10,36]]) {
    await coil.getByLabel('Раскрытие, град',{exact:true}).fill(String(dvi));
    await coil.getByRole('button',{name:'Добавить катушку',exact:true}).click();
    expectedElements+=1;await page.waitForFunction(n=>editorFixture.model().elements.length===n,expectedElements);
    const next=await current(),record=next.elements.at(-1),rows=next.mhj[0].v;
    check(`dvi=${dvi} adds exactly ${n} current rows and preserves all earlier sources`,record.symLs===n&&record.symYl===dvi&&record.geo.flat()[8]===dvi&&rows.length===previousRows.length+n&&JSON.stringify(rows.slice(0,previousRows.length))===JSON.stringify(previousRows)&&rows.slice(previousRows.length).every(v=>v[0]===0&&v[1]<0&&v[2]===0));
    previousRows=rows;
  }
  await coil.getByRole('button',{name:'Закрыть',exact:true}).click();
  // Save while an actual Tabulator editor has an uncommitted value.
  await page.evaluate(()=>{const t=editorFixture.tables('.tabulator').find(t=>t.getData().some(r=>r.name==='Катушка однородного поля'));t.getRows()[0].getCell('name').edit();});
  const editor=page.locator('.tabulator-editing input');await editor.fill('Катушка проверка Ctrl+S');
  let before=await page.evaluate(()=>editorFixture.writes.filter(v=>v==='general.txt').length);
  await editor.press('Control+s');await waitSave(before);
  check('Ctrl+S commits active text cell before saving source files',(await read('input3XX/kvs.txt')).includes('Катушка проверка Ctrl+S'));
  // Open the FMM modal while the FMM tab itself is inactive.
  await openMu();
  check('FMM generator is a true modal from a different tab',await dialog.evaluate(e=>e.matches(':modal')));
  check('Save disabled before Create',await dialog.getByRole('button',{name:'Сохранить',exact:true}).isDisabled());
  await dialog.getByLabel('μ',{exact:true}).fill('1234');await dialog.getByLabel('Hmax, кА/м',{exact:true}).fill('22');
  await dialog.getByRole('button',{name:'Создать',exact:true}).click();
  check('Create holds 12 points in memory without a file',await dialog.locator('tbody tr').count()===12&&!await page.evaluate(()=>editorFixture.exists('input3XX/xapLibFMM/1234.00.txt')));
  await page.waitForTimeout(400);
  check('FMM preview has readable text on its dark panel',await dialog.locator('td').first().evaluate(e=>getComputedStyle(e).color==='rgb(237, 242, 247)'));
  await page.screenshot({path:path.join(out,'constant-mu.png')});
  await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.constant-mu-dialog [role=status]')?.textContent.startsWith('Сохранено:'));
  let stored=JSON.parse(await read('input3XX/xapLibFMM/1234.00.txt'));
  check('Save creates native FMM filename, two columns and hip',stored.tabl.length===24&&stored.tabl[11]===22&&stored.tabl[23]===27126&&stored.hip===1233);
  await dialog.getByLabel('Hmax, кА/м',{exact:true}).fill('44');
  check('changed parameters cannot save a stale preview',await dialog.getByRole('button',{name:'Сохранить',exact:true}).isDisabled());
  await dialog.getByRole('button',{name:'Создать',exact:true}).click();await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.constant-mu-dialog [role=status]')?.textContent.startsWith('Сохранено:'));
  stored=JSON.parse(await read('input3XX/xapLibFMM/1234.00.txt'));
  check('repeated Save overwrites the named file without duplicates',stored.tabl[11]===44&&(await page.evaluate(()=>editorFixture.files())).join(',')==='1234.00.txt,2.00.txt');
  await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();
  // Ctrl+S must work on every data tab even when focus is not in a table.
  for(const tab of ['Общие параметры','Элементы','Области','Амплитуды','Траектории','Заданные источники','Настройки','Материалы ФММ','Материалы ВТСП']) {
    await button(tab).click();await page.evaluate(()=>editorFixture.setDirty());
    before=await page.evaluate(()=>editorFixture.writes.filter(v=>v==='general.txt').length);
    const consumed=await page.evaluate(()=>!window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyS',key:'ы',ctrlKey:true,bubbles:true,cancelable:true})));
    await waitSave(before);
    check(`Ctrl+S saves from ${tab}, with Cyrillic physical key`,consumed);
  }
  await button('Выбор задания').click();before=await page.evaluate(()=>editorFixture.writes.length);
  check('Ctrl+S is not intercepted on task selection tab',await page.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyS',ctrlKey:true,bubbles:true,cancelable:true}))));
  await page.waitForTimeout(150);check('task selection shortcut does not write files',(await page.evaluate(()=>editorFixture.writes.length))===before);
  // Preserve a different unsaved library row when applying a generated curve.
  await button('Материалы ФММ').click();
  await page.evaluate(()=>{const t=editorFixture.tables('.material-library-table').find(t=>t.getRows().some(r=>r.getData().name==='2.00'));t.getRows().find(r=>r.getData().name==='2.00').getCell('name').edit();});
  await page.locator('.tabulator-editing input').fill('Несохранённая другая');await page.locator('.tabulator-editing input').press('Enter');
  await openMu();await dialog.getByLabel('μ',{exact:true}).fill('7');await dialog.getByRole('button',{name:'Создать',exact:true}).click();
  await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.constant-mu-dialog [role=status]')?.textContent.startsWith('Сохранено:'));
  await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();
  check('saving generated material preserves other unsaved library rows',await page.evaluate(()=>editorFixture.tables('.material-library-table').some(t=>t.getData().some(r=>r.name==='Несохранённая другая'))));
  await openMu();await dialog.getByLabel('μ',{exact:true}).fill('2');await dialog.getByRole('button',{name:'Создать',exact:true}).click();
  await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();
  await dialog.locator('[role=alert]').filter({hasText:'несохранённые правки'}).waitFor();
  check('generator protects unsaved edits to the same source characteristic',JSON.parse(await read('input3XX/xapLibFMM/2.00.txt')).tabl[11]===22);
  await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();
  await button('Элементы').click();await page.locator('button.geometry-button').click();
  const viewer=page.locator('.geometry-viewer-window');await viewer.waitFor();
  const canvas=viewer.locator('canvas');await canvas.waitFor();await page.waitForTimeout(1500);
  await viewer.focus();await page.keyboard.press('Control+a');await page.waitForTimeout(450);
  const oblique=await canvas.screenshot();
  await page.keyboard.press('x');await page.waitForTimeout(450);const axis=await canvas.screenshot();
  check('3D axis command visibly changes the rendered scene',!oblique.equals(axis));
  await page.keyboard.press('Control+a');await page.waitForTimeout(450);const restored=await canvas.screenshot();
  check('Ctrl+A restores the initial oblique frame and fit after an axis view',oblique.equals(restored));
  await page.screenshot({path:path.join(out,'ctrl-a-restored.png')});
  before=await page.evaluate(()=>editorFixture.writes.filter(v=>v==='general.txt').length);
  await page.keyboard.press('Control+s');await waitSave(before);check('Ctrl+S also works from the floating 3D window',true);
  check('no uncaught browser errors',errors.length===0);
}finally{
  await page.screenshot({path:path.join(out,'last-state.png')}).catch(()=>{});
  await writeFile(path.join(out,'last-state.html'),await page.content()).catch(()=>{});
  await writeFile(path.join(out,'results.json'),JSON.stringify({passed:checks.length,checks,errors,scope:'Actual App, Tabulator, Chromium OPFS; controlled directory picker',notTested:['Windows chooser/permissions','installed Clark']},null,2));
  console.log('Browser errors:',JSON.stringify(errors));await browser.close();await server.close();
}
