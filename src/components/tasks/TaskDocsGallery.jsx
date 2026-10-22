import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { createTaskImageGalleryController } from "../../services/taskImageGalleryController.js";
import { listTaskDocs, readTaskDocsImage } from "../../services/taskDocsService.js";
import { createTaskDocsTextController } from "../../services/taskDocsTextController.js";
import { TaskImageGallery } from "./TaskImageGallery.jsx";
import { TaskReadmeEditor } from "./TaskReadmeEditor.jsx";
import { TaskMediaDialog } from "./TaskMediaDialog.jsx";

const createDocsController = options => createTaskImageGalleryController({
  ...options, list: async (task, args) => (await listTaskDocs(task, args)).images, read: readTaskDocsImage,
});

export function TaskDocsGallery(props) {
  const [view, setView] = createSignal({ documents: [], selected: null, text: "", error: "", loading: false });
  const [readmeRequest, setReadmeRequest] = createSignal(null);
  const [readmeRevision, setReadmeRevision] = createSignal(0);
  const [selectReadmeAfterSave, setSelectReadmeAfterSave] = createSignal(false);
  const [expanded, setExpanded] = createSignal(null);
  const controller = createTaskDocsTextController({ publish: setView });
  let opener, previousTask, previousActive, previousRefreshKey, initialized = false;
  const disabled = () => props.active === false || props.visible === false || !props.taskHandle || props.disabled;
  const format = () => /\.md$/i.test(view().selected?.name ?? "") ? "исходный Markdown · UTF-8" : "обычный текст · UTF-8";
  const status = () => !props.taskHandle ? "Выберите задание" : view().loading ? "Чтение документа…"
    : view().error || (view().selected ? "" : "В DOCS нет текстовых файлов TXT/MD");
  createEffect(() => controller.setDisplayActive(props.visible !== false));
  createEffect(() => {
    const task = props.taskHandle, active = props.active !== false, refreshKey = [props.refreshKey, readmeRevision()];
    const sameContext = initialized && task === previousTask && active === previousActive;
    controller.setContext(task, active);
    if (sameContext && (refreshKey[0] !== previousRefreshKey?.[0] || refreshKey[1] !== previousRefreshKey?.[1])) controller.refresh();
    previousTask = task; previousActive = active; previousRefreshKey = refreshKey; initialized = true;
  });
  createEffect(() => {
    const request = expanded();
    if (request && (disabled() || request.task !== props.taskHandle || request.name !== view().selected?.name)) setExpanded(null);
  });
  onMount(() => {
    const refresh = () => controller.refresh();
    window.addEventListener("focus", refresh);
    onCleanup(() => window.removeEventListener("focus", refresh));
  });
  createEffect(() => {
    if (!selectReadmeAfterSave() || view().loading) return;
    const entry = view().documents.find(item => item.name.toLowerCase() === "readme.txt");
    if (entry) { setSelectReadmeAfterSave(false); controller.select(entry.name); }
  });
  onCleanup(() => controller.dispose());

  return <>
    <TaskImageGallery taskHandle={props.taskHandle} active={props.active} visible={props.visible}
      disabled={props.disabled} refreshKey={[props.refreshKey, readmeRevision()]} onCountChange={props.onCountChange}
      label="DOCS" emptyMessage="В DOCS нет изображений PNG, JPEG или WebP"
      createController={createDocsController} onRefresh={() => controller.refresh()} />
    <section class="task-docs-text-panel" aria-label="Текстовые документы задания">
      <div class="task-docs-toolbar">
        <select aria-label="Текстовый документ DOCS" value={view().selected?.name ?? ""}
          disabled={disabled() || !view().documents.length} onChange={event => controller.select(event.currentTarget.value)}>
          <Show when={!view().documents.length}><option value="">Текстовые документы</option></Show>
          <For each={view().documents}>{entry => <option value={entry.name}>{entry.name}</option>}</For>
          <Show when={view().documents.length}><option disabled value="">все документы см в Viewer</option></Show>
        </select>
        <button type="button" title="Развернуть текст документа" aria-label="Развернуть текст документа"
          disabled={disabled() || !view().selected || view().loading || Boolean(view().error)} onClick={event => {
            opener = event.currentTarget; setExpanded({ task: props.taskHandle, name: view().selected.name });
          }}>⤢</button>
      </div>
      <div class="task-readme-actions" aria-label="Управление README.txt">
        <button type="button" aria-label="Создать README.txt" title="Создать README.txt" disabled={disabled() || view().loading || Boolean(readmeRequest()) || view().documents.some(entry => entry.name.toLowerCase() === "readme.txt")}
          onClick={event => setReadmeRequest({ task: props.taskHandle, mode: "create", opener: event.currentTarget })}>Создать</button>
        <button type="button" disabled={disabled() || view().loading || Boolean(readmeRequest()) || !view().documents.some(entry => entry.name.toLowerCase() === "readme.txt")}
          onClick={event => setReadmeRequest({ task: props.taskHandle, mode: "edit", opener: event.currentTarget })} title="Править README.txt">Править</button>
        <button type="button" disabled={disabled() || view().loading || Boolean(readmeRequest()) || !view().documents.some(entry => entry.name.toLowerCase() === "readme.txt")}
          onClick={event => setReadmeRequest({ task: props.taskHandle, mode: "delete", opener: event.currentTarget })} title="Удалить README.txt">Удалить</button>
      </div>
      <div class="task-docs-status" role={view().error ? "alert" : "status"}>{status() || format()}</div>
      <textarea class="task-media-text" aria-label="Содержимое документа DOCS" readOnly wrap="off"
        spellcheck={false} value={view().text} aria-busy={view().loading} />
    </section>
    <Show when={readmeRequest()} keyed>{request => <TaskReadmeEditor request={request}
      onBusyChange={props.onBusyChange} onClose={() => setReadmeRequest(null)}
      onChanged={() => { setReadmeRevision(value => value + 1); setSelectReadmeAfterSave(request.mode !== "delete"); }} />}</Show>
    <TaskMediaDialog open={Boolean(expanded())} title={view().selected ? `${view().selected.name} — ${format()}` : ""}
      opener={() => opener} onClose={() => setExpanded(null)} closeLabel="Закрыть просмотр документа"
      renderBody={() => <textarea class="task-media-text task-docs-expanded" aria-label="Полный текст документа DOCS"
        readOnly wrap="off" spellcheck={false} value={view().text} aria-busy={view().loading} />} />
  </>;
}
