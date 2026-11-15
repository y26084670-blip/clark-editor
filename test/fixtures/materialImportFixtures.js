import {
    LEGACY_CHARACTER_TABLE,
} from "../../src/services/materialImport/legacyCharacterTable.js";
import {
    XAP_RECORD_BYTES,
    XAP_RECORD_FLOATS,
    XAP_TABLE_ROWS,
} from "../../src/services/materialImport/xapLibImporter.js";

const reverseCharacterTable = new Map();
LEGACY_CHARACTER_TABLE.forEach((character, code) => {
    if (character !== " " && !reverseCharacterTable.has(character)) {
        reverseCharacterTable.set(character, code);
    }
});
reverseCharacterTable.set(" ", 32);

function writeLegacyText(view, floatOffset, text) {
    const characters = [...text];
    if (characters.length > 256) {
        throw new Error("Fixture legacy text exceeds 256 characters.");
    }

    characters.forEach((character, index) => {
        const code = reverseCharacterTable.get(character);
        if (code === undefined) {
            throw new Error(`Fixture character is not encodable: ${character}`);
        }
        view.setFloat32((floatOffset + index) * 4, code, true);
    });
}

export function buildXapRecord({
    name = "STAL3",
    comment = "Комментарий",
    rows = Array.from(
        { length: XAP_TABLE_ROWS },
        (_, index) => [index + 0.25, (index + 1) * 10],
    ),
    hip = 0.125,
} = {}) {
    if (rows.length !== XAP_TABLE_ROWS) {
        throw new Error(`Fixture requires ${XAP_TABLE_ROWS} rows.`);
    }

    const buffer = new ArrayBuffer(XAP_RECORD_BYTES);
    const view = new DataView(buffer);

    // Явно инициализуем все позиции как Float32: нулевые байты уже дают 0.0.
    for (let index = 0; index < XAP_RECORD_FLOATS; index += 1) {
        view.setFloat32(index * 4, 0, true);
    }

    writeLegacyText(view, 0, name);
    rows.forEach((row, index) => {
        view.setFloat32((256 + index * 2) * 4, row[0], true);
        view.setFloat32((256 + index * 2 + 1) * 4, row[1], true);
    });
    view.setFloat32(280 * 4, hip + 1, true);
    writeLegacyText(view, 288, comment);
    return buffer;
}

export function concatenateBuffers(...buffers) {
    const bytes = new Uint8Array(
        buffers.reduce((size, buffer) => size + buffer.byteLength, 0),
    );
    let offset = 0;

    buffers.forEach((buffer) => {
        bytes.set(new Uint8Array(buffer), offset);
        offset += buffer.byteLength;
    });
    return bytes.buffer;
}

const valueLine = value => `${value}\tfixture`;

export function buildHtsConfig(version, overrides = {}) {
    const values = {
        j_HC0: 2300,
        JC0: 150,
        JCa: 2,
        JCb: 1,
        j_type: 1,
        j_scale: 1,
        j_gmin: 0.01,
        j_gmax: 1e10,
        j1_delta: 0.03,
        j2_n: 21,
        m_type: 3,
        m_scale: 1,
        m_HC0: 54000,
        m1_delta: 0.03,
        m2_app: 1,
        m2_alpha: "1E-4",
        m2_c: 0.7,
        m2_k: 100,
        m3_Mmax: 460,
        m3_a: 1,
        m3_b: 10,
        ...overrides,
    };
    const lines = [
        valueLine(version),
        "******** модель ВТСП ********",
        "аппроксимация критического тока",
        valueLine(values.j_HC0),
        valueLine(values.JC0),
        valueLine(values.JCa),
        valueLine(values.JCb),
        "токовая подсистема",
        valueLine(values.j_type),
        valueLine(values.j_scale),
        valueLine(values.j_gmin),
        valueLine(values.j_gmax),
        valueLine(values.j1_delta),
        valueLine(values.j2_n),
        "магнитная подсистема",
        valueLine(values.m_type),
        valueLine(values.m_scale),
        valueLine(values.m_HC0),
        valueLine(values.m1_delta),
        valueLine(values.m2_app),
        valueLine(values.m2_alpha),
        valueLine(values.m2_c),
        valueLine(values.m2_k),
        valueLine(values.m3_Mmax),
    ];

    if (version >= 202) {
        lines.push(
            valueLine(values.m3_a),
            valueLine(values.m3_b),
            "общие параметры",
            valueLine(1),
            valueLine(0),
        );
    }

    lines.push(
        "******** настройки ********",
        valueLine(0),
        valueLine(0),
        valueLine(0),
        valueLine(0),
        valueLine(0),
        valueLine(0),
        valueLine(0),
        valueLine(0),
        valueLine(0),
        valueLine(0),
    );

    if (version < 202) {
        lines.push(
            "устаревшая настройка 1",
            "устаревшая настройка 2",
            "устаревшая настройка 3",
            "устаревшая настройка 4",
        );
    }

    lines.push(
        valueLine(1),
        valueLine(1),
        valueLine(1),
        valueLine(1),
        valueLine(0),
        valueLine(1),
        valueLine(1),
        valueLine(1),
        valueLine(0),
    );

    if (version >= 204) {
        lines.push(
            "******** уравнение электрической цепи ********",
            valueLine(1),
            "1\tномера катушек",
            valueLine(3),
            "0.0 1.0 10.0\tI-узлы",
            "0.0 2.0 20.0\tU-узлы",
            valueLine(1),
            valueLine(4),
            "0.0 0.1 0.9 1.3\tвремя",
            "0.0 4.1 4.0 0.0\tнапряжение",
            valueLine(0.01),
        );
    }

    return lines.join("\r\n") + "\r\n";
}

export function utf8Bytes(text) {
    return new TextEncoder().encode(text);
}

export function windows1251Bytes(text) {
    const bytes = [];
    for (const character of text) {
        const code = reverseCharacterTable.get(character);
        if (code === undefined) {
            throw new Error(`Fixture character is not encodable: ${character}`);
        }
        bytes.push(code);
    }
    return Uint8Array.from(bytes);
}

export function mockFile(name, source) {
    const bytes = typeof source === "string"
        ? utf8Bytes(source)
        : new Uint8Array(
            source.buffer ?? source,
            source.byteOffset ?? 0,
            source.byteLength,
        );

    return {
        name,
        size: bytes.byteLength,
        async arrayBuffer() {
            return bytes.buffer.slice(
                bytes.byteOffset,
                bytes.byteOffset + bytes.byteLength,
            );
        },
    };
}
