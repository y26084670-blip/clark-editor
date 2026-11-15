// Базовая библиотека остаётся readonly; локальная проекция снимает readonly
// в MaterialLibraryTab. Параметры остаются скалярными свойствами записи и
// редактируются в транспонированной таблице деталей.
import {
    FIELD_TYPES,
    STORAGE_TYPES,
    TABS,
} from "./common/constants";
import { createSchema } from "../schemaFactory";
import {
    HTS_EFFECTIVE_DEFAULTS,
    HTS_PARAMETER_NAMES,
} from "../materials/materialConstants";

const scalar = (
    type,
    label,
    description = label,
    defaultValue = type === FIELD_TYPES.BOOLEAN ? false : 0,
) => ({
    type,
    label,
    description,
    default: defaultValue,
    readonly: true,
    hidden: true,
});

export { HTS_PARAMETER_NAMES };

export default createSchema({
    id: TABS.HTS_LIBRARY.id,
    title: TABS.HTS_LIBRARY.label,
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
            columnWidth: 320,
        },

        // критический ток
        j_HC0: scalar(
            FIELD_TYPES.FLOAT,
            "j_HC0",
            "Критическая индукция как B/μ₀, кА/м",
        ),
        JC0: scalar(
            FIELD_TYPES.FLOAT,
            "JC0",
            "Максимальное значение критического тока, А/кв.мм",
        ),
        JCa: scalar(
            FIELD_TYPES.FLOAT,
            "JCa",
            "Первый показатель степени критического тока",
        ),
        JCb: scalar(
            FIELD_TYPES.FLOAT,
            "JCb",
            "Второй показатель степени критического тока",
        ),
        // токовая подсистема
        j_ani: {
            ...scalar(
                FIELD_TYPES.BOOLEAN,
                "Тип токовой подсистемы",
                "true - планарная модель электропроводящих свойств с нулевой X компонентой в плоскости анизотропии, false - изотропные электропроводящие свойства",
                HTS_EFFECTIVE_DEFAULTS.j_ani,
            ),
            textOn: "Планарная",
            textOff: "Изотропная",
        },
        j_type: scalar(
            FIELD_TYPES.INTEGER,
            "j_type",
            "Тип модели: 1 — tanh, 2 — степенная",
        ),
        j_gmin: scalar(
            FIELD_TYPES.FLOAT,
            "j_gmin",
            "Критическая электропроводность, МСм/м",
        ),
        j1_delta: scalar(
            FIELD_TYPES.FLOAT,
            "j1_delta",
            "Параметр DELTA модели tanh",
        ),
        j2_n: scalar(
            FIELD_TYPES.INTEGER,
            "j2_n",
            "Показатель степенной модели для сопротивления: учесть, что это значение на 1 меньше, чем при непосредственном задании степенного закона E=E(J)",
        ),
        // магнитная подсистема
        m_type: scalar(
            FIELD_TYPES.INTEGER,
            "m_type",
            "Тип модели: 1 — tanh, 2 — зарезервировано, "
            + "3 — аппроксимация идеальной характеристики",
        ),
        m_HC0: scalar(
            FIELD_TYPES.FLOAT,
            "m_HC0",
            "Напряжённость критического магнитного поля, кА/м",
        ),
        m1_delta: scalar(
            FIELD_TYPES.FLOAT,
            "m1_delta",
            "Параметр DELTA модели tanh",
        ),
        m3_Mmax: scalar(
            FIELD_TYPES.FLOAT,
            "m3_Mmax",
            "ПК-модель: максимальная намагниченность, кА/м",
        ),
        m3_a: scalar(
            FIELD_TYPES.FLOAT,
            "m3_a",
            "ПК-модель: параметр аппроксимации M(H) a (ver202)",
        ),
        m3_b: scalar(
            FIELD_TYPES.FLOAT,
            "m3_b",
            "ПК-модель: параметр аппроксимации M(H) b (ver202)",
        ),
        // 3d модель
        KHabc: scalar(
            FIELD_TYPES.FLOAT,
            "KHabc",
            "Параметр анизотропии для 3D",
            HTS_EFFECTIVE_DEFAULTS.KHabc,
        ),
        M3D: scalar(
            FIELD_TYPES.BOOLEAN,
            "M3D",
            "Использовать режим 3D",
            HTS_EFFECTIVE_DEFAULTS.M3D,
        ),
        //
        comment: {
            type: FIELD_TYPES.STRING,
            label: "Комментарий",
            description: "Комментарий из файла характеристики",
            default: "",
            readonly: true,
            columnWidth: 620,
        },
    },
});
