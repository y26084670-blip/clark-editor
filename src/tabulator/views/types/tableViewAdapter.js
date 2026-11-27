import { TableView } from "../TableView";
import { decodeArrayView } from "../../converters/arrayViewCodec";
import {
    DEFAULT_SUMMARY_MAX_LENGTH,
    STORAGE_TYPES,
} from "../../../services/schemas/common/constants";
import {
    readSingleRecordArray,
    writeSingleRecordArray,
} from "../../converters/singleRecordArray";

// Представления вложенных таблиц, привязанные к данным строки.
// Ключ первого уровня — объект данных строки (стабилен при перерисовке),
// ключ второго уровня — имя поля.
const viewsByRow = new WeakMap();

function getRowViews(rowData) {
    let views = viewsByRow.get(rowData);

    if (!views) {
        views = new Map();
        viewsByRow.set(rowData, views);
    }

    return views;
}

function createCellBinding(cell) {
    let ownerTable = null;
    let rowData = null;
    let field = null;

    const binding = {
        setCell(nextCell) {
            ownerTable = nextCell.getTable();
            rowData = nextCell.getRow().getData();
            field = nextCell.getField();
        },

        getSchema() {
            return ownerTable?._gui?.schema;
        },

        getValue() {
            return rowData?.[field];
        },

        getRecord() {
            return ownerTable?._gui?.model?.getRecord?.(rowData)
                ?? rowData;
        },

        getModelSnapshot() {
            return ownerTable?._gui?.model?.getSnapshot?.();
        },

        isWritable() {
            return ownerTable?._gui?.isWritable?.() !== false && Boolean(
                ownerTable?.getRows().some(
                    row => row.getData() === rowData
                )
            );
        },

        setValue(value) {
            const setRecordValue =
                ownerTable?._gui?.model?.setRecordValue;

            if (typeof setRecordValue === "function") {
                return setRecordValue(
                    rowData,
                    field,
                    value,
                );
            }

            const row = ownerTable
                ?.getRows()
                .find(item => item.getData() === rowData);

            return row?.update({ [field]: value });
        },
    };

    binding.setCell(cell);
    return binding;
}

function createPrimaryBinding({
    isWritable,
    schema,
    propertyName,
    getRecords,
    setRecords,
    getModelSnapshot,
    createDefaultRecord,
}) {
    const read = () => readSingleRecordArray(
        getRecords(),
        propertyName,
    );

    return {
        getSchema() {
            return schema;
        },

        getValue() {
            return read().value;
        },

        getRecord() {
            return read().record;
        },

        getModelSnapshot,

        isWritable() {
            return isWritable?.() !== false && read().valid;
        },

        setValue(value) {
            const records = writeSingleRecordArray({
                records: getRecords(),
                propertyName,
                value,
                createDefaultRecord,
            });

            if (records) {
                setRecords(records);
            }
        },
    };
}

function createEntry(property, cell) {
    // Собственный узел представления: перемещается в область деталей
    // и обратно, не уничтожается при освобождении области.
    const host = document.createElement("div");
    host.className = "nested-table-view";

    return {
        host,
        property,
        view: new TableView(
            property,
            createCellBinding(cell),
        ),
    };
}

export const tableViewAdapter = {

    // Текст сводки для ячейки основной таблицы (режим DETAIL).
    summary(cell, formatterParams) {
        const property = formatterParams.property;
        const value = cell.getValue();

        if (!property) return "";

        const storage =
            cell.getTable()._gui?.schema?.config?.storage;
        if (storage === STORAGE_TYPES.RECORDS) {
            cell.getTable()._gui?.detailRegion?.syncSourceCell?.(cell);
        }

        const rowData = cell.getRow().getData();
        const record =
            cell.getTable()._gui?.model?.getRecord?.(rowData)
            ?? rowData;
        const presentation = decodeArrayView(
            property,
            value,
            record,
        );
        let text;

        if (typeof property.summary === "function") {
            text = property.summary({
                rowData,
                value,
                presentation,
            });
        } else {
            text = `${property.label ?? ""}: ${presentation.rows.length} строк`;
        }

        const fullText = String(text ?? "");

        const limit =
            cell.getTable()._gui?.schema?.config?.summaryMaxLength
            ?? DEFAULT_SUMMARY_MAX_LENGTH;

        if (fullText.length > limit) {
            text = fullText.slice(0, limit - 1) + "…";
        } else {
            text = fullText;
        }

        const element = document.createElement("span");
        element.className = "nested-summary";
        element.dataset.fullSummary = fullText;
        element.textContent = text;

        return element;
    },

    // Активация пары «запись + свойство»: размещение представления
    // в области деталей вкладки.
    activate(cell, formatterParams) {
        const property = formatterParams.property;
        const region = cell.getTable()._gui?.detailRegion;

        if (!region || !property) return;

        const rowData = cell.getRow().getData();
        const views = getRowViews(rowData);
        const field = cell.getField();

        let entry = views.get(field);

        if (entry && entry.property !== property) {
            entry.view.destroy();
            entry = undefined;
        }

        if (!entry) {
            entry = createEntry(property, cell);
            views.set(field, entry);
        }

        entry.view.setCell(cell);

        // Заголовок: свойство и обозначение записи.
        // Обозначение записи присутствует там, где записей несколько.
        const storage = cell.getTable()._gui?.schema?.config?.storage;
        const label = property.label ?? field;
        const title =
            storage === STORAGE_TYPES.RECORDS
                ? `${label} — запись ${rowData.rowLabel}`
                : label;

        region.mount(
            entry,
            entry.view,
            title,
            entry.host,
            field,
            storage === STORAGE_TYPES.RECORDS ? cell : null,
        );
    },

    // Представление единственного ARRAY-свойства RECORDS непосредственно
    // в основной области вкладки. CellComponent здесь отсутствует.
    createPrimary(options) {
        const binding = createPrimaryBinding(options);

        return new TableView(
            options.property,
            binding,
            { primary: true },
        );
    },

};
