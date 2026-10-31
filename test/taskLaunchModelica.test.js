import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../src/components/tasks/TaskLaunchWindow.jsx", import.meta.url), "utf8");
const code = source.slice(source.indexOf("  function launch(action)"), source.indexOf("  async function acceptRun"));
test("OM launch explains zero or multiple enabled tasks before issuing a native request", () => {
  for (const count of [0, 2, 7]) {
    let message = "", dialogs = 0, requests = 0;
    const run = new Function("launchReady", "enabledEntries", "setModelicaError", "modelicaDialog", "canLaunch", "proof",
      `${code}; return launch;`)(() => true, () => Array(count).fill({ enabled: true }), value => { message = value; },
      { open: false, showModal() { dialogs++; } }, () => count > 0, () => { requests++; });
    run("modelica");
    assert.equal(dialogs, 1); assert.equal(requests, 0);
    assert.match(message, /ровно одно задание/); assert.ok(message.endsWith(`${count}.`));
  }
});

test("the single launcher forwards calculation, OM and confirmed import; only calculation and OM use MPI", () => {
  for (const action of ["solver","modelica","import"]) {
    let ranksRead = 0, beforeImport = 0, sent;
    const entries = () => [{path:"Project/Task",enabled:true}];
    const noop = () => {}, browser = {location:{}};
    const run = new Function("launchReady","enabledEntries","canLaunch","proof","entries","mpiEdited","parseMpiRanks","mpiValue",
      "binding","createNativeLaunchUri","props","loadedIncluded","setPending","setProof","setConfirmImport","setError",
      "setImportMessages","setNotice","window",`${code}; return launch;`)(() => true,entries,() => true,
      () => ({workspaceId:"ws",requestId:"id"}),entries,() => true,() => { ranksRead++; return 3; },() => "3",
      () => ({launchOptionsVersion:1}),(ws,mode,id,ranks) => { sent={ws,mode,id,ranks}; return "clark://test"; },
      {onBeforeImport:() => beforeImport++},() => true,noop,noop,noop,noop,noop,noop,browser);
    run(action);
    assert.deepEqual(sent,{ws:"ws",mode:action,id:"id",ranks:action==="import"?null:3});
    assert.equal(ranksRead,action==="import"?0:1);
    assert.equal(beforeImport,action==="import"?1:0);
    assert.equal(browser.location.href,"clark://test");
  }
});
