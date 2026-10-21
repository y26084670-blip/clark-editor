import { TabulatorFull as Tabulator } from "tabulator-tables";
import {
    NESTED_TABLE_COLUMN_MIN_WIDTH,
    NESTED_TABLE_MAX_HEIGHT,
} from "../../services/schemas/common/constants";
import { universalEditor } from "../editors/universalEditor";
import { constraintValidator } from "../validators/types/constraintValidator";
import { universalFormatter } from "../formatters/universalFormatter";
import { dataService } from "../../services/dataService";
import {
    cellsToValues,
    columnKey,
    valuesToCells,
} from "../../services/model/arrayShape";
import {
    arrayViewSignature,
    decodeArrayView,
    encodeArrayView,
} from "../converters/arrayViewCodec";
import {
    computedViewSignature,
    evaluateComputedView,
} from "../converters/computedView";
import { viewRowLabel } from "../converters/rowLabel";
import { COMMON_TABLE_OPTIONS } from "../tableOptions";
import { isPropertyReadonly } from "../../services/model/modelCompute";
import { viewSettingsService } from "../../services/viewSettingsService";

export class TableView {
    constructor(property, binding, { primary = false } = {}) {
        this.property = property;
        this.binding = binding;
        this.primary = primary;

        this.host = null;
        this.table = null;
        this.value = undefined;
        this.presentation = null;
        this.computedRows = [];
        this.computedSignature = null;
        this.adjusted = false;
        this.built = false;
        this.buildPromise = Promise.resolve();
        this.resolveBuilt = null;
        this.observer = null;
        this.lastWidth = 0;
        this.lastHeight = 0;
        this.hidden = false;
        this.nextRowId = 0;
        this.applying = false;
        this.renumbering = false;
        this.changingStructure = false;
        this.computedDirty = false;
        this.computedColumnsMode =
            viewSettingsService.computedColumnsMode();
    }

    attach(host) {
        this.host = host;
        this.observeHost(host);
    }

    // Отсоединение от области деталей без уничтожения таблицы.
    detach() {
        this.unobserveHost();
        this.host = null;
    }

    // Наблюдение за размерами области представления.
    // Нужно потому, что вкладка скрывается через display:none,
    // и при возврате видимости таблица обязана перерисоваться.
    observeHost(host) {
        this.unobserveHost();

        if (typeof ResizeObserver === "undefined") return;

        this.observer = new ResizeObserver(
            () => this.onHostResize()
        );

        this.observer.observe(host);
    }

    unobserveHost() {
        this.observer?.disconnect();
        this.observer = null;
    }

    // Cell-backed binding обновляет логического владельца при переносе
    // DetailRegion на другую запись. Основная проекция CellComponent не имеет.
    setCell(cell) {
        this.binding?.setCell?.(cell);
    }

    render() {
        if (!this.host) return undefined;

        if (!this.table) {
            this.create();
            return undefined;
        }

        return this.update();
    }

    create() {
        this.value = this.readValue();
        this.presentation = this.readPresentation();
        this.computedRows = this.readComputedRows();
        this.computedSignature = computedViewSignature(
            this.property,
            this.computedRows,
        );

        this.built = false;
        this.buildPromise = new Promise((resolve) => {
            this.resolveBuilt = resolve;
        });
        const table = new Tabulator(
            this.host,
            this.createOptions(),
        );
        this.table = table;

        // События Tabulator 6.x подключаются через API экземпляра,
        // а не передаются как параметры конструктора.
        table.on(
            "tableBuilt",
            () => this.onTableBuilt(table),
        );

        this.setupContext();

        // Фиксация изменений представления в значении записи.
        this.table.on(
            "dataChanged",
            () => this.commit(),
        );
    }

