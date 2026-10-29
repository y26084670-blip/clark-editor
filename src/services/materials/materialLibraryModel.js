import {
    FMM_MIN_TABLE_ROWS,
    HTS_EFFECTIVE_DEFAULTS,
    HTS_PARAMETER_NAMES,
} from "./materialConstants.js";

function isObject(value) {
    return value !== null &&
        typeof value === "object" &&
        !Array.isArray(value);
}

function recordPayload(record) {
    return isObject(record?.data)
        ? record.data
        : record;
}

function recordName(record, payload) {
    const value = record?.name ?? payload?.name;
    return typeof value === "string" ? value : "";
}

function cloneRecordPayload(record) {
    const payload = recordPayload(record);
    if (!isObject(payload)) {
        throw new TypeError("Характеристика должна быть JSON-объектом.");
    }
    return structuredClone(payload);
}

function transientLibrarySource(record) {
    if (record?.source === "task") {
        return { _taskLibraryRecord: structuredClone(record) };
    }

    const isDefaultRecord =
        isObject(record?.data) &&
        typeof record?.relativePath === "string" &&
        typeof record?.sha256 === "string";
    return isDefaultRecord
        ? { _libraryRecord: structuredClone(record) }
        : {};
}

export function decodeFmmTable(value) {
    if (!Array.isArray(value)) {
        throw new TypeError("Поле tabl характеристики ФММ должно быть массивом.");
    }

    if (value.every(Array.isArray)) {
        if (
            value.length < FMM_MIN_TABLE_ROWS ||
            value.some(row => row.length !== 2)
        ) {
            throw new Error(
                `Таблица ФММ должна содержать не менее ${FMM_MIN_TABLE_ROWS} строк и две колонки H и M.`,
            );
        }
        const rows = structuredClone(value);
        assertFiniteFmmValues(rows.flat());
        return rows;
    }

    if (value.length < 2 * FMM_MIN_TABLE_ROWS || value.length % 2 !== 0) {
        throw new Error(
            `Таблица ФММ должна содержать не менее ${FMM_MIN_TABLE_ROWS} пар H–M и чётное число значений; получено ${value.length}.`,
        );
    }

    assertFiniteFmmValues(value);
    const rowCount = value.length / 2;
    return Array.from(
        { length: rowCount },
        (_, row) => [value[row], value[row + rowCount]],
    );
}

function assertFiniteFmmValues(values) {
    if (values.some(item => !Number.isFinite(item))) {
        throw new Error(
            "Таблица ФММ должна содержать только конечные числовые значения.",
        );
    }
}

export function createHtsMaterialDetailSchema(schema) {
    const properties = Object.fromEntries(
        HTS_PARAMETER_NAMES.map(name => [name, {
            ...schema.properties[name],
            readonly: false,
            hidden: false,
        }]),
    );

    return {
        ...schema,
        config: {
            ...schema.config,
            recordCount: 1,
            rowLabelTitle: "Параметр",
            rowLabelWidth: 130,
        },
        properties,
        views: {
            ...schema.views,
            recordsAsColumns: {
                labels: ["Значение"],
            },
        },
    };
}

export function toFmmLibraryModel(records) {
    if (!Array.isArray(records)) {
        throw new TypeError("Библиотека ФММ должна быть массивом RECORDS.");
    }

    return records.map(record => {
        const payload = cloneRecordPayload(record);
        return {
            ...transientLibrarySource(record),
            name: recordName(record, payload),
            tabl: decodeFmmTable(payload.tabl),
            hip: payload.hip,
            comment: payload.comment ?? "",
        };
    });
}

export function toHtsLibraryModel(records) {
    if (!Array.isArray(records)) {
        throw new TypeError("Библиотека ВТСП должна быть массивом RECORDS.");
    }

    return records.map(record => {
        const payload = cloneRecordPayload(record);
        delete payload.name;
        const currentProperty = Object.fromEntries(
            HTS_PARAMETER_NAMES.map(name => [
                name,
                Object.hasOwn(payload, name)
                    ? payload[name]
                    : HTS_EFFECTIVE_DEFAULTS[name],
            ]),
        );
        return {
            ...transientLibrarySource(record),
            name: recordName(record, payload),
            ...currentProperty,
            comment: payload.comment ?? "",
        };
    });
}
