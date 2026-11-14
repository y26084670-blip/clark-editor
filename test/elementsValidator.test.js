import test from "node:test";
import assert from "node:assert/strict";

import { elementsValidator }
    from "../src/tabulator/validators/models/elements/elementsValidator.js";
import {medModel,medBox} from "./fixtures/medContactCases.js";

test("MED diagnostics use the full model and do not modify stored pointers",()=>{
    const model=medModel([medBox(),medBox({origin:[1,.25,.25],size:[1,.5,.5]})]);
    model.general.countTimeSteps=1; model.general.timeStep=1;
    const before=structuredClone(model),messages=[];
    elementsValidator({getModel:()=>model},messages);
    assert.ok(messages.some(d=>d.code==="PARTIAL_CONTACT"&&d.row===1));
    assert.ok(messages.some(d=>d.code==="PARTIAL_CONTACT"&&d.row===2));
    assert.deepEqual(model,before);
});

test("a static model skips MED contacts and leaves its stored pointers unchanged",()=>{
    const model=medModel([medBox({med:[999,999,999,999,999,999]}),medBox({origin:[1,.25,.25],size:[1,.5,.5]})]);
    const before=structuredClone(model),messages=[];
    elementsValidator({getModel:()=>model},messages);
    assert.ok(!messages.some(d=>d.property==="med"||d.code==="PARTIAL_CONTACT"));
    assert.deepEqual(model,before);
});

function validVertices() {
    return [
        [0, 1, 0],
        [1, 1, 0],
        [0, 1, 1],
        [1, 1, 1],
        [0, 0, 0],
        [1, 0, 0],
        [0, 0, 1],
        [1, 0, 1],
    ];
}

function vector(rows, value = 0) {
    return Array.from({ length: rows }, () => [value]);
}

function parameterGeo(values) {
    const flat = new Array(24).fill(0);
    values.forEach((value, index) => {
        flat[index] = value;
    });

    return Array.from(
        { length: 8 },
        (_, index) => flat.slice(3 * index, 3 * index + 3),
    );
}

function element({
    geoType = 0,
    geo = validVertices(),
    ...overrides
} = {}) {
    return {
        name: "Элемент",
        symVi: vector(3),
        symR0: vector(3),
        symYl: 0,
        symYa: 0,
        symTx: 0,
        symLs: 1,
        symAs: 1,
        symPs: 1,
        geoType,
        geo,
        dr: vector(3),
        dp: vector(3, 1),
        vkan: vector(3),
        med: vector(6),
        indMove: 0,
        targ: 0,
        model: 0,
        rv: 0,
        xapName: "Сталь",
        ...overrides,
    };
}

function validate(elements, model = {}) {
    const diagnostics = [];
    const service = {
        getModel: () => ({ ...model, elements }),
    };

    elementsValidator(service, diagnostics);
    return diagnostics;
}

function invalidVertices() {
    const vertices = validVertices();
    vertices[3][1] += 0.25;
    return vertices;
}

test("elements accepts valid direct vertices", () => {
    assert.deepEqual(validate([element()]), []);
});

test("skew source is accepted and a reversed source identifies its row", () => {
    const reversed = validVertices().map(([x,y,z]) => [-x,y,z]);
    const diagnostics = validate([element({geo: invalidVertices()}), element({geo: reversed})]);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].level, "error");
    assert.equal(diagnostics[0].row, 2);
    assert.equal(diagnostics[0].property, "geo");
    assert.match(diagnostics[0].message, /ориентация/);
});

test("elements accepts the reported Float32 geometry", () => {
    const geo = [
        [13, 0, 24.500778198242188],
        [13, -2.5132100582122803, 24.37150001525879],
        [13, 0, 27.500699996948242],
        [13, -2.5132100582122803, 27.386499404907227],
        [10, 0, 24.500699996948242],
        [10, -2.5132100582122803, 24.37150001525879],
        [10, 0, 27.500699996948242],
        [10, -2.5132100582122803, 27.386499404907227],
    ];

    assert.deepEqual(validate([element({ geo })]), []);
});

test("elements validates every geometry type after unpack", () => {
    const validCases = [
        [1, [0, 1, 1, 1, 1, 2, 0, 2, 30]],
        [2, [2, 3, 4]],
        [3, [2, 3, 4, 2, 3]],
        [4, [3, 2, 0, 4, 2, 1, 1]],
    ];

    for (const [geoType, parameters] of validCases) {
        assert.deepEqual(
            validate([
                element({
                    geoType,
                    geo: parameterGeo(parameters),
                }),
            ]),
            [],
            `geoType ${geoType}`,
        );
    }

    for (const [geoType, parameters] of [
        [1, [0, 1, 1, 1, 1, 2, 0, 2, 0]],
        [2, [0, 3, 4]],
        [3, [0, 3, 4, 2, 3]],
        [4, [0, 2, 0, 4, 2, 1, 1]],
    ]) {
        assert.notDeepEqual(
            validate([
                element({
                    geoType,
                    geo: parameterGeo(parameters),
                }),
            ]),
            [],
            `geoType ${geoType}`,
        );
    }
});

