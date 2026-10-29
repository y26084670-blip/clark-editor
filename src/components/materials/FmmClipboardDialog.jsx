import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { fmmClipboardBlock, firstFmmClipboardBlock } from "../../services/materials/fmmTableInput.js";
import "./MaterialSelectionDialog.css";

export function FmmClipboardDialog(props) {
  const [startRow, setStartRow] = createSignal(1);
  const [endRow, setEndRow] = createSignal(2);
  let dialog;
  createEffect(() => {
    const request = props.request;
    if (request) {
      setStartRow(firstFmmClipboardBlock(request.rows));
      setEndRow(request.rows.length);
      queueMicrotask(() => dialog?.focus());
    }
  });
  const preview = createMemo(() => {
    if (!props.request) return { rows: [], error: "" };
    try {
      return { rows: fmmClipboardBlock(props.request.rows, startRow(), endRow()), error: "" };
    } catch (error) {
      return { rows: [], error: error.message };
    }
  });
  const rawBlock = () => props.request?.rows.slice(Math.max(0, startRow() - 1), endRow()) ?? [];

  return (
    <Show when={props.request}>
      <div class="material-dialog-backdrop" role="presentation">
        <section class="material-dialog fmm-clipboard-dialog" role="dialog"
          aria-modal="true" aria-label="Вставка характеристики из буфера"
          tabIndex="-1" ref={element => { dialog = element; }}
          onKeyDown={event => {
            if (event.key === "Escape" && !props.busy) props.onCancel();
            if (event.key === "Tab") {
              const controls = [...dialog.querySelectorAll('input:not(:disabled), button:not(:disabled), [tabindex="0"]')];
              const first = controls[0], last = controls.at(-1);
              if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
                event.preventDefault(); last?.focus();
              } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
                event.preventDefault(); first?.focus();
              }
            }
          }}>
          <div class="material-dialog-title">Из буфера — {props.request?.record.name}</div>
          <div class="material-dialog-summary">
            Строк в буфере: {props.request?.rows.length}. Используются первые две колонки.
          </div>
          <div class="fmm-clipboard-range">
            <label class="fmm-clipboard-start">
              Начальная строка
              <input type="number" min="1" max={Math.max(1, (props.request?.rows.length ?? 2) - 1)}
                step="1" value={startRow()} disabled={props.busy}
                onInput={event => setStartRow(Number(event.currentTarget.value))} />
            </label>
            <label class="fmm-clipboard-start">
              Конечная строка
              <input type="number" min="2" max={props.request?.rows.length ?? 2}
                step="1" value={endRow()} disabled={props.busy}
                onInput={event => setEndRow(Number(event.currentTarget.value))} />
            </label>
          </div>
          <div class="fmm-clipboard-preview-scroll" tabIndex="0" aria-label="Выбранные строки характеристики">
            <table class="fmm-clipboard-preview">
              <thead><tr><th>Строка</th><th>H, кА/м</th><th>M, кА/м</th></tr></thead>
              <tbody>
                <For each={rawBlock()}>{(row, index) => <tr>
                  <td>{startRow() + index()}</td><td>{row[0] ?? ""}</td><td>{row[1] ?? ""}</td>
                </tr>}</For>
              </tbody>
            </table>
          </div>
          <Show when={preview().error || props.error}>
            <div class="material-dialog-error" role="alert">{preview().error || props.error}</div>
          </Show>
          <div class="material-dialog-summary">
            Будет вставлено точек: {preview().rows.length}. Применение заменит таблицу H–M и сохранит текущую характеристику.
          </div>
          <div class="material-dialog-actions fmm-clipboard-actions">
            <button disabled={props.busy} onClick={props.onCancel}>Отмена</button>
            <button disabled={props.busy || Boolean(preview().error)}
              onClick={() => props.onApply(startRow(), endRow())}>
              {props.busy ? "Сохранение…" : "Применить"}
            </button>
          </div>
        </section>
      </div>
    </Show>
  );
}
