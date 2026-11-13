// services/solver/geometryKv.js
// Источник: julia, src/core/03_kv.jl, функция unpack(me::Kv). Снимок 2026-08.

const GRAD2RADIAN = Math.PI / 180;

function difference(left, right) {
    return [
        left[0] - right[0],
        left[1] - right[1],
        left[2] - right[2],
    ];
}

function cross(left, right) {
    return [
        left[1] * right[2] - left[2] * right[1],
        left[2] * right[0] - left[0] * right[2],
        left[0] * right[1] - left[1] * right[0],
    ];
}

function dot(left, right) {
    return left[0] * right[0]
        + left[1] * right[1]
        + left[2] * right[2];
}

function norm(vector) {
    return Math.hypot(vector[0], vector[1], vector[2]);
}

function isVertex(vertex) {
    return Array.isArray(vertex)
        && vertex.length === 3
        && Array.from(vertex).every(Number.isFinite);
}

export const KV_GEO_FIELDS = {
    0: ["v1x","v1y","v1z","v2x","v2y","v2z","v3x","v3y","v3z","v4x","v4y","v4z",
        "v5x","v5y","v5z","v6x","v6y","v6z","v7x","v7y","v7z","v8x","v8y","v8z"],
    1: ["x1","r1","x2","r2","x3","r3","x4","r4","dvi"],
    2: ["Lx","Ly","Lz"],
    3: ["Hx","Ly","Lz","Ly2","Lz2"],
    4: ["L15","L37","Z037","DY","H","YV","ZV"],
};

export const KV_GEO_LENGTH = 24;   // zeros(REAL, 3 * 8)

// Объёмная проверка Q1 во всех режимах, включая автоматический выбор 2D-оператора.
// Контрольные точки выявляют вырождение/инверсии, но не сертифицируют всю карту.
export function validateKvVerticesDetailed(vertices, profile = {}) {
    const checks = {}, measurements = {}, warnings = [];
    const result = extra => ({ valid: Object.values(checks).every(Boolean),
        malformed: false, invalidSettings: false, checks, measurements, warnings, ...extra });
    if (!Array.isArray(vertices) || vertices.length !== 8
        || !Array.from(vertices).every(isVertex)) return result({ valid: false, malformed: true });
    const doubleFloat = profile?.doubleFloat !== false;
    const convert = doubleFloat ? x => x : Math.fround;
    const eps = doubleFloat ? Number.EPSILON : 2 ** -23;
    const input = vertices.map(v => v.map(convert));
    if (!input.every(v => v.every(Number.isFinite))) return result({ valid: false, malformed: true });
    const xyz = input.map(v => difference(v, input[0]));
    const scale = Math.max(...xyz.flat().map(Math.abs));
    checks.volume = scale > 0 && Number.isFinite(scale);
    checks.orientation = true;
    checks.jacobian = true;
    if (!checks.volume) return result();
    const centered = xyz.map(v => v.map(x => x / scale));
    let minQuality = Infinity, minDet = Infinity;
    function determinant(x, y, z, interior = true) {
        const parameters = [x, y, z];
        const columns = Array.from({ length: 3 }, () => [0, 0, 0]);
        for (let v = 0; v < 8; v++) for (let a = 0; a < 3; a++) {
            let weight = (v >> a) & 1 ? 1 : -1;
            for (let b = 0; b < 3; b++) if (a !== b)
                weight *= (v >> b) & 1 ? parameters[b] : 1 - parameters[b];
            for (let d = 0; d < 3; d++) columns[a][d] += centered[v][d] * weight;
        }
        const value = dot(columns[0], cross(columns[1], columns[2]));
        const lengths = columns.map(norm), tolerance = 64 * eps * lengths.reduce((a, b) => a * b, 1);
        if (!Number.isFinite(value) || value < -tolerance) checks.orientation = false;
        if (!Number.isFinite(value) || (interior && value <= tolerance)) checks.jacobian = false;
        if (interior) {
            minQuality = Math.min(minQuality, value / Math.max(...lengths) ** 3);
            minDet = Math.min(minDet, value);
        }
        return value;
    }
    const gauss = [(1 - 1 / Math.sqrt(3)) / 2, (1 + 1 / Math.sqrt(3)) / 2];
    let volume = 0;
    for (const x of gauss) for (const y of gauss) for (const z of gauss)
        volume += determinant(x, y, z) / 8;
    const physicalVolume = convert(volume * scale ** 3);
    checks.volume = physicalVolume > 0 && Number.isFinite(physicalVolume);
    for (const x of [0, .5, 1]) for (const y of [0, .5, 1]) for (const z of [0, .5, 1])
        determinant(x, y, z, x === .5 && y === .5 && z === .5);
    measurements.jacobian = { value: minDet, limit: 0, comparison: ">", unit: "" };
    measurements.volume = { value: physicalVolume, limit: 0, comparison: ">", unit: "мм³" };
    if (Object.values(checks).every(Boolean) && minQuality < 1024 * eps)
        warnings.push("Тонкий или сильно скошенный ШГ: возможна потеря точности геометрии в выбранной разрядности");
    return result();
}

export function validateKvVertices(vertices, profile = {}) {
    return validateKvVerticesDetailed(vertices, profile).valid;
}

