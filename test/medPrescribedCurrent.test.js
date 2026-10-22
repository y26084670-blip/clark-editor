import test from "node:test";
import assert from "node:assert/strict";
import {analyzeMed,medDiagnostics} from "../src/services/medAnalysisService.js";
import {medBox,medModel} from "./fixtures/medContactCases.js";

function bar({sourceDp=[3,1,1],active=true,...general}={}) {
    const conductor=medBox({dp:[2,4,3]});
    const source=medBox({origin:[1,0,0],dp:sourceDp,targ:2,rv:0});
    if(active) {conductor.med[5]=[2];source.med[4]=[1];}
    return medModel([conductor,source],general);
}

test("prescribed contact uses source 1x1 face and receiving arbitrary subdivisions",()=>{
    const model=bar(),before=structuredClone(model),r=analyzeMed(model);
    assert.deepEqual(r.errors,[]);assert.deepEqual(medDiagnostics(r),[]);
    assert.equal(r.contacts.length,1);assert.equal(r.contacts[0].prescribed,true);
    assert.equal(r.contacts[0].compatible,true);assert.deepEqual(model,before);
});
test("the unit subdivisions follow the donor face axes",()=>{
    for(let axis=0;axis<3;axis++) {
        const origin=[0,0,0];origin[axis]=1;
        const dp=[1,1,1];dp[axis]=7;
        const face=5-2*axis;
        const model=medModel([medBox({dp:[2,3,4]}),medBox({origin,dp,targ:2})]);
        model.elements[0].med[face]=[2];model.elements[1].med[face-1]=[1];
        assert.deepEqual(analyzeMed(model).errors,[]);
        model.elements[1].dp[(axis+1)%3]=[2];
        assert.ok(analyzeMed(model).errors.some(e=>e.code==="PRESCRIBED_GRID"));
    }
});
test("full macro faces must coincide even though elementary grids need not",()=>{
    const m=bar();for(const p of m.elements[1].geo)p[1]+=.2;
    assert.ok(analyzeMed(m).errors.some(e=>e.code==="PARTIAL_CONTACT"));
});
test("autofill proposes a valid prescribed contact and read-only check preserves -1",()=>{
    const m=bar({active:false}),before=structuredClone(m),r=analyzeMed(m);
    assert.deepEqual(r.changes.map(c=>[c.block,c.face,c.proposed]),[[1,5,2],[2,4,1]]);
    assert.ok(medDiagnostics(r).every(d=>d.level==="warning"));
    assert.deepEqual(m,before);
});
test("a coincident insulated inductive source can retain its own discretization",()=>{
    const r=analyzeMed(bar({active:false,sourceDp:[3,2,4]}));
    assert.deepEqual(r.errors,[]);assert.equal(r.canApply,false);
    assert.deepEqual(r.changes,[]);
    assert.ok(medDiagnostics(r).some(d=>d.code==="PRESCRIBED_INSULATED"));
});
test("one-sided prescribed contact is an error",()=>{
    const m=bar();m.elements[1].med[4]=[-1];
    assert.ok(medDiagnostics(analyzeMed(m)).some(d=>d.level==="error"));
});
test("a resolvable gap leaves the source inductive and retains unused source MED=0",()=>{
    const m=bar({active:false,doubleFloat:false});
    m.elements[1].med=Array.from({length:6},()=>[0]);
    for(const p of m.elements[1].geo)p[0]+=.001;
    const r=analyzeMed(m);
    assert.deepEqual(r.errors,[]);assert.equal(r.contacts.length,0);
    assert.deepEqual(medDiagnostics(r),[]);
});
test("ordinary contacts on another face remain subject to grid conformity",()=>{
    const m=bar();m.elements.push(medBox({origin:[-1,0,0],dp:[7,4,3]}));
    m.elements[0].med[4]=[3];m.elements[2].med[5]=[1];
    const r=analyzeMed(m);assert.deepEqual(r.errors,[]);
    assert.equal(r.contacts.length,2);assert.deepEqual(medDiagnostics(r),[]);
    m.elements[2].dp[1]=[2];
    assert.ok(analyzeMed(m).errors.some(e=>e.code==="GRID_MISMATCH"));
});
test("mirrored source contacts use the same physical images as conductors",()=>{
    const m=bar({mirrorSymmetryY:1});
    for(const e of m.elements)for(const p of e.geo)p[1]+=1;
    const r=analyzeMed(m);assert.deepEqual(r.errors,[]);
    assert.equal(r.contacts.length,2);assert.deepEqual(medDiagnostics(r),[]);
});
test("two prescribed sources do not create a conduction constraint",()=>{
    const m=medModel([medBox({origin:[10,0,0]}),medBox({targ:2}),medBox({targ:2})]);
    const r=analyzeMed(m);assert.deepEqual(r.errors,[]);assert.equal(r.contacts.length,0);
});

