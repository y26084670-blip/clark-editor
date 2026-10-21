import { createEffect, Show } from "solid-js";
import "./TaskAccessDialog.css";

export function TaskAccessDialog(props) {
  let dialog, picker;
  createEffect(() => {
    if (props.open) {
      if (!dialog.open) { dialog.showModal(); picker.focus(); }
    } else if (dialog.open) dialog.close();
  });
  return <dialog ref={dialog} class="task-access-dialog" aria-labelledby="task-access-title"
    onCancel={event => { event.preventDefault(); if (!props.busy) props.onClose(); }}>
    <h2 id="task-access-title">Доступ к проектам</h2>
    <p>Выберите диск с проектами и разрешите чтение и запись. Каталоги clark.* появятся в верхнем списке; clark.app исключён.</p>
    <button ref={picker} type="button" onClick={props.onPick} disabled={props.busy}>Выбрать диск с проектами</button>
    <p class="task-access-location">{props.disk ? `Выбрано: ${props.disk.name || "корень диска"}. Каталогов: ${props.count}.` : "Диск ещё не выбран."}</p>
    <Show when={props.disk && !props.count}><p>В корне выбранного диска нет каталогов clark.* с проектами.</p></Show>
    <p>Для запуска расчётов свяжите найденные каталоги с установленным Решателем. В его окне подтвердите тот же диск один раз.</p>
    <button type="button" class="task-access-bind" classList={{ "task-access-bind--bound": props.bound }} onClick={props.onBind} disabled={props.busy || !props.count}>{props.bound ? "Связано с Решателем" : "Связать с Решателем"}</button>
    <p class="task-access-notice" role="status" aria-live="polite">{props.notice}</p>
    <div class="task-access-actions">
      <button type="button" disabled={props.busy || !props.count} onClick={props.onClose}>Продолжить</button>
      <button type="button" disabled={props.busy} onClick={props.onClose}>Закрыть</button>
    </div>
  </dialog>;
}
