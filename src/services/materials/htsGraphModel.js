import {
    htsCriticalCurrent,
    htsElectricField,
    htsInitialContact,
    htsMagneticEnvelope,
    htsMagneticValue,
} from "../solver/htsMaterialLaw.js";

export const HTS_GRAPH_KINDS = Object.freeze(["jc", "ej", "mh"]);
const SAMPLES = 400;

export function graphNumber(value) {
    return Number.isFinite(value)
        ? new Intl.NumberFormat("ru-RU", { maximumSignificantDigits: 5 }).format(value)
        : "—";
}

function finite(p, names) {
    for (const name of names) {
        if (!Number.isFinite(p[name])) throw new Error(`${name}: требуется конечное число.`);
    }
}

function positive(p, names) {
    finite(p, names);
    for (const name of names) {
        if (!(p[name] > 0)) throw new Error(`${name}: требуется значение больше нуля.`);
    }
}

function nonnegative(p, names) {
    finite(p, names);
    for (const name of names) {
        if (p[name] < 0) throw new Error(`${name}: требуется неотрицательное значение.`);
    }
}

function currentParameters(p) {
    positive(p, ["j_HC0"]);
    nonnegative(p, ["JC0"]);
    finite(p, ["JCa", "JCb"]);
}

function samples(range, knots = []) {
    const [min, max] = range;
    if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min)) {
        throw new Error("Некорректный диапазон графика.");
    }
    return [...new Set([
        ...Array.from({ length: SAMPLES + 1 }, (_, i) => min + (max - min) * i / SAMPLES),
        ...knots.filter(x => x >= min && x <= max),
    ])].sort((a, b) => a - b);
}

function dataset(label, points, color) {
    if (points.some(p => !Number.isFinite(p.x) || (p.y !== null && !Number.isFinite(p.y)))) {
        throw new Error("Значения кривой выходят за числовой диапазон. Измените параметры или масштаб.");
    }
    return {
        label, data: points, borderColor: color, backgroundColor: color,
        borderWidth: 2, pointRadius: 0, pointHitRadius: 5, fill: false,
        // The limiting loop returns along decreasing H. Let Chart.js detect
        // the unsorted x sequence rather than assuming sorted pre-parsed data.
        parsing: true, tension: 0,
    };
}

export function htsGraphModel(kind, p, beff = 0, visibleX = null) {
    try {
        if (!p) return { error: "Выберите характеристику в таблице." };
        let xRange, xLabel, yLabel, datasets, note = "";
        if (kind === "jc" || kind === "ej") {
            currentParameters(p);
            const jc = htsCriticalCurrent(p, beff);
            if (kind === "jc") {
                xRange = [0, 1.5 * p.j_HC0];
                xLabel = "b_eff = B_eff/μ₀, кА/м";
                yLabel = "Jc, А/мм²";
                datasets = [dataset("Критическая плотность тока", samples(visibleX ?? xRange, [p.j_HC0, beff])
                    .map(x => ({ x, y: htsCriticalCurrent(p, x) })), "#6db8ff")];
            } else {
                positive(p, ["JC0", "j_gmin"]);
                if (![1, 2].includes(p.j_type)) throw new Error("j_type: поддерживаются модели 1 и 2.");
                if (p.j_type === 1) positive(p, ["j1_delta"]);
                else {
                    nonnegative(p, ["j2_n"]);
                    if (!Number.isInteger(p.j2_n)) throw new Error("j2_n: требуется целое число.");
                }
                xRange = [0, 2 * p.JC0];
                xLabel = "J, А/мм²";
                yLabel = "E, В/м";
                datasets = [dataset("Электрическое поле", samples(visibleX ?? xRange, [jc])
                    .map(x => ({ x, y: htsElectricField(p, x, beff) })), "#efbc68")];
                if (jc === 0) note = "Jc = 0: нулевая ветвь E(J) решателя.";
            }
        } else if (kind === "mh") {
            positive(p, ["m_HC0"]);
            xRange = [-1.2 * p.m_HC0, 1.2 * p.m_HC0];
            xLabel = "H вдоль c, кА/м";
            yLabel = "M, кА/м";
            const nodes = samples(visibleX ?? xRange, [-p.m_HC0, 0, p.m_HC0]);
            if (p.m_type === 1) {
                positive(p, ["m1_delta"]);
                datasets = [dataset("M(H), tanh", nodes.map(x => ({ x, y: htsMagneticValue(p, x) })), "#79d6b2")];
                note = "Модель tanh без гистерезиса.";
            } else if (p.m_type === 3) {
                nonnegative(p, ["m3_Mmax"]);
                finite(p, ["m3_a", "m3_b"]);
                const contact = htsInitialContact(p);
                const loop = [
                    ...nodes.map(x => ({ x, y: -htsMagneticEnvelope(p, x) })),
                    // Noncompact envelopes do not meet at finite H. A gap avoids
                    // inventing a vertical reversal segment at the viewport edge.
                    ...(htsMagneticEnvelope(p, nodes.at(-1)) === 0 ? [] : [{ x: nodes.at(-1), y: null }]),
                    ...nodes.slice().reverse().map(x => ({ x, y: htsMagneticEnvelope(p, x) })),
                ];
                if (htsMagneticEnvelope(p, nodes[0]) === 0) loop.push({ ...loop[0] });
                datasets = [
                    dataset("Предельная петля", loop, "#79d6b2"),
                    dataset("Начальная линия", [{ x: 0, y: 0 }, { x: contact, y: -contact }], "#f391a9"),
                ];
                note = `Начальная линия: H = ${graphNumber(contact)} кА/м до предельной кривой.`;
            } else throw new Error(p.m_type === 2
                ? "m_type = 2: модель зарезервирована."
                : "m_type: поддерживаются модели 1 и 3.");
        } else throw new Error("Неизвестный график ВТСП.");
        if (!xRange.every(Number.isFinite) || !(xRange[1] > xRange[0])) {
            throw new Error("Некорректный диапазон графика.");
        }
        return { xRange, xLabel, yLabel, datasets, note };
    } catch (error) {
        return { error: error.message };
    }
}

export function zoomGraphRange(range, factor, anchor = (range[0] + range[1]) / 2, nonnegativeX = false) {
    let min = anchor + (range[0] - anchor) * factor;
    let max = anchor + (range[1] - anchor) * factor;
    if (nonnegativeX && min < 0) { max -= min; min = 0; }
    const span = max - min;
    return Number.isFinite(min) && Number.isFinite(max) && Number.isFinite(span)
        && span > 32 * Number.EPSILON * Math.max(Math.abs(min), Math.abs(max), Number.MIN_VALUE)
        ? [min, max] : range;
}

export function panGraphRange(range, offset, nonnegativeX = false) {
    const applied = nonnegativeX ? Math.max(offset, -range[0]) : offset;
    const result = range.map(x => x + applied);
    return result.every(Number.isFinite) && result[1] > result[0] ? result : range;
}
