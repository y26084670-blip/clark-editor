// По JSON-объекту и описывающей его схеме:
//
//   • строки основной таблицы;
//   • колонки основной таблицы;
//   • контейнер вложенной таблицы;
//   • строки вложенной таблицы;
//   • колонки вложенной таблицы.
//
// Модуль предоставляет необходимые структуры данных.

import {
    FIELD_TYPES,
    STORAGE_TYPES,
    VIEW_TYPES
} from "../../services/schemas/common/constants";
import { viewRegistry } from "../views/viewRegistry";
import { universalEditor } from "../editors/universalEditor";
import { constraintValidator } from "../validators/types/constraintValidator";
import { resolveProperty } from "../schema/propertyResolver";
import { universalFormatter } from "../formatters/universalFormatter";
import {
    isComputedProperty,
    isPropertyReadonly,
} from "../../services/model/modelCompute";
import { viewSettingsService } from "../../services/viewSettingsService";
import {
    hasRecordColumnsView,
    recordColumnField,
} from "../converters/recordColumns";
import { referenceViewEntries } from "../../services/referenceViewService.js";
import { findNamedEnumOption }
    from "../../services/schemas/common/enumOptions.js";

import "../../tabs/Tasks.css";

// Активация связанного представления для ячейки-сводки.
function activateView(cell, property) {
    const adapter = viewRegistry.get(
        property.view ?? VIEW_TYPES.TABLE,
    );
    adapter?.activate?.(cell, { property });
}

// Визуальная раскладка заголовка не изменяет семантический property.label.
// Текстовые узлы исключают интерпретацию label как HTML.
function wordLinesHeaderFormatter(cell) {
    const element = document.createElement("span");
    const words = String(cell.getValue() ?? "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    words.forEach((word, index) => {
        if (index > 0) {
            element.appendChild(document.createElement("br"));
        }
        element.appendChild(document.createTextNode(word));
    });

    return element;
}

// Tooltip создаётся текстовым DOM-узлом: содержимое схемы и данных не
// интерпретируется как HTML.
function textTooltip(text) {
    const element = document.createElement("div");
    element.textContent = text;
    element.style.whiteSpace = "pre-line";
    return element;
}

function imageEnumTooltip(property, value) {
    const option = findNamedEnumOption(property?.enum, value);
    if (typeof option?.image !== "string" || option.image.length === 0) {
        return null;
    }

    const text = option.description ?? option.label;
    if (!text) return "";

    const element = textTooltip(text);
    element.classList.add("image-enum-tooltip");
    return element;
}

// Полное отображаемое значение показывается только при фактической обрезке
// шириной ячейки либо лимитом summary.
function overflowCellTooltip(cell) {
    const cellElement = cell.getElement();
    const summaryElement = cellElement.querySelector(".nested-summary");
    const visibleText = summaryElement?.textContent
        ?? cellElement.textContent
        ?? "";
    const fullText = summaryElement?.dataset.fullSummary
        ?? visibleText;
    const clippedByLimit = fullText !== visibleText;
    const clippedBySize =
        cellElement.scrollWidth > cellElement.clientWidth ||
        cellElement.scrollHeight > cellElement.clientHeight;

    if (!fullText || (!clippedByLimit && !clippedBySize)) {
        return "";
    }

    return textTooltip(fullText);
}

function recordRowTooltip(schema, cell, tooltip = "") {
    if (!schema.config.rowNumberTooltip) return tooltip;
    const number = cell.getRow().getData().rowLabel;
    if (!Number.isSafeInteger(number) || number < 1) return tooltip;
    const details = tooltip ? `\n${tooltip.textContent ?? tooltip}` : "";
    return textTooltip(`Строка №${number}${details}`);
}

