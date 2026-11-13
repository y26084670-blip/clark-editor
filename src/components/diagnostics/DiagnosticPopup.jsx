import { Show, For, createMemo } from "solid-js";
import { diagnosticService } from "../../services/diagnosticService";
import {
  TABS,
  VALIDATION_LEVELS,
} from "../../services/schemas/common/constants";
import { tabRegistry } from "../../services/tabRegistry";
import { materialTabRegistry } from "../../services/materialTabRegistry";
import { groupDiagnostics } from "./diagnosticGrouping.js";
import "./DiagnosticPopup.css";

const LEVEL_LABELS = {
  [VALIDATION_LEVELS.ERROR]: "ERROR",
  [VALIDATION_LEVELS.WARNING]: "WARNING",
  [VALIDATION_LEVELS.SUCCESS]: "SUCCESS",
  [VALIDATION_LEVELS.UNKNOWN]: "UNKNOWN",
};

const SCHEMAS_BY_TAB_ID = new Map([
  ...tabRegistry.map((schema) => [schema.id, schema]),
  ...materialTabRegistry.map((definition) => [
    definition.id,
    definition.schema,
  ]),
]);

function nonEmptyLabel(value) {
  return typeof value === "string" && value.trim() !== ""
    ? value
    : null;
}

function diagnosticTabId(diagnostic) {
  return typeof diagnostic?.tab === "string"
    ? diagnostic.tab
    : diagnostic?.tab?.id;
}

function diagnosticPropertyLabel(diagnostic) {
  const property = diagnostic?.property;

  if (property && typeof property === "object") {
    const objectLabel = nonEmptyLabel(property.label)
      ?? nonEmptyLabel(property.title);
    if (objectLabel) return objectLabel;
  }

  const propertyId = typeof property === "string"
    ? property
    : property?.id;
  const tabId = diagnosticTabId(diagnostic);
  const schema = SCHEMAS_BY_TAB_ID.get(tabId);

  if (!schema || !nonEmptyLabel(propertyId)) return null;

  return nonEmptyLabel(schema.properties?.[propertyId]?.label)
    ?? nonEmptyLabel(schema.views?.references?.[propertyId]?.label);
}

export function DiagnosticPopup(props) {
  const displayedDiagnostics = createMemo(() =>
    groupDiagnostics(diagnosticService.diagnostics())
  );

  function displayValue(value) {
    if (value === undefined || value === null) {
      return "";
    }

    if (typeof value === "object") {
      return value.label ?? value.title ?? value.id ?? "";
    }

    return value;
  }

  function diagnosticSourceLabel(diagnostic) {
    const rows = diagnostic?.rows ?? (
      diagnostic?.row === undefined || diagnostic?.row === null
        ? []
        : [diagnostic.row]
    );
    if (rows.length === 0) return null;
    const tabId = diagnosticTabId(diagnostic);

    if (tabId === TABS.ELEMENTS.id) {
      return rows.length === 1
        ? `Элемент № ${rows[0]}`
        : `Элементы № ${rows.join(", ")}`;
    }

    if (tabId === TABS.REGIONS.id) {
      return rows.length === 1
        ? `Область № ${rows[0]}`
        : `Области № ${rows.join(", ")}`;
    }

    return rows.length === 1
      ? `Строка № ${rows[0]}`
      : `Строки № ${rows.join(", ")}`;
  }

  return (
    <Show when={props.open()}>
      <div class="diagnostic-popup">
        <div class="diagnostic-title">Диагностика модели</div>

        <div class="diagnostic-list">
          <For each={displayedDiagnostics()}>
            {(diagnostic) => (
              <div
                class="diagnostic-item"
                classList={{
                  "constraint-summary": diagnostic.presentation === "constraint-summary",
                }}
              >
                <Show when={diagnostic.presentation !== "constraint-summary"}>
                  <div class={`diagnostic-level level-${diagnostic.level}`}>
                    {LEVEL_LABELS[diagnostic.level]}
                  </div>
                </Show>
                <div class="diagnostic-message">{diagnostic.message}</div>
                <For each={diagnostic.fieldRows}>{({ label, rows }) => (
                  <div class="diagnostic-source">
                    {rows.length === 1 ? "Строка" : "Строки"} № {rows.join(", ")}
                    {" · "}{label}
                  </div>
                )}</For>
                <Show when={diagnostic.presentation !== "constraint-summary"}>
                  <div class="diagnostic-source">
                    {diagnostic.tab && (
                      <span>Вкладка: {displayValue(diagnostic.tab)}</span>
                    )}

                    <Show when={diagnosticSourceLabel(diagnostic)}>
                      {(label) => <span>{label()}</span>}
                    </Show>

                    <Show when={diagnosticPropertyLabel(diagnostic)}>
                      {(label) => <span>Поле: {label()}</span>}
                    </Show>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}
