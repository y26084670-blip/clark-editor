// Independent tabs, native BroadcastChannel and OPFS. Browser policy may deny focus.
// Run with PLAYWRIGHT_MODULE and CHROMIUM_EXECUTABLE, as for the other browser checks.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const files = new Map(await Promise.all(['taskSelectionChannel.js','taskLastOpenedService.js','projectDiskAccessService.js'].map(async name =>
  ['/'+name,await readFile(new URL('src/services/'+name,root),'utf8')])));
const html = `<script type="module">
import {createTaskSelectionChannel,readTaskSelection} from '/taskSelectionChannel.js';
const params=new URL(location.href).searchParams;
const app=params.get('app'),activity=Number(params.get('activity'));
const root=await navigator.storage.getDirectory();
const project=await root.getDirectoryHandle('Project',{create:true});
await project.getDirectoryHandle('Task',{create:true});
window.state={selected:null,selections:0,requests:0,focusRequests:0,blocked:false,busy:false};
const nativeFocus=window.focus.bind(window);
window.focus=()=>{state.focusRequests++;if(state.blocked)throw new DOMException('Blocked','NotAllowedError');nativeFocus();};
window.channel=createTaskSelectionChannel({app,getActivity:()=>({focused:false,lastActiveAt:activity}),async onSelection(request){
 state.requests++;if(state.busy)throw new Error(app+' занят');
 const selected=await readTaskSelection(root,request);state.selected=selected.project.name+'/'+selected.task.name;state.selections++;
}});
window.select=()=>channel.select({baseHandle:root,projectName:'Project',taskName:'Task'});
window.ready=true;
</script>`;
const server=createServer((req,res)=>{const path=new URL(req.url,'http://localhost').pathname;
  res.setHeader('Content-Type',files.has(path)?'text/javascript':'text/html');res.end(files.get(path)||html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,headless:true,args:['--no-sandbox']});
try {
  const context=await browser.newContext();
  const errors=[];
  async function open(app,activity=10){
    const page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin+'/?app='+app+'&activity='+activity);
    await page.waitForFunction(()=>window.ready);
    return page;
  }
  const editor=await open('editor'),viewer=await open('viewer');
  for (const [from,to] of [[editor,viewer],[viewer,editor]]) {
    await from.bringToFront();await from.evaluate(()=>select());
    assert.deepEqual(await to.evaluate(()=>({selected:state.selected,requests:state.focusRequests})),{selected:'Project/Task',requests:1});
  }
  await viewer.evaluate(()=>state.blocked=true);
  await editor.evaluate(()=>select());
  assert.equal(await viewer.evaluate(()=>state.focusRequests),2);
  assert.equal(await viewer.evaluate(()=>state.selected),'Project/Task');
  console.log('PASS: both directions; blocked focus preserves successful selection');
  for(const [from,to,app] of [[editor,viewer,'viewer'],[viewer,editor,'editor']]){
    const busy=await open(app,20);
    await busy.evaluate(()=>state.busy=true);
    const before=await to.evaluate(()=>state.selections);
    await from.evaluate(()=>select());
    assert.equal(await busy.evaluate(()=>state.requests),1);
    assert.equal(await busy.evaluate(()=>state.selections),0);
    assert.equal(await to.evaluate(()=>state.selections),before+1);
    const recent=await open(app,30);
    await from.evaluate(()=>select());
    assert.equal(await recent.evaluate(()=>state.selections),1);
    assert.equal(await to.evaluate(()=>state.selections),before+1);
    assert.equal(await busy.evaluate(()=>state.requests),1);
    await recent.close();await busy.close();
    await from.evaluate(()=>select());
    assert.equal(await to.evaluate(()=>state.selections),before+2);
    console.log('PASS:',app,'busy-tab fallback, one receiver, recently active receiver and closed extra tabs');
  }
  assert.deepEqual(errors,[]);
  console.log('Headless observations (not proof of physical tab activation):',await editor.evaluate(()=>document.hasFocus()),await viewer.evaluate(()=>document.hasFocus()));
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
