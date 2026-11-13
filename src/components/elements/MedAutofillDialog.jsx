import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js";
import { FloatingWindow } from "../window/FloatingWindow.jsx";
import { MED_FACE_NAMES } from "../../services/medAnalysisService.js";
import "./MedAutofillDialog.css";

// Existing MED values belong to the source element. The six drafts are local
// to this window; committing them together produces one normal edit/undo step.
function MedFaceEditor(props) {
  const [open, setOpen] = createSignal(false);
  const [row, setRow] = createSignal(null);
  const rows = createMemo(() => props.rows ?? []);
  const enabled = createMemo(() => props.enabled);
  const block = createMemo(() => rows().indexOf(row()) + 1);
  const inputs = [];
  let selector;
  const faces = createMemo(() => props.elements?.[block() - 1]?.med);
  createEffect(on(rows, current => {
    setRow(previous => current.includes(previous) ? previous : current[props.selectedBlock - 1] ?? current[0] ?? null);
  }));
  createEffect(on([row, faces], ([, med]) => {
    MED_FACE_NAMES.forEach((_, i) => {
      if (inputs[i]) inputs[i].value = String(med?.[i]?.[0] ?? "");
    });
  }));
  createEffect(on(() => props.navigation, target => {
    if (!target || !target.row || rows()[target.block - 1] !== target.row) return;
    setRow(target.row);
    setOpen(true);
    const frame = requestAnimationFrame(() => (inputs[target.face] ?? selector)?.focus());
    onCleanup(() => cancelAnimationFrame(frame));
  }));

  function save(event) {
    event.preventDefault();
    if (!enabled() || !faces()) return;
    const values = inputs.map(input => input.valueAsNumber);
    if (!values.every(value => Number.isSafeInteger(value) && value >= -1)) return;
    if (values.some((value, i) => value !== faces()?.[i]?.[0])) {
      props.onWriteFaces(row(), block(), values);
    }
  }

  return <details class="med-manual" open={open()} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>Ручная правка MED</summary>
    <form onSubmit={save}><fieldset disabled={!enabled() || !block()}>
      <label>Шестигранник <select ref={selector} value={String(block())}
        onChange={e => setRow(rows()[Number(e.currentTarget.value) - 1])}>
        <For each={rows()}>{(_, i) => <option value={i() + 1}>
          {"№ " + (i() + 1) + " · " + (props.elements?.[i()]?.name || "Без названия")}
        </option>}</For>
      </select></label>
      <div class="med-face-fields">{MED_FACE_NAMES.map((face, i) => <label>{face}
        <input ref={el => { inputs[i] = el; }} type="number" min="-1" step="1" required
          aria-label={"MED " + face} />
      </label>)}<button type="submit">Записать грани</button></div>
    </fieldset></form>
  </details>;
}

