/*
Источник: solver/src/base/types.jl (SYMBase),
solver/src/core/types.jl (TkBase) и solver/src/core/03_tk.jl. Снимок 2026-08.
Сериализуются только поля TkBase; SYMAdd, tk34 и vi4AC1 являются производными.
Унаследованные sym.ya, sym.tx, sym.as, sym.ps, sym.kya и sym.kyp сохраняются,
но скрыты: алгоритмы Tk их не используют.
*/
import {
    TABS,
    STORAGE_TYPES,
    FIELD_TYPES,
    FILES,
    VIEW_TYPES,
} from "../../services/schemas/common/constants";
import { SYM_KIND, TK_GEO_TYPE } from "./common/enums";
import { createSchema } from "../schemaFactory";
import { TK_GEO_LENGTH } from "../solver/geometryTk";
import { tkGeoVariantCodec } from "../../tabulator/converters/geoVariantCodec";
import { regionName } from "../solver/tkDerived";
import { epCount } from "../solver/kvDerived";

function summaryRows({ value, presentation }) {
    return Array.isArray(presentation?.rows)
        ? presentation.rows
        : value;
}

function arraySummary(context) {
    const rows = summaryRows(context);

    return Array.isArray(rows)
        ? rows.flat().join(", ")
        : "";
}

function coordinateTriplesSummary(context) {
    const rows = summaryRows(context);
    if (!Array.isArray(rows)) return "";

    const values = rows.flat();
    const triples = [];

    for (let index = 0; index < values.length; index += 3) {
        triples.push(
            "(" + values.slice(index, index + 3).join(", ") + ")"
        );
    }

    return triples.join(", ");
}

function geometrySummary(context) {
    const geoType = context.rowData?.geoType;

    return geoType === 0 || geoType === 2
        ? coordinateTriplesSummary(context)
        : arraySummary(context);
}

