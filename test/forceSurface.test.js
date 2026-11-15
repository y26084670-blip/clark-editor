import test from 'node:test';
import assert from 'node:assert/strict';
import createModule from 'manifold-3d/manifold';
import { forceBodies, generateForceSurface } from '../src/services/generator/forceSurface.js';
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

test('node step uses both endpoints and the longer edge of each opposite pair independently', () => {
    const wide = [[0,0,0],[3,0,0],[4.5,2,0],[0,2,0]];
    const square = [[0,0,0],[1.5,0,0],[1.5,1.5,0],[0,1.5,0]];
    const input = {elements:[block(0)],regions:[]};
    const plan = {ids:[1], replace:[1], surfaces:[{id:1,panels:[wide,square]}]};
    const write = step => applyForceGroups(input, plan, step, () => ({}));
    // max(3,4.5) / 1.5 = 3 intervals; max(2,2.5) / 1.5 rounds up to 2.
    assert.deepEqual(write(1.5).regions.map(r=>r.dp), [[[4],[3]], [[2],[2]]]);
    assert.deepEqual(write(10).regions.map(r=>r.dp), [[[2],[2]], [[2],[2]]]);
    for (const step of [0,-1,NaN,Infinity,Number.MIN_VALUE]) assert.throws(()=>write(step), /шаг/);
    assert.deepEqual(input.regions, []);
    assert.equal(input.elements[0].take, 0);
});

// Geometry from input3XX(2).zip: 600 LS/AS/PS images and two separated groups.
// Keep the original stored coordinates; rounding their decimal values hides
// the near-collinear Boolean seams that caused the regression.
function repeatedRadialModel(doubleFloat) {
    const row = (geo, dp, extra={}) => ({
        geo, dp, geoType:1, targ:0, take:0, indMove:0,
        symR0:[0,0,0], symVi:[0,0,0], symYl:0, symYa:45, symTx:13,
        symLs:1, symAs:8, symPs:3, symKya:1, symKyp:0, ...extra,
    });
    const elements = [
        row([13,0,24.5,13,-2.5,24.372499465942383,13,0,27.5,13,-2.5,27.386499404907227,
            10,0,24.5,10,-2.5,24.372499465942383,10,0,27.5,10,-2.5,27.386499404907227], [3,4,5], {geoType:0}),
        row([13,2.5,24.372499465942383,13,0,24.5,13,2.5,27.386499404907227,13,0,27.5,
            10,2.5,24.372499465942383,10,0,24.5,10,2.5,27.386499404907227,10,0,27.5], [3,4,5], {geoType:0}),
        row([13,-2.5,24.372499465942383,13,-5,23.984500885009766,13,-2.5,27.386499404907227,13,-5,27.042499542236328,
            10,-2.5,24.372499465942383,10,-5,23.984500885009766,10,-2.5,27.386499404907227,10,-5,27.042499542236328], [3,4,5], {geoType:0}),
        row([13,5,23.984500885009766,13,2.5,24.372499465942383,13,5,27.042499542236328,13,2.5,27.386499404907227,
            10,5,23.984500885009766,10,2.5,24.372499465942383,10,5,27.042499542236328,10,2.5,27.386499404907227], [3,4,4], {geoType:0}),
        row([10,13,13,13,13,24.468399047851562,10,24.468399047851562,5.887499809265137], [4,12,3],
            {symVi:[-8.831250190734863,0,0], symYl:5.887499809265137, symLs:4}),
        row([10,12.789799690246582,13,12.789799690246582,13,24.07200050354004,10,24.07200050354004,21.450000762939453],
            [4,12,8], {symVi:[22.5,0,0]}),
        row([13,33.5,23,33.5,23,37,13,37,5], [10,4,4],
            {symVi:[-7.699999809265137,0,0], symYl:5, symLs:9, symPs:2, indMove:1}),
        row([10,30,13,30,13,37,10,37,5], [4,8,4],
            {symVi:[-7.5,0,0], symYl:5, symLs:4, indMove:1}),
        row([13,13,23,13,23,22,13,22,5], [1,1,1],
            {targ:1, symYa:5, symAs:72, symPs:2, symKyp:-1}),
    ];
    return {...model(elements,{doubleFloat, countTimeSteps:40, timeStep:.05}), moves:[{
        angle:[[0,0,0,0],[1,11.25,0,0],[2,0,0,0]],
        position:[[0,0,0,0],[1,0,0,0],[2,3,0,0]],
    }]};
}

// Exact integration of a uniform Maxwell stress over planar triangles. A
// closed, consistently oriented shell has zero resultant and zero moment.
function checkUniformStress(panels) {
    const h = [2,-3,5], hh = dot(h,h), force = [0,0,0], moment = [0,0,0];
    let forceScale = 0, momentScale = 0;
    for (const q of panels) for (const ids of [[0,2,1],[0,3,2]]) {
        const [a,b,c] = ids.map(i=>q[i]);
        const area = cross(sub(b,a),sub(c,a)).map(v=>v/2);
        const center = axes.map(d=>(a[d]+b[d]+c[d])/3);
        const f = h.map((v,d)=>v*dot(h,area)-area[d]*hh/2);
        const torque = cross(center,f);
        forceScale += Math.hypot(...f); momentScale += Math.hypot(...torque);
        for (const d of axes) { force[d] += f[d]; moment[d] += torque[d]; }
    }
    assert.ok(Math.hypot(...force) < 1e-12*forceScale);
    assert.ok(Math.hypot(...moment) < 1e-12*momentScale);
}

for (const doubleFloat of [false,true]) {
    test(`rounded radial Boolean seams produce two closed force shells (${doubleFloat ? 'double' : 'single'})`, () => {
        const input = repeatedRadialModel(doubleFloat), saved = structuredClone(input);
        const plan = automatic(input,2,1);
        assert.deepEqual(plan.ids,[1,1,1,1,1,1,2,2,1]);
        const {bodies} = forceBodies(input);
        assert.equal(bodies.length,600);
        for (const shell of plan.surfaces) {
            const grouped = {...input,elements:input.elements.map((e,i)=>({...e,take:plan.ids[i]}))};
            const manual = buildForceGroups(kernel,grouped,{mode:'manual',group:shell.id,
                indices:shell.members,distance:1,minimumGap:2});
            assert.deepEqual(manual.surfaces[0].panels,shell.panels);
            checkEdges(shell.panels);
            checkUniformStress(shell.panels);
            for (const q of shell.panels) {
                const normal = cross(sub(q[3],q[0]),sub(q[1],q[0]));
                for (const [j,p] of q.entries()) {
                    const turn = cross(sub(q[(j+3)%4],p),sub(q[(j+1)%4],p));
                    assert.ok(dot(turn,normal)>0);
                    assert.ok(p.every(v=>Number.isFinite(v) && (doubleFloat || v===Math.fround(v))));
                }
            }
            for (const index of input.elements.keys()) {
                const body = bodies.find(b=>b.index===index);
                const center = axes.map(d=>body.vertices.reduce((s,p)=>s+p[d]/8,0));
                const expected = shell.members.includes(index) ? 1 : 0;
                assert.ok(Math.abs(winding(shell.panels,center)-expected)<1e-8);
            }
        }
        assert.deepEqual(input,saved);
    });
}
