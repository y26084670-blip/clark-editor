import { GEOMETRY_VALIDATION_DEFAULTS } from "../solver/geometryValidationSettings.js";
/*
Источник: solver/src/core/types.jl, Conrab; startITER и fullJNewton — логические параметры.
Файл содержит две RECORDS-записи: Float32, затем Float64.
Каждая запись GUI содержит 12 полей: 11 расчётных и собственный GEO_ANGLE.
Отсутствующие поля получают default схемы.
*/
import {
    TABS,
    STORAGE_TYPES,
    FIELD_TYPES,
    FILES,
} from "../../services/schemas/common/constants";
import { createSchema } from "../schemaFactory";

export default createSchema({
    id: TABS.CONRAB.id,
    title: TABS.CONRAB.label,
    file: FILES.CONRAB,
    storage: STORAGE_TYPES.RECORDS,
    required: true,
    recordCount: 2,
    singleRecordFallback: {
        message: "При загрузке файла 'conrab.txt' найдена одна строка. "
            + "Значения продублированы для Float32 и Float64; "
            + "при сохранении будут записаны обе строки.",
    },
    obsoleteStoragePaths: ["KPY", "KB2", "B20", "KEPS2", "KEPS3", "KEPS4",
        "EPS_0", "TAU_0", "KB1", "KEPS1", "CF_KEPS", "DIPOLE_FLOAT32"],
    rowLabelDescription: "Параметры математической модели",
    rowLabelWidth: "auto",

    views: {
        recordsAsColumns: {
            labels: ["Float32", "Float64"],
            activeRecord: {
                dependencies: [TABS.GENERAL.id],
                index({ model }) {
                    const precision = model[TABS.GENERAL.id]?.doubleFloat;
                    return typeof precision === "boolean"
                        ? Number(precision)
                        : null;
                },
            },
        },
    },

    properties: {

        // геометрическая проверка модели
        GEO_ANGLE: {
            type: FIELD_TYPES.FLOAT,
            label: "GEO_ANGLE: Угловой допуск непараллельности, град",
            description: "Максимальное отклонение от параллельности пар 13–24, 15–26, "
                + "15–37, 15–48, 75–68. "
                + "Используется активный профиль Float32 или Float64. Больше 0 и меньше 90°.",
            default: GEOMETRY_VALIDATION_DEFAULTS.GEO_ANGLE,
            exclusiveMinimum: 0,
            exclusiveMaximum: 90,
            digits: 6,
        },
        // итерационный процесс

        startITER: {
            type: FIELD_TYPES.BOOLEAN,
            label: "StartITER: Задание начального приближения",
            description: "Начальное приближение итерационного процесса: "
                + "true — использует нулевые значения; "
                + "false — использует значения предыдущей итерации",
            default: false,
            textOn: "Нулевые значения",
            textOff: "Предыдущая итерация",
        },

        EPS: {
            type: FIELD_TYPES.FLOAT,
            label: "EPS: Критерий выхода из итераций",
            description: "Критерий выхода из итерационного процесса для плотности тока и намагниченности",
            default: 0.005,
            digits: 6,
        },

        TAU: {
            type: FIELD_TYPES.FLOAT,
            label: "TAU: Параметр итераций",
            description: "Параметр итерационного процесса при расчете нового приближения",
            default: 0.3,
            digits: 6,
        },

        EXTRA: {
            type: FIELD_TYPES.BOOLEAN,
            label: "EXTRA: Экстраполяция при итерациях",
            description: "Использование экстраполяции для намагниченности при итерационном процессе",
            default: true,
            textOn: "Использовать",
            textOff: "Не использовать",
        },

        // формирование уравнений

        ADMIN: {
            type: FIELD_TYPES.FLOAT,
            label: "ADMIN: Граница диагоналей",
            description: "Нижнее регулязирующее ограничение диагональных элементов для намагниченности при итерационном процессе",
            default: 0.001,
            digits: 6,
        },

        // интегрирование

        UZMIN: {
            type: FIELD_TYPES.FLOAT,
            label: "UZMIN: Принудительное смещение",
            description: "Регуляризирующее ограничение на расстояние от точки наблюдения до площадки интегрирования при расчете матриц",
            default: 0.005,
            digits: 6,
        },


        LONGD: {
            type: FIELD_TYPES.FLOAT,
            label: "LONGD: Коэффициент условия дальней зоны",
            description: "Коэффициент перехода к квадратуре дальней зоны: LONGD * |SY| <= YY; SY—интервал интегрирования, YY — расстояние в плоскости y–z от точки наблюдения до начала интервала",
            default: 200,
            digits: 6,
        },

        DIPOLE_RTOL: {
            type: FIELD_TYPES.FLOAT,
            label: "DIPOLE_RTOL: Допуск дипольного приближения",
            description: "Относительный допуск нормы отдельного блока дальней 3D-зоны. "
                + "Радиусы перехода вычисляются по геометрии ЭО отдельно для ядер; "
                + "переключается целый симметричный образ. Не является допуском "
                + "суммарного поля или нелинейного решения. Конечное число от 0 "
                + "включительно до 1 исключительно; 0 отключает приближение. "
                + "По умолчанию 0.001 в каждом профиле. Разрядность совпадает "
                + "с разрядностью интегрирования выбранного решателя.",
            default: 0.001,
            minimum: 0,
            exclusiveMaximum: 1,
            digits: 6,
        },

        // материальные уравнения

        CF_FMMEPS: {
            type: FIELD_TYPES.FLOAT,
            label: "CF_FMMEPS: Допуск поиска пробного решения для ФММ, кА/м",
            description: "Абсолютный допуск невязки намагниченности ФММ: "
                + "abs(M из уравнений − M по характеристике) < CF_FMMEPS. "
                + "Конечное положительное число. На насыщенной ветви поиск продолжается "
                + "до неделимого машинного интервала. Не зависит от EPS.",
            default: 0.01,
            exclusiveMinimum: 0,
            digits: 6,
        },

        CF_HTSEPS: {
            type: FIELD_TYPES.FLOAT,
            label: "CF_HTSEPS: Допуск поиска пробного решения для ВТСП, кА/м",
            description: "Абсолютный допуск невязки намагниченности магнитной подсистемы ВТСП: "
                + "abs(M из уравнений − M по характеристике) < CF_HTSEPS. "
                + "Конечное положительное число. На возможном участке ветви M = const поиск "
                + "до неделимого машинного интервала. Не зависит от EPS.",
            default: 0.01,
            exclusiveMinimum: 0,
            digits: 6,
        },

        fullJNewton: {
            type: FIELD_TYPES.BOOLEAN,
            label: "fullJNewton: Полный метод Ньютона [J/λ] для J = const * E",
            description: "Выбор метода решения совместной системы для плотности тока J "
                + "и множителей Лагранжа λ в ШГ с линейными электропроводящими свойствами. "
                + "true — полный метод Ньютона с GMRES всей токовой системы; "
                + "false — упрощённая блочная коррекция: локальные системы 3×3 "
                + "и система Шура для множителей, без внутреннего GMRES. "
                + "В обоих режимах сохраняются полные физические уравнения, ограничения "
                + "и критерии сходимости. Полный режим можно включить для контрольного "
                + "расчёта или при трудностях сходимости упрощённого режима. "
                + "При наличии ВТСП-проводников, в том числе в смешанной задаче, "
                + "для всей токовой системы всегда используется полный метод независимо "
                + "от fullJNewton. Нелинейность только магнитных свойств сама по себе "
                + "не включает полный токовый метод. Параметр не отключает токи "
                + "и не заменяет настройку «Подключить токовую подсистему» (htsRo). "
                + "Значение задаётся отдельно для Float32 и Float64; применяется активный "
                + "профиль. По умолчанию false, в том числе при отсутствии поля в conrab.txt.",
            default: false,
            textOn: "Полный Newton",
            textOff: "Упрощённый Newton",
        },

    },
});