    // Контекст GUI таблицы представления.
    setupContext() {
        this.table._gui = {
            schema: this.binding.getSchema(),
            required: false,
            structure: {
                mutable: this.isStructureMutable(),
                removeRows: (rows) => this.removeRows(rows),
                createDefaultRow: () => ({
                    _row: this.nextRowId++,
                    index: 0,
                    ...dataService.createDefaultNestedRow(this.property),
                }),
                beginChange: () => {
                    this.changingStructure = true;
                },
                endChange: () => {
                    this.changingStructure = false;
                    return this.afterStructureChange();
                },
                cancelChange: () => {
                    this.changingStructure = false;
                },
                // Пересчёт нумерации не фиксирует значение представления.
                withoutCommit: async (action) => {
                    this.renumbering = true;
                    try {
                        return await action();
                    } finally {
                        this.renumbering = false;
                    }
                },
                afterStructureChange: () =>
                    this.afterStructureChange(),
                updateRowLabel: (row, index) => {
                    const label = this.rowLabel(index);
                    if (row.getData().index === label) {
                        return undefined;
                    }
                    return row.update({ index: label });
                },
            },
        };
    }

    // ARRAY не владеет связанными представлениями строк. Однократная замена
    // сохраняет порядок значений и не запускает полный пересчёт после каждой
    // удалённой строки. Готовые подписи исключают такой же эффект row.update.
    async removeRows(rows) {
        const table = this.table;
        const removed = new Set(rows.map(row => row.getIndex()));
        const previous = table.getData();
        const remaining = previous
            .filter(row => !removed.has(row._row))
            .map((row, index) => ({ ...row, index: this.rowLabel(index) }));

        try {
            await table.replaceData(remaining);
        } catch (error) {
            // BaseModel ещё не опубликована: восстановить только проекцию.
            await table.replaceData(previous);
            table.selectRow([...removed]);
            throw error;
        }
    }

    fillsAvailableHeight() {
        return Boolean(
            this.host?.closest?.('[data-fill-height="true"]')
        );
    }

    createOptions() {
        const size = this.primary || this.fillsAvailableHeight()
            ? { height: "100%" }
            : { maxHeight: NESTED_TABLE_MAX_HEIGHT };

        return {
            ...COMMON_TABLE_OPTIONS,
            layout: "fitDataFill",
            ...size,
            index: "_row",
            data: this.buildRows(),
            columns: this.buildColumns(),
            selectableRows: true,
            selectableRowsRangeMode: "click",
        };
    }

    // Однократное согласование размеров после построения Tabulator.
    onTableBuilt(table) {
        if (this.table !== table) {
            return;
        }

        this.built = true;
        this.lastWidth = this.host?.offsetWidth ?? 0;
        this.lastHeight = this.host?.offsetHeight ?? 0;
        if (!this.adjusted) {
            this.adjusted = true;
            table.redraw(true);
        }

        const resolveBuilt = this.resolveBuilt;
        this.resolveBuilt = null;
        resolveBuilt?.();
    }

    readValue() {
        return this.binding.getValue();
    }

    readRecord() {
        return this.binding.getRecord();
    }

    readPresentation(value = this.readValue()) {
        return decodeArrayView(
            this.property,
            value,
            this.readRecord(),
        );
    }

    readComputedRows(presentation = this.presentation) {
        const rowLimit = Array.isArray(presentation?.rows)
            ? presentation.rows.length
            : 0;

        return evaluateComputedView(
            this.property,
            this.binding.getModelSnapshot,
            rowLimit,
        );
    }

    formatComputedCell(cell, column) {
        const position = cell.getRow().getPosition();
        const value = Number.isInteger(position) && position > 0
            ? this.computedRows[position - 1]?.[column.key]
            : undefined;
        const element = document.createElement("span");
        element.textContent = String(value ?? "");
        return element;
    }

    refreshComputedColumns() {
        if (!this.table || !this.property.computedView) return;

        this.computedDirty = true;

        // Скрытая вкладка не имеет пригодной геометрии. ResizeObserver
        // сначала восстановит раскладку, затем переформатирует ячейки.
        if (!this.host?.offsetWidth) {
            this.hidden = true;
            return;
        }

        this.reformatComputedCells();
    }

    // computedView-значения не входят в row data, поэтому redraw не обязан
    // повторно вызвать formatter. Обновляются только вычисляемые ячейки.
    reformatComputedCells() {
        if (
            !this.table ||
            !this.property.computedView ||
            !this.computedDirty
        ) {
            return;
        }

        for (const row of this.table.getRows()) {
            row.reformat();
        }

        this.computedDirty = false;
    }

