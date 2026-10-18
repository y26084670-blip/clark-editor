/*
{"impuls":[0.0,4.0,5.0,6.0,7.0,8.0,1.0,1.0,0.9659,0.866,0.7071,0.0],"n":6}
...
json_amplitude = JSON_Amplitude()
me.amplitudes = Amplitude[]
while !eof(f)
    json_str = readline(f)
    JSON3.read!(json_str, json_amplitude)
    # копирование данных из 1d json массивов в матрицы
    amplitude.impuls = fcopy(json_amplitude.impuls, 2)
    amplitude.n = json_amplitude.n
    push!(me.amplitudes, deepcopy(amplitude))
end    
...
mutable struct JSON_Amplitude
    impuls::VEC = VNULL()
    n::INT = 0
end
mutable struct Amplitude
    impuls::APPROX = MNULL()
    n::INT = 0
end
amplitudes::Vector{Amplitude} = Amplitude[]
*/
import { VIEW_TYPES, TABS, STORAGE_TYPES, FIELD_TYPES, FILES } from "../../services/schemas/common/constants";
import { createSchema } from "../schemaFactory";
import { nodeCount } from "../solver/kvDerived";
import {
    amplitudeReferenceRows,
    amplitudeReferenceSummary,
} from "../references/modelReferenceViews.js";

function impulsePairsSummary({ presentation }) {
    const rows = presentation?.rows;
    if (!Array.isArray(rows)) return "";

    return rows
        .map(row => {
            const time = row?.[0] ?? "";
            const amplitude = row?.[1] ?? "";
            return `(${time}, ${amplitude})`;
        })
        .join(", ");
}

export default createSchema({

    id: TABS.AMPS.id,

    title: TABS.AMPS.label,

    file: FILES.AMPLITUDES,

    storage: STORAGE_TYPES.RECORDS,

    required: false,
    stretchLastColumn: true,

    views: {
        clipboardTables: [{
            property: "impuls",
            label: "Заменить амплитуды значениями из буфера",
            title: "Выделите одну строку амплитуды. Скопируйте из Excel две числовые колонки без заголовка: время, амплитуда. Вся таблица будет заменена; доступна отмена.",
        }],
        references: {
            usedByElements: {
                type: FIELD_TYPES.ARRAY,
                view: VIEW_TYPES.TABLE,
                label: "Элементы",
                description: "Элементы модели, использующие данную амплитуду",
                readonly: true,
                rowsMutable: false,
                nColumns: 2,
                columns: ["№ KV", "Название элемента"],
                items: {
                    type: FIELD_TYPES.STRING,
                    default: "",
                    description: "Ссылка на элемент модели",
                },
                dependencies: [TABS.ELEMENTS.id],
                rows: amplitudeReferenceRows,
                summary: amplitudeReferenceSummary,
            },
        },
        generator: {
            title: "Генератор временных зависимостей",
            historyFile: "_генератор_амплитуд.txt",
            defaultTarget: "amplitude",
            synchronizedProperties: ["impuls"],
            targets: [{
                value: "amplitude",
                label: "Амплитуда",
                property: "impuls",
                column: 1,
            }],
        },
        graph: {
            title: "Графики амплитуд",
            recordLabel: "Амплитуда",
            defaultMode: "amplitude",
            modes: [{
                value: "amplitude",
                label: "Амплитуда",
                property: "impuls",
                x: { column: 0, title: "Время" },
                y: { title: "Амплитуда" },
                series: [{ column: 1, label: "Амплитуда" }],
            }],
        },
    },

    properties: {

        impuls: {
            type: FIELD_TYPES.ARRAY,
            view: VIEW_TYPES.TABLE,
            label: "Амплитуда",
            description: "Узловые значения временной зависимости векторов заданных источников",
            default: [],
            digits: 6,
            nColumns: 2,
            columns: ["Время", "Амплитуда",],
            items: {
                type: FIELD_TYPES.FLOAT,
                default: 0,
                digits: 6,
                description: "Amplitude value",
            },
            summary: impulsePairsSummary,
        },

        n: {
            type: FIELD_TYPES.INTEGER,
            label: "Число узлов",
            description: "Число строк таблицы амплитуды",
            default: 0,
            readonly: true,
            hidden: true,
            computeStored: {
                dependencies: ["impuls"],
                evaluate: ({ values }) => nodeCount(values.impuls),
            },
        },

    }
});
