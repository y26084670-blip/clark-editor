import { decodeLegacyCharacterCodes } from "./legacyCharacterTable.js";
import { FMM_MIN_TABLE_ROWS } from "../materials/materialConstants.js";
import {
    legacyMaterialFileName,
    validateUniqueLegacyMaterialNames,
} from "./legacyMaterialName.js";

export const XAP_RECORD_FLOATS = 547;
export const XAP_RECORD_BYTES = XAP_RECORD_FLOATS * Float32Array.BYTES_PER_ELEMENT;
export const XAP_TABLE_ROWS = 12; // Fixed layout of legacy binary XAP.lib only.

const NAME_OFFSET = 0;
const TEXT_FIELD_LENGTH = 256;
const TABLE_OFFSET = 256;
const HIP_OFFSET = 280;
const COMMENT_OFFSET = 288;

function asDataView(source) {
    if (source instanceof ArrayBuffer) {
        return new DataView(source);
    }
    if (ArrayBuffer.isView(source)) {
        return new DataView(
            source.buffer,
            source.byteOffset,
            source.byteLength,
        );
    }
    throw new TypeError("XAP.lib должен быть передан как ArrayBuffer или TypedArray.");
}

function readFloat(view, recordOffset, floatIndex, field) {
    const value = view.getFloat32(
        recordOffset + floatIndex * Float32Array.BYTES_PER_ELEMENT,
        true,
    );

    if (!Number.isFinite(value)) {
        throw new Error(`${field}: получено нечисловое или бесконечное значение.`);
    }

    return value;
}

function readCharacterField(view, recordOffset, floatOffset, field) {
    const values = Array.from(
        { length: TEXT_FIELD_LENGTH },
        (_, index) => readFloat(
            view,
            recordOffset,
            floatOffset + index,
            field,
        ),
    );

    return decodeLegacyCharacterCodes(values, { field });
}

function parseRecord(view, recordIndex) {
    const recordOffset = recordIndex * XAP_RECORD_BYTES;
    const recordLabel = `XAP.lib, запись ${recordIndex + 1}`;
    const name = readCharacterField(
        view,
        recordOffset,
        NAME_OFFSET,
        `${recordLabel}, имя`,
    );
    const tabl = Array.from({ length: XAP_TABLE_ROWS }, (_, row) => [
        readFloat(
            view,
            recordOffset,
            TABLE_OFFSET + row * 2,
            `${recordLabel}, H[${row + 1}]`,
        ),
        readFloat(
            view,
            recordOffset,
            TABLE_OFFSET + row * 2 + 1,
            `${recordLabel}, M[${row + 1}]`,
        ),
    ]);
    const storedHip = readFloat(
        view,
        recordOffset,
        HIP_OFFSET,
        `${recordLabel}, hip`,
    );
    const comment = readCharacterField(
        view,
        recordOffset,
        COMMENT_OFFSET,
        `${recordLabel}, комментарий`,
    );

    return {
        name,
        tabl,
        hip: storedHip - 1,
        comment,
    };
}

/**
 * Преобразует XAP.lib в RECORDS BaseModel для вкладки ФММ.
 *
 * @param {ArrayBuffer|ArrayBufferView} source
 * @returns {Array<{name:string, tabl:number[][], hip:number, comment:string}>}
 */
export function parseXapLibrary(source) {
    const view = asDataView(source);

    if (view.byteLength === 0) {
        throw new Error("XAP.lib пуст.");
    }
    if (view.byteLength % XAP_RECORD_BYTES !== 0) {
        throw new Error(
            `Размер XAP.lib (${view.byteLength} байт) не кратен размеру `
            + `записи ${XAP_RECORD_BYTES} байт.`,
        );
    }

    const records = Array.from(
        { length: view.byteLength / XAP_RECORD_BYTES },
        (_, index) => parseRecord(view, index),
    );
    const names = validateUniqueLegacyMaterialNames(
        records.map(record => record.name),
    );

    return records.map((record, index) => ({
        ...record,
        name: names[index],
    }));
}

function requireFinite(value, field) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`${field} должно быть конечным числом.`);
    }
    return value;
}

export function fmmMaterialStorageRecord(record) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
        throw new TypeError("Характеристика ФММ должна быть объектом.");
    }
    if (!Array.isArray(record.tabl) || record.tabl.length < FMM_MIN_TABLE_ROWS) {
        throw new Error(`Таблица ФММ должна содержать не менее ${FMM_MIN_TABLE_ROWS} строк.`);
    }

    const rows = record.tabl.map((row, rowIndex) => {
        if (!Array.isArray(row) || row.length !== 2) {
            throw new Error(
                `Строка ${rowIndex + 1} таблицы ФММ должна содержать H и M.`,
            );
        }
        return [
            requireFinite(row[0], `H[${rowIndex + 1}]`),
            requireFinite(row[1], `M[${rowIndex + 1}]`),
        ];
    });

    if (typeof record.comment !== "string") {
        throw new Error("Комментарий характеристики ФММ должен быть строкой.");
    }

    return {
        // Column-major — действующий JSON-контракт solver JSON_PropFMM.
        tabl: [
            ...rows.map(row => row[0]),
            ...rows.map(row => row[1]),
        ],
        hip: requireFinite(record.hip, "hip"),
        comment: record.comment,
    };
}

export function serializeFmmMaterial(record) {
    return `${JSON.stringify(fmmMaterialStorageRecord(record))}\n`;
}

export function createFmmMaterialFile(record) {
    const data = fmmMaterialStorageRecord(record);
    return {
        kind: "FMM",
        name: record.name,
        fileName: legacyMaterialFileName(record.name),
        record,
        data,
        text: `${JSON.stringify(data)}\n`,
    };
}
