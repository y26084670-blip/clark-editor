/*
Источник: solver/src/core/types.jl (Move, JSON_Move),
solver/src/task/05_taskData.jl и solver/src/import/02_fillMoves.jl.
Снимок 2026-08.
*/
import {
    VIEW_TYPES,
    TABS,
    STORAGE_TYPES,
    FIELD_TYPES,
    FILES,
} from "../../services/schemas/common/constants";
import { createSchema } from "../schemaFactory";
import { nodeCount } from "../solver/kvDerived";
import {
    moveReferenceRows,
    moveReferenceSummary,
} from "../references/modelReferenceViews.js";

function commonMoveNodeCount({ values }) {
    const angleCount = nodeCount(values.angle);
    const positionCount = nodeCount(values.position);

    return angleCount === positionCount
        ? angleCount
        : 0;
}

function moveRowsSummary({ presentation }) {
    const rows = presentation?.rows;
    if (!Array.isArray(rows)) return "";

    return rows
        .map(row =>
            `(${row?.[0] ?? ""}, ${row?.[1] ?? ""}, `
            + `${row?.[2] ?? ""}, ${row?.[3] ?? ""})`
        )
        .join(", ");
}

export default createSchema({

    id: TABS.MOVES.id,

    title: TABS.MOVES.label,

    file: FILES.MOVES,

    storage: STORAGE_TYPES.RECORDS,

    required: false,

    views: {
        clipboardTables: [{
            property: "angle",
            label: "Заменить повороты значениями из буфера",
            title: "Выделите одну строку траектории. Скопируйте четыре числовые колонки без заголовка: время, поворот X, Y, Z (градусы). Таблица поворотов будет заменена; доступна отмена.",
        }, {
            property: "position",
            label: "Заменить положения значениями из буфера",
            title: "Выделите одну строку траектории. Скопируйте четыре числовые колонки без заголовка: время, положение X, Y, Z (мм). Таблица положений будет заменена; доступна отмена.",
        }],
        references: {
            usedByObjects: {
                type: FIELD_TYPES.ARRAY,
                view: VIEW_TYPES.TABLE,
                label: "Элементы и области",
                description: "Элементы модели и области наблюдения, использующие траекторию",
                readonly: true,
                rowsMutable: false,
                nColumns: 3,
                columns: ["Тип", "№", "Название"],
                items: {
                    type: FIELD_TYPES.STRING,
                    default: "",
                    description: "Ссылка на элемент или область",
                },
                dependencies: [TABS.ELEMENTS.id, TABS.REGIONS.id],
                rows: moveReferenceRows,
                summary: moveReferenceSummary,
            },
        },
        generator: {
            title: "Генератор временных зависимостей",
            historyFile: "_генератор_траекторий.txt",
            defaultTarget: "positionX",
            synchronizedProperties: ["angle", "position"],
            targets: [
                {
                    value: "angleX",
                    label: "Вращение вокруг оси X",
                    property: "angle",
                    column: 1,
                },
                {
                    value: "angleY",
                    label: "Вращение вокруг оси Y",
                    property: "angle",
                    column: 2,
                },
                {
                    value: "angleZ",
                    label: "Вращение вокруг оси Z",
                    property: "angle",
                    column: 3,
                },
                {
                    value: "positionX",
                    label: "Перемещение вдоль оси X",
                    property: "position",
                    column: 1,
                },
                {
                    value: "positionY",
                    label: "Перемещение вдоль оси Y",
                    property: "position",
                    column: 2,
                },
                {
                    value: "positionZ",
                    label: "Перемещение вдоль оси Z",
                    property: "position",
                    column: 3,
                },
            ],
        },
        graph: {
            title: "Графики траекторий",
            recordLabel: "Траектория",
            selectorLabel: "Показ",
            defaultMode: "position",
            modes: [
                {
                    value: "position",
                    label: "Смещение",
                    property: "position",
                    x: { column: 0, title: "Время" },
                    y: { title: "Смещение" },
                    series: [
                        { column: 1, label: "X" },
                        { column: 2, label: "Y" },
                        { column: 3, label: "Z" },
                    ],
                },
                {
                    value: "angle",
                    label: "Углы",
                    property: "angle",
                    x: { column: 0, title: "Время" },
                    y: { title: "Угол" },
                    series: [
                        { column: 1, label: "aX" },
                        { column: 2, label: "aY" },
                        { column: 3, label: "aZ" },
                    ],
                },
            ],
        },
    },

    properties: {

        angle: {
            type: FIELD_TYPES.ARRAY,
            view: VIEW_TYPES.TABLE,
            label: "Поворот",
            description: "Зависимость изменения исходной ориентации 9углов поворота) локальной СК элементов/областей от времени",
            default: [],
            nColumns: 4,
            columns: [
                "Время",
                "aX",
                "aY",
                "aZ",
            ],
            items: {
                type: FIELD_TYPES.FLOAT,
                description: "Время или угол поворота",
                default: 0,
                digits: 6,
            },
            summary: moveRowsSummary,
        },

        position: {
            type: FIELD_TYPES.ARRAY,
            view: VIEW_TYPES.TABLE,
            label: "Положение",
            description: "Зависимость изменения исходного положения (начала) локальной СК элементов/областей от времени",
            default: [],
            nColumns: 4,
            columns: [
                "Время",
                "X0",
                "Y0",
                "Z0",
            ],
            items: {
                type: FIELD_TYPES.FLOAT,
                description: "Время или координата положения",
                default: 0,
                digits: 6,
            },
            summary: moveRowsSummary,
        },

        n: {
            type: FIELD_TYPES.INTEGER,
            label: "Число узлов",
            description: "Общее число строк таблиц поворота и положения",
            default: 0,
            readonly: true,
            hidden: true,
            computeStored: {
                dependencies: ["angle", "position"],
                evaluate: commonMoveNodeCount,
            },
        },

    }

});