test("elements accepts the collapsed non-reference edges of a pyramid", () => {
    assert.deepEqual(validate([element({geoType:4,geo:parameterGeo([3,2,0,4,2,1,1])})]),[]);
});

test("positive wedges accept zero-length boundary edges", () => {
    for (const [a,b] of [[2,6],[4,5]]) {
        const geo = validVertices();
        geo[a] = [...geo[0]];
        geo[b] = [...geo[a === 2 ? 4 : 1]];
        assert.deepEqual(validate([element({geo})]), []);
    }
});

test("elements keeps parameter-unpack diagnostics separate from the SHG contract", () => {
    const diagnostics=validate([element({geoType:2,geo:parameterGeo([0,3,4])})]);
    assert.equal(diagnostics.length,1);
    assert.match(diagnostics[0].message,/неположительный размер/);
});

test("elements does not duplicate an incomplete geo shape error", () => {
    const diagnostics = validate([
        element({ geo: validVertices().slice(0, 7) }),
    ]);

    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].property, "geo");
    assert.match(diagnostics[0].message, /8 × 3/);
});

test("elements treats sparse geo arrays as one shape error", () => {
    const sparseRows = new Array(8);
    sparseRows[0] = [0, 0, 0];

    const sparseCoordinates = validVertices();
    sparseCoordinates[0] = new Array(3);

    for (const geo of [sparseRows, sparseCoordinates]) {
        const diagnostics = validate([element({ geo })]);

        assert.equal(diagnostics.length, 1);
        assert.equal(diagnostics[0].property, "geo");
        assert.match(diagnostics[0].message, /8 × 3/);
    }
});

test("elements reports inconsistent symmetry settings", () => {
    const diagnostics = validate([element({
        symLs: 2,
        symAs: 3,
        symPs: 2,
    })]);

    assert.deepEqual(
        diagnostics.map(({ level, property, message }) => ({
            level,
            property,
            message,
        })),
        [
            {
                level: "error",
                property: "symYl",
                message:
                    "при наличии локальных образов следует задать "
                    + "ненулевой угол симметрии (шаг по углу)",
            },
            {
                level: "error",
                property: "symYa",
                message:
                    "при наличии азимутальных образов следует задать "
                    + "ненулевой угол симметрии (шаг по углу)",
            },
            {
                level: "error",
                property: "symTx",
                message:
                    "при наличии периодических образов следует задать "
                    + "ненулевой шаг вдоль оси",
            },
        ],
    );
});

test("elements warns about unused symmetry steps", () => {
    const diagnostics = validate([element({
        symYl: 15,
        symYa: 30,
        symTx: 4,
    })]);

    assert.deepEqual(diagnostics.map(item => item.level), [
        "warning",
        "warning",
        "warning",
    ]);
    assert.deepEqual(diagnostics.map(item => item.property), [
        "symYl",
        "symYa",
        "symTx",
    ]);
    assert.deepEqual(diagnostics.map(item => item.message), [
        "при отсутствии локальных образов задавать угол симметрии "
            + "(шаг по углу) излишне",
        "при отсутствии азимутальных образов задавать угол симметрии "
            + "(шаг по углу) излишне",
        "при отсутствии периодических образов задавать шаг вдоль оси "
            + "излишне",
    ]);
});

test("elements rejects negative movement and conductivity", () => {
    const diagnostics = validate([element({ indMove: -1, rv: -0.1 })]);

    assert.deepEqual(
        diagnostics.map(({ level, property, message }) => ({
            level,
            property,
            message,
        })),
        [
            {
                level: "error",
                property: "indMove",
                message: "индекс движения не может быть отрицательным",
            },
            {
                level: "error",
                property: "rv",
                message: "электропроводность не может быть отрицательной",
            },
        ],
    );
});

test("Unknown without magnetic material and with zero conductivity reports ERROR at its original row", () => {
    for (const model of [0, 1, 2]) {
        for (const xapName of ["", " \t\r\n", "\u00a0\u2003", null, undefined]) {
            const elements = [element({ model }), element({ model, xapName, rv: 0 })];
            const before = structuredClone(elements);
            const diagnostics = validate(elements);
            assert.deepEqual(diagnostics.map(({ level, tab, row, property, message }) =>
                ({ level, tab: tab.id, row, property, message })), [{
                level: "error", tab: "elements", row: 2, property: "targ",
                message: "элемент с назначением Unknown не может быть немагнитным при нулевой электропроводности",
            }]);
            assert.deepEqual(elements, before);
        }
    }
});

