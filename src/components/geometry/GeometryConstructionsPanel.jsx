import { For, Index, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { FloatingWindow } from "../window/FloatingWindow.jsx";
import { constructionCoordinate, moveConstructionNode, newConstruction } from "../../services/visualization/geometryConstructions.js";
import "./GeometryConstructionsPanel.css";

const AXES = ["X", "Y", "Z"];

function NodeCoordinates(props) {
  let row;
  const values = () => Array.from(row.querySelectorAll("input"), input => constructionCoordinate(input.value));
  const update = () => {
    const point = values();
    if (point.every(value => value !== null)) props.onPoint?.(point);
  };
  const add = () => {
    if (props.disabled || !row.reportValidity()) return;
    const point = values();
    if (point.some(value => value === null)) return;
    props.onAdd(point);
    row.reset();
    const first = row.querySelector("input");
    first.focus({ preventScroll: true });
  };
  return <form ref={row} class="construction-node"
    aria-label={props.draft ? "Новый узел" : `Узел ${props.index + 1}`}
    onSubmit={event => {
      event.preventDefault();
      if (props.draft) { add(); return; }
      update();
      row.ownerDocument.activeElement?.blur();
    }}
    onKeyDown={event => {
      if (!props.draft && event.key === "Enter" && event.target.tagName === "INPUT") {
        event.preventDefault();
        if (row.reportValidity()) event.target.blur();
      }
    }}
    onDragOver={event => { if (props.canDrop?.()) event.preventDefault(); }}
    onDrop={event => { if (props.canDrop?.()) { event.preventDefault(); props.onDrop(); } }}>
    <Show when={!props.draft} fallback={<span />}>
      <span class="construction-grip" draggable="true" title="Перетащите строку вверх или вниз"
        onDragStart={event => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", String(props.index + 1));
          props.onDrag();
        }} onDragEnd={() => props.onDragEnd()}>⠿</span>
    </Show>
    <For each={AXES}>{(axis, component) =>
      <input type="text" inputmode="decimal" required autocomplete="off" disabled={props.disabled}
        aria-label={axis} placeholder={axis} value={props.draft ? "" : String(props.point[component()])}
        onInput={event => {
          const input = event.currentTarget;
          input.setCustomValidity(input.value && constructionCoordinate(input.value) === null ? "Введите число." : "");
        }}
        onChange={() => { if (!props.draft) update(); }}
        onBlur={event => {
          if (props.draft || event.currentTarget.validity.valid) return;
          event.currentTarget.value = String(props.point[component()]);
          event.currentTarget.setCustomValidity("");
        }} />
    }</For>
    <Show when={props.draft} fallback={<button type="button" aria-label="Удалить узел" title="Удалить узел"
      onClick={() => props.onRemove()}>×</button>}>
      <button type="submit" aria-label="Добавить узел" title="Добавить узел (Enter)" disabled={props.disabled}>+</button>
    </Show>
  </form>;
}

