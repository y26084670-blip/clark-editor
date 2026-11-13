/*
Источник: solver/src/core/types.jl, Conrab; startITER и fullJNewton — логические параметры.
Файл содержит две RECORDS-записи: Float32, затем Float64.
Устаревшие настройки интегратора и угловой допуск при загрузке пропускаются.
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
    obsoleteStoragePaths: ["KPY", "LONGD", "GEO_ANGLE", "KB2", "B20", "KEPS2", "KEPS3", "KEPS4",
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
            label: "(3D): UZMIN: Принудительное смещение",
            description: "Регуляризирующее ограничение на расстояние от точки наблюдения до площадки интегрирования при расчете матриц",
            default: 0.005,
            digits: 6,
        },


        POLAR_EPS_PERCENT: {
            type: FIELD_TYPES.FLOAT,
            label: "(3D): Полярное интегрирование по ЭП, %",
            description: "Целевая относительная погрешность скалярного интеграла и нормы векторного интеграла на одной ЭП в конечной 3D-задаче. Применяется к полярной квадратуре граней всех объёмных шестигранников. Меньший процент увеличивает число узлов. По умолчанию 0,05 %.",
            default: 0.05,
            exclusiveMinimum: 0,
            exclusiveMaximum: 100,
            digits: 8,
        },

        DIPOLE_RTOL: {
            type: FIELD_TYPES.FLOAT,
            label: "(3D): DIPOLE_RTOL: Допуск дипольного приближения",
            description: "Относительный допуск нормы отдельного блока дальней зоны. Используется также для дальнего приближения в чистой 2D-модели. "
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