test("Unknown may be magnetic, conducting or both; prescribed and virtual sources are exempt", () => {
    const model = { general: { countTimeSteps: 0 } };
    for (const fields of [
        { xapName: "Сталь", rv: 0 },
        { xapName: "", rv: 1 },
        { xapName: "", rv: Number.MIN_VALUE },
        { xapName: "Сталь", rv: 1 },
        ...[1, 2, 3].map(targ => ({ targ, xapName: "", rv: 0 })),
    ]) assert.deepEqual(validate([element(fields)], model), []);
});

test("Unknown source rule uses original material fields and also applies in static and HTS modes", () => {
    for (const countTimeSteps of [0, 20]) {
        const model = { general: { countTimeSteps, useMED: false, htsMu: false, htsRo: false } };
        const invalid = element({ model: 2, xapName: "", rv: -0, isMagnetic: true, isConductive: true });
        assert.equal(validate([invalid], model).filter(d => d.property === "targ").length, 1);
        assert.deepEqual(validate([element({ isMagnetic: false, isConductive: false })], model), []);
    }
});

test("Unknown source rule does not duplicate invalid conductivity diagnostics", () => {
    for (const rv of [-1, NaN, Infinity, undefined, null, "0"]) {
        const diagnostics = validate([element({ xapName: "", rv })]);
        assert.ok(!diagnostics.some(d => d.property === "targ"));
        if (rv === -1) assert.deepEqual(diagnostics.map(d => [d.level, d.property]), [["error", "rv"]]);
    }
});

test("full model validation reports and clears the Unknown material error using the current snapshot", async () => {
    const { createServer } = await import("vite");
    const server = await createServer({ configFile: false, appType: "custom",
        server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] } });
    try {
        const { modelValidator } = await server.ssrLoadModule("/src/tabulator/validators/types/modelValidator.js");
        const model = { general: { countTimeSteps: 0, useMED: true },
            elements: [element({ xapName: "", rv: 0 })], amps: [], moves: [], mhj: null };
        const check = () => modelValidator({ getModel: () => model }).filter(d => d.level === "error");
        const before = structuredClone(model);
        assert.deepEqual(check().map(d => [d.tab.id, d.row, d.property]), [["elements", 1, "targ"]]);
        assert.deepEqual(model, before);
        model.elements[0].rv = 1;
        assert.deepEqual(check(), []);
        model.elements[0].rv = 0;
        model.elements[0].xapName = "Сталь";
        assert.deepEqual(check(), []);
        model.elements[0].xapName = "";
        assert.equal(check().length, 1);
    } finally {
        await server.close();
    }
});

test("elements validates every discretization direction", () => {
    const diagnostics = validate([element({
        dp: [[0], [1.5], ["2"]],
    })]);

    assert.deepEqual(diagnostics.map(item => item.property), ["dp", "dp", "dp"]);
    assert.deepEqual(diagnostics.map(item => item.message), [
        "разбиение D1 должно быть задано положительным целым числом",
        "разбиение D2 должно быть задано положительным целым числом",
        "разбиение D3 должно быть задано положительным целым числом",
    ]);
});


test("a source lost to Float32 rounding is reported at the active precision", () => {
    const geo = validVertices().map(([x,y,z]) => [x + 1e8,y,z]);
    const single = validate([element({geo})], {general: {doubleFloat: false}});
    assert.equal(single.length, 1);
    assert.equal(single[0].level, "error");
    assert.deepEqual(validate([element({geo})], {general: {doubleFloat: true}}), []);
});

test("zero-volume observation regions remain usable as point sets", () => {
    const geo = validVertices().map(([x,y]) => [x,y,0]);
    assert.ok(validate([element({geo})]).some(d => d.level === "error"));
    assert.ok(validate([element({geo, targ: 3})]).every(d => d.property !== "geo"));
});
test("model diagnostics distinguish the 60-degree shell intersection from a twist warning",()=>{
    const h=Math.sqrt(3)/2;
    const rhombus=[[0,0,0],[1,0,0],[-.5,h,0],[.5,h,0]];
    // Use the same rhombus rotated by 60° around its center.
    for (let i=0;i<4;i++) {
        const [x,y]=rhombus[i], dx=x-.25,dy=y-h/2;
        rhombus[4+i]=[.25+.5*dx-h*dy,h/2+h*dx+.5*dy,1];
    }
    for (const doubleFloat of [true,false]) {
        const model={general:{doubleFloat,useMED:false,countTimeSteps:0}};
        const errors=validate([element({geo:rhombus})],model);
        assert.equal(errors.length,1);
        assert.equal(errors[0].row,1);assert.equal(errors[0].level,"error");
        assert.match(errors[0].message,/ЭО №1.*самопересечение.*гранями 3 и 6/);
        assert.deepEqual(validate([element({geo:rhombus,dp:vector(3,2)})],model),[]);
        assert.deepEqual(validate([element({geo:rhombus,targ:3})],model).filter(d=>d.property==="geo"),[]);
    }
});