export function GeometryConstructionsPanel(props) {
  let list, drag, resize;
  const [currentId, setCurrentId] = createSignal(props.cells[0]?.id);
  const ids = createMemo(() => props.cells.map(cell => cell.id));
  const current = () => props.cells.find(cell => cell.id === currentId());

  function measure() {
    if (!list) return;
    const cards = Array.from(list.querySelectorAll(".construction-cell"));
    if (!cards.length) { setCurrentId(undefined); return; }
    const top = list.getBoundingClientRect().top + list.clientTop;
    const first = cards.find(card => card.getBoundingClientRect().bottom > top + 0.5);
    setCurrentId((first ?? cards.at(-1)).dataset.id);
  }

  function toTop(id) {
    const card = Array.from(list?.children ?? []).find(child => child.dataset.id === id);
    if (!card) return;
    measure();
    list.scrollTop += card.getBoundingClientRect().top - list.getBoundingClientRect().top - list.clientTop;
    measure();
  }

  function attachList(element) {
    list = element;
    resize?.disconnect();
    resize = new ResizeObserver(measure);
    resize.observe(element);
    queueMicrotask(measure);
  }
  onCleanup(() => resize?.disconnect());
  createEffect(() => { props.cells; queueMicrotask(measure); });

  function change(id, transform) {
    props.onChange(props.cells.map(cell => cell.id === id ? transform(cell) : cell));
  }
  function addCell() {
    const cell = newConstruction();
    props.onChange([...props.cells, cell]);
    queueMicrotask(() => {
      toTop(cell.id);
      list.querySelector('.construction-cell[aria-current=true] input[aria-label="X"]')?.focus({ preventScroll: true });
    });
  }

  return <FloatingWindow open={true} title="Построения" storageKey="clark:geometry-constructions:v1"
    class="geometry-constructions-window" zIndex={3210} initialX={24} initialY={100}
    initialWidth={430} initialHeight={375} minWidth={330} minHeight={210} onClose={props.onClose}>
    <div class="geometry-constructions-body">
      <div class="construction-columns">
        <fieldset class="construction-editor" disabled={!props.ready}>
          <button type="button" onClick={addCell}>+ Ячейка</button>
          <div class="construction-list" ref={attachList} onScroll={measure} aria-label="Ячейки построений">
            <For each={ids()}>{(id, index) => {
              const cell = () => props.cells[index()];
              const nodes = () => cell().nodes;
              const setNodes = next => change(id, value => ({ ...value, nodes: next }));
              const canDrop = () => drag?.id === id;
              return <section class="construction-cell" data-id={id} aria-current={currentId() === id}
                aria-label={`Построение ${index() + 1}`} style={{ "--construction-color": cell().color }}>
                <div class="construction-cell-header">
                  <button type="button" class="construction-cell-title" onClick={() => toTop(id)}
                    title="Прокрутить к этой ячейке">Построение {index() + 1}</button>
                  <label><input type="checkbox" checked={cell().visible} onChange={event => {
                    const visible = event.currentTarget.checked;
                    change(id, value => ({ ...value, visible }));
                  }} /> Показ</label>
                </div>
                <div class="construction-node construction-axis-labels" aria-hidden="true">
                  <span /><span>X</span><span>Y</span><span>Z</span><span />
                </div>
                <Index each={nodes()}>{(point, i) => <NodeCoordinates point={point()} index={i}
                  onPoint={next => {
                    if (next.every((v, k) => v === nodes()[i][k])) return;
                    setNodes(nodes().map((value, j) => i === j ? next : value));
                  }}
                  onRemove={() => setNodes(nodes().filter((_, j) => i !== j))}
                  onDrag={() => { drag = { id, i }; }} onDragEnd={() => { drag = null; }} canDrop={canDrop}
                  onDrop={() => {
                    if (drag.i !== i) setNodes(moveConstructionNode(nodes(), drag.i, i));
                    drag = null;
                  }} />}</Index>
                <NodeCoordinates draft onAdd={point => setNodes([...nodes(), point])} />
              </section>;
            }}</For>
          </div>
        </fieldset>
        <div class="construction-actions">
          <label>Цвет <input type="color" aria-label="Цвет" disabled={!props.ready || !current()}
            value={current()?.color ?? "#ffdc55"} onInput={event => {
              const color = event.currentTarget.value;
              change(currentId(), cell => ({ ...cell, color }));
            }} /></label>
          <label><input type="checkbox" checked={current()?.closed ?? false} disabled={!props.ready || !current()}
            onChange={event => {
              const closed = event.currentTarget.checked;
              change(currentId(), cell => ({ ...cell, closed }));
            }} /> Замкнуть</label>
          <button type="button" disabled={!props.ready || !current()} title="Удалить текущую ячейку"
            onClick={() => props.onChange(props.cells.filter(cell => cell.id !== currentId()))}>Удалить</button>
          <button type="button" onClick={props.onClose}>Закрыть</button>
        </div>
      </div>
      <Show when={props.error} fallback={<Show when={props.status}><small role="status">{props.status}</small></Show>}>
        <div class="construction-error" role="alert">{props.error}
          <button type="button" onClick={props.onRetry} title={props.reload ? "Заменить локальные построения данными из файла задания" : undefined}>
            {props.reload ? "Загрузить с диска" : "Повторить"}
          </button>
        </div>
      </Show>
    </div>
  </FloatingWindow>;
}
