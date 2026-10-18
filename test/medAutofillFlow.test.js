import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createRoot,createSignal,createEffect,createMemo,onCleanup} from "solid-js/dist/solid.js";
import {analyzeMed} from "../src/services/medAnalysisService.js";
import {createMedRequest,medRequestIsCurrent,medRequestCanNavigate,applyMedResult}
    from "../src/services/medAutofillService.js";
import {medBox,medModel} from "./fixtures/medContactCases.js";

const appUrl=new URL("../src/App.jsx",import.meta.url);
const source=await readFile(appUrl,"utf8");
const start=source.indexOf("  const [medOpen, setMedOpen]");
const end=source.indexOf("  const [selectedGeometryElementIndices",start);
assert.ok(start>=0&&end>start);
// Execute the real App controller with Solid signals and browser worker/editor
// dependencies replaced. The worker still runs the production geometry analysis.
const controller=new Function("dependencies",`
    const {createSignal,createEffect,createMemo,onCleanup,selectionService,modelService,
        createMedRequest,medRequestIsCurrent,medRequestCanNavigate,applyMedResult,
        loadJweakLocal,Worker,tabRegistry,TABS,performModelValidation,
        setSidePanelOpen,setActiveTab}=dependencies;
    ${source.slice(source.indexOf("  async function refreshJweakForMed()"),source.indexOf("  const [sidePanelOpen"))}
    ${source.slice(start,end).replaceAll("import.meta.url",JSON.stringify(appUrl.href))}
    return {analyzeCurrentMed,applyCurrentMed,navigateCurrentMed,closeMed,
        medResult,medRequest,medBusy,medError,medNotice,medStale,medCanNavigate,medOpen,
        medNavigation,setEditor:editor=>{medEditor=editor;}};
`);

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function runtime() {
    let api,dispose,setModel,setTask;
    const state={workers:[],writes:0,validations:0,held:false,rows:[{},{}],flush:null};
    createRoot(cleanup=>{
        dispose=cleanup;
        const [model,updateModel]=createSignal(medModel([medBox(),medBox({origin:[1,0,0]})]));
        const [task,updateTask]=createSignal({});
        setModel=updateModel;setTask=updateTask;
        const service={getModel:model,setModelPart(_schema,elements){
            state.writes++;updateModel(current=>({...current,elements}));
        }};
        class Worker {
            constructor(){state.workers.push(this);}
            postMessage(snapshot){this.snapshot=structuredClone(snapshot);
                if(!state.held)queueMicrotask(()=>this.reply());}
            reply(){this.onmessage?.({data:{result:analyzeMed(this.snapshot)}});}
            terminate(){this.terminated=true;}
        }
        api=controller({createSignal,createEffect,createMemo,onCleanup,modelService:service,
            selectionService:{loadedTaskHandle:task,taskDataVersion:()=>0},createMedRequest,medRequestIsCurrent,
            medRequestCanNavigate,applyMedResult,loadJweakLocal:async()=>model().jweakLocal,Worker,
            tabRegistry:[{id:"elements"}],TABS:{ELEMENTS:{id:"elements"}},
            performModelValidation:async()=>{state.validations++;},setSidePanelOpen(){},setActiveTab(){}});
        api.setEditor({rows:()=>state.rows,flush:async()=>{await state.flush?.();}});
    });
    await tick();
    return {api,state,dispose,setTask,
        edit(change){setModel(current=>change(structuredClone(current)));},
    };
}

test("many MED corrections keep navigation and one apply refreshes the analysis",async()=>{
    const r=await runtime();
    try {
        await r.api.analyzeCurrentMed();
        const initial=r.api.medResult();
        for(let i=0;i<5;i++) {
            r.edit(model=>{model.elements[i%2].med[0]=[i];return model;});
            await r.api.navigateCurrentMed(i%2+1,0);
            assert.equal(r.api.medNavigation().block,i%2+1);
            assert.equal(r.api.medResult(),initial);
            assert.equal(r.api.medCanNavigate(),true);
            assert.equal(r.state.workers.length,1);
        }
        await r.api.applyCurrentMed();
        assert.equal(r.state.workers.length,2);
        assert.equal(r.state.writes,1);
        assert.equal(r.state.validations,1);
        assert.equal(r.api.medError(),"");
        assert.match(r.api.medNotice(),/MED применён/u);
    } finally {r.dispose();}
});