export default createSchema({
    id: TABS.REGIONS.id,
    title: TABS.REGIONS.label,
    file: FILES.TKS,
    storage: STORAGE_TYPES.RECORDS,
    required: true,
    columnHeaderWordLines: true,
    rowNumberTooltip: true,

    properties: {
        name: {
            type: FIELD_TYPES.STRING,
            label: "Название",
            description: "Название области наблюдения",
            default: "",
            readonly: true,
            computeStored: {
                dependencies: ["geoType", "dp", "symLs"],
                evaluate: regionName,
            },
        },

        geo: {
            type: FIELD_TYPES.ARRAY,
            view: VIEW_TYPES.TABLE,
            label: "Геометрия",
            description: "Геометрия области наблюдения в локальной СК",
            default: new Array(TK_GEO_LENGTH).fill(0),
            nColumns: 3,
            order: "row",
            columns: ["X", "Y", "Z"],
            rowsMutable: false,
            minItems: 4,
            maxItems: 4,
            itemLabels: ["V1", "V2", "V3", "V4"],
            itemLabelTitle: "Вершина",
            variantCodec: tkGeoVariantCodec,
            summary: geometrySummary,
            items: {
                type: FIELD_TYPES.FLOAT,
                description: "Координата или параметр геометрии",
                default: 0,
                digits: 6,
            },
        },

        dr: {
            type: FIELD_TYPES.ARRAY,
            view: VIEW_TYPES.TABLE,
            label: "Начальное смещение",
            description: "Вектор начального (до всех поворотов) смещения геометрии области наблюдения в локальной СК",
            default: [0, 0, 0],
            nColumns: 1,
            columns: ["Значение"],
            rowsMutable: false,
            minItems: 3,
            maxItems: 3,
            itemLabels: ["X", "Y", "Z"],
            itemLabelTitle: "Ось",
            summary: arraySummary,
            items: {
                type: FIELD_TYPES.FLOAT,
                description: "Компонента вектора смещения",
                default: 0,
                digits: 6,
            },
        },

        symVi: {
            storageKey: "sym.vi",
            type: FIELD_TYPES.ARRAY,
            view: VIEW_TYPES.TABLE,
            label: "Поворот локальной СК",
            description: "Углы последовательных поворотов для получения положения локальной СК из исходной СК: X -> Y -> Z повороты",
            default: [0, 0, 0],
            nColumns: 1,
            columns: ["Угол"],
            rowsMutable: false,
            minItems: 3,
            maxItems: 3,
            itemLabels: ["X", "Y", "Z"],
            itemLabelTitle: "Ось",
            summary: arraySummary,
            items: {
                type: FIELD_TYPES.FLOAT,
                description: "Угол поворота",
                default: 0,
                digits: 6,
            },
        },

        symR0: {
            storageKey: "sym.r0",
            type: FIELD_TYPES.ARRAY,
            view: VIEW_TYPES.TABLE,
            label: "Начало локальной СК",
            description: "Координаты начала локальной СК",
            default: [0, 0, 0],
            nColumns: 1,
            columns: ["Координата"],
            rowsMutable: false,
            minItems: 3,
            maxItems: 3,
            itemLabels: ["X", "Y", "Z"],
            itemLabelTitle: "Ось",
            summary: arraySummary,
            items: {
                type: FIELD_TYPES.FLOAT,
                description: "Координата начала локальной СК",
                default: 0,
                digits: 6,
            },
        },

        symYl: {
            storageKey: "sym.yl",
            type: FIELD_TYPES.FLOAT,
            label: "Локальная симметрия: угол",
            description: "Угол поворота в локальной СК, формирующий образы локальной симметрии",
            default: 0,
            digits: 6,
        },

        symYa: {
            storageKey: "sym.ya",
            type: FIELD_TYPES.FLOAT,
            label: "Азимутальная симметрия: угол",
            description: "Угол поворота в основной СК, формирующий азимутальные образы",
            default: 0,
            digits: 6,
            hidden: true,
        },

        symTx: {
            storageKey: "sym.tx",
            type: FIELD_TYPES.FLOAT,
            label: "Периодическая симметрия: смещение",
            description: "Смещение в основной СК, формирующее периодические образы",
            default: 0,
            digits: 6,
            hidden: true,
        },

        symLs: {
            storageKey: "sym.ls",
            type: FIELD_TYPES.INTEGER,
            label: "Образы локальной симметрии",
            description: "Число образов локальной симметрии",
            default: 1,
            minimum: 1,
        },

        symAs: {
            storageKey: "sym.as",
            type: FIELD_TYPES.INTEGER,
            label: "Образы азимутальной симметрии",
            description: "Число образов азимутальной симметрии",
            default: 1,
            hidden: true,
        },

        symPs: {
            storageKey: "sym.ps",
            type: FIELD_TYPES.INTEGER,
            label: "Образы периодической симметрии",
            description: "Число образов периодической симметрии",
            default: 1,
            hidden: true,
        },

        symKya: {
            storageKey: "sym.kya",
            type: FIELD_TYPES.ENUM,
            label: "Тип азимутальной симметрии",
            description: "Знак и характер азимутальной симметрии",
            default: 0,
            enum: SYM_KIND,
            hidden: true,
        },

        symKyp: {
            storageKey: "sym.kyp",
            type: FIELD_TYPES.ENUM,
            label: "Тип периодической симметрии",
            description: "Знак и характер периодической симметрии",
            default: 0,
            enum: SYM_KIND,
            hidden: true,
        },

        geoType: {
            type: FIELD_TYPES.ENUM,
            label: "Тип геометрии",
            description: "Способ задания геометрии области наблюдения",
            default: 0,
            enum: TK_GEO_TYPE,
        },

        dp: {
            type: FIELD_TYPES.ARRAY,
            view: VIEW_TYPES.TABLE,
            label: "Разбиение",
            description: "Число узлов разбиения по двум направлениям",
            default: [1, 1],
            nColumns: 1,
            columns: ["Число узлов"],
            rowsMutable: false,
            minItems: 2,
            maxItems: 2,
            itemLabels: ["D1", "D2"],
            itemLabelTitle: "Направление",
            summary: arraySummary,
            items: {
                type: FIELD_TYPES.INTEGER,
                description: "Число узлов разбиения",
                default: 1,
                minimum: 1,
            },
        },

        epCount: {
            type: FIELD_TYPES.INTEGER,
            label: "Количество ЭП",
            description: "Число элементарных площадок",
            default: 0,
            readonly: true,
            columnWidth: 110,
            compute: {
                dependencies: ["dp", "symLs"],
                evaluate: ({ values }) => epCount(values),
            },
        },

        indCoil: {
            type: FIELD_TYPES.INTEGER,
            label: "Индекс катушки",
            description: "Номер измерительной катушки; 0 — область не принадлежит катушке",
            default: 0,
        },

        wCoil: {
            type: FIELD_TYPES.FLOAT,
            label: "Множитель катушки",
            description: "Число витков измерительной катушки",
            default: 0,
            digits: 6,
        },

        indMove: {
            type: FIELD_TYPES.INTEGER,
            label: "Индекс движения",
            description: "Индекс траектории движения области наблюдения",
            default: 0,
            minimum: 0,
        },
    },
});
