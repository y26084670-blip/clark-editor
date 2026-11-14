import { createMemo, createSignal, onCleanup, Show } from "solid-js";
import { forceSurfaceMotionWarning } from "../../services/generator/forceSurfaceMotion.js";
import { FloatingWindow } from "../window/FloatingWindow.jsx";
import { ThreeGeometryViewport } from "../geometry/ThreeGeometryViewport.jsx";
import { buildGeometryScene } from "../../services/visualization/geometrySceneModel.js";
import { buildGeometryTimeModel } from "../../services/visualization/geometryTimeModel.js";
import { bilinearRegionNormals } from "../../services/visualization/geometryDiscretization.js";
import "./ForceSurfaceDialog.css";

export function ForceSurfaceDialog(props) {
    const [distance, setDistance] = createSignal("1");
    const [gap,setGap] = createSignal(String(props.request.general.forceGroupMinGap ?? 2));
    let linkGap = props.request.general.forceGroupMinGap == null || props.request.general.forceGroupMinGap === 2;
    const minimum = () => Number(gap().trim().replace(",","."));
    const validGap = () => gap().trim() !== "" && Number.isFinite(minimum()) && minimum() >= 0;
    const selected = props.request.indices;
    const physical = props.request.elements.flatMap((row,i) => row.targ === 3 ? [] : [i]);
    const prior = new Set(selected.map(i => props.request.elements[i]?.take).filter(x => x > 0));
    const inUse = new Set(props.request.elements.map(row => row.take));
    let free = 1;
    while (inUse.has(free)) free++;
    const [mode,setMode] = createSignal(selected.length ? "manual" : "automatic");
    const [group,setGroup] = createSignal(String(prior.size === 1 ? [...prior][0] : free));
    const [plan,setPlan] = createSignal(null);
    const members = () => mode() === "automatic" ? physical : selected;
    const panels = createMemo(() => plan()?.surfaces.flatMap(s => s.panels));
    const warning = createMemo(() => forceSurfaceMotionWarning({elements:props.request.elements,
        selectedIndices:members(),regions:props.request.regions}));
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal("");
    const [nodes, setNodes] = createSignal("5");
    const count = () => Number(nodes());
    const validNodes = () => Number.isSafeInteger(count()) && count() >= 1 && count() <= 2147483647;
    const offset = () => Number(distance().trim().replace(",", "."));
    const validDistance = () => Number.isFinite(offset()) && offset() > 0;
    let worker;
    onCleanup(() => worker?.terminate());

    function build() {
        if (busy() || !validDistance() || !validGap()) return;
        setPlan(null); setError(""); setBusy(true);
        try {
            worker = new Worker(new URL("../../workers/forceSurface.worker.js", import.meta.url), {type:"module"});
            worker.onmessage = ({data}) => {
                worker.terminate(); worker = null; setBusy(false);
                if (data.error) setError(data.error);
                else setPlan(data.plan);
            };
            worker.onerror = event => {
                setError(event.message || "Не удалось построить поверхность.");
                worker.terminate(); worker = null; setBusy(false);
            };
            const {general, elements, moves} = props.request;
            worker.postMessage({model: {general, elements, moves}, options:{mode:mode(),group:Number(group()),indices:selected,distance:offset(),minimumGap:minimum()}});
        } catch (e) {
            worker?.terminate(); worker = null; setBusy(false); setError(e.message);
        }
    }

    const preview = createMemo(() => {
        if (!panels()) return null;
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
    function apply() {
        if (!panels() || !validNodes()) return;
        try { props.onApply(plan(), count()); }
        catch (e) { setError(e.message); }
    }
    return <FloatingWindow open={true} title="Поверхность для расчета силы/момента" initialWidth={640}
        initialHeight={510} minWidth={340} minHeight={280} storageKey="web-gui:force-surface" onClose={props.onClose}>
        <div class="force-surface-dialog">
            <fieldset class="force-surface-modes" disabled={busy()}>
                <legend>Способ построения</legend>
                <label><input type="radio" name="force-method" checked={mode()==="manual"}
                    onChange={() => {setMode("manual");setPlan(null);setError("");}}/> Вручную по выделенным элементам</label>
                <label><input type="radio" name="force-method" checked={mode()==="automatic"}
                    onChange={() => {setMode("automatic");setPlan(null);setError("");}}/> Автоматически по контактам</label>
            </fieldset>
            <Show when={mode()==="manual"} fallback={<span>Автопостроение заново назначит номера всем физическим элементам и заменит групповые оболочки.</span>}>
                <label>Номер группы <input type="number" min="1" step="1" value={group()} disabled={busy()}
                    onInput={e=>{setGroup(e.currentTarget.value);setPlan(null);setError("");}}/></label>
                <span>Выделенные элементы: {selected.length ? selected.map(i=>i+1).join(", ") : "нет"}</span>
            </Show>
            <Show when={warning()}><div class="force-surface-warning" role="status">{warning()}</div></Show>
            <div class="force-surface-inputs">
                <label>Рекомендуемое расстояние, мм<input type="text" inputMode="decimal" value={distance()} disabled={busy()}
                    onInput={e => { setDistance(e.currentTarget.value); if (linkGap && validDistance()) setGap(String(2*offset())); setPlan(null); setError(""); }} /></label>
                <label title="Элементы с зазором меньше заданного объединяются. При 0 учитывается только разрешимая точность построения.">Минимальный зазор между группами, мм<input type="text" inputMode="decimal" value={gap()} disabled={busy()}
                    onInput={e => { linkGap=false; setGap(e.currentTarget.value); setPlan(null); setError(""); }} /></label>
                <label>Узлов по каждой стороне<input type="number" min="1" step="1" value={nodes()}
                    onInput={e => setNodes(e.currentTarget.value)} /></label>
            </div>
            <Show when={preview()} keyed>{scene => <div class="force-surface-preview">
                <ThreeGeometryViewport scene={scene} active={true} mode="translucent" showEdges={true}
                    demoArrows={normals()} demoVectorKind="normal" projection="orthographic" autoFit={true} />
            </div>}</Show>
            <Show when={error()}><div class="force-surface-error" role="alert">{error()}</div></Show>
            <div class="force-surface-actions">
                <span role="status">{busy() ? "Построение…" : plan()?.surfaces.map(s => `Группа ${s.id}: ШГ ${s.members.map(i=>i+1).join(", ")} (${s.panels.length} пл.)`).join(" · ")}</span>
                <button onClick={build} disabled={busy() || !validDistance() || !validGap() || (mode()==="manual" && (!selected.length || !Number.isSafeInteger(Number(group())) || Number(group())<1))}>Построить</button>
                <button onClick={apply} disabled={busy() || !panels() || !validNodes()}>Применить</button>
                <button disabled={busy() || !selected.some(i=>props.request.elements[i]?.take>0)}
                    title="Присвоить выбранным элементам группу 0. Их источники исключаются из всех пар силы и момента."
                    onClick={()=>{try { props.onExclude(); } catch(e) {setError(e.message);}}}>Исключить выделенные элементы</button>
                <button onClick={props.onClose}>Закрыть</button>
            </div>
        </div>
    </FloatingWindow>;
}