// geo -> вершины [8][3] (kv38, локальная СК). Возврат { vertices, err }.
export function unpackKvVertices(geo, geoType) {
    const v = Array.from({ length: 8 }, () => [0, 0, 0]);
    let err = 0;

    // Шестигранник
    if (geoType === 0) {
        for (let k = 0; k < 8; k++) {
            v[k] = [geo[3 * k], geo[3 * k + 1], geo[3 * k + 2]];
        }
        return { vertices: v, err };
    }

    // Сектор
    if (geoType === 1) {
        const [x1, r1, x2, r2, x3, r3, x4, r4, dvi] = geo.slice(0, 9);
        const xsh = [x1, x2, x3, x4];
        const rsh = [r1, r2, r3, r4];
        const a = (dvi / 2) * GRAD2RADIAN;
        const TNG8 = Math.sin(a) / Math.cos(a);

        let kzz = 0;
        if (rsh[0] === rsh[1] && rsh[2] === rsh[3]) kzz = 1;
        if (xsh[0] === xsh[3] && xsh[1] === xsh[2]) kzz = 2;
        err = kzz === 0 ? 1 : 0;
        if (kzz === 1 && (rsh[1] >= rsh[2] || xsh[0] > xsh[1] || xsh[3] > xsh[2])) err = 2;
        if (kzz === 2 && xsh[3] >= xsh[1]) err = 21;
        if (kzz === 2 && rsh[0] > rsh[3]) err = 22;
        if (kzz === 2 && rsh[1] > rsh[2]) err = 23;
        if (err !== 0) kzz = 1;

        const MSE1 = [2, 6, 5, 1];
        const MSE2 = [7, 8, 6, 5];
        for (let i = 0; i <= 1; i++) {
            const rr = TNG8 * Math.pow(-1, i + kzz);
            for (let k = 0; k < 4; k++) {
                let m = kzz === 1 ? MSE1[k] + 2 * i : 0;
                if (kzz === 2) m = MSE2[k] - 4 * i;
                v[m - 1] = [xsh[k], rsh[k] * rr, rsh[k]];   // julia: 1-based m
            }
        }
        return { vertices: v, err };
    }

    // Прямоугольная призма
    if (geoType === 2) {
        const [Lx, Ly, Lz] = geo.slice(0, 3);
        err = Lx > 0 && Ly > 0 && Lz > 0 ? 0 : 1;
        for (const m of [2, 4, 6, 8]) v[m - 1][0] = Lx;
        for (const m of [1, 2, 3, 4]) v[m - 1][1] = Ly;
        for (const m of [3, 4, 7, 8]) v[m - 1][2] = Lz;
        return { vertices: v, err };
    }

    // Усечённая правильная пирамида
    if (geoType === 3) {
        const [Hx, Ly, Lz, Ly2, Lz2] = geo.slice(0, 5);
        err = Hx > 0 && Ly > 0 && Lz > 0 && Ly2 > 0 && Lz2 > 0
            ? 0
            : 1;
        for (const m of [1, 3, 5, 7]) v[m - 1][0] = 0;
        for (const m of [2, 4, 6, 8]) v[m - 1][0] = Hx; 
        for (const m of [1, 3]) v[m - 1][1] = Ly;
        for (const m of [5, 7]) v[m - 1][1] = 0;
        for (const m of [2, 4]) v[m - 1][1] = (Ly + Ly2) / 2;
        for (const m of [6, 8]) v[m - 1][1] = (Ly - Ly2) / 2;
        for (const m of [1, 5]) v[m - 1][2] = 0;
        for (const m of [3, 7]) v[m - 1][2] = Lz;
        for (const m of [4, 8]) v[m - 1][2] = (Lz + Lz2) / 2;
        for (const m of [2, 6]) v[m - 1][2] = (Lz - Lz2) / 2;
        return { vertices: v, err };
    }

    // Неправильная пирамида
    if (geoType === 4) {
        const [L15, L37, Z037, DY, H, YV, ZV] = geo.slice(0, 7);
        err = L15 > 0 && L37 > 0 && DY > 0 ? 0 : 1;
        for (const m of [1, 3, 5, 7]) v[m - 1][0] = 0;
        for (const m of [2, 4, 6, 8]) v[m - 1][0] = -H;
        for (const m of [1, 5]) v[m - 1][1] = 0;
        for (const m of [3, 7]) v[m - 1][1] = DY;
        for (const m of [2, 4, 6, 8]) v[m - 1][1] = YV;
        v[0][2] = L15;
        v[4][2] = 0;
        v[2][2] = Z037 + L37;
        v[6][2] = Z037;
        for (const m of [2, 4, 6, 8]) v[m - 1][2] = ZV;
        return { vertices: v, err };
    }

    return { vertices: v, err: -1 };
}

// Обратное преобразование для geoType = 0 (не запрошено и не нужно)
export function packKvVertices(vertices) {
    const geo = new Array(KV_GEO_LENGTH).fill(0);
    for (let k = 0; k < 8; k++) {
        geo[3 * k] = vertices[k][0];
        geo[3 * k + 1] = vertices[k][1];
        geo[3 * k + 2] = vertices[k][2];
    }
    return geo;
}

// Смена варианта geo: состав позиций определяется geoType; переноса значений нет.
// Источник: julia, src/core/03_kv.jl::unpack — читает geo[1:k] по типу, хвост не используется.
// Примеры ниже выбраны для Editor, а не перенесены из solver. Все используемые
// параметры ненулевые; неиспользуемый хвост буфера по-прежнему заполнен нулями.
export function resetKvGeo(geoType) {
    if (geoType === 0) {
        // Куб 10 мм с координатами 1…11 мм, в порядке вершин solver.
        const { vertices } = unpackKvVertices([10, 10, 10], 2);
        return packKvVertices(vertices.map(vertex => vertex.map(value => value + 1)));
    }

    const examples = {
        1: [1, 10, 21, 10, 21, 15, 1, 15, 30],
        2: [10, 15, 20],
        3: [20, 15, 10, 8, 6],
        4: [10, 6, 2, 12, 15, 6, 5],
    };
    const values = Number.isInteger(geoType) ? examples[geoType] : null;
    return Array.from({ length: KV_GEO_LENGTH }, (_, index) => values?.[index] ?? 0);
}
