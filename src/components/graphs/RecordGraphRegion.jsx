import {
  createEffect,
  createSignal,
  onCleanup,
  Show,
} from "solid-js";

import { GraphContextMenu } from "./GraphContextMenu.jsx";
import {
  createDetailTableBlock,
} from "../../services/graphs/graphClipboard.js";
import {
  recordGraphConfig,
  recordGraphModeForProperty,
} from "../../services/graphs/recordGraphModel.js";
import "./RecordGraphRegion.css";

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}
export function RecordGraphRegion(props) {
  const descriptor = props.schema.views.graph;
  const [graphError, setGraphError] = createSignal("");
  const [copyError, setCopyError] = createSignal("");
  const [menuPosition, setMenuPosition] = createSignal(null);
  let canvas;
  let chart;
  let renderRevision = 0;

  function currentMode() {
    return recordGraphModeForProperty(props.schema, props.field);
  }

  function graphHint() {
    if (!props.field) return "Откройте таблицу детализации";
    if (!currentMode()) return "Для текущей таблицы график не предусмотрен";
    if ((props.records?.length ?? 0) === 0) {
      return "Выберите записи в основной таблице";
    }
    return "";
  }

  function tableBlocks() {
    const mode = currentMode();
    const property = mode
      ? props.schema.properties[mode.property]
      : null;
    if (!mode || !property) return [];

    return (props.records ?? []).map((record, index) => {
      const recordLabel = record?.rowLabel ?? index + 1;
      return createDetailTableBlock({
        title: `${property.label ?? mode.property} — запись ${recordLabel}`,
        property,
        rows: record?.[mode.property],
      });
    });
  }

  function openContextMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    setCopyError("");
    setMenuPosition({ x: event.clientX, y: event.clientY });
  }

  createEffect(() => {
    const records = props.records ?? [];
    const mode = currentMode();
    const endTime = props.endTime;
    const revision = ++renderRevision;
    chart?.destroy();
    chart = null;
    setGraphError("");
    setCopyError("");
    setMenuPosition(null);
    if (!canvas || records.length === 0 || !mode) return;

    void import("chart.js/auto").then(({ default: Chart }) => {
      if (revision !== renderRevision || !canvas) return;
      chart = new Chart(
        canvas,
        recordGraphConfig(props.schema, records, mode.value, endTime),
      );
    }).catch((error) => {
      if (revision !== renderRevision) return;
      console.error(`${props.schema.id} graph creation error:`, error);
      setGraphError(errorText(error));
    });
  });

  onCleanup(() => {
    renderRevision += 1;
    chart?.destroy();
    chart = null;
  });

  return (
    <section
      class="record-graph-region"
      aria-label={descriptor.title}
      onContextMenu={openContextMenu}
    >
      <div class="record-graph-region-header">
        <div class="record-graph-region-title">
          {descriptor.title}
          {currentMode()?.label ? ` — ${currentMode().label}` : ""}
        </div>
      </div>
      <div class="record-graph-region-host">
        <canvas ref={(element) => (canvas = element)} />
        <Show when={graphHint()}>
          <div class="record-graph-region-hint">
            {graphHint()}
          </div>
        </Show>
        <Show when={graphError()}>
          <div class="record-graph-region-error" role="alert">
            График не построен: {graphError()}
          </div>
        </Show>
        <Show when={copyError()}>
          <div class="record-graph-region-error" role="alert">
            Копирование не выполнено: {copyError()}
          </div>
        </Show>
      </div>
      <GraphContextMenu
        position={menuPosition()}
        onClose={() => setMenuPosition(null)}
        onError={error => setCopyError(errorText(error))}
        getTables={tableBlocks}
        getCanvas={() => canvas}
        hasImage={() => Boolean(chart)}
        imageBackground="#20262d"
      />
    </section>
  );
}
