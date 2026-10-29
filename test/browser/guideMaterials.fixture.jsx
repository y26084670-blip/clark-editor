/** Browser-only fixture: real Solid/Tabulator components, controlled file handles. */
import '../../src/App.css';
import { render } from 'solid-js/web';
import { createSignal, Show } from 'solid-js';
import { MaterialLibraryTab } from '../../src/tabs/MaterialLibraryTab.jsx';
import { GeneralInformationDialog } from '../../src/components/help/GeneralInformationDialog.jsx';
import { selectionService } from '../../src/services/selectionService.js';
import { materialTabRegistry } from '../../src/services/materialTabRegistry.js';
import { materialLibraryHistoryService } from '../../src/services/materialLibraryHistoryService.js';
import { materialLibraryRevisionService } from '../../src/services/materialLibraryRevisionService.js';
import { toFmmLibraryModel, toHtsLibraryModel } from '../../src/services/materials/materialLibraryModel.js';
import { TabulatorFull } from 'tabulator-tables';
import Chart from 'chart.js/auto';
import { createMaterialLibraryLoadQueue } from '../../src/services/materials/materialLibraryLoadQueue.js';

const [kind, setKind] = createSignal('FMM');
const [mounted, setMounted] = createSignal(false);
const [active, setActive] = createSignal(false);
const [help, setHelp] = createSignal(false);
let releaseBase, releaseLocal, releaseRender;
let baseDelay = null, localDelay = null;
let baseCalls = 0, baseCompleted = 0, renderWaiting = false;
let localCalls = 0;
const delay = which => {
    if (which === 'base') baseDelay = new Promise(resolve => { releaseBase = resolve; });
    else localDelay = new Promise(resolve => { releaseLocal = resolve; });
};
const fmm = { tabl: [...Array.from({ length: 12 }, (_, i) => i), ...Array.from({ length: 12 }, (_, i) => i * 2)], hip: 0, comment: 'Local test' };
const hts = { j_HC0: 1, JC0: 2.5, JCa: 1, JCb: 1, j_ani: false, j_type: 2, j_gmin: 25000, j1_delta: .1, j2_n: 24, m_type: 3, m_HC0: 1, m1_delta: .1, m3_Mmax: 0, m3_a: 1, m3_b: 1, KHabc: 1, Diag: 0, M3D: false, comment: 'Local HTS test' };
const notFound = () => new DOMException('Missing fixture entry', 'NotFoundError');
const writes = [];
function file(name, data) {
    let bytes = new TextEncoder().encode(JSON.stringify(data));
    return { name, kind: 'file',
        async getFile() { return { size: bytes.length, async arrayBuffer() { return bytes.slice().buffer; } }; },
        async createWritable() { return { async write(value) { bytes = new Uint8Array(value); writes.push(name); }, async close() {}, async abort() {} }; },
    };
}
function directory(name, children = {}, options = {}) {
    return { name, kind: 'directory',
        async getDirectoryHandle(key) {
            if (name.startsWith('Task') && key === 'input3XX') {
                localCalls += 1;
                if (localDelay) await localDelay;
                if (options.denied) throw new DOMException('Test permission denied', 'NotAllowedError');
            }
            if (children[key]?.kind !== 'directory') throw notFound();
            return children[key];
        },
        async getFileHandle(key) { if (children[key]?.kind !== 'file') throw notFound(); return children[key]; },
        async *entries() { for (const entry of Object.entries(children)) yield entry; },
    };
}
const makeTask = (name, options = {}) => directory(name, { input3XX: directory('input3XX', options.empty ? {} : {
    xapLibFMM: directory('xapLibFMM', { [`${name}_FMM.txt`]: file(`${name}_FMM.txt`, fmm) }),
    xapLibHTS: directory('xapLibHTS', { [`${name}_HTS.txt`]: file(`${name}_HTS.txt`, hts) }),
}) }, options);
const tasks = { A: makeTask('TaskA'), B: makeTask('TaskB'), empty: makeTask('TaskEmpty', { empty: true }), denied: makeTask('TaskDenied', { denied: true }) };
const definitions = materialTabRegistry.map(definition => ({ ...definition, async loadRecords() {
    baseCalls += 1;
    if (baseDelay) await baseDelay;
    baseCompleted += 1;
    const record = { name: `BASE_${definition.kind}`, data: definition.kind === 'FMM' ? fmm : hts };
    return definition.kind === 'FMM' ? toFmmLibraryModel([record]) : toHtsLibraryModel([record]);
} }));
function Fixture() {
    return <>
        <Show when={mounted()}><div style={{ height: '850px', position: 'relative', display: active() ? 'block' : 'none' }}>
            <MaterialLibraryTab definition={definitions.find(d => d.kind === kind())} active={active()} />
        </div></Show>
        <GeneralInformationDialog open={help()} onClose={() => setHelp(false)} />
    </>;
}
render(() => <Fixture />, document.getElementById('root'));
window.guideMaterials = {
    setTask(id) { selectionService.setLoadedTaskHandle(id ? tasks[id] : null); },
    mount(type, id = null) { setMounted(false); setActive(false); setKind(type); selectionService.setLoadedTaskHandle(id ? tasks[id] : null); setMounted(true); },
    setActive, setHelp,
    delayRender() {
        const table = this.table(), original = table.setData.bind(table);
        let first = true;
        table.setData = async (...args) => {
            if (first) { first = false; renderWaiting = true; await new Promise(resolve => { releaseRender = resolve; }); }
            return original(...args);
        };
    },
    releaseRender() { renderWaiting = false; releaseRender?.(); },
    renderWaiting() { return renderWaiting; },
    delay,
    release(which) { if (which === 'base') { releaseBase?.(); baseDelay = null; } else { releaseLocal?.(); localDelay = null; } },
    counters() { return { baseCalls, baseCompleted, localCalls, writes }; },
    table() { return TabulatorFull.findTable('.material-library-table')[0]; },
    graphPointCounts() { return Object.values(Chart.instances).flatMap(chart => chart.data.datasets.map(dataset => dataset.data.length)); },
    detailTable() { return TabulatorFull.findTable('.tabulator').find(table => table.getColumns().some(column => column.getField() === 'c0')); },
    async savedFmm(id = 'A') {
        const input = await tasks[id].getDirectoryHandle('input3XX');
        const dir = await input.getDirectoryHandle('xapLibFMM');
        const handle = await dir.getFileHandle(`Task${id}_FMM.txt`);
        return JSON.parse(new TextDecoder().decode(await (await handle.getFile()).arrayBuffer()));
    },
    snapshot() {
        const table = this.table();
        return { value: document.querySelector('.material-library-source select')?.value,
            rows: table?.getData().map(row => ({ name: row.name, source: row._taskLibraryRecord ? 'task' : 'default', hip: row.hip })),
            editable: table?.getColumn('name')?.getDefinition().editable(),
            busy: document.querySelector('.material-library-table')?.getAttribute('aria-busy'),
        };
    },
    history(action) { const id = definitions.find(d => d.kind === kind()).id; return materialLibraryHistoryService[action](id); },
    refresh() { materialLibraryRevisionService.notifyChanged(kind()); },
    async queueRegression() {
        const queue = createMaterialLibraryLoadQueue(); let finish; let visible;
        const old = queue.run(async () => { await new Promise(resolve => { finish = resolve; }); visible = 'base'; });
        await Promise.resolve();
        const clear = queue.run(() => { visible = null; });
        const next = queue.run(() => { visible = 'task'; });
        finish(); await Promise.all([old, clear, next]); return visible;
    },
};
