import test from "node:test";
import assert from "node:assert/strict";
import { KV_GEO_FIELDS, KV_GEO_LENGTH, resetKvGeo, unpackKvVertices, validateKvVertices, validateKvVerticesDetailed }
    from "../src/services/solver/geometryKv.js";

const add = (a,b) => a.map((x,i)=>x+b[i]);
function box(a=[1,0,0], b=[0,1,0], c=[0,0,1]) {
    return [[0,0,0],a,b,add(a,b),c,add(a,c),add(b,c),add(add(a,b),c)];
}
test("skew positive cells retain their volume in both working precisions", () => {
    const vertices = box([2,0,0], [.25,3,0], [1,0,4]);
    vertices[3][0] += .5;
    for (const doubleFloat of [false, true]) {
        const result = validateKvVerticesDetailed(vertices, {doubleFloat});
        assert.equal(result.valid, true);
        assert.ok(result.measurements.volume.value > 24);
        assert.deepEqual(result.warnings, []);
    }
});

test("wedges allow collapsed boundary edges 13 and 15", () => {
    for (const [to, from] of [[[2,6],[0,4]], [[4,5],[0,1]]]) {
        const vertices = box();
        to.forEach((v,i) => { vertices[v] = [...vertices[from[i]]]; });
        const result = validateKvVerticesDetailed(vertices);
        assert.equal(result.valid, true);
        assert.ok(Math.abs(result.measurements.volume.value - .5) < 1e-14);
    }
});

test("reversed, flat and locally inverted source geometries are rejected", () => {
    const folded = box();
    folded[7] = [0.1, 0.1, -0.2];
    for (const doubleFloat of [false, true]) {
        assert.equal(validateKvVerticesDetailed(box([-1,0,0]), {doubleFloat}).checks.orientation, false);
        assert.equal(validateKvVerticesDetailed(box([0,0,0]), {doubleFloat}).checks.volume, false);
        assert.equal(validateKvVerticesDetailed(folded, {doubleFloat}).checks.orientation, false);
    }
});

test("coordinate rounding follows the selected precision", () => {
    const vertices = box().map(([x,y,z]) => [1e8 + x, y, z]);
    assert.equal(validateKvVertices(vertices, {doubleFloat: false}), false);
    assert.equal(validateKvVertices(vertices, {doubleFloat: true}), true);
});

test("thin positive source produces a precision warning only when warranted", () => {
    const thin = box([1e-6,0,0]);
    const single = validateKvVerticesDetailed(thin, {doubleFloat: false});
    assert.equal(single.valid, true);
    assert.equal(single.warnings.length, 1);
    assert.deepEqual(validateKvVerticesDetailed(thin, {doubleFloat: true}).warnings, []);
});

test("malformed coordinates do not enter normalization",()=>{
    const bad=box();bad[0][0]=Infinity;
    for(const v of [[],new Array(8),bad,box().map(r=>[...r,0])]) {
        const result=validateKvVerticesDetailed(v);
        assert.equal(result.malformed,true);
        assert.equal(result.valid,false);
    }
});

test("reported legacy Float32 geometry has positive orientation",()=>{
    const v=[
        [13,0,24.500778198242188],[13,-2.5132100582122803,24.37150001525879],
        [13,0,27.500699996948242],[13,-2.5132100582122803,27.386499404907227],
        [10,0,24.500699996948242],[10,-2.5132100582122803,24.37150001525879],
        [10,0,27.500699996948242],[10,-2.5132100582122803,27.386499404907227],
    ];
    assert.equal(validateKvVertices(v),true);
});

test("KV unpack keeps solver error flags while constructing vertices", () => {
    const cases = [
        { geoType: 2, valid: [2, 3, 4], invalid: [0, 3, 4] },
        { geoType: 3, valid: [2, 3, 4, 2, 3], invalid: [0, 3, 4, 2, 3] },
        { geoType: 4, valid: [3, 2, 0, 4, 2, 1, 1], invalid: [0, 2, 0, 4, 2, 1, 1] },
    ];

    for (const { geoType, valid, invalid } of cases) {
        const validResult = unpackKvVertices(valid, geoType);
        const invalidResult = unpackKvVertices(invalid, geoType);

        assert.equal(validResult.err, 0, `valid geoType ${geoType}`);
        assert.equal(invalidResult.err, 1, `invalid geoType ${geoType}`);
        assert.equal(validResult.vertices.length, 8);
        assert.equal(invalidResult.vertices.length, 8);
    }
});


test("all supported geometry types are checked after unpack",()=>{
    for(const [type,parameters] of [
        [0,box().flat()],[1,[0,1,1,1,1,2,0,2,30]],
        [2,[2,3,4]],[3,[2,3,4,2,3]],
    ]) assert.equal(validateKvVertices(unpackKvVertices(parameters,type).vertices),true);
    const pyramid=validateKvVerticesDetailed(unpackKvVertices([3,2,0,4,2,1,1],4).vertices);
    assert.equal(pyramid.valid,true);
    assert.ok(pyramid.measurements.volume.value > 0);
});

