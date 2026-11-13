import { For, Index, Show, createEffect, createMemo, createSignal } from "solid-js";
import { FIELD_TYPES } from "../../services/schemas/common/constants";
import { modelService } from "../../services/modelService";
import { geometryCameraCommandFromKeyboardEvent } from "../../services/visualization/geometryCameraView.js";
import {
  SYMMETRY_STAGES, activeSymmetryStages, snapSymmetryStage,
  buildRecordSymmetryStage, buildDemoVectors,
} from "../../services/visualization/recordSymmetryDemo.js";
import { ThreeGeometryViewport } from "../geometry/ThreeGeometryViewport.jsx";
import "../geometry/GeometryViewerWindow.css";
import { CardInput } from "./RecordCard.jsx";

const numberField = { type: FIELD_TYPES.FLOAT };

export function createRecordSymmetryDemo(element, record, index, active) {
  const [open, setOpen] = createSignal(false);
  const [position, setPosition] = createSignal(1);
  const [components, setComponents] = createSignal([1, 0, 0]);
  const [length, setLength] = createSignal(45);
  const [choice, setChoice] = createSignal("magnetization");
  const [error, setError] = createSignal("");
  const general = createMemo(() => open() && modelService.getModel().general);
  const moves = createMemo(() => open() && modelService.getModel().moves);
  const stages = createMemo(() => open() ? activeSymmetryStages(record(), general(), element) : []);
  const stage = createMemo(() => snapSymmetryStage(stages(), position(), false));
  createEffect(() => {
    if (stages().length && stage() !== position()) setPosition(stage());
  });
  const kind = () => record()?.targ === 1 ? "magnetization" : record()?.targ === 2 ? "current" : choice();
  const geometry = createMemo(() => open() && active() && record()
    ? buildRecordSymmetryStage(record(), general(), moves(), element, stage(), index())
    : null);
  const arrows = createMemo(() => element && geometry()
    ? buildDemoVectors(geometry(), components(), length(), kind()) : []);
  return { element, record, open, setOpen, stages, stage, setPosition, geometry, arrows,
    components, setComponents, kind, setChoice, length, setLength, error, setError };
}

export function RecordSymmetryControls(props) {
  const demo = props.demo;
  const count = demo.element ? 9 : 5;
  function choose(request) {
    demo.setPosition(snapSymmetryStage(demo.stages(), request, request > demo.stage()));
  }
  function stageList(start, end) {
    return <For each={SYMMETRY_STAGES.slice(start - 1, end)}>{(label, i) => {
      const n = start + i();
      return <button type="button" data-stage={n} disabled={!demo.stages().includes(n)}
        aria-current={demo.stage() === n && demo.record() ? "step" : undefined}
        onClick={() => choose(n)}><b>{n}.</b> {label}</button>;
    }}</For>;
  }
  return <section class="record-demo-card" aria-label="Стадии построения образов">
    <div class="record-card-info">{demo.element ? "Построение образов ШГ" : "Построение образов области"}</div>
    <input class="record-demo-stage" type="range" aria-label="Стадия построения" min="1" max={count} step="1"
      value={demo.stage()} disabled={!demo.stages().length}
      aria-valuetext={demo.stage() + ". " + SYMMETRY_STAGES[demo.stage() - 1]}
      onInput={e => { choose(e.currentTarget.valueAsNumber); e.currentTarget.value = String(demo.stage()); }}
      onWheel={e => {
        if (!demo.stages().length || !e.deltaY) return;
        e.preventDefault(); choose(demo.stage() + Math.sign(e.deltaY));
      }} />
    <div class="record-demo-columns">
      <div class="record-demo-list">{stageList(1, demo.element ? 5 : 3)}</div>
      <div class="record-demo-list">{demo.element ? stageList(6, 9) : stageList(4, 5)}
        <Show when={demo.element}><fieldset class="record-demo-vector" disabled={!demo.record()}>
          <legend>Демо-вектор</legend>
          <div class="record-demo-components">
            <select aria-label="Тип демо-вектора" value={demo.kind()}
              disabled={demo.record()?.targ === 1 || demo.record()?.targ === 2}
              onChange={e => demo.setChoice(e.currentTarget.value)}>
              <option value="magnetization">M</option><option value="current">J</option>
            </select>
            <Index each={["X", "Y", "Z"]}>{(axis, i) => <label>{axis()}
              <CardInput label={"Демо-вектор " + axis()} property={numberField} floatDigits={10}
                value={demo.components()[i]} onError={demo.setError}
                onChange={value => demo.setComponents(old => old.map((v, j) => j === i ? value : v))} />
            </label>}</Index>
          </div>
          <label class="record-demo-length">Длина<input type="range" aria-label="Длина демо-вектора"
            min="0" max="100" step="1" value={demo.length()} onInput={e => demo.setLength(e.currentTarget.valueAsNumber)} /></label>
          <Show when={demo.error()}><span role="alert">{demo.error()}</span></Show>
        </fieldset></Show>
      </div>
    </div>
  </section>;
}

export function RecordSymmetryViewport(props) {
  const demo = props.demo;
  const [viewRequest, setViewRequest] = createSignal(null);
  const [width, setWidth] = createSignal(330);
  let panel, drag;
  function resize(px) {
    const host = panel.parentElement, column = panel.previousElementSibling;
    const available = host.clientWidth - column.offsetWidth - 450 - 21;
    setWidth(Math.max(180, Math.min(Math.max(180, available), px)));
    props.onResize();
  }
  function keyboard(event) {
    const command = geometryCameraCommandFromKeyboardEvent(event);
    if (command) {
      event.preventDefault(); event.stopPropagation();
      setViewRequest(previous => ({ command, sequence: (previous?.sequence ?? 0) + 1 }));
    }
  }
  return <>
    <section ref={panel} class="record-demo-view" aria-label="3D-построение образов" tabIndex="0"
      style={{ "--demo-width": width() + "px" }} onKeyDown={keyboard}
      onPointerDown={() => panel.focus({ preventScroll: true })}>
      <Show when={demo.geometry()?.scene.primitives.length}>
        <ThreeGeometryViewport scene={demo.geometry().scene} demoStage={demo.geometry()}
          demoArrows={demo.arrows()} demoVectorKind={demo.kind()} projection="orthographic"
          autoFit={true} mode="translucent" showEdges={true} viewRequest={viewRequest()} />
      </Show>
      <Show when={demo.geometry()?.notices.length || !demo.record()}>
        <div class="record-demo-notice" role="status">{demo.geometry()?.notices.join(" ") || "Выберите строку таблицы"}</div>
      </Show>
    </section>
    <div class="data-editor-main-splitter record-demo-splitter" role="separator" aria-orientation="vertical"
      aria-label="Ширина 3D-панели" tabIndex="0"
      onPointerDown={e => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag = { id: e.pointerId, x: e.clientX, width: panel.offsetWidth };
      }}
      onPointerMove={e => { if (drag?.id === e.pointerId) resize(drag.width + e.clientX - drag.x); }}
      onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
      onLostPointerCapture={() => { drag = null; }}
      onKeyDown={e => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault(); resize(panel.offsetWidth + (e.key === "ArrowLeft" ? -16 : 16));
      }} />
  </>;
}
