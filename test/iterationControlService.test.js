import test from "node:test";
import assert from "node:assert/strict";
import { formatIterationValue, parseIterationValue, readIterationStatus, sendIterationRequest,
  ITERATION_STATUS_FILE, ITERATION_REQUEST_FILE } from "../src/services/iterationControlService.js";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const binding = { bindingState: "bound", workspaceId };
const snapshot = () => ({ schemaVersion: 1, workspaceId, sessionId: "22222222-2222-4222-8222-222222222222",
  active: true, taskId: 4, taskPath: "Project/Task", tau: .3, eps: .005, updatedAt: new Date().toISOString() });
function fixture(status = snapshot()) {
  const writes = [];
  return { writes, status, kind: "directory", async getFileHandle(name, options) {
    if (name === ITERATION_STATUS_FILE) return { getFile: async () => ({ text: async () => JSON.stringify(this.status) }) };
    assert.equal(name, ITERATION_REQUEST_FILE); assert.equal(options.create, true);
    return { createWritable: async () => ({ write: async text => writes.push(JSON.parse(text)), close: async () => {} }) };
  } };
}
test("fixed decimal inputs enforce bounds and retain ten EPS decimals", () => {
  assert.equal(formatIterationValue(.3, "TAU"), "0.3000");
  assert.equal(formatIterationValue(1e-10, "EPS"), "0.0000000001");
  for (const value of ["0.0001", "1.0000", ".3", "0,4"]) assert.ok(parseIterationValue(value, "TAU") > 0);
  for (const value of ["0", "-1", "1.0001", "0.00009", "NaN", "Infinity", "1e-3", ""]) assert.throws(() => parseIterationValue(value, "TAU"));
  for (const value of ["0", "-0.1", "0.00000000001", "Infinity"]) assert.throws(() => parseIterationValue(value, "EPS"));
});
test("inactive, stale, other-workspace and malformed status never enable controls", async () => {
  const status = snapshot();
  assert.equal((await readIterationStatus(fixture(status), binding)).taskId, 4);
  for (const change of [{active:false}, {schemaVersion:2}, {workspaceId:"other"}, {updatedAt:"bad"},
    {updatedAt:new Date(Date.now()-6000).toISOString()}, {tau:0}, {eps:0}, {taskId:0}]) {
    assert.equal(await readIterationStatus(fixture({...status,...change}), binding), null);
  }
  const f = fixture({...status,tau:Math.fround(.0001)});
  assert.ok(await readIterationStatus(f,binding), "REAL32 lower bound remains available");
});
test("only selected parameters are sent with run/task identity", async () => {
  for (const values of [{TAU:"0.5000"}, {EPS:"0.0000000010"}, {TAU:"1.0000",EPS:"0.0100000000"}]) {
    const root = fixture(), status = await readIterationStatus(root,binding);
    const id = await sendIterationRequest(root,binding,status,values);
    assert.equal(root.writes.length,1); const sent=root.writes[0];
    assert.equal(sent.requestId,id); assert.equal(sent.taskId,status.taskId); assert.equal(sent.sessionId,status.sessionId);
    assert.deepEqual(Object.keys(sent.parameters),Object.keys(values));
    assert.deepEqual(sent.parameters,Object.fromEntries(Object.entries(values).map(([k,v])=>[k,Number(v)])));
  }
});
test("task changes and invalid requests produce no write", async () => {
  const root = fixture(), status=await readIterationStatus(root,binding);
  root.status={...root.status,taskId:5};
  await assert.rejects(()=>sendIterationRequest(root,binding,status,{TAU:".5"}),/изменилось/);
  root.status=status;
  for (const values of [{}, {TAU:"2"}, {EPS:"0"}, {TAU:".5",EPS:"-1"}, {DTK:"1"}]) {
    await assert.rejects(()=>sendIterationRequest(root,binding,status,values));
  }
  assert.equal(root.writes.length,0);
});
