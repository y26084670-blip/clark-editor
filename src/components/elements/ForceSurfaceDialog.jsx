import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import { forceSurfaceMotionWarning } from "../../services/generator/forceSurfaceMotion.js";
import { FloatingWindow } from "../window/FloatingWindow.jsx";
import { ThreeGeometryViewport } from "../geometry/ThreeGeometryViewport.jsx";
import { buildGeometryScene } from "../../services/visualization/geometrySceneModel.js";
import { buildGeometryTimeModel } from "../../services/visualization/geometryTimeModel.js";
import { bilinearRegionNormals } from "../../services/visualization/geometryDiscretization.js";
import "./ForceSurfaceDialog.css";

const decimal = value => Number(value.trim().replace(",", "."));
const transferHint = "Перевести в группу 0 элементы, выделенные в таблице «Элементы».";
const width = 424, height = 308;

export function ForceSurfaceDialog(props) {
    const [distance, setDistance] = createSignal("1");
    const [gap, setGap] = createSignal("2");
    let linkGap = true;
    const [step, setStep] = createSignal("2");
    const [mode, setMode] = createSignal("automatic");
    const [groupInput, setGroupInput] = createSignal(null);
    const [result, setResult] = createSignal(null);
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal("");
    const [zeroIndices, setZeroIndices] = createSignal([]);
    let zeroNotice;
    const selected = () => props.request?.indices ?? [];
    const elements = () => props.request?.elements ?? [];
    const externalFaces = () => props.request?.general.forceFaceOffset > 0;
    const canTransfer = () => !busy() && selected().some(i => {
        const row = elements()[i];
        return row && row.targ !== 3 && (mode() === "automatic" || row.take > 0);
    });
    const group = createMemo(() => {
        if (groupInput() !== null) return groupInput();
        const prior = new Set(selected().map(i => elements()[i]?.take).filter(id => id > 0));
        if (prior.size === 1) return String([...prior][0]);
        const used = new Set(elements().map(row => row.take));
        let free = 1;
        while (used.has(free)) free++;
        return String(free);
    });
    const canBuild = () => props.request && !busy()
        && gap().trim() !== "" && Number.isFinite(decimal(gap())) && decimal(gap()) >= 0
        && (externalFaces() || (Number.isFinite(decimal(distance())) && decimal(distance()) > 0
            && Number.isFinite(decimal(step())) && decimal(step()) > 0))
        && (mode() === "automatic" || (selected().length && Number.isSafeInteger(Number(group())) && Number(group()) > 0));
    const plan = createMemo(() => {
        const saved = result(), request = props.request;
        if (request && saved && saved.request?.task === request.task && saved.request.version === request.version
            && saved.request.regions === request.regions && saved.request.elements === request.elements
            && saved.request.general === request.general && saved.request.moves === request.moves) return saved.plan;
        return null;
    });
    const panels = createMemo(() => plan()?.surfaces.flatMap(surface => surface.panels));
    const warning = createMemo(() => !externalFaces() && forceSurfaceMotionWarning({elements:elements(),
        selectedIndices:mode() === "automatic" ? elements().flatMap((row,i) => row.targ === 3 ? [] : [i]) : selected(),
        regions:props.request?.regions}));
    function clearResult() {
        setResult(null);
        setError("");
    }

    let task, version, order, rowCount;
    createEffect(() => {
        const request = props.request;
        if (!request) return;
        const sameTask = request.task === task && request.version === version;
        const rowsChanged = request.order !== order || request.elements.length !== rowCount;
        order = request.order;
        rowCount = request.elements.length;
        if (sameTask) {
            if (rowsChanged && zeroIndices().length) {
                setZeroIndices([]);
                setError("Состав или порядок строк изменился. Выберите элементы группы 0 заново.");
            }
            return;
        }
        task = request.task;
        version = request.version;
        setZeroIndices([]);
        if (zeroNotice?.open) zeroNotice.close();
        const initialGap = request.general.forceGroupMinGap ?? 2;
        setGap(String(initialGap));
        linkGap = initialGap === 2;
        setDistance("1");
        setStep("2");
        setMode("automatic");
        setGroupInput(null);
        clearResult();
    });

    let worker, closed = false;
    onCleanup(() => { closed = true; worker?.terminate(); });
    async function build() {
        if (!canBuild()) return;
        clearResult();
        setBusy(true);
        try {
            const request = await props.prepare();
            if (closed) return;
            const {general, elements, moves, indices} = request;
            const marked = zeroIndices();
            const options = {mode:mode(), group:Number(group()), indices, zeroIndices:marked, distance:decimal(distance()), minimumGap:decimal(gap())};
            const nodeStep = decimal(step());
            worker = new Worker(new URL("../../workers/forceSurface.worker.js", import.meta.url), {type:"module"});
            const built = await new Promise((resolve, reject) => {
                worker.onmessage = ({data}) => data.error ? reject(new Error(data.error)) : resolve(data.plan);
                worker.onerror = event => reject(new Error(event.message || "Не удалось построить поверхность."));
                worker.postMessage({model:{general, elements, moves}, options});
            });
            if (closed) return;
            await props.prepare();
            if (!closed) {
                const updated = props.onApply(request, {plan:built, step:nodeStep});
                setResult({plan:built, request:updated});
            }
        } catch (e) {
            setError(e.message);
        } finally {
            worker?.terminate(); worker = null; setBusy(false);
        }
    }

    async function transferSelected() {
        if (!canTransfer()) return;
        clearResult();
        setBusy(true);
        try {
            const request = await props.prepare();
            if (closed) return;
            const physical = request.indices.filter(i => request.elements[i] && request.elements[i].targ !== 3);
            if (!physical.length) return;
            const automatic = mode() === "automatic";
            props.onApply(request, {rememberZero:automatic});
            if (automatic) {
                setZeroIndices([...new Set([...zeroIndices(), ...physical])].sort((a,b) => a-b));
                zeroNotice.showModal();
            }
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    }

    const preview = createMemo(() => {
        if (!panels()?.length) return null;
        const request = props.request;
        const elements = [...new Set(plan().surfaces.flatMap(s=>s.members))].map(i=>request.elements[i]);
        const general = {...request.general, mirrorSymmetryX: -1, mirrorSymmetryY: -1};
        const frame = buildGeometryTimeModel({general, elements}, request.moves, 0);
        const zero = [[0],[0],[0]];
        const regions = panels().map(geo => ({
            geoType:0, geo, dp:[[1],[1]], symLs:1, symYl:0, dr:zero, symR0:zero, symVi:zero,
        }));
        return buildGeometryScene({...frame.model, regions});
    });
    const normals = createMemo(() => (panels() ?? []).flatMap(quad => {
        const size = Math.min(...quad.map((p,i) => Math.hypot(...p.map((v,d) => v-quad[(i+1)%4][d]))));
        return bilinearRegionNormals(quad).map(n => ({...n, length:size*0.18}));
    }));

    return <FloatingWindow open={true} title="Поверхность для расчета силы/момента" class="force-surface-window"
        initialWidth={width} initialHeight={height} fixedWidth={width} fixedHeight={height}
        hideTitleControls={true} storageKey="web-gui:force-surface">
        <div class="force-surface-dialog">
            <div class="force-surface-body">
                <div class="force-surface-method" classList={{"has-preview": !!preview()}}>
                    <fieldset class="force-surface-modes" disabled={busy()}>
                        <legend>Способ построения</legend>
                        <label><input type="radio" name="force-method" checked={mode()==="manual"}
                            onChange={() => {setMode("manual"); clearResult();}}/> Вручную по выделенным элементам</label>
                        <label><input type="radio" name="force-method" checked={mode()==="automatic"}
                            onChange={() => {setMode("automatic"); clearResult();}}/> Автоматически по контактам</label>
                    </fieldset>
                    <Show when={preview()} keyed>{scene => <div class="force-surface-preview">
                        <ThreeGeometryViewport scene={scene} active={true} mode="translucent" showEdges={true}
                            demoArrows={normals()} demoVectorKind="normal" projection="orthographic" autoFit={true} />
                    </div>}</Show>
                </div>
                <Show when={mode()==="automatic"} fallback={<span>Выделенные элементы: {selected().length ? selected().map(i=>i+1).join(", ") : "нет"}</span>}>
                    <span>{zeroIndices().length ? `Запомнены для группы 0: ${zeroIndices().map(i=>i+1).join(", ")}.` :
                        "Чтобы оставить элементы в группе 0, выделите их и нажмите «Перевести в группу 0» до построения."}</span>
                </Show>
                <div class="force-surface-inputs">
                    <Show when={mode()==="manual"}>
                        <label>Номер группы <input type="number" min="1" step="1" value={group()} disabled={busy()}
                            onInput={e=>{setGroupInput(e.currentTarget.value); clearResult();}}/></label>
                    </Show>
                    <Show when={!externalFaces()} fallback={<span>Поле на внешних ЭП при отступе {props.request.general.forceFaceOffset} мм. Узлы строит решатель.</span>}>
                        <label>Рекомендуемое расстояние, мм<input type="text" inputMode="decimal" value={distance()} disabled={busy()}
                            onInput={e => { setDistance(e.currentTarget.value); if (linkGap && decimal(distance()) > 0) setGap(String(2*decimal(distance()))); clearResult(); }} /></label>
                    </Show>
                    <label title="Элементы с зазором меньше заданного объединяются. При 0 учитывается только разрешимая точность построения.">Минимальный зазор между группами, мм<input type="text" inputMode="decimal" value={gap()} disabled={busy()}
                        onInput={e => { linkGap=false; setGap(e.currentTarget.value); clearResult(); }} /></label>
                    <Show when={!externalFaces()}>
                        <label>Шаг по узлам, мм<input type="text" inputMode="decimal" value={step()} disabled={busy()}
                            onInput={e => {setStep(e.currentTarget.value); clearResult();}} /></label>
                    </Show>
                </div>
                <Show when={warning()}><div class="force-surface-warning" role="status">{warning()}</div></Show>
                <Show when={!props.request}><span>Для работы с поверхностями откройте вкладку «Элементы» задания.</span></Show>
                <Show when={error()}><div class="force-surface-error" role="alert">{error()}</div></Show>
                <Show when={busy() || plan()}><span role="status">{busy() ? "Выполнение…" : plan()?.surfaces.map(s =>
                    `Группа ${s.id}: ШГ ${s.members.map(i=>i+1).join(", ")}` + (plan().externalFaces ? "" : ` (${s.panels.length} пл.)`)
                ).join(" · ") || "Все физические элементы отнесены к группе 0."}
                    <Show when={!busy() && plan()?.coverage}>{range => ` · Охват движения: ${range().start}–${range().end} с`}</Show>
                </span></Show>
            </div>
            <div class="force-surface-actions">
                <span title={transferHint}><button title={transferHint} onClick={transferSelected}
                    disabled={!canTransfer()}>Перевести в группу 0</button></span>
                <button onClick={build} disabled={!canBuild()}>Построить</button>
                <button onClick={props.onClose}>Закрыть</button>
            </div>
            <dialog ref={zeroNotice} class="modal-window" aria-labelledby="force-zero-notice">
                <p class="modal-text" id="force-zero-notice">Элементы группы 0 запомнены</p>
                <form method="dialog"><button class="validate-button" type="submit">ОК</button></form>
            </dialog>
        </div>
    </FloatingWindow>;
}
