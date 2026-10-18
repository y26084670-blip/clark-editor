// Two independent tabs, native BroadcastChannel and OPFS. Browser policy may deny focus.
// Run with PLAYWRIGHT_MODULE and CHROMIUM_EXECUTABLE, as for the other browser checks.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const files = new Map(await Promise.all(['taskSelectionChannel.js','taskLastOpenedService.js'].map(async name =>
  ['/'+name,await readFile(new URL('src/services/'+name,root),'utf8')])));
const html = `<script type="module">
import {createTaskSelectionChannel,readTaskSelection} from '/taskSelectionChannel.js';
const app=new URL(location.href).searchParams.get('app');
const root=await navigator.storage.getDirectory();
const project=await root.getDirectoryHandle('Project',{create:true});
await project.getDirectoryHandle('Task',{create:true});
window.state={selected:null,focusRequests:0,blocked:false};
const nativeFocus=window.focus.bind(window);
window.focus=()=>{state.focusRequests++;if(state.blocked)throw new DOMException('Blocked','NotAllowedError');nativeFocus();};
window.channel=createTaskSelectionChannel({app,async onSelection(request){
 const selected=await readTaskSelection(root,request);state.selected=selected.project.name+'/'+selected.task.name;
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
  const editor=await context.newPage(),viewer=await context.newPage();
  await editor.goto(origin+'/?app=editor');await viewer.goto(origin+'/?app=viewer');
  await editor.waitForFunction(()=>window.ready);await viewer.waitForFunction(()=>window.ready);
  for (const [from,to] of [[editor,viewer],[viewer,editor]]) {
    await from.bringToFront();await from.evaluate(()=>select());
    assert.deepEqual(await to.evaluate(()=>({selected:state.selected,requests:state.focusRequests})),{selected:'Project/Task',requests:1});
  }
  await viewer.evaluate(()=>state.blocked=true);
  await editor.evaluate(()=>select());
  assert.equal(await viewer.evaluate(()=>state.focusRequests),2);
  assert.equal(await viewer.evaluate(()=>state.selected),'Project/Task');
  console.log('PASS: both directions; blocked focus preserves successful selection');
  console.log('Headless observations (not proof of physical tab activation):',await editor.evaluate(()=>document.hasFocus()),await viewer.evaluate(()=>document.hasFocus()));
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
