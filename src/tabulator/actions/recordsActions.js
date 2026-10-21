import { selectionContextService } from "../../services/selectionContextService";
import { clipboardService } from "../../services/clipboardService";
import { modelService } from "../../services/modelService";

// Операции со строками таблиц RECORDS.
export const recordsActions = {

    // Добавляет новую запись.
    async addRecord() {
        const table = selectionContextService.getActiveTable();
        if (!canChangeStructure(table)) return;

        const newRow = await runStructureChange(
            table,
            async () => {
                const record =
                    table._gui.structure.createDefaultRow();
                const lastRow = getLastSelectedRow(table);

                return lastRow
                    ? await table.addRow(record, false, lastRow)
                    : await table.addRow(record);
            },
        );

        newRow?.select();
    },

    // Копирование не изменяет модель и не создаёт шаг истории.
    copyRecords() {
        const table = selectionContextService.getActiveTable();
        if (!table) return;
        const rows = getSelectedRows(table);
        if (rows.length === 0) return;
        clipboardService.set(
            table,
            rows.map(row => this.cleanRowData(row.getData())),
        );
    },

    cleanRowData(data) {
        const result = {};
        for (const [key, value] of Object.entries(data)) {
            if (key === "datasetNestedCreated") continue;
            result[key] = structuredClone(value);
        }
        return result;
    },

    async pasteRecords() {
        const table = selectionContextService.getActiveTable();
        if (!canChangeStructure(table)) return;
        if (!clipboardService.isCompatible(table)) return;

        const insertedRows = await runStructureChange(
            table,
            async () => {
                const clipboard = clipboardService.get();
                const lastRow = getLastSelectedRow(table);
                const rows = [];

                for (const data of clipboard.rows) {
                    const row = lastRow
                        ? await table.addRow(
                            structuredClone(data),
                            false,
                            lastRow,
                        )
                        : await table.addRow(
                            structuredClone(data),
                        );
                    rows.push(row);
                }

                return rows;
            },
        );

        table.deselectRow();
        insertedRows.forEach(row => row.select());
    },

    // Удаляет выделенные записи.
    async removeRecord() {
        const table = selectionContextService.getActiveTable();
        if (!canChangeStructure(table)) return;
        const rows = getSelectedRows(table);
        if (rows.length === 0) return;

        // Для обязательной таблицы запрещено удаление всех существующих записей.
        if (
            table._gui.required &&
            table.getRows().length === rows.length
        ) {
            return;
        }

        await runStructureChange(
            table,
            () => table._gui.structure.removeRows
                ? table._gui.structure.removeRows(rows)
                : Promise.all(rows.map(row => row.delete())),
        );
    },

    // Перемещает выделенные записи вверх.
    async moveRecordUp() {
        const table = selectionContextService.getActiveTable();
        if (!canChangeStructure(table)) return;
        const rows = getSelectedRows(table);
        if (rows.length === 0) return;

        await runStructureChange(table, () => {
            rows.forEach(row => {
                const previous = row.getPrevRow();
                if (previous) {
                    row.move(previous, true);
                }
            });
        });
    },

    // Перемещает выделенные записи вниз.
    async moveRecordDown() {
        const table = selectionContextService.getActiveTable();
        if (!canChangeStructure(table)) return;
        const rows = getSelectedRows(table);
        if (rows.length === 0) return;

        await runStructureChange(table, () => {
            [...rows]
                .reverse()
                .forEach(row => {
                    const next = row.getNextRow();
                    if (next) {
                        row.move(next, false);
                    }
                });
        });
    },
};

// Все промежуточные dataChanged одной структурной операции объединяются.
async function runStructureChange(table, action) {
    const structure = table._gui.structure;

    modelService.beginHistoryTransaction();
    structure.beginChange?.();

    let completed = false;

    try {
        const result = await action();
        await finishStructureChange(table);
        completed = true;
        return result;
    } finally {
        if (!completed) {
            structure.cancelChange?.();
        }
        modelService.endHistoryTransaction();
    }
}

function canChangeStructure(table) {
    return Boolean(table) &&
        table._gui?.structure?.mutable !== false;
}

// Возвращает выделенные строки.
function getSelectedRows(table) {
    return table ? table.getSelectedRows() : [];
}

// Возвращает последнюю выделенную строку.
function getLastSelectedRow(table) {
    const rows = getSelectedRows(table);
    if (rows.length === 0) return null;
    return rows.reduce((last, row) =>
        row.getPosition(true) > last.getPosition(true)
            ? row
            : last
    );
}

// Пересчитывает служебную нумерацию строк.
async function refreshRowLabels(table) {
    const updates = table.getRows().map(
        (row, index) =>
            table._gui.structure.updateRowLabel(
                row,
                index,
            ),
    );

    await Promise.all(
        updates.filter(Boolean),
    );
}

// Общий завершающий этап структурной операции.
async function finishStructureChange(table) {
    const structure = table._gui.structure;
    const renumber = () => refreshRowLabels(table);

    // Пересчёт нумерации выполняется без фиксации значения представления.
    if (structure.withoutCommit) {
        await structure.withoutCommit(renumber);
    } else {
        await renumber();
    }

    if (typeof structure.endChange === "function") {
        return structure.endChange(table);
    }

    return structure.afterStructureChange?.(table);
}
