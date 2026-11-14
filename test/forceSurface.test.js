import test from 'node:test';
import assert from 'node:assert/strict';
import createModule from 'manifold-3d/manifold';
import { generateForceSurface } from '../src/services/generator/forceSurface.js';
import { bilinearRegionNormals } from '../src/services/visualization/geometryDiscretization.js';
import { expandElementSymmetry } from '../src/services/solver/symmetryExpansion.js';
import { applyMatrix4ToPoint } from '../src/services/solver/rotation3d.js';

const kernel = await createModule(); kernel.setup();
const prism = (origin, size) => ({ geoType:2, geo:[size], symR0:origin.map(x=>[x]), dp:[[2],[2],[2]] });
const model = (elements, general={}) => ({elements, general:{doubleFloat:true, mirrorSymmetryX:-1, mirrorSymmetryY:-1, ...general}});
const build = (m, selected=[0], d=1) => generateForceSurface(kernel,m,selected,d);
const axes=[0,1,2];
const bounds = quads => axes.map(d => [Math.min(...quads.flat().map(p=>p[d])),Math.max(...quads.flat().map(p=>p[d]))]);
const sub = (p,q) => p.map((v,i)=>v-q[i]);
const dot = (p,q) => p.reduce((v,x,i)=>v+x*q[i],0);
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

// Independent test of the exported panels, including the sign of a cavity.
function winding(panels, point) {
    let angle = 0;
    for (const quad of panels) for (const ids of [[0,2,1],[0,3,2]]) {
        const [a,b,c] = ids.map(j=>sub(quad[j],point));
        const [x,y,z] = [a,b,c].map(v=>Math.hypot(...v));
        angle += 2*Math.atan2(dot(a,cross(b,c)), x*y*z+dot(a,b)*z+dot(b,c)*x+dot(c,a)*y);
    }
    return angle/(4*Math.PI);
}
function checkEdges(panels, planes=[]) {
    const edges = new Map();
    for (const q of panels) {
        assert.equal(new Set(q.map(p=>p.join(','))).size,4);
        assert.equal(bilinearRegionNormals(q).length,1);
        for (const [i,p] of q.entries()) {
            const next=q[(i+1)%4], a=p.join(','), b=next.join(',');
            if (planes.some(d=>p[d]===0 && next[d]===0)) continue;
            const id=a<b?a+'/'+b:b+'/'+a, entry=edges.get(id)??[0,0];
            entry[0]++; entry[1]+=a<b?1:-1; edges.set(id,entry);
        }
    }
    for (const [key,pair] of edges) assert.deepEqual(pair,[2,0],key);
}
const u=[prism([0,0,0],[2,10,4]),prism([2,0,0],[6,2,4]),prism([8,0,0],[2,10,4])];

test('empty recess is covered by six outward planar quads at the requested offset', () => {
    const panels=build(model(u),[0,1,2]);
    assert.equal(panels.length,6); checkEdges(panels);
    assert.deepEqual(bounds(panels),[[-1,11],[-1,11],[-1,5]]);
    assert.ok(Math.abs(winding(panels,[4,1,2])-1)<1e-10);
});

test('a foreign body wholly inside the box is excluded, including its volume, with conforming outward quads', () => {
    const foreign=prism([4.5,5,1],[1,1,2]), panels=build(model([...u,foreign]),[0,1,2]);
    assert.ok(panels.length>6); checkEdges(panels);
    for (const point of [[1,5,2],[5,1,2],[9,5,2]]) assert.ok(Math.abs(winding(panels,point)-1)<1e-8);
    assert.ok(Math.abs(winding(panels,[5,5.5,2]))<1e-8);
    assert.deepEqual(panels,build(model([...u,foreign]),[2,0,1]));
});

test('a narrow gap silently moves one wall; contact, overlap and containment cannot produce force panels', () => {
    const a=prism([0,0,0],[2,4,4]);
    const p=build(model([a,prism([2.0005,0,0],[1,4,4])],{doubleFloat:false}));
    assert.equal(p.length,6); const xmax=bounds(p)[0][1];
    assert.ok(xmax>2 && xmax<2.0005); assert.deepEqual(bounds(p)[1],[-1,5]);
    for (const x of [2,1.9,.5]) assert.throws(()=>build(model([a,prism([x,1,1],[1,1,1])])),/№1.*№2/);
});

