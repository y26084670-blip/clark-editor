// Browser-only integration fixture. Actual App and native Chromium OPFS;
// only the operating-system directory picker is controlled.
import { render } from 'solid-js/web';
import App from '../../src/App.jsx';
import { initializeTaskDirectory } from '../../src/services/taskTemplateService.js';
import { modelService } from '../../src/services/modelService.js';
import { selectionService } from '../../src/services/selectionService.js';
import { unsavedChangesService } from '../../src/services/unsavedChangesService.js';
import { tabRegistry } from '../../src/services/tabRegistry.js';
import { TabulatorFull } from 'tabulator-tables';
import Chart from 'chart.js/auto';
import { createConstantMuFmm } from '../../src/services/materials/constantMuFmm.js';
import { createFmmMaterialFile } from '../../src/services/materialImport/xapLibImporter.js';
const opfs = await navigator.storage.getDirectory();
try { await opfs.removeEntry('clark.editor-features', {recursive:true}); } catch(e) { if(e.name!=='NotFoundError')throw e; }
const root=await opfs.getDirectoryHandle('clark.editor-features',{create:true});
const project=await root.getDirectoryHandle('Project',{create:true});
const task=await project.getDirectoryHandle('Task',{create:true});
await initializeTaskDirectory(task);
async function parent(path,create=false){const parts=path.split('/'),name=parts.pop();let dir=task;for(const p of parts)dir=await dir.getDirectoryHandle(p,{create});return{dir,name};}
async function read(path){const {dir,name}=await parent(path);return(await(await dir.getFileHandle(name)).getFile()).text();}
async function put(path,text){const {dir,name}=await parent(path,true),file=await dir.getFileHandle(name,{create:true});const stream=await file.createWritable();await stream.write(text);await stream.close();}
const general=JSON.parse(await read('input3XX/general.txt'));
await put('input3XX/general.txt',JSON.stringify({...general,mirrorSymmetryX:-1,mirrorSymmetryY:-1,htsMu:false,htsRo:false}));
await put('input3XX/xapLibFMM/2.00.txt',createFmmMaterialFile(createConstantMuFmm({mu:2,hMax:22})).text);
const writes=[];let failFile=null;
const nativeWrite=FileSystemFileHandle.prototype.createWritable;
FileSystemFileHandle.prototype.createWritable=async function(...args){
  if(this.name===failFile)throw new DOMException('Controlled write failure','NotAllowedError');
  const stream=await nativeWrite.apply(this,args),close=stream.close.bind(stream),name=this.name;
  stream.close=async()=>{await close();writes.push(name);};return stream;
};
window.showDirectoryPicker=async options=>options?.id === "clark-project-disk" ? opfs : root;
localStorage.setItem('e3d.generalInformation.openAtStartup','false');
window.editorFixture={read,put,writes,
  failFile:name=>{failFile=name;},
  exists:async path=>{try{await read(path);return true;}catch(e){if(e.name==='NotFoundError')return false;throw e;}},
  files:async()=>{const dir=await(await task.getDirectoryHandle('input3XX')).getDirectoryHandle('xapLibFMM');const names=[];for await(const [name]of dir.entries())names.push(name);return names.sort();},
  model:()=>structuredClone(modelService.getModel()),
  task:()=>selectionService.loadedTaskHandle(),
  dirty:()=>unsavedChangesService.hasDirty(),
  setDirty:()=>{const schema=tabRegistry.find(v=>v.id==='general');modelService.setModelPart(schema,{...modelService.getModel().general,timeStep:Math.random()+1});unsavedChangesService.setExplicitDirty('general',true);},
  tables:selector=>TabulatorFull.findTable(selector),
  chart:canvas=>Chart.getChart(canvas),
  setLoaded:loaded=>{selectionService.setLoadedTaskHandle(loaded?task:null);},
};
render(()=><App/>,document.getElementById('root'));
window.editorFixture.ready=true;