test("Editor examples have nonzero parameters and valid three-dimensional geometry for every KV type", () => {
    for (let type = 0; type <= 4; type++) {
        const geo = resetKvGeo(type);
        assert.equal(geo.length, KV_GEO_LENGTH);
        assert.ok(geo.every(Number.isFinite));
        assert.ok(geo.slice(0, KV_GEO_FIELDS[type].length).every(value => value !== 0));
        assert.ok(geo.slice(KV_GEO_FIELDS[type].length).every(value => value === 0));

        const { vertices, err } = unpackKvVertices(geo, type);
        assert.equal(err, 0, `type ${type}`);
        assert.equal(validateKvVertices(vertices), true, `type ${type}`);
        const edges = [1, 2, 4].map(index => vertices[index].map((value, axis) => value - vertices[0][axis]));
        const [a, b, c] = edges;
        const determinant = a[0] * (b[1] * c[2] - b[2] * c[1])
            - a[1] * (b[0] * c[2] - b[2] * c[0])
            + a[2] * (b[0] * c[1] - b[1] * c[0]);
        assert.ok(Math.abs(determinant) > 0, `type ${type} must span a volume`);

        const copy = resetKvGeo(type);
        geo[0] = -999;
        assert.deepEqual(resetKvGeo(type), copy, "examples are independent editable values");
    }
});
test("global Jacobian distinguishes a hidden fold, an interior zero and a legal boundary collapse", () => {
    const fromMap=f=>Array.from({length:8},(_,i)=>f(i&1,(i>>1)&1,i>>2));
    const folded=fromMap((u,v,w)=>[(1-3*w)*u-.1*w*v,.1*w*u+(1-4*w)*v,w]);
    const touching=fromMap((u,v,w)=>[(1-3*w)*u,(1-3*w)*v,w]);
    for (const doubleFloat of [false,true]) {
        const bad=validateKvVerticesDetailed(folded,{doubleFloat});
        assert.equal(bad.measurements.certificate.status,"inverted");
        const w=bad.measurements.certificate.location[2];
        assert.ok(w>.25 && w<1/3);
        const singular=validateKvVerticesDetailed(touching,{doubleFloat});
        assert.equal(singular.measurements.certificate.status,"singular");
        assert.equal(singular.valid,false);
        assert.ok(Math.abs(singular.measurements.certificate.location[2]-1/3)<1e-12);
    }
});

test("a small twist does not mask inversion, and inconclusive Bernstein coefficients are subdivided", () => {
    // Johnen, Weill & Remacle, arXiv:1706.01613, Figs. 5 and 6, cyclic -> CLARK bit order.
    const invalid=[[0,0,0],[1,0,0],[1.7615170641459,.594764272968121,.15552188663289],
        [.438888411629833,1.53098020041072,.185631029838277],[1.3859049651391,.0755794018509022,1.77483024073906],
        [1.22129676447071,.271876165350328,.630922158503566],[1.77365642274365,1.25103990471942,1.83300604452892],
        [.0769922201302364,.940424880836765,1.45521546591891]];
    const valid=[[0,0,0],[1,0,0],[1.539,.704696,1.84011],[.166589,1.08208,.162539],
        [.0501127,1.96347,1.56559],[.422336,.00419138,1.43038],[.509917,.0214216,1.55322],[.40783,1.73452,1.93234]];
    const clark=p=>[0,1,3,2,4,5,7,6].map(i=>p[i]);
    for (const doubleFloat of [false,true]) {
        const bad=validateKvVerticesDetailed(clark(invalid),{doubleFloat});
        assert.equal(bad.measurements.certificate.status,"inverted");
        assert.ok(Math.abs(Math.max(...bad.measurements.twist.map(Math.abs))-47.00444)<.0001);
        assert.equal(validateKvVerticesDetailed(clark(valid),{doubleFloat}).valid,true);
    }
});

test("scaled determinant, SVD and twist use independent measures", () => {
    const skew=box([1,0,0],[.75,1,0],[0,0,1]);
    const measured=validateKvVerticesDetailed(skew).measurements.quality;
    assert.ok(Math.abs(measured.q-.8)<1e-13);
    assert.ok(Math.abs(measured.rho-(Math.hypot(2,.75)-.75)/(Math.hypot(2,.75)+.75))<1e-13);
    const thin=validateKvVerticesDetailed(box(),{doubleFloat:false,dp:[100000,1,1]});
    assert.equal(thin.valid,true);
    assert.ok(Math.abs(thin.measurements.quality.rho-1e-5)<1e-12);
    assert.ok(Math.abs(thin.measurements.quality.q-1)<1e-14);
    assert.match(thin.warnings[0],/σmin/);
    const rotated=angle=>box().map(([u,v,w])=>w
        ? [.5+Math.cos(angle)*(u-.5)-Math.sin(angle)*(v-.5),.5+Math.sin(angle)*(u-.5)+Math.cos(angle)*(v-.5),w] : [u,v,w]);
    assert.deepEqual(validateKvVerticesDetailed(rotated(Math.PI/2)).warnings,[]);
    const plus=validateKvVerticesDetailed(rotated(2*Math.PI/3));
    assert.equal(plus.valid,true);
    assert.match(plus.warnings[0],/120.00°/);
});