function hierarchicalBar({port=true,insulatedJoint=false}={}) {
    const m=medModel([
        medBox({dp:[3,3,2]}),
        medBox({origin:[-1,0,0],dp:[1,1,2]}),
        medBox({origin:[1,0,0],dp:[2,1,1],targ:2,rv:0}),
    ],{useMED:true});
    if (!insulatedJoint) {m.elements[0].med[4]=[2];m.elements[1].med[5]=[1];}
    if (port) {m.elements[0].med[5]=[3];m.elements[2].med[4]=[1];}
    m.jweakLocal={status:"ready",data:{version:1,coarse_divisions:[[1,1,2],[1,1,2],[2,1,1]]}};
    return m;
}

test("hierarchical port supports nonconforming child joints with conforming parents",()=>{
    const m=hierarchicalBar(),before=structuredClone(m),r=analyzeMed(m);
    assert.equal(r.ordinaryContactGrid.status,"incompatible");
    assert.equal(r.ordinaryContactGrid.conflicts.length,1);
    assert.deepEqual(r.errors,[]);
    assert.deepEqual(medDiagnostics(r),[]);
    assert.equal(r.contacts.find(c=>c.prescribed).compatible,true);
    assert.deepEqual(r.changes,[]);
    assert.equal(r.canApply,false);
    assert.deepEqual(m,before);
});

test("matching actual joints do not get a false structural-incompatibility diagnosis",()=>{
    const m=hierarchicalBar();m.elements[1].dp=[[3],[3],[2]];
    const r=analyzeMed(m);
    assert.equal(r.ordinaryContactGrid.status,"compatible");
    assert.deepEqual(r.ordinaryContactGrid.conflicts,[]);
    assert.deepEqual(r.errors,[]);
    assert.deepEqual(medDiagnostics(r),[]);
    assert.equal(r.canApply,false); // All existing pointers are already correct.
});

test("paired insulation is excluded from the active-interface compatibility check",()=>{
    const r=analyzeMed(hierarchicalBar({insulatedJoint:true}));
    assert.equal(r.ordinaryContactGrid.status,"compatible");
    assert.deepEqual(r.errors,[]);
});

test("a supported hierarchy with no active port is not invalidated by nonconforming child joints",()=>{
    const r=analyzeMed(hierarchicalBar({port:false}));
    assert.equal(r.ordinaryContactGrid.status,"incompatible");
    assert.deepEqual(r.errors,[]);
    assert.ok(!medDiagnostics(r).some(d=>d.level==="error"));
});

test("an incomplete interface assessment never declares the ordinary grid compatible",()=>{
    const m=hierarchicalBar();m.elements[1].dp=[[1],[1],[3]];
    m.jweakLocal.data.coarse_divisions[1]=[1,1,3];
    const r=analyzeMed(m);
    assert.equal(r.ordinaryContactGrid.status,"unverified");
    assert.ok(r.errors.some(e=>e.code==="PARENT_GRID_MISMATCH"));
    assert.ok(medDiagnostics(r).some(d=>d.level==="error"&&d.code==="PARENT_GRID_MISMATCH"));
});

test("hierarchical prescribed contact can be explicitly autofilled",()=>{
    const m=hierarchicalBar({port:false}),before=structuredClone(m),r=analyzeMed(m);
    assert.deepEqual(r.errors,[]);
    assert.equal(r.canApply,true);
    assert.deepEqual(r.changes.map(c=>[c.block,c.face,c.proposed]),[[1,5,3],[3,4,1]]);
    assert.ok(medDiagnostics(r).every(d=>d.level==="warning"));
    assert.deepEqual(m,before);
});

test("hierarchical port retains donor face, parent and reciprocal MED checks",()=>{
    for(let axis=0;axis<3;axis++) {
        const origin=[0,0,0];origin[axis]=1;
        const dp=[1,1,1];dp[axis]=3;
        const face=5-2*axis;
        const m=medModel([medBox({dp:[3,3,2]}),medBox({origin,dp,targ:2})],{useMED:true});
        m.elements[0].med[face]=[2];m.elements[1].med[face-1]=[1];
        m.jweakLocal={status:"ready",data:{version:1,coarse_divisions:[[1,1,2],dp.slice()]}};
        assert.deepEqual(medDiagnostics(analyzeMed(m)),[]);
        m.elements[1].med[face-1]=[-1];
        assert.ok(medDiagnostics(analyzeMed(m)).some(d=>d.level==="error"));
        m.elements[1].med[face-1]=[1];
        m.elements[1].dp[(axis+1)%3]=[2];
        m.jweakLocal.data.coarse_divisions[1][(axis+1)%3]=2;
        assert.ok(analyzeMed(m).errors.some(e=>e.code==="PRESCRIBED_GRID"));
    }
});
