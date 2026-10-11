import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";

import { modelService } from "../../services/modelService.js";
import { selectionService } from "../../services/selectionService.js";
import { TABS } from "../../services/schemas/common/constants.js";
import { GraphContextMenu } from "../graphs/GraphContextMenu.jsx";
import {
  createGeneratedDetailTableBlock,
} from "../../services/graphs/graphClipboard.js";
import {
  generateTimeSeries,
} from "../../services/generator/timeFunctionModel.js";
import {
  loadFormulaHistory,
  saveFormulaHistory,
} from "../../services/generator/timeFunctionHistoryService.js";
import {
  resizedGeneratorGraphRatio,
  TIME_GENERATOR_SPLIT_LIMITS,
} from "../../services/dataEditorLayout.js";
import { TIME_EXPRESSION_HELP } from "../../services/generator/timeFunctionExpression.js";
import { generateSineTimeSeries } from "../../services/generator/sineTimeFunction.js";
import { SineGeneratorDialog } from "./SineGeneratorDialog.jsx";
import "./TimeFunctionGenerator.css";

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}
const FORMULA_PLACEHOLDER = [
  "Введите построчно здесь свои формулы зависимостей от времени t (сек).",
  "Используйте промежуточные переменные.",
  "Результатом считается последнее выражение (можно без присвоения).",
  "Зарезервированные имена функций и констант:",
  [...TIME_EXPRESSION_HELP.functions, ...TIME_EXPRESSION_HELP.constants, "^"].join(", "),
  "Пример использования:",
  "f=50.0",
  "omega=2*pi*f",
  "tau=1.1",
  "res=exp(-2*t/tau)*sin(omega*t-pi/2)",
].join("\n");