export const TableBuilder = {

    // Единый источник конфигурации ячейки-значения.
    // Поведение определяется дескриптором свойства и контрактом типа хранения.
    buildValueColumnConfig(schema) {
        return {
            editable(cell) {
                const property = resolveProperty(cell, schema,);
                if (!property) return false;
                return property.type !== FIELD_TYPES.ARRAY &&
                    property.type !== FIELD_TYPES.BOOLEAN &&
                    !isPropertyReadonly(property);
            },
            editor: universalEditor,
            validator(cell, value) {
                return constraintValidator(cell, value, schema,);
            },
            formatter: universalFormatter,
            tooltip(e, cell) {
                const property = resolveProperty(cell, schema,);
                if (cell.getElement()?.classList.contains("tabulator-editing")) {
                    return "";
                }
                if (
                    schema.config.storage === STORAGE_TYPES.RECORDS &&
                    !hasRecordColumnsView(schema)
                ) {
                    return recordRowTooltip(schema, cell, overflowCellTooltip(cell));
                }
                return imageEnumTooltip(property, cell.getValue())
                    ?? property?.description
                    ?? "";
            },
            cellClick(e, cell) {
                const property = resolveProperty(cell, schema,);
                if (!property) return;

                if (
                    property.type === FIELD_TYPES.BOOLEAN &&
                    !isPropertyReadonly(property)
                ) {
                    cell.setValue(!cell.getValue());
                    return;
                }

                if (property.type === FIELD_TYPES.ARRAY) {
                    // Ячейка строки с arrayIndex содержит отдельный элемент
                    // значения, а не массив: представление к ней не применяется.
                    const row = cell.getRow().getData();
                    if (row.arrayIndex !== undefined) return;
                    activateView(cell, property);
                }
            },
        };
    },

    buildColumns(schema) {
        if (hasRecordColumnsView(schema)) {
            return this.buildRecordColumns(schema);
        }
        if (schema.config.storage === STORAGE_TYPES.CLUSTER) {
            return this.buildClusterColumns(schema);
        }
        if (schema.config.storage === STORAGE_TYPES.RECORDS) {
            return this.buildRecordsColumns(schema);
        }
        throw new Error(
            `Unknown storage: ${schema.config.storage}`
        );
    },

    buildRecordColumns(schema) {
        const columns = [
            {
                title: schema.config.rowLabelTitle ?? "Параметр",
                field: "rowLabel",
                // No fixed width lets Tabulator measure the longest rendered label.
                ...(schema.config.rowLabelWidth === "auto"
                    ? {} : { width: schema.config.rowLabelWidth ?? 250 }),
                headerTooltip: schema.config.rowLabelDescription ?? "",
            },
        ];

        schema.views.recordsAsColumns.labels.forEach((label, recordIndex) => {
            columns.push({
                title: label,
                field: recordColumnField(recordIndex),
                ...this.buildValueColumnConfig(schema),
            });
        });

        return columns;
    },

    buildRecordsColumns(schema) {
        const columns = [
            {
                title: "#",
                field: "rowLabel",
                width: 70,
                ...(schema.config.rowNumberTooltip
                    ? { tooltip: (e, cell) => recordRowTooltip(schema, cell) }
                    : {}),
            },
        ];
        for (const [name, property] of Object.entries(schema.properties)) {
            const computed = isComputedProperty(property);
            if (property.hidden && !computed) continue;
            columns.push({
                title: property.label,
                field: name,
                ...(property.description
                    ? {
                        headerTooltip: () =>
                            textTooltip(property.description),
                    }
                    : {}),
                ...(schema.config.columnHeaderWordLines
                    ? { titleFormatter: wordLinesHeaderFormatter }
                    : {}),
                ...(property.columnWidth !== undefined
                    ? { width: property.columnWidth }
                    : {}),
                ...(computed
                    ? {
                        cssClass: "computed-column",
                        visible:
                            viewSettingsService.isComputedColumnVisible(
                                property.hidden,
                            ),
                    }
                    : {}),
                ...this.buildValueColumnConfig(schema),
            });
        }
        for (const [name, property] of referenceViewEntries(schema)) {
            columns.push({
                title: property.label,
                field: name,
                headerTooltip: property.description ?? "",
                cssClass: "computed-column",
                visible: viewSettingsService.isComputedColumnVisible(
                    property.hidden,
                ),
                ...(property.columnWidth !== undefined
                    ? { width: property.columnWidth }
                    : {}),
                ...this.buildValueColumnConfig(schema),
            });
        }
        return columns;
    },

    buildClusterColumns(schema) {
        return [
            {
                title: schema.config.rowLabelTitle ?? "Parameter",
                field: "rowLabel",
                formatter(cell) {
                    const property = schema.properties[cell.getRow().getData().property];
                    const label = document.createElement("span");
                    label.textContent = cell.getValue();
                    if (property?.labelColor) label.style.color = property.labelColor;
                    return label;
                },
                width: schema.config.rowLabelWidth ?? 250,
                headerTooltip: schema.config.rowLabelDescription ?? "",
            },

            {
                title: schema.config.valueTitle ?? "Value",
                field: "value",
                ...this.buildValueColumnConfig(schema),
            },
        ];
    },

};
