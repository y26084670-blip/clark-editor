// services/solver/geometryKv.js
// Источник: julia, src/core/03_kv.jl, функция unpack(me::Kv). Снимок 2026-08.

import { norm, realEpsilon, QUALITY_EPS_FACTOR } from "./geometryShape.js";
import { edgeVectors, jacobianColumns, det3, certifyJacobian, cellQuality, twistAngles } from "./hexJacobian.js";

const GRAD2RADIAN = Math.PI / 180;

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
export function validateKvVerticesDetailed(vertices, profile = {}) {
    const checks = {}, measurements = {}, warnings = [];
    const result = extra => ({ valid: Object.values(checks).every(Boolean),
        malformed: false, invalidSettings: false, checks, measurements, warnings, ...extra });
    if (!Array.isArray(vertices) || vertices.length !== 8
        || !Array.from(vertices).every(isVertex)) return result({ valid: false, malformed: true });
    const doubleFloat = profile?.doubleFloat !== false;
    const convert = doubleFloat ? Number : Math.fround;
    const eps = realEpsilon(doubleFloat);
    const input = vertices.map(v => v.map(convert));
    if (!input.every(v => v.every(Number.isFinite))) return result({ valid: false, malformed: true });
    const rawEdges = edgeVectors(input);
    const scale = Math.max(...rawEdges.flat(2).map(Math.abs));
    checks.volume = scale > 0 && Number.isFinite(scale);
    checks.orientation = true;
    checks.jacobian = true;
    if (!checks.volume) return result();
    const edges = rawEdges.map(row => row.map(v => v.map(x => x/scale)));
    const affine = rawEdges.every(row => row.every(v => v.every((x,i)=>x===row[0][i])));
    const sample = p => jacobianColumns(edges,p);
    let minDet = Infinity;
    const detAt = (p, interior) => {
        const columns = sample(p), value = det3(columns);
        const tolerance = 64*eps*columns.reduce((product,v)=>product*norm(v),1);
        if (interior) {
            minDet = Math.min(minDet,value);
            if (value <= tolerance) checks.jacobian = false;
        }
        if (value < -tolerance) checks.orientation = false;
        return value;
    };
    const gauss = [(1-1/Math.sqrt(3))/2, (1+1/Math.sqrt(3))/2];
    let volume = 0;
    for (const x of gauss) for (const y of gauss) for (const z of gauss) volume += detAt([x,y,z],true)/8;
    // Multiply progressively: scale³ itself may overflow for an anisotropic cell.
    const physicalVolume = convert(((volume*scale)*scale)*scale);
    checks.volume = physicalVolume > 0 && Number.isFinite(physicalVolume);
    const grid = Array.from({length:27},(_,i)=>detAt([i%3/2,Math.floor(i/3)%3/2,Math.floor(i/9)/2],i===13));
    const bound = 4096*Number.EPSILON*edges.reduce((s,row)=>s*Math.max(...row.map(norm)),1);
    const certificate = certifyJacobian(input,grid,bound);
    if (certificate.status === "inverted") checks.orientation = false;
    if (certificate.status === "singular") checks.jacobian = false;
    if (certificate.status === "unresolved") checks.certified = false;
    measurements.certificate = certificate;
    measurements.jacobian = { value: minDet, limit: 0, comparison: ">", unit: "" };
    measurements.volume = { value: physicalVolume, limit: 0, comparison: ">", unit: "мм³" };
    const angles = twistAngles(edges);
    measurements.twist = angles;
    const maximum = Math.max(...angles.map(a=>Math.abs(a ?? 0)));
    if (maximum > 90+256*Number.EPSILON*180) {
        const axis = angles.findIndex(a=>Math.abs(a)===maximum)+1;
        warnings.push(`Скручивание ШГ по D${axis}: ${angles[axis-1].toFixed(2)}° (предел 90°).`);
    }
    if (!Object.values(checks).every(Boolean)) return result();
    const dp = profile?.dp ?? [1,1,1];
    if (dp.length === 3 && dp.every(n=>Number.isSafeInteger(n) && n>=1)) {
        let q = 1, rho = 1;
        const nodes = affine ? [.5] : gauss;
        for (const x of nodes) for (const y of nodes) for (const z of nodes) {
            const quality=cellQuality(sample([x,y,z]),dp);
            q=Math.min(q,quality.q); rho=Math.min(rho,quality.rho);
        }
        measurements.quality={q,rho};
        if (Math.min(q,rho)<QUALITY_EPS_FACTOR*eps) warnings.push(
            `Тонкий или сильно скошенный ЭО: q = ${q.toPrecision(3)}, σmin/σmax = ${rho.toPrecision(3)} (D1–D3: ${dp.join("×")}).`);
    }
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
