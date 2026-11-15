import { HTS_EFFECTIVE_DEFAULTS, HTS_PARAMETER_NAMES } from "../materials/materialConstants.js";
import {
    legacyMaterialFileName,
    validateLegacyMaterialName,
} from "./legacyMaterialName.js";

export const SUPPORTED_HTS_CONFIG_VERSIONS = Object.freeze([
    201,
    202,
    203,
    204,
]);

export const HTS_PROPERTY_KEYS = Object.freeze([...HTS_PARAMETER_NAMES, "comment"]);

const FLOAT_PATTERN = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/u;
const INTEGER_PATTERN = /^[+-]?\d+$/u;
const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

function asBytes(source, field) {
    if (typeof source === "string") {
        return new TextEncoder().encode(source);
    }
    if (source instanceof ArrayBuffer) {
        return new Uint8Array(source);
    }
    if (ArrayBuffer.isView(source)) {
        return new Uint8Array(
            source.buffer,
            source.byteOffset,
            source.byteLength,
        );
    }
    throw new TypeError(`${field} должен быть строкой, ArrayBuffer или TypedArray.`);
}

function splitByteLines(bytes) {
    const lines = [];
    let start = 0;

    for (let index = 0; index < bytes.length; index += 1) {
        if (bytes[index] !== 0x0a) continue;

        let end = index;
        if (end > start && bytes[end - 1] === 0x0d) end -= 1;
        lines.push(bytes.subarray(start, end));
        start = index + 1;
    }

    let end = bytes.length;
    if (end > start && bytes[end - 1] === 0x0d) end -= 1;
    lines.push(bytes.subarray(start, end));
    return lines;
}

function asciiText(bytes, field) {
    let text = "";
    for (const byte of bytes) {
        if (byte > 0x7f) {
            throw new Error(`${field}: числовое поле должно содержать ASCII.`);
        }
        text += String.fromCharCode(byte);
    }
    return text;
}

class ConfigReader {
    constructor(source) {
        this.lines = splitByteLines(asBytes(source, "config.txt"));
        this.index = 0;
    }

    readLine(field) {
        if (this.index >= this.lines.length) {
            throw new Error(`config.txt оборван: отсутствует строка «${field}».`);
        }
        const line = this.lines[this.index];
        this.index += 1;
        return line;
    }

    skip(field) {
        this.readLine(field);
    }

    readTabToken(field) {
        const line = this.readLine(field);
        const tab = line.indexOf(0x09);
        if (tab < 0) {
            throw new Error(
                `config.txt, «${field}»: отсутствует разделитель табуляции.`,
            );
        }

        const token = asciiText(line.subarray(0, tab), field).trim();
        if (!token) {
            throw new Error(`config.txt, «${field}»: не задано значение.`);
        }
        return token;
    }

    readFloat32(field) {
        const token = this.readTabToken(field);
        if (!FLOAT_PATTERN.test(token)) {
            throw new Error(
                `config.txt, «${field}»: некорректное вещественное значение «${token}».`,
            );
        }

        const value = Math.fround(Number(token));
        if (!Number.isFinite(value)) {
            throw new Error(
                `config.txt, «${field}»: значение вне диапазона Float32.`,
            );
        }
        return value;
    }

    readInt32(field) {
        const token = this.readTabToken(field);
        if (!INTEGER_PATTERN.test(token)) {
            throw new Error(
                `config.txt, «${field}»: некорректное целое значение «${token}».`,
            );
        }

        const value = Number(token);
        if (
            !Number.isSafeInteger(value)
            || value < INT32_MIN
            || value > INT32_MAX
        ) {
            throw new Error(
                `config.txt, «${field}»: значение вне диапазона Int32.`,
            );
        }
        return value;
    }

}

function float32Integer(value, field) {
    // Julia читает эти позиции как Float32, затем присваивает solver INT
    // (Int64). В JavaScript сохраняем весь точно представимый целый диапазон.
    if (!Number.isSafeInteger(value)) {
        throw new Error(`config.txt, «${field}»: ожидалось целое значение.`);
    }
    return value;
}

/**
 * Разбирает материальную секцию позиционного config.txt версий 201–204.
 * Настройки задания и необязательная секция электрической цепи не являются
 * частью характеристики и намеренно не проверяются. Числа читаются как
 * Float32/Int32, независимо от кодировки пояснений после табуляции.
 *
 * @param {string|ArrayBuffer|ArrayBufferView} source
 * @returns {{version:number, property:Object}}
 */