test('one or two mirrors clip only the cut edges, and keep a detached or negative-side box on its actual side', () => {
    const a=prism([0,0,0],[2,4,4]);
    for (const type of [0,1]) for (const both of [false,true]) {
        const planes=both?[0,1]:[0];
        const p=build(model([a],{mirrorSymmetryX:type,mirrorSymmetryY:both?1-type:-1}));
        assert.equal(p.length,6-planes.length); checkEdges(p,planes);
        for (const d of planes) {
            assert.equal(bounds(p)[d][0],0);
            assert.ok(p.every(q=>q.some(v=>v[d]>0)));
        }
    }
    const detached=build(model([prism([3,4,0],[2,2,2])],{mirrorSymmetryX:0,mirrorSymmetryY:1}));
    assert.equal(detached.length,6); checkEdges(detached);
    const negative=build(model([prism([-2,0,0],[2,2,2])],{mirrorSymmetryX:1}));
    assert.deepEqual(bounds(negative)[0],[-3,0]); assert.equal(negative.length,5);
});

test('uses LS/AS/PS of real records and the actual t=0 frame, independently of viewer filters', () => {
    const a={...prism([0,0,0],[2,2,2]),symR0:[[1],[0],[0]],symVi:[0,0,0],symPs:2,symTx:8,indMove:1};
    const m=model([a]);m.moves=[{angle:[[0,0,0,0]],position:[[0,3,0,0]]}];
    assert.deepEqual(bounds(build(m))[0],[3,15]);
    const rotated={...prism([0,0,0],[2,4,1]),symLs:2,symYl:90,symAs:2,symYa:180};
    const b=bounds(build(model([rotated])));
    assert.ok(Math.abs(b[1][0]+5)<1e-12 && Math.abs(b[2][1]-5)<1e-12);
});

test('rotated neighbours with overlapping bounding boxes and a warped source do not cause false capture', () => {
    const a={...prism([0,0,0],[8,1,1]),symVi:[[0],[0],[45]]};
    const b={...prism([-1.25,1.25,0],[8,1,1]),symVi:[[0],[0],[45]]};
    const p=build(model([a,b]),[0],.6); checkEdges(p);
    assert.ok(Math.abs(winding(p,[2.5,3.15,.5])-1)<1e-7);
    assert.ok(Math.abs(winding(p,[1.25,4.40,.5]))<1e-7);
    const vertices=Array.from({length:8},(_,i)=>[i&1?4:0,i&2?4:0,i&4?2:0]); vertices[7][2]=2.8;
    assert.equal(build(model([{geoType:0,geo:vertices}])).length,6);
});

test('oblique cuts at large single-precision coordinates stay planar after the solver reads every vertex', () => {
    const a = {...prism([10000,10000,10000],[10,1,1]), symVi:[[20],[25],[35]]};
    const matrix = expandElementSymmetry(a)[0].matrix;
    const translate = p => applyMatrix4ToPoint(matrix,p);
    const b = {...a, symR0:translate([0,1.5,0]).map(v => [v])};
    const panels = build(model([a,b],{doubleFloat:false}));
    assert.ok(panels.length > 6);
    assert.ok(panels.flat(2).every(v => v === Math.fround(v)));
    checkEdges(panels);
    assert.ok(Math.abs(winding(panels,translate([5,.5,.5]))-1) < 1e-8);
    assert.ok(Math.abs(winding(panels,translate([5,2,.5]))) < 1e-8);
});

test('warped boundary is refined on its EO grid when the eight-corner hull captures a clear obstacle', () => {
    const vertices = Array.from({length:8}, (_,i) =>
        [i&1 ? 4:0, i&2 ? 4:0, (i&4 ? 2:-2) + (i===7 ? 2:0)]);
    const element = {geoType:0, geo:vertices, dp:[[4],[4],[2]]};
    const obstacle = prism([1.9,1.9,2.75],[.2,.2,.12]);
    const p = build(model([element,obstacle]));
    checkEdges(p);
    assert.ok(Math.abs(winding(p,[2,2,2.4])-1)<1e-8);
    assert.ok(Math.abs(winding(p,[2,2,2.8]))<1e-8);
});

