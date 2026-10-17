import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';

const server = await createServer({configFile:false, server:{middlewareMode:true,hmr:false},
    appType:'custom', optimizeDeps:{noDiscovery:true,include:[]}});
after(() => server.close());
const {TableBuilder} = await server.ssrLoadModule('/src/tabulator/builders/TableBuilder.js');
const {modelToRows, rowsToModel} = await server.ssrLoadModule('/src/tabulator/converters/modelConverter.js');
const elements = (await server.ssrLoadModule('/src/services/schemas/elements.schema.js')).default;
const regions = (await server.ssrLoadModule('/src/services/schemas/regions.schema.js')).default;
const originalDocument = globalThis.document;
globalThis.document = {createElement: () => ({style:{},
    set innerHTML(value) { assert.fail('Tooltip must use textContent: '+value); }})};
after(() => { if (originalDocument === undefined) delete globalThis.document; else globalThis.document=originalDocument; });

function cell(row, {clipped=false, editing=false}={}) {
    const element={textContent:row.name, clientWidth:100, scrollWidth:clipped?200:100,
        clientHeight:20,scrollHeight:20,querySelector:()=>null,
        classList:{contains:()=>editing}};
    return {getRow:()=>({getData:()=>row}),getField:()=>'name',getValue:()=>row.name,getElement:()=>element};
}

for (const [kind,schema] of [['elements',elements],['regions',regions]]) {
    test(`${kind}: every value cell and number column expose the source row number`, () => {
        assert.equal(schema.config.rowNumberTooltip,true);
        const rows=modelToRows(schema,[{name:'Первый'},{name:'Второй'}]);
        const config=TableBuilder.buildValueColumnConfig(schema);
        assert.equal(config.tooltip(null,cell(rows[1])).textContent,'Строка №2');
        const number=TableBuilder.buildColumns(schema).find(c=>c.field==='rowLabel');
        assert.equal(number.tooltip(null,cell(rows[0])).textContent,'Строка №1');
        const reordered=modelToRows(schema,rowsToModel(schema,[rows[1],rows[0]]));
        assert.equal(reordered[0].name,'Второй');
        assert.equal(config.tooltip(null,cell(reordered[0])).textContent,'Строка №1');
        const deleted=modelToRows(schema,rowsToModel(schema,[reordered[1]]));
        assert.equal(config.tooltip(null,cell(deleted[0])).textContent,'Строка №1');
    });
}

test('row numbers preserve full clipped text as safe text and hide while editing', () => {
    const config=TableBuilder.buildValueColumnConfig(elements);
    const row={rowLabel:21,name:'<img src=x onerror=alert(1)>'};
    assert.equal(config.tooltip(null,cell(row,{clipped:true})).textContent,
        'Строка №21\n'+row.name);
    assert.equal(config.tooltip(null,cell(row,{editing:true})), '');
    row.rowLabel=12;
    assert.equal(config.tooltip(null,cell(row)).textContent,'Строка №12');
});

test('other record schemas retain existing overflow-only tooltips', () => {
    const schema={...elements,config:{...elements.config,rowNumberTooltip:false}};
    const config=TableBuilder.buildValueColumnConfig(schema);
    assert.equal(config.tooltip(null,cell({rowLabel:2,name:'Имя'})), '');
    assert.equal(config.tooltip(null,cell({rowLabel:2,name:'Длинное имя'},{clipped:true})).textContent,'Длинное имя');
});
