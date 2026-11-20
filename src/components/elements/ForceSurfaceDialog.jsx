import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { FloatingWindow } from "../window/FloatingWindow.jsx";
import "./ForceSurfaceDialog.css";

export function ForceSurfaceDialog(props) {
    const [zeroIndices, setZeroIndices] = createSignal([]);
    const [result, setResult] = createSignal(null);
    const [noticeText, setNoticeText] = createSignal({title:"", message:""});
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal("");
    let notice, worker, closed = false;
    let task, version, order, rowCount;

    const canTransfer = () => !busy() && props.request?.indices.some(i => props.request.elements[i] && props.request.elements[i].targ !== 3);
    const summary = () => {
        const saved = result(), current = props.request;
        if (!saved || !current || current.task !== saved.request.task || current.version !== saved.request.version
            || current.elements !== saved.request.elements || current.order !== saved.request.order
            || current.moves !== saved.request.moves || current.general !== saved.request.general) return "";
        return saved.plan.groups.map(group => `Группа ${group.id} — ШГ ${group.members.map(i => i + 1).join(", ")}`)
            .join(" · ") || "Все физические элементы отнесены к группе 0.";
    };

    createEffect(() => {
        const current = props.request;
        if (!current) return;
        if (current.task !== task || current.version !== version) {
            task = current.task;
            version = current.version;
            setZeroIndices([]);
            setResult(null);
            setError("");
            if (notice?.open) notice.close();
        } else if (current.order !== order || current.elements.length !== rowCount) {
            if (zeroIndices().length) {
                setZeroIndices([]);
                setError("Состав или порядок строк изменился. Выберите элементы группы 0 заново.");
            }
        }
        order = current.order;
        rowCount = current.elements.length;
    });
    onCleanup(() => { closed = true; worker?.terminate(); });

    function inform(title, message = "") {
        setNoticeText({title, message});
        notice.showModal();
    }

    async function build() {
        if (!props.request || busy()) return;
        setBusy(true);
        setResult(null);
        setError("");
        try {
            const request = await props.prepare();
            if (closed) return;
            const {general, elements, moves} = request;
            worker = new Worker(new URL("../../workers/forceSurface.worker.js", import.meta.url), {type:"module"});
            const plan = await new Promise((resolve, reject) => {
                worker.onmessage = ({data}) => data.error ? reject(new Error(data.error)) : resolve(data.plan);
                worker.onerror = event => reject(new Error(event.message || "Не удалось определить силовые группы."));
                worker.postMessage({model:{general, elements, moves}, zeroIndices:zeroIndices()});
            });
            if (closed) return;
            await props.prepare();
            if (closed) return;
            const updated = props.onApply(request, plan);
            setResult({plan, request:updated});
            let message;
            if (general.forceFaceOffset > 0) {
                message = plan.groups.length ? "Силовую поверхность построит решатель по внешним граням. Для этого режима площадки на вкладке «Области» не требуются."
                    : "Все элементы отнесены к группе 0. Для расчёта по внешним граням нужна хотя бы одна положительная группа элементов.";
            } else {
                message = plan.groups.length ? "На вкладке «Области» создайте или проверьте замкнутую оболочку каждой положительной группы. Задайте каждой её площадке тот же номер в столбце «Силовая группа»."
                    : "Все элементы отнесены к группе 0. Для расчёта по полному полю задайте оболочку вручную на вкладке «Области» и оставьте у её площадок силовую группу 0.";
            }
            inform("Построение силовых групп завершено", message);
        } catch (e) {
            if (!closed) setError(e.message);
        } finally {
            worker?.terminate();
            worker = null;
            setBusy(false);
        }
    }

    async function transferSelected() {
        if (!canTransfer()) return;
        setBusy(true);
        setResult(null);
        setError("");
        try {
            const request = await props.prepare();
            if (closed) return;
            const selected = request.indices.filter(i => request.elements[i] && request.elements[i].targ !== 3);
            if (!selected.length) return;
            props.onApply(request);
            setZeroIndices(previous => [...new Set([...previous, ...selected])].sort((a,b) => a-b));
            inform("Элементы группы 0 запомнены");
        } catch (e) {
            if (!closed) setError(e.message);
        } finally {
            setBusy(false);
        }
    }

    return <FloatingWindow open={true} title="Создание силовых групп" class="force-surface-window"
        initialWidth={430} initialHeight={195} fixedWidth={430} fixedHeight={195}
        hideTitleControls={true} storageKey="web-gui:force-groups">
        <div class="force-surface-dialog">
            <div class="force-surface-body">
                <Show when={props.request} fallback={<span>Откройте вкладку «Элементы» задания.</span>}>
                    <span>{zeroIndices().length ? `Запомнены для группы 0: ${zeroIndices().map(i => i+1).join(", ")}.`
                        : "Чтобы оставить элементы в группе 0, выделите их и нажмите «Перевести в группу 0» до построения."}</span>
                </Show>
                <Show when={busy() || summary()}><span role="status">{busy() ? "Выполнение…" : summary()}</span></Show>
                <Show when={error()}><span class="force-surface-error" role="alert">{error()}</span></Show>
            </div>
            <div class="force-surface-actions">
                <button onClick={transferSelected} disabled={!canTransfer()}>Перевести в группу 0</button>
                <button onClick={build} disabled={!props.request || busy()}>Построить</button>
                <button onClick={props.onClose}>Закрыть</button>
            </div>
            <dialog ref={notice} class="modal-window" aria-labelledby="force-group-notice">
                <p class="modal-text" id="force-group-notice">{noticeText().title}</p>
                <Show when={noticeText().message}><p class="modal-text">{noticeText().message}</p></Show>
                <form method="dialog"><button class="validate-button" type="submit">ОК</button></form>
            </dialog>
        </div>
    </FloatingWindow>;
}
