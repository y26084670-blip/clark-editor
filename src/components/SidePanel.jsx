import { createEffect, onCleanup } from "solid-js";
import {
  COMPUTED_COLUMN_MODES,
} from "../services/viewSettingsService";
import "./SidePanel.css";
import { PROJECT_OPERATION_LABELS, TASK_OPERATION_LABELS } from "./tasks/TaskOperationDialog.jsx";

const VISIBILITY_OPTIONS = Object.freeze([
  {
    value: COMPUTED_COLUMN_MODES.SCHEMA,
    label: "По схеме",
    title: "Восстановить видимость, заданную схемой",
  },
  {
    value: COMPUTED_COLUMN_MODES.SHOW,
    label: "Показать",
    title: "Показать все вычисляемые колонки",
  },
  {
    value: COMPUTED_COLUMN_MODES.HIDE,
    label: "Скрыть",
    title: "Скрыть все вычисляемые колонки",
  },
]);

export function SidePanel(props) {
  let closeButton;

  createEffect(() => {
    if (!props.open) return;

    closeButton?.focus();

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        props.onClose?.();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => {
      window.removeEventListener("keydown", handleKeyDown);
    });
  });

  return (
    <>
      <div
        classList={{
          "side-panel-backdrop": true,
          open: props.open,
        }}
        aria-hidden="true"
        onClick={props.onClose}
      />

      <aside
        classList={{
          "side-panel": true,
          open: props.open,
        }}
        aria-hidden={!props.open}
        aria-label="Дополнительные функции"
      >
        <div class="side-panel-header">
          <div class="side-panel-title">Дополнительные функции</div>
          <button
            class="side-panel-close"
            ref={(element) => (closeButton = element)}
            disabled={!props.open}
            onClick={props.onClose}
            title="Закрыть"
            aria-label="Закрыть дополнительные функции"
          >
            ×
          </button>
        </div>

        {props.taskActions && <section class="side-panel-section">
          <details class="side-panel-submenu">
            <summary class="side-panel-section-title">Работа с проектами</summary>
            <div class="side-panel-options">
              {Object.entries(PROJECT_OPERATION_LABELS).map(([kind, label]) => <button
                class="side-panel-option"
                disabled={!props.open || !(kind === "create" ? props.taskActions.createProjectEnabled : props.taskActions.projectEnabled)}
                title={{ create: "Создать пустой проект в выбранном базовом каталоге", rename: "Изменить имя выбранного проекта, сохранив задания и результаты", delete: "Удалить выбранный проект, только если в его каталоге нет файлов и подкаталогов" }[kind]}
                onClick={() => props.onTaskAction?.(`project-${kind}`)}>{label}</button>)}
            </div>
          </details>
        </section>}

        {props.taskActions && <section class="side-panel-section">
          <div class="side-panel-section-title">Работа с заданиями</div>
          <div class="side-panel-options">
            <button class="side-panel-option" disabled={!props.open || !props.taskActions.createEnabled}
              title="Подготовить эскиз, условие и контекст CLARK для внешнего чата"
              onClick={() => props.onTaskAction?.("sketch")}>Создать геометрию по эскизу</button>
            {Object.entries(TASK_OPERATION_LABELS).map(([kind, label]) => <button
              class="side-panel-option"
              disabled={!props.open || !(kind === "create" ? props.taskActions.createEnabled : props.taskActions.selectedEnabled)}
              title={{ create: "Создать пустое задание в выбранном проекте", copy: "Создать копию сохранённых исходных данных в том же проекте, без результатов расчёта", rename: "Изменить имя выбранного задания, сохранив все его файлы", move: "Перенести всё задание в выбранный каталог проекта после проверки целостности", delete: "После подтверждения удалить каталог выделенного задания со всеми файлами и обновить список текущего проекта. Без корзины и Undo" }[kind]}
              onClick={() => props.onTaskAction?.(kind)}>{label}</button>)}
          </div>
        </section>}

        {props.clipboardTableActions?.length > 0 && <section class="side-panel-section">
          <div class="side-panel-section-title">Таблицы из буфера обмена</div>
          <div class="side-panel-options">
            {props.clipboardTableActions.map(action => <button class="side-panel-option"
              disabled={!props.open || !props.clipboardTableEnabled} title={action.title}
              onClick={() => props.onReplaceTableFromClipboard?.(action.property)}>{action.label}</button>)}
          </div>
        </section>}

        <section class="side-panel-section">
          <div
            class="side-panel-section-title"
            title={
              "вторичные колонки, зависимые от значений пользовательских "
              + "редактируемых колонок"
            }
          >
            Вычисляемые колонки
          </div>

          <div
            class="side-panel-options"
            role="group"
            aria-label="Видимость вычисляемых колонок"
          >
            {VISIBILITY_OPTIONS.map((option) => (
              <button
                classList={{
                  "side-panel-option": true,
                  active:
                    props.computedColumnsMode === option.value,
                }}
                disabled={!props.open}
                aria-pressed={
                  props.computedColumnsMode === option.value
                }
                title={option.title}
                onClick={() =>
                  props.onComputedColumnsModeChange?.(
                    option.value,
                  )
                }
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        {props.materialActionVisible && (
          <>
            <hr class="side-panel-separator" />
            <section class="side-panel-section">
              <div class="side-panel-section-title">
                Элементы модели
              </div>
              <div class="side-panel-options">
                <button
                  class="side-panel-option"
                  disabled={!props.open || !props.materialActionEnabled}
                  onClick={props.onChooseMaterial}
                  title={
                    "Выбрать элементы в списке, нажать кнопку и выбрать "
                    + "характеристику в появившемся диалоге"
                  }
                >
                  Выбрать характеристику
                </button>
                <button
                  class="side-panel-option"
                  disabled={!props.open || !props.materialActionEnabled}
                  onClick={props.onMakeNonmagnetic}
                  title="Очистить имя характеристики у выделенных элементов"
                >
                  Сделать немагнитными
                </button>
                <button class="side-panel-option"
                  disabled={!props.open || !props.medActionEnabled}
                  onClick={props.onAutofillMed}
                  title="Проанализировать контакты всех проводящих элементов при t = 0 и предложить MED. Выделение и фильтры не ограничивают поиск."
                >Автозаполнение MED</button>
                <button class="side-panel-option" disabled={!props.open || !props.medActionEnabled}
                  onClick={props.onCreateUniformFieldCoil}>Катушка однородного поля</button>
                <button class="side-panel-option" disabled={!props.open || !props.medActionEnabled} onClick={props.onCreateContactElement}>Контактный элемент</button>
              </div>
            </section>
          </>
        )}

        <hr class="side-panel-separator" />

        <section class="side-panel-section">
          <details class="side-panel-submenu">
            <summary class="side-panel-section-title">Характеристики ФММ</summary>
            <div class="side-panel-options">
              <button class="side-panel-option" disabled={!props.open}
                onClick={props.onCreateConstantMu}>Создать таблицу μ = const</button>
            </div>
          </details>
        </section>
        <hr class="side-panel-separator" />

        <section class="side-panel-section side-panel-history">
          <div class="side-panel-section-title">
            История текущей вкладки
          </div>
          <div class="side-panel-history-tab">
            {props.historyEnabled
              ? props.historyTabLabel
              : "Для этой вкладки история не ведётся"}
          </div>

          <div class="side-panel-history-actions">
            <button
              class="side-panel-option"
              disabled={
                !props.open ||
                !props.historyEnabled ||
                !props.canUndo
              }
              onClick={props.onUndo}
              title="Отменить последнее изменение текущей вкладки"
            >
              ↶ Отменить
            </button>
            <button
              class="side-panel-option"
              disabled={
                !props.open ||
                !props.historyEnabled ||
                !props.canRedo
              }
              onClick={props.onRedo}
              title="Повторить отменённое изменение текущей вкладки"
            >
              ↷ Повторить
            </button>
          </div>
        </section>
      </aside>
    </>
  );
}
