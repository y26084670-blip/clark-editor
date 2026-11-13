import { For, Index, Show, batch, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { FloatingWindow } from "../window/FloatingWindow.jsx";
import { constructionCoordinate, moveConstructionNode, newConstruction } from "../../services/visualization/geometryConstructions.js";
import { formatFixedSignificant } from "../../tabulator/formatters/types/floatFormatter.js";
import "./GeometryConstructionsPanel.css";

const AXES = ["X", "Y", "Z"];
const INITIAL_WIDTH = 430;

function NodeCoordinates(props) {
  let row;
  const inputs = [];
  // Keep the spelling and caret of a valid number being typed (e.g. -0, or 1e-3).
  // A move, removal or disk reload still replaces coordinates that actually differ.
  createEffect(() => {
    const point = props.point;
    inputs.forEach((input, axis) => {
      if (point && constructionCoordinate(input.value) === point[axis]) return;
      input.value = point ? String(point[axis]) : "";
      input.setCustomValidity("");
    });
  });
  function edit(input) {
    input.setCustomValidity(input.value && constructionCoordinate(input.value) === null ? "Введите число." : "");
    const next = inputs.map(field => constructionCoordinate(field.value));
    if (next.every(value => value !== null)) props.onPoint(next);
  }
  return <form ref={row} class="construction-node"
    aria-label={props.point ? `Узел ${props.index + 1}` : "Новый узел"}
    onSubmit={event => event.preventDefault()}
    onKeyDown={event => {
      if (event.key === "Enter" && !event.isComposing && event.target.tagName === "INPUT") {
        event.preventDefault();
        if (!row.reportValidity()) return;
        if (props.last) props.onNext();
        else event.target.blur();
      }
    }}
    onDragOver={event => { if (props.canDrop?.()) event.preventDefault(); }}
    onDrop={event => { if (props.canDrop?.()) { event.preventDefault(); props.onDrop(); } }}>
    <Show when={props.point} fallback={<span />}>
      <span class="construction-grip" draggable="true" title="Перетащите строку вверх или вниз"
        onDragStart={event => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", String(props.index + 1));
          props.onDrag();
        }} onDragEnd={() => props.onDragEnd()}>⠿</span>
    </Show>
    <For each={AXES}>{(axis, component) =>
      <input ref={input => { inputs[component()] = input; }} type="text" inputmode="decimal"
        required autocomplete="off" aria-label={axis} placeholder={axis}
        onInput={event => edit(event.currentTarget)}
        onBlur={event => {
          if (!props.point || event.currentTarget.validity.valid) return;
          event.currentTarget.value = String(props.point[component()]);
          event.currentTarget.setCustomValidity("");
        }} />
    }</For>
    <Show when={props.point} fallback={<span />}>
      <button type="button" aria-label="Удалить узел" title="Удалить узел" onClick={props.onRemove}>×</button>
    </Show>
  </form>;
}

export function GeometryConstructionsPanel(props) {
  let list, drag, resize;
  const [currentId, setCurrentId] = createSignal(props.cells[0]?.id);
  const ids = createMemo(() => props.cells.map(cell => cell.id));
  const current = () => props.cells.find(cell => cell.id === currentId());

  function maximizedWidth(frame) {
    const columns = list?.closest(".construction-columns");
    if (!columns || !list.firstElementChild) return INITIAL_WIDTH;
    const borderAndPadding = frame.getBoundingClientRect().width - columns.getBoundingClientRect().width;
    let characters = "-0.12345678".length;
    for (const cell of props.cells) {
      for (const point of cell.nodes) {
        for (const value of point) characters = Math.max(characters, formatFixedSignificant(-Math.abs(value), 8).length);
      }
    }
    columns.style.setProperty("--coordinate-text-width", characters + "ch");
    columns.classList.add("measure-coordinate-width");
    const width = columns.getBoundingClientRect().width + borderAndPadding;
    columns.classList.remove("measure-coordinate-width");
    columns.style.removeProperty("--coordinate-text-width");
    return Math.ceil(width);
  }

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
    initialWidth={INITIAL_WIDTH} initialHeight={375} minWidth={330} minHeight={210}
    maximizeHeightOnly getMaximizedWidth={maximizedWidth} onClose={props.onClose}>
    <div class="geometry-constructions-body">
      <div class="construction-columns">
        <fieldset class="construction-editor" disabled={!props.ready}>
          <button type="button" onClick={addCell}>+ Ячейка</button>
          <div class="construction-list" ref={attachList} onScroll={measure} aria-label="Ячейки построений">
            <For each={ids()}>{(id, index) => {
              let card;
              const cell = () => props.cells[index()];
              const nodes = () => cell().nodes;
              const setNodes = next => change(id, value => ({ ...value, nodes: next }));
              const [newRow, setNewRow] = createSignal(false);
              const rows = createMemo(() => newRow() || !nodes().length ? [...nodes(), null] : nodes());
              function startNode() {
                setNewRow(true);
                card.querySelector('form:last-of-type input')?.focus();
              }
              function setPoint(i, point) {
                const previous = nodes();
                if (i === previous.length) {
                  // Promote the draft in place. The focused fields survive its first valid XYZ.
                  batch(() => { setNewRow(false); setNodes([...previous, point]); });
                } else if (point.some((v, k) => v !== previous[i][k])) {
                  setNodes(previous.map((value, j) => i === j ? point : value));
                }
              }
              return <section ref={card} class="construction-cell" data-id={id} aria-current={currentId() === id}
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
                <Index each={rows()}>{(point, i) => <NodeCoordinates point={point()} index={i}
                  last={i === nodes().length - 1} onNext={startNode} onPoint={next => setPoint(i, next)}
                  onRemove={() => setNodes(nodes().filter((_, j) => i !== j))}
                  onDrag={() => { drag = { id, i }; }} onDragEnd={() => { drag = null; }}
                  canDrop={() => Boolean(point()) && drag?.id === id}
                  onDrop={() => {
                    if (drag.i !== i) setNodes(moveConstructionNode(nodes(), drag.i, i));
                    drag = null;
                  }} />}</Index>
                <button type="button" class="construction-add-node" aria-label="Добавить узел"
                  title="Открыть строку для следующего узла (Enter)" onClick={startNode}>+ Узел</button>
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