test("apply checks the new geometry and performs no writes if errors remain",async()=>{
    const r=await runtime();
    try {
        await r.api.analyzeCurrentMed();
        r.edit(model=>{model.elements[1].geo=structuredClone(model.elements[0].geo);return model;});
        await r.api.applyCurrentMed();
        assert.equal(r.state.workers.length,2);
        assert.equal(r.state.writes,0);
        assert.ok(r.api.medResult().errors.length>0);
        assert.match(r.api.medError(),/ошибки/u);
    } finally {r.dispose();}
});

test("an initially erroneous list can be corrected and applied without manual reanalysis",async()=>{
    const r=await runtime();
    try {
        r.edit(model=>{model.elements[1].geo=structuredClone(model.elements[0].geo);return model;});
        await r.api.analyzeCurrentMed();
        assert.ok(r.api.medResult().errors.length>0);
        r.edit(model=>{model.elements[1]=medBox({origin:[1,0,0]});return model;});
        assert.equal(r.api.medCanNavigate(),true);
        assert.equal(r.state.workers.length,1);
        await r.api.applyCurrentMed();
        assert.equal(r.state.workers.length,2);
        assert.equal(r.state.writes,1);
        assert.equal(r.api.medError(),"");
    } finally {r.dispose();}
});

test("renumbered rows cannot navigate; pending editor changes are flushed first",async()=>{
    const r=await runtime();
    try {
        await r.api.analyzeCurrentMed();
        r.state.flush=async()=>{
            r.state.rows.reverse();r.edit(model=>{model.elements.reverse();return model;});
            r.state.flush=null;
        };
        await r.api.navigateCurrentMed(1,0);
        assert.equal(r.api.medNavigation(),null);
        assert.equal(r.api.medCanNavigate(),false);
    } finally {r.dispose();}
});

test("changing task closes the old list and rejects delayed analysis",async()=>{
    const r=await runtime();
    try {
        await r.api.analyzeCurrentMed();
        r.edit(model=>{model.elements[0].med[0]=[0];return model;});
        r.state.held=true;
        const pending=r.api.applyCurrentMed();
        await tick();
        const worker=r.state.workers.at(-1);
        r.setTask({});await tick();
        worker.reply();await pending;
        assert.equal(r.state.writes,0);
        assert.equal(r.api.medOpen(),false);
        assert.equal(r.api.medResult(),null);
    } finally {r.dispose();}
});

test("closing while flushing an edit cancels apply and does not reopen the panel",async()=>{
    const r=await runtime();
    try {
        await r.api.analyzeCurrentMed();
        r.edit(model=>{model.elements[0].med[0]=[0];return model;});
        let finish;
        r.state.flush=()=>new Promise(resolve=>{finish=resolve;});
        const pending=r.api.applyCurrentMed();await tick();
        r.api.closeMed();finish();await pending;
        assert.equal(r.api.medOpen(),false);
        assert.equal(r.state.workers.length,1);
        assert.equal(r.state.writes,0);
    } finally {r.dispose();}
});

test("edits during refresh cancel it and a later apply uses a fresh snapshot",async()=>{
    const r=await runtime();
    try {
        await r.api.analyzeCurrentMed();
        r.edit(model=>{model.elements[0].med[0]=[0];return model;});
        r.state.held=true;
        const pending=r.api.applyCurrentMed();await tick();
        const worker=r.state.workers.at(-1);
        r.edit(model=>{model.elements[1].med[0]=[0];return model;});await tick();
        worker.reply();await pending;
        assert.equal(r.state.writes,0);
        assert.equal(r.api.medCanNavigate(),true);
        r.state.held=false;await r.api.applyCurrentMed();
        assert.equal(r.state.writes,1);
        assert.equal(r.api.medError(),"");
    } finally {r.dispose();}
});
