import { createMemo, createSignal, onCleanup, Show } from "solid-js";
import { FloatingWindow } from "../window/FloatingWindow.jsx";
import { ThreeGeometryViewport } from "../geometry/ThreeGeometryViewport.jsx";
import { buildGeometryScene } from "../../services/visualization/geometrySceneModel.js";
import { buildGeometryTimeModel } from "../../services/visualization/geometryTimeModel.js";
import { bilinearRegionNormals } from "../../services/visualization/geometryDiscretization.js";
import "./ForceSurfaceDialog.css";

export function ForceSurfaceDialog(props) {
    const [distance, setDistance] = createSignal("1");
    const [panels, setPanels] = createSignal(null);
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
        if (busy() || !validDistance()) return;
        setPanels(null); setError(""); setBusy(true);
        try {
            worker = new Worker(new URL("../../workers/forceSurface.worker.js", import.meta.url), {type:"module"});
            worker.onmessage = ({data}) => {
                worker.terminate(); worker = null; setBusy(false);
                if (data.error) setError(data.error);
                else setPanels(data.panels);
            };
            worker.onerror = event => {
                setError(event.message || "Не удалось построить поверхность.");
                worker.terminate(); worker = null; setBusy(false);
            };
            const {general, elements, moves} = props.request;
            worker.postMessage({model: {general, elements, moves}, indices: props.request.indices, distance: offset()});
        } catch (e) {
            worker?.terminate(); worker = null; setBusy(false); setError(e.message);
        }
    }

    const preview = createMemo(() => {
        if (!panels()) return null;
        const request = props.request;
        const elements = request.indices.map(i => request.elements[i]);
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
        try { props.onApply(panels(), count()); }
        catch (e) { setError(e.message); }
    }
    return <FloatingWindow open={true} title="Поверхность для расчета силы/момента" initialWidth={640}
        initialHeight={510} minWidth={340} minHeight={280} storageKey="web-gui:force-surface" onClose={props.onClose}>
        <div class="force-surface-dialog">
            <div>Элементы № {props.request.indices.map(i => i+1).join(", ")}</div>
            <Show when={props.motionWarning}>
                <div class="force-surface-warning" role="status">{props.motionWarning}</div>
            </Show>
            <div class="force-surface-inputs">
                <label>Рекомендуемое расстояние, мм<input type="text" inputMode="decimal" value={distance()} disabled={busy()}
                    onInput={e => { setDistance(e.currentTarget.value); setPanels(null); setError(""); }} /></label>
                <label>Узлов по каждой стороне<input type="number" min="1" step="1" value={nodes()}
                    onInput={e => setNodes(e.currentTarget.value)} /></label>
            </div>
            <Show when={preview()} keyed>{scene => <div class="force-surface-preview">
                <ThreeGeometryViewport scene={scene} active={true} mode="translucent" showEdges={true}
                    demoArrows={normals()} demoVectorKind="normal" projection="orthographic" autoFit={true} />
            </div>}</Show>
            <Show when={error()}><div class="force-surface-error" role="alert">{error()}</div></Show>
            <div class="force-surface-actions">
                <span role="status">{busy() ? "Построение…" : panels() ? `Площадок: ${panels().length}` : ""}</span>
                <button onClick={build} disabled={busy() || !validDistance()}>Построить</button>
                <button onClick={apply} disabled={busy() || !panels() || !validNodes()}>Добавить в области</button>
                <button onClick={props.onClose}>Закрыть</button>
            </div>
        </div>
    </FloatingWindow>;
}