    setComputedColumnsVisibility(mode) {
        this.computedColumnsMode = mode;

        if (
            !this.table ||
            !this.property.computedView ||
            !this.host?.offsetWidth
        ) {
            return;
        }

        this.property.computedView.columns.forEach((descriptor, index) => {
            const column = this.table.getColumn(`_computed_${index}`);
            if (!column) return;

            const visible =
                viewSettingsService.isComputedColumnVisible(
                    descriptor.hidden,
                    mode,
                );

            if (column.isVisible?.() === visible) return;

            if (visible) {
                column.show();
            } else {
                column.hide();
            }
        });
    }

    isWritable() {
        return this.binding?.isWritable?.() !== false;
    }

    isStructureMutable() {
        return this.isWritable() &&
            !isPropertyReadonly(this.property) &&
            this.property.rowsMutable !== false;
    }

    syncStructureContext() {
        const structure = this.table?._gui?.structure;
        if (structure) {
            structure.mutable = this.isStructureMutable();
        }
    }

    rowLabel(index) {
        return viewRowLabel(
            this.property,
            index,
            this.presentation?.itemLabels,
        );
    }

    // После изменения числа/порядка строк пересчитываются позиционные
    // computedView-значения в том же цикле, без замены редактируемых строк.
    afterStructureChange() {
        const publication = this.commit();

        this.presentation = this.readPresentation(this.value);
        this.computedRows = this.readComputedRows(this.presentation);
        this.computedSignature = computedViewSignature(
            this.property,
            this.computedRows,
        );

        this.refreshComputedColumns();
        return publication;
    }

    // Перенос содержимого представления в значение записи.
    commit() {
        if (
            this.applying ||
            this.renumbering ||
            this.changingStructure ||
            !this.isWritable() ||
            isPropertyReadonly(this.property)
        ) {
            return;
        }

        const rows = this.rowsToPresentation(
            this.table.getData(),
        );

        this.value = encodeArrayView(
            this.property,
            rows,
            this.readRecord(),
            this.presentation,
        );

        const publication =
            this.binding.setValue(this.value);

        // Model-backed binding может клонировать опубликованное значение.
        // Асинхронный cell-backed binding сначала завершает row.update и
        // явную публикацию родительской модели, затем возвращает канон.
        if (
            publication &&
            typeof publication.then === "function"
        ) {
            return publication.then(
                () => {
                    this.value = this.readValue();
                },
                (error) => {
                    console.error("Nested table commit error:", error);
                    this.value = this.readValue();
                },
            );
        }

        this.value = this.readValue();
        return undefined;
    }

    getTable() {
        return this.table;
    }

    // Явное восстановление представления после активации вкладки.
    // Не зависит от ResizeObserver для перехода display:none -> block.
    onVisible() {
        if (!this.built || !this.table || !this.table.element || !this.host) {
            return;
        }

        const width = this.host.offsetWidth;
        const height = this.host.offsetHeight;

        if (!width) {
            this.hidden = true;
            return;
        }

        const renderedRows =
            this.host.querySelectorAll(".tabulator-row").length;
        const bodyLost =
            renderedRows === 0 && this.table.getDataCount() > 0;
        const needsRedraw =
            this.hidden ||
            this.computedDirty ||
            bodyLost ||
            width !== this.lastWidth ||
            height !== this.lastHeight;

        this.hidden = false;
        this.lastWidth = width;
        this.lastHeight = height;
        this.setComputedColumnsVisibility(
            this.computedColumnsMode,
        );

        if (needsRedraw) {
            this.table.redraw(true);
        }

        this.reformatComputedCells();
    }

    onHostResize() {
        // ResizeObserver остаётся резервом для фактического изменения размера.
        if (!this.built || !this.table || !this.table.element || !this.host) {
            return;
        }

        if (!this.host.offsetWidth) {
            this.hidden = true;
            return;
        }

        this.onVisible();
    }

    // Строки вариантного представления массива.
    buildRows() {
        const rows = this.presentation?.rows;
        if (!Array.isArray(rows)) return [];

        this.nextRowId = rows.length;

        return rows.map((values, row) => ({
            // идентичность строки представления
            _row: row,
            // отображаемая нумерация
            index: this.rowLabel(row),
            ...valuesToCells(values),
        }));
    }

