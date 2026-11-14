import { For, Index, Show, createEffect, createMemo, createSignal } from "solid-js";
import { FIELD_TYPES } from "../../services/schemas/common/constants";
import { modelService } from "../../services/modelService";
import { geometryCameraCommandFromKeyboardEvent } from "../../services/visualization/geometryCameraView.js";
import {
  SYMMETRY_STAGES, NUMBERED_SYMMETRIES, activeSymmetryStages, snapSymmetryStage, demoImageNumber,
  buildRecordSymmetryStage, buildDemoVectors,
} from "../../services/visualization/recordSymmetryDemo.js";
import { ThreeGeometryViewport } from "../geometry/ThreeGeometryViewport.jsx";
import "../geometry/GeometryViewerWindow.css";
import { CardInput } from "./RecordCard.jsx";

const numberField = { type: FIELD_TYPES.FLOAT };
const imageNumberField = { type: FIELD_TYPES.INTEGER };
const defaultImage = { all: true, number: 1 };

export function createRecordSymmetryDemo(element, record, index, active) {
  const [open, setOpen] = createSignal(false);
  const [position, setPosition] = createSignal(1);
  const [components, setComponents] = createSignal([1, 0, 0]);
  const [length, setLength] = createSignal(45);
  const [transparency, setTransparency] = createSignal(58);
  const [edges, setEdges] = createSignal(true);
  const [images, setImages] = createSignal({});
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
  const image = family => images()[family.index] ?? defaultImage;
  function changeImage(family, patch) {
    setImages(current => ({ ...current, [family.index]: { ...defaultImage, ...current[family.index], ...patch } }));
  }
  const geometry = createMemo(() => open() && active() && record()
    ? buildRecordSymmetryStage(record(), general(), moves(), element, stage(), index(), images())
    : null);
  const arrows = createMemo(() => element && geometry()
    ? buildDemoVectors(geometry(), components(), length(), kind()) : []);
  return { element, record, open, setOpen, stages, stage, setPosition, geometry, arrows,
    components, setComponents, kind, setChoice, length, setLength, error, setError,
    transparency, setTransparency, edges, setEdges, image, changeImage };
}

function ImageSelection(props) {
  const { demo, family, label } = props;
  const count = () => demo.record()?.[family.count];
  const choice = () => demo.image(family);
  const disabled = () => !demo.stages().includes(family.stage);
  return <>
    <fieldset class="record-demo-image-number" disabled={disabled() || choice().all}>
      <label>#<CardInput label={"Номер образа: " + label} title={"Номер образа от 1 до " + (count() || 1)}
        property={imageNumberField} value={demoImageNumber(choice().number, count())}
        onError={demo.setError} onChange={number => demo.changeImage(family, { number: demoImageNumber(number, count()) })} /></label>
    </fieldset>
    <label class="record-demo-all"><input type="checkbox" checked={choice().all} disabled={disabled()}
      aria-label={"Все образы: " + label} onChange={e => demo.changeImage(family, { all: e.currentTarget.checked })} />Все</label>
  </>;
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
      const family = NUMBERED_SYMMETRIES.find(f => f.stage === n);
      return <div class="record-demo-stage-row">
        <button type="button" data-stage={n} disabled={!demo.stages().includes(n)}
          aria-current={demo.stage() === n && demo.record() ? "step" : undefined}
          onClick={() => choose(n)}><b>{n}.</b> {label}</button>
        {family && <ImageSelection demo={demo} family={family} label={label} />}
      </div>;
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
      <div class="record-demo-list">{stageList(1, demo.element ? 5 : 3)}
        <fieldset class="record-demo-display" aria-label="Вид геометрии" disabled={!demo.record()}>
          <label class="record-demo-edges"><input type="checkbox" checked={demo.edges()}
            onChange={e => demo.setEdges(e.currentTarget.checked)} />Ребра</label>
          <label class="record-demo-length">Прозрачность<input type="range" min="0" max="100" step="1"
            aria-label="Прозрачность" aria-valuetext={demo.transparency() + "%"} value={demo.transparency()}
            onInput={e => demo.setTransparency(e.currentTarget.valueAsNumber)} /></label>
        </fieldset>
      </div>
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
        </fieldset></Show>
      </div>
    </div>
    <Show when={demo.error()}><div class="record-card-error" role="alert">{demo.error()}</div></Show>
  </section>;
}

export function RecordSymmetryViewport(props) {
  const demo = props.demo;
  const [viewRequest, setViewRequest] = createSignal(null);
  const [width, setWidth] = createSignal(null);
  let panel, drag;
  function resize(px) {
    setWidth(px);
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
      style={{ "--demo-width": width() == null ? undefined : width() + "px" }} onKeyDown={keyboard}
      onPointerDown={() => panel.focus({ preventScroll: true })}>
      <Show when={demo.geometry()?.scene.primitives.length}>
        <ThreeGeometryViewport scene={demo.geometry().scene} demoStage={demo.geometry()}
          demoArrows={demo.arrows()} demoVectorKind={demo.kind()} projection="orthographic"
          autoFit={true} mode="solid" showEdges={demo.edges()} geometryOpacity={1 - demo.transparency() / 100}
          viewRequest={viewRequest()} />
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
