import test from "node:test";
import assert from "node:assert/strict";
import {validateSubdivision,faceSplits} from "../src/services/solver/hexSubdivision.js";
import {faces,shellDefect} from "../src/services/solver/hexCellShell.js";
import {unpackKvVertices} from "../src/services/solver/geometryKv.js";
import {medBox,medModel} from "./fixtures/medContactCases.js";
import {analyzeMed} from "../src/services/medAnalysisService.js";

const block=(record,row)=>({row,record,vertices:record.geo,dp:record.dp.flat()});
const general={doubleFloat:true,mirrorSymmetryX:-1,mirrorSymmetryY:-1};
function contactPair(offset=0) {
    const at=(x,y,z)=>[x+.125*y*z,y,z];
    const first=medBox(), second=medBox();
    first.geo=first.geo.map(([x,y,z])=>at(x,y,z));
    second.geo=second.geo.map(([x,y,z])=>at(1+x+offset,z,1-y));
    first.med[5]=[2];second.med[4]=[1];
    return [first,second];
}
test("a cyclically shifted warped interface uses the same physical diagonal on both cells",()=>{
    const rows=contactPair();
    const p=validateSubdivision(rows.map(block),general);
    assert.deepEqual([...p.errors],[]);
    assert.equal(p.plan.get(5),1);
    assert.equal(p.plan.get(10),-1);
    const diagonal=(points,face,split)=>[0,2].map(i=>points[faces[face][split===1?i:i+1]]).map(v=>v.join(",")).sort();
    assert.deepEqual(diagonal(rows[0].geo,5,1),diagonal(rows[1].geo,4,-1));
});
test("MED corner matching also carries the diagonal across a representable mismatch",()=>{
    const rows=contactPair(.0005);
    for (const r of rows) r.symR0=[[0],[1000],[0]];
    const model=medModel(rows,{...general,doubleFloat:false,countTimeSteps:1,timeStep:1});
    const analysis=analyzeMed(model);
    assert.equal(analysis.contacts.length,1);
    assert.equal(analysis.contacts[0].compatible,true);
    const independent=validateSubdivision(rows.map(block),model.general);
    const joined=validateSubdivision(rows.map(block),model.general,analysis);
    assert.deepEqual([...joined.errors],[]);
    assert.equal(independent.plan.get(10),1);
    assert.equal(joined.plan.get(10),-1);
});
test("an incompatible cyclic face order is reported with the originating row and EO",()=>{
    const [a,b]=contactPair();
    const idmap=new Map();
    const cells=[a,b].map((r,i)=>({row:i,index:1,ijk:[0,0,0],image:"LS1",owner:i,p:r.geo,
        ids:r.geo.map(p=>{const id=p.join(",");if (!idmap.has(id)) idmap.set(id,idmap.size);return idmap.get(id);})}));
    const ids=cells[1].ids;
    [ids[0],ids[2]]=[ids[2],ids[0]];
    const errors=[];
    assert.equal(faceSplits(cells,Number.EPSILON,(row,msg)=>errors.push([row,msg])),null);
    assert.equal(errors[0][0],1);assert.match(errors[0][1],/обход.*грани/);
});
test("mixed models do not enumerate the EO of a distant precision-safe affine block",()=>{
    const [curved]=contactPair();
    const far=medBox({origin:[10,0,0],size:[20,20,20],dp:[25,25,25]});
    const result=validateSubdivision([curved,far].map(block),general,null,{maxCells:2});
    assert.deepEqual([...result.errors],[]);
    const capped=validateSubdivision([curved].map(block),general,null,{maxCells:0});
    assert.match(capped.errors.get(0),/не завершена/);
});
test("precision loss after translation is detected in actual cell coordinates",()=>{
    const row=medBox({dp:[4,1,1],symR0:[[1e8],[0],[0]]});
    assert.match(validateSubdivision([block(row,0)],{doubleFloat:false}).errors.get(0),/ЭО №1.*якобиан/);
    assert.deepEqual([...validateSubdivision([block(row,0)],general).errors],[]);
});
test("shell intersection predicate allows shared edges, triangular ends and a collapsed apex",()=>{
    const cube=medBox().geo;
    for (const vertices of [cube,cube.map((p,i)=>i===2||i===6 ? cube[i-2] : p),
        cube.map((p,i)=>i>=4 ? [.5,.5,1] : p)]) assert.equal(shellDefect(vertices,[0,0,0,0,0,0]),null);
    const reflected=cube.map(([x,y,z])=>[-x,y,z]);
    assert.equal(shellDefect(reflected,[0,0,0,0,0,0]),null);
});
test("a sector ending on the symmetry axis certifies a large mesh without materializing its images",()=>{
    const row=medBox({dp:[80,195,1],symAs:36,symYa:10});
    row.geo=unpackKvVertices([0,0,7,0,7,23,0,23,10],1).vertices;
    assert.deepEqual([...validateSubdivision([block(row,0)],general,null,{maxCells:1}).errors],[]);
});
test("a shallow warped contact keeps its shared diagonal even when either split is safe per cell",()=>{
    const rows=contactPair();
    for (const record of rows) record.geo=record.geo.map(([x,y,z])=>{
        const base=Math.round(x);
        return [base+(x-base)/256,y,z];
    });
    const audit=validateSubdivision(rows.map(block),general);
    assert.deepEqual([...audit.errors],[]);
    assert.equal(audit.plan.get(5),1);assert.equal(audit.plan.get(10),-1);
});
test("a moving block keeps its owner slot when a distant regular grid was skipped",()=>{
    const [warped]=contactPair();
    const far=medBox({origin:[10,0,0],dp:[2,1,1]});
    const rows=[far,{...warped,indMove:1}];
    const reference=validateSubdivision(rows.map(block),general);
    const moved=validateSubdivision([far,{...rows[1],symR0:[[0],[.15],[0]]}].map(block),general,null,{reference:reference.plan});
    assert.deepEqual([...reference.errors],[]);assert.deepEqual([...moved.errors],[]);
    assert.equal(reference.plan.get(6*2+5),1);
    assert.equal(moved.plan.get(6*2+5),1);
});