    // Колонки вариантного представления массива.
    buildColumns() {
        const schema = this.binding.getSchema();
        const property = this.property;
        const itemProperty = property.items;
        const valueColumns = this.presentation?.columns ?? [];

        const columns = [];
        const computedDescriptor = property.computedView;

        if (computedDescriptor) {
            computedDescriptor.columns.forEach((column, index) => {
                columns.push({
                    title: column.label,
                    field: `_computed_${index}`,
                    width: column.width,
                    minWidth: column.minWidth ?? 55,
                    cssClass: "computed-column",
                    visible:
                        viewSettingsService.isComputedColumnVisible(
                            column.hidden,
                            this.computedColumnsMode,
                        ),
                    editable: false,
                    headerTooltip: column.description ?? "",
                    tooltip: column.description ?? "",
                    formatter: (cell) =>
                        this.formatComputedCell(cell, column),
                });
            });
        }
        else {
            columns.push({
                title:
                    this.presentation?.itemLabelTitle
                    ?? property.itemLabelTitle
                    ?? "#",
                field: "index",
                width: property.itemLabelWidth ?? 70,
            });
        }

        for (let i = 0; i < valueColumns.length; i++) {
            columns.push({
                title: valueColumns[i] ?? `C${i + 1}`,
                field: columnKey(i),
                minWidth: NESTED_TABLE_COLUMN_MIN_WIDTH,

                editable: () =>
                    this.isWritable() &&
                    !isPropertyReadonly(property) &&
                    !isPropertyReadonly(itemProperty),

                editor: universalEditor,
                editorParams: {
                    property: itemProperty,
                },

                validator(cell, value) {
                    return constraintValidator(
                        cell,
                        value,
                        schema,
                        itemProperty,
                    );
                },

                formatter: universalFormatter,
                formatterParams: {
                    property: itemProperty,
                },

                tooltip: itemProperty.description ?? "",
            });
        }

        return columns;
    }

    // Строки Tabulator -> строки вариантного представления.
    rowsToPresentation(rows) {
        const nColumns = this.presentation?.columns?.length ?? 1;
        return rows.map((row) => cellsToValues(row, nColumns));
    }

    update() {
        const table = this.table;
        if (!table) {
            return undefined;
        }
        if (!this.built) {
            const buildPromise = this.buildPromise;
            return buildPromise.then(() => {
                if (this.table !== table || !this.built) {
                    return undefined;
                }
                return this.update();
            });
        }

        const value = this.readValue();
        const presentation = this.readPresentation(value);
        const computedRows = this.readComputedRows(presentation);
        const nextComputedSignature = computedViewSignature(
            this.property,
            computedRows,
        );
        const valueChanged = value !== this.value;
        const presentationChanged =
            arrayViewSignature(presentation) !==
            arrayViewSignature(this.presentation);
        const computedChanged =
            nextComputedSignature !== this.computedSignature;

        this.syncStructureContext();

        if (
            !valueChanged &&
            !presentationChanged &&
            !computedChanged
        ) {
            return undefined;
        }

        this.value = value;
        this.presentation = presentation;
        this.computedRows = computedRows;
        this.computedSignature = nextComputedSignature;

        if (!valueChanged && !presentationChanged) {
            this.refreshComputedColumns();
            return undefined;
        }

        this.applying = true;

        if (presentationChanged) {
            this.table.setColumns(
                this.buildColumns(),
            );
        }

        return this.table.replaceData(
            this.buildRows(),
        ).finally(() => {
            this.applying = false;
        });
    }

    destroy() {
        this.unobserveHost();
        const resolveBuilt = this.resolveBuilt;
        this.resolveBuilt = null;
        resolveBuilt?.();
        this.buildPromise = Promise.resolve();
        this.table?.destroy();
        this.table = null;
        this.built = false;
        this.host = null;
        this.adjusted = false;
        this.lastWidth = 0;
        this.lastHeight = 0;
        this.hidden = false;
        this.computedRows = [];
        this.computedSignature = null;
        this.computedDirty = false;
        this.changingStructure = false;
        this.binding = null;
    }
}