test('actual group panels support axial mode and invalid inputs yield no partial result', () => {
    const a = prism([0,0,0],[2,2,2]);
    assert.deepEqual(build(model([a],{fullAxialSymmetry:true})),build(model([a])));
    assert.throws(()=>build(model([a]),[]),/Выберите/);
    assert.throws(()=>build(model([a]),[0],0),/расстояние/);
    assert.throws(()=>build(model([prism([0,0,0],[0,2,2])])),/№1/);
});

const {buildForceGroups, applyForceGroups, excludeForceElements, conflictingForceContacts} =
    await import('../src/services/generator/forceGroups.js');
const block = (x,y=0,z=0, extra={}) => ({...prism([x,y,z],[1,1,1]),targ:0,take:0,...extra});
const automatic = (m,minimumGap=.2,distance=.1) => buildForceGroups(kernel,m,{mode:'automatic',minimumGap,distance});
const apply = (m,plan) => ({...m,...applyForceGroups(m,plan,3,()=>({name:"panel"}))});

test('automatic grouping uses resolvable solid distance at a face, edge, point, overlap and containment', () => {
    for (const b of [block(1,.5),block(1,1),block(1,1,1),block(.45,.4,.1),
        {...prism([.3,.3,.3],[.1,.1,.1]),targ:1}]) {
        const m=model([block(0),b,block(8),block(0,0,0,{targ:3,take:91})]);
        assert.deepEqual(automatic(m,0).ids,[1,1,2,0]);
    }
    const m=model([block(0),block(1.125),block(2.25),block(3.6)]);
    assert.deepEqual(automatic(m,.13).ids,[1,1,1,2]);
    assert.deepEqual(automatic(m,.125).ids,[1,2,3,4]);
    assert.deepEqual(automatic(m,0).ids,[1,2,3,4]);
});

test('rotated bodies with intersecting AABBs use spatial gap and complete mirror geometry', () => {
    const a={...prism([0,0,0],[8,1,1]),symVi:[[0],[0],[45]],take:11};
    const b={...prism([-1.25,1.25,0],[8,1,1]),symVi:[[0],[0],[45]],take:14};
    const m=model([a,b]);
    assert.deepEqual(automatic(m,.6).ids,[1,2]);
    assert.deepEqual(automatic(m,.8).ids,[1,1]);
    assert.deepEqual(conflictingForceContacts(kernel,m,.6),[]);
    assert.deepEqual(conflictingForceContacts(kernel,m,.8),[[0,1]]);
    const mirror=model([block(1),block(-3.1)],{mirrorSymmetryX:0});
    assert.deepEqual(automatic(mirror,.2).ids,[1,1]);
});

test('manual, exclusion, rebuild and automatic replacement change only the corresponding groups', () => {
    const input={...model([block(0),block(1),block(7),block(13),block(0,0,0,{targ:3})]),regions:[{name:'probe',forceGroup:0}]};
    let m=apply(input,automatic(input));
    assert.deepEqual(m.elements.map(e=>e.take),[1,1,2,3,0]);
    const own=m.regions.filter(r=>r.forceGroup===1);
    m={...m,...excludeForceElements(m,[0])};
    assert.equal(m.elements[0].take,0);
    assert.deepEqual(m.regions.filter(r=>r.forceGroup===1),own);
    m={...m,...excludeForceElements(m,[1])};
    assert.ok(m.regions.every(r=>r.forceGroup!==1));
    m=apply(m,buildForceGroups(kernel,m,{mode:'manual',group:17,indices:[2,3],distance:.1,minimumGap:.2}));
    assert.deepEqual(m.elements.map(e=>e.take),[0,0,17,17,0]);
    assert.ok(m.regions.every(r=>[0,17].includes(r.forceGroup)));
    const rebuilt=apply(m,automatic(m));
    assert.deepEqual(rebuilt.elements.map(e=>e.take),[1,1,2,3,0]);
    assert.equal(rebuilt.regions[0],input.regions[0]);
    assert.deepEqual(automatic(rebuilt).surfaces,automatic(input).surfaces);
    assert.throws(()=>buildForceGroups(kernel,rebuilt,{mode:'manual',group:8,indices:[0],distance:.1,minimumGap:.2}),/зазора/);
});
