import test from 'node:test';
import assert from 'node:assert/strict';
import createModule from 'manifold-3d/manifold';
import { forceBodies } from '../src/services/generator/forceSurface.js';
import { forceSweepGeometry } from '../src/services/generator/forceSurfaceSweep.js';
import { buildForceGroups, applyForceGroups } from '../src/services/generator/forceGroups.js';
import { buildGeometryTimeModel } from '../src/services/visualization/geometryTimeModel.js';

const kernel = await createModule(); kernel.setup();
const zero = [0,0,0];
const box = (x=0, extra={}) => ({geoType:2,geo:[[1,1,1]],dp:[1,1,1],
    symVi:zero,symR0:[x,0,0],targ:0,indMove:0,take:0,...extra});
const move = (position,angle=[[0,0,0,0]]) => ({position,angle});
const model = (elements,moves=[],general={}) => ({elements,moves,regions:[],
    general:{doubleFloat:true,mirrorSymmetryX:-1,mirrorSymmetryY:-1,countTimeSteps:1,timeStep:2,...general}});
const automatic = m => buildForceGroups(kernel,m,{mode:'automatic',distance:.25,minimumGap:.5});
function atTime(m,time) {
    const frame = buildGeometryTimeModel({...m,general:{...m.general,
        countTimeSteps:time>0?1:0,timeStep:time}},m.moves,time>0?1:0);
    return forceBodies({...frame.model,elements:frame.model.elements.map(e=>({...e,indMove:0}))});
}

test('translation is covered to the final time and generated panels stay fixed', () => {
    const m = model([box(0,{indMove:1})],[move([[0,0,0,0],[2,3,0,0]])]);
    const saved = structuredClone(m), plan = automatic(m);
    assert.equal(plan.coverage.end,2);
    const panels = plan.surfaces[0].panels;
    assert.ok(Math.max(...panels.flat().map(p=>p[0]))>4);
    for (const time of [0,.337,1,1.789,2]) for (const body of atTime(m,time).bodies)
        for (const p of body.vertices) for (const d of [0,1,2]) {
            assert.ok(p[d]>Math.min(...panels.flat().map(q=>q[d])));
            assert.ok(p[d]<Math.max(...panels.flat().map(q=>q[d])));
        }
    const applied = applyForceGroups(m,plan,.5,()=>({indMove:7}));
    assert.ok(applied.regions.every(r=>r.indMove===0));
    assert.deepEqual(m,saved);
});

test('rotation includes the bulge between endpoints even with one solver interval', () => {
    const m = model([box(0,{indMove:1,dr:[2,0,0]})],
        [move([[0,0,0,0]],[[0,0,0,0],[2,0,0,90]])]);
    const plan = automatic(m), panels = plan.surfaces[0].panels;
    assert.ok(plan.coverage.poses>2);
    // The far corner's y maximum is sqrt(3^2+1^2), at atan(3), not at an endpoint.
    assert.ok(Math.max(...panels.flat().map(p=>p[1]))>Math.sqrt(10));
});

test('mixed Euler rotations, local/axial/periodic images and translation knots have enclosing sweeps', () => {
    const m = model([box(2,{indMove:1,dr:[3,-2,1],symLs:2,symYl:25,
        symAs:3,symYa:120,symPs:2,symTx:7})],
        [move([[0,0,0,0],[1.2,3,-2,1],[2,0,1,3]],
            [[0,0,0,0],[.7,110,40,0],[2,-30,10,160]])]);
    const sweep = forceSweepGeometry(m,.5);
    assert.equal(sweep.bodies.length,12);
    const envelopes = sweep.bodies.map(b => {
        const hull = kernel.Manifold.hull(b.hullVertices), padding = kernel.Manifold.cube(2*b.padding,true);
        try { return hull.minkowskiSum(padding); }
        finally { hull.delete(); padding.delete(); }
    });
    try {
        for (const time of [0,.013,.337,.699,.7,.701,1,1.199,1.2,1.201,1.789,1.999,2]) {
            for (const [j,b] of atTime(m,time).bodies.entries()) {
                const actual = kernel.Manifold.hull(b.vertices), missing = actual.subtract(envelopes[j]);
                try { assert.ok(missing.isEmpty(),`time ${time}, image ${j}`); }
                finally { missing.delete(); actual.delete(); }
            }
        }
    } finally { envelopes.forEach(s=>s.delete()); }
});

test('a future collision rejects separate shells without silently merging the groups', () => {
    const m = model([box(0,{indMove:1}),box(10)],
        [move([[0,0,0,0],[2,10,0,0]])]);
    const saved = structuredClone(m);
    assert.throws(()=>automatic(m),/Огибающие.*№1.*№2.*не разделяются/);
    assert.deepEqual(m,saved);
});

test('overlapping swept paths at different times do not imply physical contact or group merging', () => {
    const m = model([box(0,{indMove:1}),box(3,{indMove:1})],
        [move([[0,0,0,0],[2,10,0,0]])]);
    assert.throws(()=>automatic(m),/Огибающие.*не разделяются/);
});

test('only the requested time range is swept and static geometry is preserved', () => {
    const m = model([box(0,{indMove:1}),box(20)],
        [move([[0,0,0,0],[100,100,0,0]])]);
    const initial = forceBodies(m), sweep = forceSweepGeometry(m,.25,initial);
    assert.ok(sweep.bodies[0].box[0][1]>3 && sweep.bodies[0].box[0][1]<3.001);
    assert.equal(sweep.bodies[1],initial.bodies[1]);
    const startOnly = {...m,general:{...m.general,countTimeSteps:0}};
    const start = forceBodies(startOnly);
    assert.equal(forceSweepGeometry(startOnly,.25,start),start);
    const fixed = model([box()]);
    const fixedInitial = forceBodies(fixed);
    assert.equal(forceSweepGeometry(fixed,.25,fixedInitial),fixedInitial);
});

test('full-turn angles keep their long path and invalid time ranges are rejected', () => {
    const m = model([box(0,{indMove:1,dr:[2,0,0]})],
        [move([[0,0,0,0]],[[0,0,0,0],[2,0,0,360]])]);
    const sweep = forceSweepGeometry(m,.25);
    assert.ok(sweep.bodies[0].box[0][0]<-3);
    assert.ok(sweep.bodies[0].box[1][0]<-3);
    for (const patch of [{countTimeSteps:1.5},{timeStep:0},{timeStep:Infinity},{countTimeSteps:-1}])
        assert.throws(()=>forceSweepGeometry({...m,general:{...m.general,...patch}},.25),/интервал|времени/);
});
