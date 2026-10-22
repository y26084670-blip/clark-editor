import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { EN_MODEL, EN_TARG } from "../src/services/schemas/common/enums.js";

const enumEditorPath = new URL(
    "../src/tabulator/editors/types/enumEditor.js",
    import.meta.url,
);
const appCssPath = new URL("../src/App.css", import.meta.url);
const generalSchemaPath = new URL(
    "../src/services/schemas/general.schema.js",
    import.meta.url,
);
const elementsSchemaPath = new URL(
    "../src/services/schemas/elements.schema.js",
    import.meta.url,
);
const enumFormatterPath = new URL(
    "../src/tabulator/formatters/types/enumFormatter.js",
    import.meta.url,
);
const tableBuilderPath = new URL(
    "../src/tabulator/builders/TableBuilder.js",
    import.meta.url,
);
const mirrorImagePaths = Object.freeze([
    Object.freeze({
        url: new URL("../resource/-1.png", import.meta.url),
        sha256: "44cd41d0688441469dfd87ee1ca1f3aaaa4c5830fec4220e8b49a29e2b703cba",
    }),
    Object.freeze({
        url: new URL("../resource/0.png", import.meta.url),
        sha256: "49600375e02f2c6cacbdad5e22adc6efe1fa0362208de600b1decf8e1e4af723",
    }),
    Object.freeze({
        url: new URL("../resource/+1.png", import.meta.url),
        sha256: "8e211b2adbcbf53e2facccb41b76b97afa8e0e3dc3ac09f9d49f50cae21ccd3b",
    }),
]);

test("material model labels expose the supported choices", () => {
    assert.equal(EN_MODEL[0].label, "ФММ M(H)");
    assert.equal(EN_MODEL[1].disabled, true);
    assert.equal(EN_MODEL[2].disabled, undefined);
});

test("element role labels retain their numeric values", () => {
    assert.deepEqual(EN_TARG, [
        { value: 0, label: "Unknown" },
        { value: 1, label: "M - const" },
        { value: 2, label: "J - const" },
        { value: 3, label: "Virtual" },
    ]);
});

