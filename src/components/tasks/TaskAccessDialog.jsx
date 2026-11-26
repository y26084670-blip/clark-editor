import { createEffect, Show } from "solid-js";
import "./TaskAccessDialog.css";

export function TaskAccessDialog(props) {
  let dialog, picker, bind, proceed, closeButton;
  createEffect(() => {
    if (!props.open) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
    if (props.busy) return;
    if (!props.picked) picker.focus();
    else if (!props.count) closeButton.focus();
    else if (props.bound) proceed.focus();
    else bind.focus();
  });
  return <dialog ref={dialog} class="task-access-dialog" aria-labelledby="task-access-title"
    onCancel={event => { event.preventDefault(); if (!props.busy) props.onClose(); }}>
    <h2 id="task-access-title">Доступ к проектам</h2>
    <Show when={props.cloudCatalogs?.length}><label>Облачные примеры
      <select aria-label="Облачные примеры" value="" disabled={props.busy} onChange={event => {
        const catalog = event.currentTarget.value;
        event.currentTarget.value = "";
        if (catalog) void props.onCloud(catalog);
      }}>
        <option value="">Выберите каталог</option>
        {props.cloudCatalogs.map(item => <option value={item.id}>☁ {item.name}</option>)}
      </select>
    </label></Show>
    <p>Выберите диск с проектами и разрешите чтение и запись.</p>
    <p>Каталоги clark.* с проектами появятся в верхнем списке.</p>
    <div class="task-access-row">
      <button ref={picker} type="button" onClick={props.onPick} disabled={props.busy || props.picked}>Выбрать диск с проектами</button>
      <p class="task-access-location">Выбрано каталогов: {props.count}</p>
    </div>
    <Show when={props.disk && !props.count}><p>В корне выбранного диска нет каталогов clark.* с проектами.</p></Show>
    <div class="task-access-row">
      <button ref={bind} type="button" class="task-access-bind" classList={{ "task-access-bind--bound": props.bound }} onClick={props.onBind} disabled={props.busy || !props.count}>{props.bound ? "Связано с Решателем" : "Связать с Решателем"}</button>
      <p>Для запуска расчётов свяжите найденные каталоги с установленным Решателем. В его окне подтвердите тот же диск один раз.</p>
    </div>
    <p class="task-access-notice" role="status" aria-live="polite">{props.notice}</p>
    <div class="task-access-actions">
      <button ref={proceed} type="button" disabled={props.busy || !props.count} onClick={props.onClose}>Продолжить</button>
      <button ref={closeButton} type="button" disabled={props.busy} onClick={props.onClose}>Закрыть</button>
    </div>
  </dialog>;
}
