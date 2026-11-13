//==============================================================================
// Область деталей вкладки.
//
// Размещает связанное представление активной пары «запись + свойство».
// Не строит представление и не знает типов данных: получает готовое
// представление от ViewAdapter.
//==============================================================================

import { recordsActions } from "../actions/recordsActions";
import { selectionContextService } from "../../services/selectionContextService";

const DETAIL_SOURCE_CLASS = "detail-source-active";

export class DetailRegion {

    constructor() {
        this.titleElement = null;
        this.toolbarElement = null;
        this.hostElement = null;
        this.fieldChangedHandler = null;

        this.view = null;
        this.key = null;
        this.element = null;

        // Логический владелец связанного представления. DOM ячейки может
        // меняться при перерисовке виртуальной таблицы.
        this.sourceTable = null;
        this.sourceRowData = null;
        this.sourceField = null;
        this.sourceElement = null;

        // Активное свойство сохраняется между записями.
        this.field = null;
    }

    // Подключение к DOM-узлам, созданным вкладкой.
    attach({ title, toolbar, host, onFieldChanged }) {
        this.titleElement = title;
        this.toolbarElement = toolbar;
        this.hostElement = host;
        this.fieldChangedHandler =
            typeof onFieldChanged === "function"
                ? onFieldChanged
                : null;
        this.fieldChangedHandler?.(this.field);

        // Взаимодействие с таблицей деталей делает её активной.
        // this.hostElement?.addEventListener("mousedown", () => {
        //     const table = this.view?.getTable?.();
        //     if (table) {
        //         selectionContextService.setActiveTable(table);
        //     }
        // });

        this.showHint();
    }

    // Состояние «выбор не сделан»: активное свойство сбрасывается.
    showHint(text = "Щёлкните ячейку со сводкой массива, чтобы открыть его содержание") {
        this.clear();

        this.setField(null);

        if (this.titleElement) {
            this.titleElement.textContent = text;
        }
    }

    setField(field) {
        if (this.field === field) return;

        this.field = field;
        this.fieldChangedHandler?.(field);
    }

    getField() {
        return this.field;
    }

    // Повторное форматирование ячейки восстанавливает метку по логической
    // паре, не полагаясь на долговечность CellComponent или DOM-узла.
    syncSourceCell(cell) {
        const cellElement = cell?.getElement?.();
        if (!cellElement) return;

        const matches =
            this.view &&
            cell.getTable?.() === this.sourceTable &&
            cell.getRow?.().getData() === this.sourceRowData &&
            cell.getField?.() === this.sourceField;

        if (!matches) {
            cellElement.classList.remove(DETAIL_SOURCE_CLASS);
            if (this.sourceElement === cellElement) {
                this.sourceElement = null;
            }
            return;
        }

        if (this.sourceElement !== cellElement) {
            this.clearSourceElement();
            this.sourceElement = cellElement;
        }

        this.sourceElement.classList.add(DETAIL_SOURCE_CLASS);
    }

    setSourceCell(cell, field) {
        this.clearSourceElement();

        this.sourceTable = cell?.getTable?.() ?? null;
        this.sourceRowData = cell?.getRow?.().getData() ?? null;
        this.sourceField = field ?? null;

        this.syncSourceCell(cell);
    }

    clearSourceElement() {
        this.sourceElement?.classList.remove(DETAIL_SOURCE_CLASS);
        this.sourceElement = null;
    }

    clearSourceCell() {
        this.clearSourceElement();
        this.sourceTable = null;
        this.sourceRowData = null;
        this.sourceField = null;
    }

    // Удаление записи-владельца не должно оставлять доступным View,
    // изменения которого уже невозможно вернуть в основную таблицу.
    clearIfSourceMissing(table) {
        if (
            !this.sourceRowData ||
            this.sourceTable !== table
        ) {
            return;
        }

        const sourceExists = table
            .getRows()
            .some(row => row.getData() === this.sourceRowData);

        if (!sourceExists) {
            this.showHint();
        }
    }

    // Размещение представления. key — пара «запись + свойство».
    // element — собственный узел представления, он не уничтожается,
    // а только перемещается в область деталей и обратно.
    mount(key, view, title, element, field, sourceCell) {

        if (this.key === key && this.view === view) {
            this.setSourceCell(sourceCell, field);
            return;
        }

        this.clear();

        this.key = key;
        this.view = view;
        this.element = element;
        this.setField(field);
        this.setSourceCell(sourceCell, field);

        if (this.titleElement) {
            this.titleElement.textContent = title ?? "";
        }

        if (this.hostElement) {
            this.hostElement.replaceChildren(element);
            view.attach(element);
            view.render();
        }

        this.buildToolbar(view);
    }

    // Освобождение области. Представление и его разметка сохраняются:
    // жизненным циклом представления владеет ViewAdapter.
    // Активное свойство (field) намеренно не сбрасывается — область
    // должна переезжать между записями без повторной активации сводки.
    clear() {
        this.clearSourceCell();

        if (this.view) {
            this.view.detach?.();
        }

        if (this.element?.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }

        this.element = null;
        this.view = null;
        this.key = null;

        if (this.toolbarElement) {
            this.toolbarElement.replaceChildren();
        }
    }

    // Панель операций: тот же состав, что у основной таблицы,
    // уменьшенная высота под строку таблицы значений.
    buildToolbar(view) {
        if (!this.toolbarElement) return;

        this.toolbarElement.replaceChildren();

        // Именованные фиксированные строки не допускают структурных операций.
        if (view.isStructureMutable?.() === false) return;

        const actions = [
            ["+", "Добавить строку", () => recordsActions.addRecord()],
            ["−", "Удалить выделенные", () => recordsActions.removeRecord()],
            ["↑", "Переместить вверх", () => recordsActions.moveRecordUp()],
            ["↓", "Переместить вниз", () => recordsActions.moveRecordDown()],
        ];

        for (const [label, title, handler] of actions) {
            const button = document.createElement("button");
            button.textContent = label;
            button.title = title;
            button.addEventListener("click", () => {
                selectionContextService.setActiveTable(view.getTable());
                handler();
            });
            this.toolbarElement.appendChild(button);
        }
    }

    // Обновление текущего View без смены активной пары.
    refresh() {
        this.view?.render?.();
    }

    // Явная активация вложенного представления после появления вкладки.
    onVisible() {
        const view = this.view;
        if (!view) return undefined;

        const rendering = view.render?.();

        if (
            rendering &&
            typeof rendering.then === "function"
        ) {
            return rendering.then(() => {
                if (this.view === view) {
                    view.onVisible?.();
                }
            });
        }

        view.onVisible?.();
        return undefined;
    }

    destroy() {
        this.clear();
        this.setField(null);

        this.fieldChangedHandler = null;
        this.titleElement = null;
        this.toolbarElement = null;
        this.hostElement = null;
    }
}