test("element role tooltip contains the exact five explanation lines", async () => {
    const source = await readFile(elementsSchemaPath, "utf8");
    const descriptionSource = source.match(
        /targ:\s*\{[\s\S]*?description:\s*([\s\S]*?),\s*default:/u,
    )?.[1];
    assert.ok(descriptionSource, "element role description is present");
    const description = [...descriptionSource.matchAll(/"(?:\\.|[^"\\])*"/gu)]
        .map(([literal]) => JSON.parse(literal))
        .join("");

    assert.deepEqual(description.split("\n"), [
        "Роль элемента в расчетах:",
        "Unknown -> Неизвестные источники",
        "M-const -> Заданная намагниченность",
        "J-const -> Заданная плотность тока; контакт через MED задаёт нормальный ток (грань источника 1×1), магнитный вклад сохраняется",
        "Virtual -> Виртуальный (поле/катушка)",
    ]);
    assert.match(source, /targ:\s*\{[\s\S]*?enum:\s*EN_TARG/u);
});

test("header tooltips preserve explicit line breaks as safe DOM text", async () => {
    const source = await readFile(tableBuilderPath, "utf8");
    const helper = source.match(/function textTooltip\(text\) \{[\s\S]*?\n\}/u)?.[0];
    assert.ok(helper, "shared text tooltip helper is present");
    const document = {
        createElement(tagName) {
            return {
                tagName,
                style: {},
                set innerHTML(value) {
                    assert.fail(`tooltip interpreted text as HTML: ${value}`);
                },
            };
        },
    };
    const textTooltip = new Function("document", `${helper}; return textTooltip;`)(document);
    const text = "Роль элемента в расчетах:\n<img src=x onerror=alert(1)>\nVirtual";
    const tooltip = textTooltip(text);

    assert.equal(tooltip.tagName, "div");
    assert.equal(tooltip.textContent, text);
    assert.equal(tooltip.style.whiteSpace, "pre-line");
    assert.match(
        source,
        /headerTooltip:\s*\(\)\s*=>\s*textTooltip\(property\.description\)/u,
    );
});

test("enum editor disables marked options", async () => {
    const source = await readFile(enumEditorPath, "utf8");

    assert.match(source, /option\.disabled = entry\.disabled === true;/u);
});

test("mirror symmetry uses image values with one white tooltip", async () => {
    const [schema, editor, formatter, builder, styles] = await Promise.all([
        readFile(generalSchemaPath, "utf8"),
        readFile(enumEditorPath, "utf8"),
        readFile(enumFormatterPath, "utf8"),
        readFile(tableBuilderPath, "utf8"),
        readFile(appCssPath, "utf8"),
    ]);

    assert.match(schema, /value:\s*-1,[\s\S]*?resource\/-1\.png/u);
    assert.match(schema, /value:\s*0,[\s\S]*?resource\/0\.png/u);
    assert.match(schema, /value:\s*1,[\s\S]*?resource\/\+1\.png/u);
    assert.match(schema, /Нулевая нормальная компонента напряженности/u);
    assert.match(schema, /Нулевая касательная компонента напряженности/u);
    assert.match(
        schema,
        /mirrorSymmetryX:[\s\S]*?description:\s*"",[\s\S]*?enum:\s*mirrorSymmetryOptions/u,
    );
    assert.match(
        schema,
        /mirrorSymmetryY:[\s\S]*?description:\s*"",[\s\S]*?enum:\s*mirrorSymmetryOptions/u,
    );
    assert.match(editor, /function imageEnumEditor/u);
    assert.match(formatter, /function imageEnumValue/u);
    assert.doesNotMatch(formatter, /value\.title/u);
    assert.match(builder, /function imageEnumTooltip/u);
    assert.match(builder, /element\.classList\.add\("image-enum-tooltip"\)/u);
    assert.match(builder, /classList\.contains\("tabulator-editing"\)/u);
    assert.match(styles, /\.image-enum-option\.selected/u);
    assert.match(
        styles,
        /\.tabulator-tooltip\.image-enum-tooltip\s*\{[^}]*background:\s*#fff;[^}]*color:\s*#111;/su,
    );
});

test("mirror symmetry uses the updated image assets", async () => {
    for (const image of mirrorImagePaths) {
        const bytes = await readFile(image.url);
        const digest = createHash("sha256").update(bytes).digest("hex");
        assert.equal(digest, image.sha256);
    }
});

test("Tabulator tooltips use the enlarged bold font", async () => {
    const source = await readFile(appCssPath, "utf8");

    assert.match(
        source,
        /\.tabulator-tooltip\s*\{[^}]*font-size:\s*14px;[^}]*font-weight:\s*bold;/su,
    );
});

test("empty material characteristic changes only the displayed model label", async () => {
  const schema=await readFile(elementsSchemaPath,"utf8");
  const callback=schema.match(/displayLabel:\s*([\s\S]*?),\n\s*\},\n\n\s*xapName:/u)?.[1];
  assert.ok(callback);
  const displayLabel=new Function(`return (${callback});`)();
  const formatterSource=(await readFile(enumFormatterPath,"utf8")).replace(/^import .*;$/mu,"").replace("export function enumFormatter","function enumFormatter");
  const formatter=new Function("findNamedEnumOption",formatterSource+";return enumFormatter;")((options,value)=>options.find(item=>item.value===value));
  for(const model of [0,2])for(const xapName of ["","   ","steel"]){
    const row={model,xapName,rv:1,targ:0},original={...row};
    const text=formatter({getValue:()=>model,getRow:()=>({getData:()=>row})},{property:{enum:EN_MODEL,displayLabel}});
    assert.equal(text,xapName.trim() ? EN_MODEL.find(option=>option.value===model).label : "немагнитный");
    assert.deepEqual(row,original);
  }
});
