// Readonly-проекция базовой библиотеки ферромагнитных характеристик.
// Файловый контракт остаётся «одна характеристика — один JSON-файл»;
// RECORDS используется только как модель каталога в редакторе.
import {
    FIELD_TYPES,
    STORAGE_TYPES,
    TABS,
    VIEW_TYPES,
} from "./common/constants";
import { createSchema } from "../schemaFactory";
import { FMM_MIN_TABLE_ROWS } from "../materials/materialConstants.js";

function tableSummary({ presentation }) {
    const count = Array.isArray(presentation?.rows)
        ? presentation.rows.length
        : 0;
    return `${count} точек`;
}

export default createSchema({
    id: TABS.FMM_LIBRARY.id,
    title: TABS.FMM_LIBRARY.label,
    storage: STORAGE_TYPES.RECORDS,
    required: false,
    stretchLastColumn: true,

    properties: {
        name: {
            type: FIELD_TYPES.STRING,
            label: "Название",
            description: "Имя характеристики и файла без расширения",
            default: "",
            readonly: true,
            columnWidth: 260,
        },

        hip: {
            type: FIELD_TYPES.FLOAT,
            label: "hip",
            description: "Поперечная магнитная восприимчивость",
            default: 0,
            readonly: true,
            digits: 8,
            columnWidth: 130,
        },

        tabl: {
            type: FIELD_TYPES.ARRAY,
            view: VIEW_TYPES.TABLE,
            label: "Таблица H–M",
            description: "Табличная ферромагнитная характеристика",
            default: [],
            readonly: true,
            rowsMutable: true,
            nColumns: 2,
            order: "column",
            columns: ["H, кА/м", "M, кА/м"],
            itemLabelTitle: "#",
            itemLabelWidth: 55,
            minItems: FMM_MIN_TABLE_ROWS,
            summary: tableSummary,
            columnWidth: 150,
            items: {
                type: FIELD_TYPES.FLOAT,
                description: "Значение точки характеристики",
                default: 0,
                digits: 8,
                floatFormat: "fixed",
                readonly: true,
            },
        },

        comment: {
            type: FIELD_TYPES.STRING,
            label: "Комментарий",
            description: "Комментарий из файла характеристики",
            default: "",
            readonly: true,
            columnWidth: 420,
        },
    },
});
