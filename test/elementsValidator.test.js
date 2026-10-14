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

const EPS = 0.1 * Math.PI / 180;
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

test("elements reports invalid direct vertices at their record row", () => {
    const diagnostics = validate([
        element(),
        element({ geo: invalidVertices() }),
    ]);

    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].level, "error");
    assert.equal(diagnostics[0].tab.id, "elements");
    assert.equal(diagnostics[0].row, 2);
    assert.equal(diagnostics[0].property, "geo");
    assert.equal(
        diagnostics[0].message,
        "Рёбра 13 и 24 не параллельны; угол = 14,03624347 °; требуется ≤ 0,1 °",
    );
});

test("elements reports connecting-edge failures separately", () => {
    const delta = Math.tan(2 * EPS);
    const pair15 = [
        [0, 0, 0], [1, 0, 0],
        [0, 1, 0], [1, 1, 0],
        [0, delta, 1], [1, 0, 1],
        [0, 1, 1], [1, 1, 1],
    ];
    const pair37 = [
        [0, -1, 0], [1, -1, 0],
        [0, 0, 0], [1, delta, 0],
        [0, -1, 1], [1, -1, 1],
        [0, delta, 1], [1, delta, 1],
    ];
    const pair48 = [
        [0, -1, 0], [1, -1, 0],
        [0, delta, 0], [1, 0, 0],
        [0, -1, 1], [1, -1, 1],
        [0, delta, 1], [1, delta, 1],
    ];
    const cases = [
        [pair15, "Рёбра 15 и 26 не параллельны"],
        [pair37, "Рёбра 15 и 37 не параллельны"],
        [pair48, "Рёбра 15 и 48 не параллельны"],
    ];

    for (const [geo, message] of cases) {
        const diagnostics = validate([element({ geo })]);

        assert.ok(diagnostics.some(item => item.message ===
            message + "; угол = 0,2 °; требуется ≤ 0,1 °"));
    }
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

test("elements reports the required zero-length edges", () => {
    for(const [edge,index] of [["13",2],["15",4]]) {
        const geo=validVertices();geo[index]=[...geo[0]];
        const diagnostics=validate([element({geo})]);
        assert.ok(diagnostics.some(d=>d.message===`Недопустимая длина ребра ${edge}; длина = 0 мм; требуется > 0 мм`));
        assert.ok(diagnostics.every(d=>!d.message.includes("NaN")));
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


test("geometry diagnostics use the active profile and contain no arithmetic tail", () => {
    const geo=validVertices();geo[3][1]+=Math.tan(0.15*Math.PI/180);
    const conrab=[{GEO_ANGLE:0.1},{GEO_ANGLE:0.2}];
    const errors=validate([element({geo})],{conrab,general:{doubleFloat:false}});
    assert.equal(errors.length,1);
    assert.equal(errors[0].message,"Рёбра 13 и 24 не параллельны; угол = 0,15 °; требуется ≤ 0,1 °");
    assert.doesNotMatch(errors[0].message,/превышение|недостаток|раза/);
    assert.deepEqual(validate([element({geo})],{conrab,general:{doubleFloat:true}}),[]);
    conrab[0].GEO_ANGLE=null;
    assert.deepEqual(validate([element({geo})],{conrab}),[]); // ошибка принадлежит conrabValidator
});

test("geometry diagnostics add no orientation or physical-size bound", () => {
    const geo=validVertices();
    for(let i=1;i<geo.length;i+=2)geo[i][0]=-1;
    assert.deepEqual(validate([element({geo})]),[]);
    const short=validVertices().map(([x,y,z])=>[x,y,z*0.015]);
    assert.deepEqual(validate([element({geo:short})]),[]);
});