function GeneratorPreviewGraph(props) {
  const [menuPosition, setMenuPosition] = createSignal(null);
  let canvas;
  let chart;
  let renderRevision = 0;

  function openContextMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    setMenuPosition({ x: event.clientX, y: event.clientY });
  }

  createEffect(() => {
    const points = props.points ?? [];
    const revision = ++renderRevision;
    chart?.destroy();
    chart = null;
    setMenuPosition(null);
    if (!canvas || points.length === 0) return;

    void import("chart.js/auto").then(({ default: Chart }) => {
      if (revision !== renderRevision || !canvas) return;
      chart = new Chart(canvas, {
        type: "line",
        data: {
          datasets: [{
            label: props.label || "Предпросмотр",
            data: points.map(([x, y]) => ({ x, y })),
            borderColor: "#e59a3a",
            backgroundColor: "#e59a3a",
            borderWidth: 2,
            pointRadius: 2,
            pointHoverRadius: 4,
            fill: false,
            parsing: false,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          normalized: true,
          plugins: {
            legend: { labels: { color: "#dce4ec" } },
          },
          scales: {
            x: {
              type: "linear",
              title: {
                display: true,
                text: "Время",
                color: "#dce4ec",
              },
              ticks: { color: "#b8c3cd" },
              grid: { color: "rgba(180, 195, 208, .16)" },
            },
            y: {
              type: "linear",
              title: {
                display: true,
                text: props.label || "Значение",
                color: "#dce4ec",
              },
              ticks: { color: "#b8c3cd" },
              grid: { color: "rgba(180, 195, 208, .16)" },
            },
          },
        },
      });
    }).catch((error) => props.onError?.(errorText(error)));
  });

  onCleanup(() => {
    renderRevision += 1;
    chart?.destroy();
    chart = null;
  });

  return (
    <div
      class="time-generator-graph"
      style={{
        "flex-basis":
          `${Math.round((props.ratio ?? 0.42) * 10000) / 100}%`,
      }}
      onContextMenu={openContextMenu}
    >
      <canvas ref={(element) => (canvas = element)} />
      <Show when={(props.points?.length ?? 0) === 0}>
        <div class="time-generator-graph-hint">
          Введите формулу и нажмите «Генерировать»
        </div>
      </Show>
      <GraphContextMenu
        position={menuPosition()}
        onClose={() => setMenuPosition(null)}
        onError={props.onError}
        getTables={() => props.tables ?? []}
        getCanvas={() => canvas}
        hasImage={() => Boolean(chart)}
        imageBackground="#1b2026"
      />
    </div>
  );
}

export function TimeFunctionGenerator(props) {
  const descriptor = props.schema.views.generator;
  const hasSineGenerator = props.schema.id === TABS.AMPS.id;
  const [sineGeneratorOpen, setSineGeneratorOpen] = createSignal(false);
  const [formula, setFormula] = createSignal("");
  const [formulas, setFormulas] = createSignal([]);
  const [selectedIndices, setSelectedIndices] = createSignal([]);
  const [lastSelectedIndex, setLastSelectedIndex] = createSignal(null);
  const [target, setTarget] = createSignal(descriptor.defaultTarget);
  const [minimumTime, setMinimumTime] = createSignal("0");
  const [maximumTime, setMaximumTime] = createSignal("0");
  const [preview, setPreview] = createSignal(null);
  const [message, setMessage] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [contextMenu, setContextMenu] = createSignal(null);
  const [graphRatio, setGraphRatio] = createSignal(0.42);
  let observedTaskHandle = null;
  let rangeTouched = false;
  let layoutHost;
  let graphResizeCleanup = null;

  function targetDefinition(value = target()) {
    return descriptor.targets.find(item => item.value === value);
  }

  function previewTables() {
    const generated = preview();
    const targetItem = generated
      ? targetDefinition(generated.target)
      : null;
    const property = targetItem
      ? props.schema.properties[targetItem.property]
      : null;
    if (!generated || !targetItem || !property) return [];

    return [createGeneratedDetailTableBlock({
      title: `${property.label ?? targetItem.label} — предпросмотр`,
      property,
      points: generated.points,
      valueColumn: targetItem.column,
    })];
  }

  function resetForTask(taskHandle) {
    observedTaskHandle = taskHandle;
    rangeTouched = false;
    setFormula("");
    setFormulas([]);
    setSelectedIndices([]);
    setLastSelectedIndex(null);
    setTarget(descriptor.defaultTarget);
    setMinimumTime("0");
    setMaximumTime("0");
    setPreview(null);
    setContextMenu(null);
    setSineGeneratorOpen(false);
  }

  createEffect(() => {
    const taskHandle = selectionService.loadedTaskHandle();
    if (taskHandle !== observedTaskHandle) resetForTask(taskHandle);
  });

  createEffect(() => {
    modelService.getModelPartUpdate(TABS.GENERAL.id)?.revision;
    const general = modelService.getModel()[TABS.GENERAL.id];
    if (rangeTouched || !general) return;
    const intervals = Number(general.countTimeSteps);
    const step = Number(general.timeStep);
    if (Number.isFinite(intervals) && Number.isFinite(step)) {
      setMaximumTime(String(Math.max(0, intervals * step)));
    }
  });

  function stopGraphResize() {
    graphResizeCleanup?.();
    graphResizeCleanup = null;
  }

  function updateGraphRatio(pointerY, bounds) {
    setGraphRatio(resizedGeneratorGraphRatio({
      pointerY,
      containerTop: bounds.top,
      containerHeight: bounds.height,
    }));
  }

  function beginGraphResize(event) {
    if (event.button !== 0 || !layoutHost) return;
    event.preventDefault();
    event.stopPropagation();
    stopGraphResize();

    const bounds = layoutHost.getBoundingClientRect();
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    const move = (moveEvent) => updateGraphRatio(moveEvent.clientY, bounds);
    const stop = () => stopGraphResize();

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    graphResizeCleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }

  function handleGraphSplitterKeyDown(event) {
    if (!layoutHost || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();

    const bounds = layoutHost.getBoundingClientRect();
    const contentHeight = Math.max(
      1,
      bounds.height - TIME_GENERATOR_SPLIT_LIMITS.splitterSize,
    );
    const direction = event.key === "ArrowUp" ? -1 : 1;
    const step = event.shiftKey ? 40 : 10;
    updateGraphRatio(
      bounds.top + graphRatio() * contentHeight + direction * step,
      bounds,
    );
  }

  onMount(() => {
    const close = () => setContextMenu(null);
    window.addEventListener("pointerdown", close);
    onCleanup(() => window.removeEventListener("pointerdown", close));
  });
  onCleanup(stopGraphResize);

  function showError(error) {
    setMessage(errorText(error));
  }

  function handleGenerate() {
    try {
      const general = modelService.getModel()[TABS.GENERAL.id];
      if (!general) {
        throw new Error("Сначала загрузите общие параметры задания.");
      }
      const points = generateTimeSeries({
        expression: formula(),
        countTimeSteps: general.countTimeSteps,
        timeStep: general.timeStep,
        minimumTime: minimumTime(),
        maximumTime: maximumTime(),
      });
      const targetItem = targetDefinition();
      setPreview({
        points,
        target: targetItem.value,
        label: targetItem.label,
      });
    } catch (error) {
      showError(error);
    }
  }

  async function handleApply() {
    const generated = preview();
    if (!generated) return;
    try {
      await props.onApply?.({
        targetValue: generated.target,
        points: generated.points,
      });
    } catch (error) {
      showError(error);
    }
  }

  function handleSineGenerate(parameters) {
    const general = modelService.getModel()[TABS.GENERAL.id];
    if (!general) throw new Error("Сначала загрузите общие параметры задания.");
    const generated = generateSineTimeSeries({
      ...parameters,
      countTimeSteps: general.countTimeSteps,
      timeStep: general.timeStep,
    });
    const targetItem = targetDefinition();
    setFormula(generated.expression);
    rangeTouched = false;
    setMinimumTime("0");
    setMaximumTime(String(generated.points.at(-1)[0]));
    setPreview({ points: generated.points, target: targetItem.value, label: targetItem.label });
  }

  function addCurrentFormula() {
    const nextFormulas = [];
    for (const sourceLine of formula().split(/\r?\n/u)) {
      const item = sourceLine.trim();
      if (item) nextFormulas.push(item);
    }
    if (nextFormulas.length === 0) {
      showError("Нельзя добавить пустую формулу.");
      return;
    }
    setFormulas(items => [...items, ...nextFormulas]);
  }

  function insertSelectedFormula() {
    const selected = new Set(selectedIndices());
    let index = lastSelectedIndex();
    if (!selected.has(index)) index = selectedIndices().at(-1);
    if (!Number.isInteger(index) || formulas()[index] === undefined) return;
    setFormula(formulas()[index]);
  }

  function deleteSelectedFormulas() {
    const selected = new Set(selectedIndices());
    setFormulas(items => items.filter((_item, index) => !selected.has(index)));
    setSelectedIndices([]);
    setLastSelectedIndex(null);
  }

  async function saveHistory() {
    setBusy(true);
    try {
      await saveFormulaHistory({
        taskHandle: selectionService.loadedTaskHandle(),
        fileName: descriptor.historyFile,
        formulas: formulas(),
      });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  async function restoreHistory() {
    setBusy(true);
    try {
      const restored = await loadFormulaHistory({
        taskHandle: selectionService.loadedTaskHandle(),
        fileName: descriptor.historyFile,
      });
      setFormulas(restored);
      setSelectedIndices([]);
      setLastSelectedIndex(null);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  function updateSelection(event) {
    setSelectedIndices(
      [...event.currentTarget.selectedOptions].map(option => Number(option.value)),
    );
  }

  function handleHistoryClick(event) {
    const option = event.target.closest?.("option");
    if (option) setLastSelectedIndex(Number(option.value));
  }

  function openContextMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    const option = event.target.closest?.("option");
    if (option) {
      const index = Number(option.value);
      setLastSelectedIndex(index);
      if (!option.selected) {
        setSelectedIndices([index]);
      }
    }
    setContextMenu({ x: event.clientX, y: event.clientY });
  }

  function menuAction(action) {
    return () => {
      setContextMenu(null);
      void Promise.resolve(action()).catch(showError);
    };
  }

  return (
    <div class={`time-generator${descriptor.targets.length > 1 ? " has-target-selector" : ""}${hasSineGenerator ? " has-sine-generator" : ""}`}>
      <div
        class="time-generator-layout"
        ref={(element) => (layoutHost = element)}
      >
        <GeneratorPreviewGraph
          points={preview()?.points ?? []}
          label={preview()?.label ?? targetDefinition()?.label}
          tables={previewTables()}
          ratio={graphRatio()}
          onError={showError}
        />
        <div
          class="time-generator-splitter"
          role="separator"
          aria-label="Изменить высоту графика и редактора формул"
          aria-orientation="horizontal"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={Math.round(graphRatio() * 100)}
          tabIndex="0"
          title="Перетащите для изменения высоты графика"
          onPointerDown={beginGraphResize}
          onKeyDown={handleGraphSplitterKeyDown}
        />

        <div class="time-generator-workspace">
        <section class="time-generator-history">
          <div class="time-generator-section-title time-generator-history-title">
            История формул
          </div>
          <select
            multiple
            size="10"
            disabled={busy()}
            aria-label="История формул"
            onChange={updateSelection}
            onClick={handleHistoryClick}
            onContextMenu={openContextMenu}
          >
            <For each={formulas()}>
              {(item, index) => (
                <option value={index()} title={item}>
                  {item.replace(/\s+/gu, " ").trim()}
                </option>
              )}
            </For>
          </select>
          <div class="time-generator-history-hint">
            Команды доступны по правому щелчку
          </div>
          <Show when={hasSineGenerator}>
            <div class="time-generator-history-actions">
              <button disabled={!selectionService.loadedTaskHandle() || busy()}
                title="Задать частоту, фазу и постоянные времени"
                onClick={() => setSineGeneratorOpen(true)}>Синус - генератор</button>
            </div>
          </Show>
        </section>

        <section class="time-generator-editor">
          <div class="time-generator-editor-header">
            <div class="time-generator-section-title">Формула</div>
            <Show when={descriptor.targets.length > 1}>
              <div class="time-generator-target">
                <select
                  value={target()}
                  aria-label="Тип искомой величины"
                  title="Выберите тип искомой величины"
                  onChange={(event) => setTarget(event.currentTarget.value)}
                >
                  <For each={descriptor.targets}>
                    {(item) => <option value={item.value}>{item.label}</option>}
                  </For>
                </select>
              </div>
            </Show>
          </div>

          <textarea
            value={formula()}
            spellcheck={false}
            aria-label="Формула временной зависимости"
            placeholder={FORMULA_PLACEHOLDER}
            onInput={(event) => setFormula(event.currentTarget.value)}
          />


          <div class="time-generator-range">
            <label>
              <span>Начало действия</span>
              <input
                type="number"
                step="any"
                value={minimumTime()}
                onInput={(event) => {
                  rangeTouched = true;
                  setMinimumTime(event.currentTarget.value);
                }}
              />
            </label>
            <label>
              <span>Конец действия</span>
              <input
                type="number"
                step="any"
                value={maximumTime()}
                onInput={(event) => {
                  rangeTouched = true;
                  setMaximumTime(event.currentTarget.value);
                }}
              />
            </label>
          </div>

          <div class="time-generator-actions">
            <button
              disabled={!selectionService.loadedTaskHandle() || busy()}
              title="Рассчитать значения и обновить график предпросмотра"
              onClick={handleGenerate}
            >
              Генерировать
            </button>
            <button
              disabled={!preview() || !selectionService.loadedTaskHandle() || busy()}
              title="Применить рассчитанные значения к выбранной записи"
              onClick={handleApply}
            >
              Применить
            </button>
          </div>
        </section>
        </div>
      </div>

      <Show when={hasSineGenerator}>
        <SineGeneratorDialog open={sineGeneratorOpen()} taskHandle={selectionService.loadedTaskHandle()}
          onClose={() => setSineGeneratorOpen(false)} onGenerate={handleSineGenerate} />
      </Show>

      <Show when={contextMenu()}>
        <div
          class="time-generator-context-menu"
          role="menu"
          style={{ left: `${contextMenu().x}px`, top: `${contextMenu().y}px` }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            role="menuitem"
            title="Добавить текст из редактора в историю формул"
            onClick={menuAction(addCurrentFormula)}
          >
            Добавить текущую формулу
          </button>
          <button
            role="menuitem"
            disabled={selectedIndices().length === 0}
            title="Поместить выбранную формулу в редактор"
            onClick={menuAction(insertSelectedFormula)}
          >
            Вставить выбранную формулу
          </button>
          <hr />
          <button
            role="menuitem"
            disabled={selectedIndices().length === 0}
            title="Удалить выделенные формулы из истории"
            onClick={menuAction(deleteSelectedFormulas)}
          >
            Удалить выделенные формулы
          </button>
          <hr />
          <button
            role="menuitem"
            disabled={busy()}
            title="Сохранить историю формул в файл задания"
            onClick={menuAction(saveHistory)}
          >
            Сохранить список
          </button>
          <button
            role="menuitem"
            disabled={busy()}
            title="Восстановить историю формул из файла задания"
            onClick={menuAction(restoreHistory)}
          >
            Восстановить список
          </button>
        </div>
      </Show>

      <Show when={message()}>
        <div class="time-generator-dialog-backdrop" role="presentation">
          <section
            class="time-generator-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Ошибка генератора"
          >
            <div class="time-generator-dialog-title">Генерация не выполнена</div>
            <div class="time-generator-dialog-message">{message()}</div>
            <button title="Закрыть сообщение" onClick={() => setMessage("")}>
              Закрыть
            </button>
          </section>
        </div>
      </Show>
    </div>
  );
}
