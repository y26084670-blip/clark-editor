import assert from "node:assert/strict";
import test from "node:test";

import { regionsValidator }
    from "../src/tabulator/validators/models/regions/regionsValidator.js";

function vector(rows, value = 0) {
    return Array.from({ length: rows }, () => [value]);
}

function region(overrides = {}) {
    return {
        symVi: vector(3),
        symR0: vector(3),
        symYl: 0,
        symLs: 1,
        geo: Array.from({ length: 4 }, () => [0, 0, 0]),
        dr: vector(3),
        dp: vector(2, 1),
        indMove: 0,
        ...overrides,
    };
}

function validate(regions) {
    const diagnostics = [];
    regionsValidator({
        getModel: () => ({ regions }),
    }, diagnostics);
    return diagnostics;
}

test("regions accept valid local symmetry and discretization", () => {
    assert.deepEqual(validate([region()]), []);
});

test("regions report and warn about inconsistent local symmetry", () => {
    const error = validate([region({ symLs: 2 })]);
    const warning = validate([region({ symYl: 30 })]);

    assert.deepEqual(error.map(item => ({
        level: item.level,
        property: item.property,
        message: item.message,
    })), [{
        level: "error",
        property: "symYl",
        message:
            "при наличии локальных образов следует задать ненулевой "
            + "угол симметрии (шаг по углу)",
    }]);
    assert.deepEqual(warning.map(item => ({
        level: item.level,
        property: item.property,
        message: item.message,
    })), [{
        level: "warning",
        property: "symYl",
        message:
            "при отсутствии локальных образов задавать угол симметрии "
            + "(шаг по углу) излишне",
    }]);
});

test("regions reject negative movement and invalid discretization", () => {
    const diagnostics = validate([region({
        indMove: -1,
        dp: [[0], [1.5]],
    })]);

    assert.deepEqual(diagnostics.map(item => item.property), [
        "indMove",
        "dp",
        "dp",
    ]);
    assert.deepEqual(diagnostics.map(item => item.message), [
        "индекс движения не может быть отрицательным",
        "разбиение D1 должно быть задано положительным целым числом",
        "разбиение D2 должно быть задано положительным целым числом",
    ]);
});
test("only genuine surface defects are ERROR, in either cyclic orientation", () => {
    const check=(xy,extra={})=>validate([region({geoType:0,geo:xy.map(([x,y,z=0])=>[x,y,z]),...extra})]);
    const square=[[0,0],[2,0],[2,2],[0,2]];
    assert.deepEqual(check(square),[]);
    assert.deepEqual(check(square.toReversed()),[]);
    for (const [shape,reason] of [
        [[[0,0],[2,2],[0,2],[2,0]],/Перекрученная/],
        [[[0,0],[2,0],[.5,.5],[0,2]],/Невыпуклая/],
        [[[0,0],[2,0],[1,0],[0,2]],/перекрываются/],
        [[[0,0],[1,0],[2,0],[0,2]],/коллинеарны/],
    ]) for (const p of [shape,shape.toReversed()]) {
        const [d]=check(p);
        assert.equal(d.row,1);assert.equal(d.property,"geo");assert.equal(d.level,"error");assert.match(d.message,reason);
    }
    assert.deepEqual(check([[0,0],[0,0],[1,0],[0,1]]),[]); // collapsed edge of a triangle
    assert.deepEqual(check([[0,0],[0,0],[1,0],[1,0]]),[]); // encoded measuring line
    assert.deepEqual(check(Array(4).fill([1,2])),[]); // observation point
});
test("a projected bow tie is spatially regular; force panels require planarity", () => {
    const geo=[[0,0,0],[1,1,0],[0,1,0],[1,0,.125]];
    function check(general,indCoil=0) {
        const diagnostics=[];
        regionsValidator({getModel:()=>({general,regions:[region({geoType:0,geo,indCoil})]})},diagnostics);
        return diagnostics.filter(d=>d.property==="geo");
    }
    assert.match(check({})[0].message,/Неплоская.*мм/);
    assert.deepEqual(check({}).map(d=>d.level),["warning"]);
    assert.deepEqual(check({evalForce:true}).map(d=>d.level),["error"]);
    assert.deepEqual(check({evalForce:true},1).map(d=>d.level),["warning"]);
    const skinny=[[0,0,0],[1,0,0],[1,1e-6,0],[0,1e-6,0]];
    assert.match(validate([region({geoType:0,geo:skinny})])[0].message,/min \|G\|/);
});
test("REAL32 rounding cannot silently turn a surface into an intentional measuring line",()=>{
    const geo=[[1e8,0,0],[1e8+1,0,0],[1e8+1,1,0],[1e8,1,0]];
    const diag=validate([region({geoType:0,geo})]);
    assert.match(diag[0].message,/округлении/);assert.equal(diag[0].level,"error");
});