export function parseHtsConfig(source) {
    const reader = new ConfigReader(source);
    const version = reader.readInt32("версия формата");

    if (!SUPPORTED_HTS_CONFIG_VERSIONS.includes(version)) {
        throw new Error(
            `Неподдерживаемая версия config.txt: ${version}; `
            + "ожидалась версия 201, 202, 203 или 204.",
        );
    }

    reader.skip("заголовок модели ВТСП");
    reader.skip("заголовок аппроксимации критического тока");

    const j_HC0 = reader.readFloat32("JHc0");
    const JC0 = reader.readFloat32("Jc0");
    const JCa = reader.readFloat32("Jca");
    const JCb = reader.readFloat32("Jcb");

    reader.skip("заголовок токовой подсистемы");
    const j_type = reader.readInt32("Jtype");
    reader.readFloat32("Jscale");
    const j_gmin = reader.readFloat32("Jgmin");
    // В полном 2XX config перед delta и N присутствует ещё одна числовая позиция.
    // Короткие ранее поддерживаемые записи сразу переходят к двум рабочим полям.
    const third = reader.lines[reader.index + 2];
    if (third && /^[+\-.\d]/u.test(String.fromCharCode(third[0]))) {
        reader.readFloat32("Jgmax");
    }
    const j1_delta = reader.readFloat32("JMOD1delta");
    const j2_n = float32Integer(
        reader.readFloat32("JMOD2N"),
        "JMOD2N",
    );

    reader.skip("заголовок магнитной подсистемы");
    const m_type = float32Integer(
        reader.readFloat32("Mtype"),
        "Mtype",
    );
    reader.readFloat32("Mscale");
    const m_HC0 = reader.readFloat32("MHc0");
    const m1_delta = reader.readFloat32("MMOD1delta");
    reader.readFloat32("MMOD2app");
    reader.readFloat32("MMOD2alpha");
    reader.readFloat32("MMOD2c");
    reader.readFloat32("MMOD2k");
    const m3_Mmax = reader.readFloat32("MMOD3Mmax");

    let m3_a = Math.fround(2);
    let m3_b = Math.fround(1);

    if (version >= 202) {
        m3_a = reader.readFloat32("MMOD3a");
        m3_b = reader.readFloat32("MMOD3b");
    }

    return {
        version,
        property: {
            j_HC0,
            JC0,
            JCa,
            JCb,
            j_ani: HTS_EFFECTIVE_DEFAULTS.j_ani,
            j_type,
            j_gmin,
            j1_delta,
            j2_n,
            m_type,
            m_HC0,
            m1_delta,
            m3_Mmax,
            m3_a,
            m3_b,
            KHabc: 1,
            M3D: false,
        },
    };
}

function decodeCommentLine(source) {
    const bytes = asBytes(source, "comment.txt");
    if (bytes.byteLength === 0) {
        throw new Error("Файл comment.txt пуст.");
    }

    let end = bytes.indexOf(0x0a);
    if (end < 0) end = bytes.length;
    if (end > 0 && bytes[end - 1] === 0x0d) end -= 1;
    const firstLine = bytes.subarray(0, end);

    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(firstLine);
    } catch {
        return new TextDecoder("windows-1251").decode(firstLine);
    }
}

/**
 * Создаёт одну BaseModel-запись ВТСП из каталога legacy-характеристики.
 */
export function parseHtsMaterial({ name, config, comment }) {
    const normalizedName = validateLegacyMaterialName(name);
    const parsed = parseHtsConfig(config);

    return {
        version: parsed.version,
        record: {
            name: normalizedName,
            ...parsed.property,
            comment: decodeCommentLine(comment),
        },
    };
}

function requirePropertyValue(record, key) {
    if (key === "j_ani" && !Object.hasOwn(record, key)) {
        return HTS_EFFECTIVE_DEFAULTS.j_ani;
    }
    const value = record[key];

    if (key === "comment") {
        if (typeof value !== "string") {
            throw new Error("Комментарий характеристики ВТСП должен быть строкой.");
        }
        return value;
    }
    if (key === "M3D" || key === "j_ani") {
        if (typeof value !== "boolean") {
            throw new Error(`${key} характеристики ВТСП должен быть логическим значением.`);
        }
        return value;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`${key} характеристики ВТСП должен быть конечным числом.`);
    }
    if ((key === "j_type" || key === "j2_n" || key === "m_type") &&
        !Number.isInteger(value)) {
        throw new Error(`${key} характеристики ВТСП должен быть целым числом.`);
    }
    return value;
}

export function htsMaterialStorageRecord(record) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
        throw new TypeError("Характеристика ВТСП должна быть объектом.");
    }

    return Object.fromEntries(
        HTS_PROPERTY_KEYS.map(key => [key, requirePropertyValue(record, key)]),
    );
}

export function serializeHtsMaterial(record) {
    return `${JSON.stringify(htsMaterialStorageRecord(record))}\n`;
}

export function createHtsMaterialFile(record, { version } = {}) {
    const data = htsMaterialStorageRecord(record);
    return {
        kind: "HTS",
        name: record.name,
        fileName: legacyMaterialFileName(record.name),
        record,
        data,
        legacyVersion: version,
        text: `${JSON.stringify(data)}\n`,
    };
}
