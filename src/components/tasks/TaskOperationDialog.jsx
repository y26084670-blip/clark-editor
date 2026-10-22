import { createEffect, createSignal, Show } from "solid-js";
import "./TaskOperationDialog.css";

export const TASK_OPERATION_LABELS = Object.freeze({
  create: "Создать задание", copy: "Создать копию", rename: "Переименовать задание", move: "Перенести в другой каталог",
  delete: "Удалить задание",
});

export const PROJECT_OPERATION_LABELS = Object.freeze({
  create: "Создать проект", rename: "Переименовать проект", delete: "Удалить пустой проект",
});

export function TaskOperationDialog(props) {
  let dialog, nameInput;
  const [name, setName] = createSignal("");
  const [stopped, setStopped] = createSignal(false);
  const project = () => props.request?.scope === "project";
  const labels = () => project() ? PROJECT_OPERATION_LABELS : TASK_OPERATION_LABELS;
  const relocation = () => ["rename", "move"].includes(props.request?.kind);
  const deletion = () => props.request?.kind === "delete";
  const needsStopped = () => relocation() || deletion();
  createEffect(() => {
    const request = props.request;
    setName(request?.name ?? "");
    setStopped(false);
    if (request) {
      if (!dialog.open) dialog.showModal();
      queueMicrotask(() => { nameInput?.focus(); nameInput?.select(); });
    } else if (dialog.open) dialog.close();
  });
  return <dialog ref={dialog} class="task-operation-dialog" aria-labelledby="task-operation-title"
    onCancel={event => { event.preventDefault(); if (!props.busy) props.onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); if (!props.busy && !props.failed && (!needsStopped() || stopped())) props.onSubmit(name()); }}>
      <h2 id="task-operation-title">{labels()[props.request?.kind]}</h2>
      <p>{project() ? "Базовый каталог: " + props.request?.root?.name : "Проект: " + props.request?.projectName}</p>
      <Show when={props.request?.kind !== "move" && !deletion()} fallback={<p>{project() ? "Проект" : "Задание"}: {props.request?.name}. {deletion() ? "" : "Выберите проект назначения после нажатия кнопки ниже."}</p>}>
        <label>{project() ? "Имя проекта" : "Имя задания"}
          <input ref={nameInput} name={project() ? "projectName" : "taskName"} value={name()} maxLength={120} required disabled={props.busy}
            onInput={event => setName(event.currentTarget.value)} autocomplete="off" />
        </label>
      </Show>
      <Show when={props.request?.kind === "copy"}>
        <p>Копируются сохранённые исходные данные и библиотеки. Несохранённые правки и результаты расчёта в копию не входят. Копия автоматически не открывается.</p>
      </Show>
      <Show when={project() && props.request?.kind === "create"}>
        <p>Будет создан пустой проект. Затем добавьте в него задания через раздел «Работа с заданиями».</p>
      </Show>
      <Show when={!project() && props.request?.kind === "create"}>
        <p>Будет создан черновик с начальными параметрами и пустой геометрией. Затем загрузите, заполните, проверьте и сохраните его.</p>
      </Show>
      <Show when={relocation()}>
        <p>Переносится всё содержимое, включая результаты. Несохранённые изменения выбранного задания необходимо предварительно сохранить. Существующее назначение не перезаписывается.</p>
      </Show>
      <Show when={project() && relocation()}>
        <p>Будут обновлены пути заданий в списке запуска этого базового каталога. Требуется место для полной копии проекта. Остановите расчёты и запись файлов во всех его заданиях; после переименования заново загрузите открытые задания в Viewer и других окнах. Внешние списки запуска обновите отдельно.</p>
      </Show>
      <Show when={project() && deletion()}>
        <p>Удалить пустой проект «{props.request?.projectName}»? Каталог с любыми файлами или подкаталогами удалить нельзя. Корзина и Undo недоступны.</p>
      </Show>
      <Show when={!project() && deletion()}>
        <p>Удалить каталог «{props.request?.projectName}/{props.request?.name}» и всё его содержимое, включая исходные данные, библиотеки и результаты расчёта? Удаление безвозвратное, без корзины и Undo.</p>
        <p>Если это задание открыто в редакторе, оно будет закрыто. Его несохранённые изменения также будут потеряны. Другие задания не изменяются.</p>
      </Show>
      <Show when={needsStopped()}>
        <label class="task-operation-confirm"><input type="checkbox" checked={stopped()} disabled={props.busy}
          onChange={event => setStopped(event.currentTarget.checked)} />{project() ? "Все операции с этим проектом будут остановлены" : "Все операции с этим заданием будут остановлены"}</label>
      </Show>
      <p class="task-operation-error" role="alert">{props.error}</p>
      <p role="status">{props.busy ? "Выполнение операции и проверка файлов…" : ""}</p>
      <div class="task-operation-actions">
        <button type="submit" disabled={props.busy || props.failed || (needsStopped() && !stopped())}>
          {props.request?.kind === "move" ? "Выбрать каталог назначения" : labels()[props.request?.kind]}
        </button>
        <button type="button" disabled={props.busy} onClick={props.onClose}>{props.failed ? "Закрыть" : "Отмена"}</button>
      </div>
    </form>
  </dialog>;
}