export function MedAutofillDialog(props) {
  const link = (block,face) => <button type="button" class="med-element-link"
    disabled={!props.navigationEnabled} title="Открыть исходный ШГ для ручной правки MED"
    onClick={()=>props.onNavigate(block,face)}>
    ШГ {block}{face===undefined?"":` · ${MED_FACE_NAMES[face]}`}
  </button>;
  const proposed = side => props.result?.faces.find(f=>f.block===side.block&&f.face===side.face)?.proposed ?? "—";
  return <FloatingWindow open={props.open} title="Автозаполнение MED" initialWidth={980} initialHeight={640}
    minWidth={560} minHeight={360} storageKey="web-gui:med-autofill" onClose={props.onClose}>
    <div class="med-autofill">
      <p>Все проводящие элементы задания и их физические образы, начальная конфигурация t = 0.
        Полный согласованный контакт считается проводящим, включая прежние MED = −1 / −1.</p>
      <div class="med-toolbar">
        <button type="button" onClick={props.onAnalyze} title="Повторить полный анализ текущих исходных данных">{props.busy?"Начать анализ заново":"Повторить анализ"}</button>
        <button type="button" disabled={props.busy||props.applying||!props.result||(!props.stale&&!props.result.canApply)}
          onClick={props.onApply} title="При изменении данных обновить анализ, затем применить MED одной операцией с поддержкой Undo/Redo">
          {props.stale?"Проверить и применить":"Применить"}</button>
        <button type="button" onClick={props.onClose} title="Закрыть окно без применения новых предложений">Закрыть</button>
      </div>
      <MedFaceEditor enabled={!props.busy && !props.applying} rows={props.rows} navigation={props.navigation}
        elements={props.elements} selectedBlock={props.selectedBlock} onWriteFaces={props.onWriteFaces} />
      <Show when={props.busy}><p role="status">Анализ контактов…</p></Show>
      <Show when={props.stale}><p role="status">Исходные данные изменены. Список относится к последнему анализу.
        Можно продолжить исправления; перед применением анализ обновится автоматически.</p></Show>
      <Show when={props.stale&&!props.busy&&!props.navigationEnabled}><p class="med-error" role="alert">
        Нумерация или состав строк изменены. Обновите анализ для переходов по списку.</p></Show>
      <Show when={props.error}><p class="med-error" role="alert">{props.error}</p></Show>
      <Show when={props.notice}><p role="status">{props.notice}</p></Show>
      <Show when={props.result}>{result => <>
        <p class="med-counts">Физических контактов: {result().counts.contacts} · Свободных граней исходных записей: {result().counts.freeFaces}
          {" · "}Изменений MED: {result().counts.changedFaces} · Ошибок: {result().counts.errors}</p>
        <Show when={result().gridLevel === "parent"}>
          <p role="status">Иерархическая сетка JWeak1. Контакты проверяются по родительскому
            разбиению; отображаемая сетка ЭО соответствует dp.
            {" "}Уточнённых ШГ: {result().refinedBlocks.length}.</p>
        </Show>
        <p>Разрядность: {result().doubleFloat?"REAL64":"REAL32"}; допуск: {result().tolerance.toExponential(3)} мм.</p>
        <Show when={result().errors.length}><section aria-label="Ошибки MED">
          <h3>Ошибки — применение заблокировано</h3>
          <ul><For each={result().errors}>{e=><li>{e.message}{" "}
            <For each={e.elements}>{block=>link(block,e.faces.find(f=>f.block===block)?.face)}</For>
          </li>}</For></ul>
        </section></Show>
        <h3>Контакты</h3>
        <table><thead><tr><th>Первая грань / образ</th><th>Вторая грань / образ</th><th>MED до → после</th><th>Сетка стыка</th></tr></thead>
          <tbody><For each={result().contacts}>{c=><tr>
            <td>{link(c.a.block,c.a.face)}<small>{c.a.image}</small></td>
            <td>{link(c.b.block,c.b.face)}<small>{c.b.image}</small></td>
            <td>{c.oldA} → {proposed(c.a)}; {c.oldB} → {proposed(c.b)}</td><td>{c.compatible?"Совпадает":"Ошибка"}
              <Show when={c.gridLevel === "parent"}><small>
                Родители: [{c.contactDpA.join(",")}] ↔ [{c.contactDpB.join(",")}];
                {" "}ЭО: [{c.actualDpA.join(",")}] ↔ [{c.actualDpB.join(",")}]
              </small></Show>
            </td>
          </tr>}</For></tbody></table>
        <h3>Предлагаемые изменения</h3>
        <Show when={!props.stale&&!result().changes.length&&!result().errors.length}><p>Изменений MED не требуется.</p></Show>
        <table><thead><tr><th>Исходная запись / грань</th><th>Старое MED</th><th>Предлагаемое MED</th></tr></thead>
          <tbody><For each={result().changes}>{c=><tr><td>{link(c.block,c.face)}</td><td>{c.old??"—"}</td><td>{c.proposed}</td></tr>}</For></tbody>
        </table>
      </>}</Show>
    </div>
  </FloatingWindow>;
}
