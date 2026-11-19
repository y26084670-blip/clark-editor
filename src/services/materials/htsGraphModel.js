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

export function electricFieldNumber(value) {
    return Number.isFinite(value) && value !== 0 && (Math.abs(value) >= 1e5 || Math.abs(value) < 1e-3)
        ? new Intl.NumberFormat("ru-RU", { notation: "scientific", maximumSignificantDigits: 5 }).format(value)
        : graphNumber(value);
}

function magneticParameters(p) {
    if (!p) throw new Error("Выберите характеристику в таблице.");
    positive(p, ["m_HC0"]);
    if (p.m_type === 1) positive(p, ["m1_delta"]);
    else if (p.m_type === 3) {
        nonnegative(p, ["m3_Mmax"]); finite(p, ["m3_a", "m3_b"]);
    } else throw new Error(p.m_type === 2
        ? "m_type = 2: модель зарезервирована." : "m_type: поддерживаются модели 1 и 3.");
}

export function htsMagneticStep(p, H, previous = { x: 0, y: 0 }) {
    magneticParameters(p);
    if (![H, previous.x, previous.y].every(Number.isFinite)) throw new Error("H и предыдущее состояние M должны быть конечными.");
    const M = htsMagneticValue(p, H, previous.x, previous.y);
    if (!Number.isFinite(M)) throw new Error("M(H) выходит за числовой диапазон.");
    return { x: H === 0 ? 0 : H, y: M === 0 ? 0 : M };
}

export function htsMagneticTrace(points) {
    return { ...dataset("Траектория", points, "#f6e493"),
        pointRadius: context => context.dataIndex === points.length - 1 ? 3 : 0 };
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

function samples(range, knots = [], logarithmic = false) {
    const [min, max] = range;
    if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min)) {
        throw new Error("Некорректный диапазон графика.");
    }
    if (logarithmic && !(min > 0)) throw new Error("Для логарифмических осей требуется J > 0.");
    return [...new Set([
        ...Array.from({ length: SAMPLES + 1 }, (_, i) => logarithmic
            ? 10 ** (Math.log10(min) + (Math.log10(max) - Math.log10(min)) * i / SAMPLES)
            : min + (max - min) * i / SAMPLES),
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

export function htsGraphModel(kind, p, beff = 0, visibleX = null, { logarithmic = false } = {}) {
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
                xRange = [logarithmic ? Math.max(Number.MIN_VALUE, Math.min(p.JC0, jc > 0 ? jc : p.JC0) * 1e-6) : 0, 2 * p.JC0];
                xLabel = "J, А/мм²";
                yLabel = "E, В/м";
                let points = samples(visibleX ?? xRange, [jc], logarithmic)
                    .map(x => ({ x, y: htsElectricField(p, x, beff) }));
                if (logarithmic) {
                    const count = points.length;
                    points = points.filter(point => point.x > 0 && point.y > 0);
                    if (!points.length) throw new Error(jc === 0
                        ? "Jc = 0: нулевая ветвь E(J) не отображается в логарифмических осях."
                        : "В видимом диапазоне нет положительных значений J и E для логарифмических осей.");
                    if (points.length < count) note = "В логарифмических осях показаны только J > 0 и E > 0.";
                }
                datasets = [dataset("Электрическое поле", points, "#efbc68")];
                if (jc === 0) note = "Jc = 0: нулевая ветвь E(J) решателя.";
            }
        } else if (kind === "mh") {
            magneticParameters(p);
            xRange = [-1.2 * p.m_HC0, 1.2 * p.m_HC0];
            xLabel = "H вдоль c, кА/м";
            yLabel = "M, кА/м";
            const nodes = samples(visibleX ?? xRange, [-p.m_HC0, 0, p.m_HC0]);
            if (p.m_type === 1) {
                datasets = [dataset("M(H), tanh", nodes.map(x => ({ x, y: htsMagneticValue(p, x) })), "#79d6b2")];
                note = "Модель tanh без гистерезиса.";
            } else if (p.m_type === 3) {
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

export function zoomGraphRange(range, factor, anchor, nonnegativeX = false, logarithmic = false) {
    if (logarithmic) return logGraphRange(range, values => zoomGraphRange(values, factor,
        Number.isFinite(anchor) && anchor > 0 ? Math.log10(anchor) : undefined));
    anchor ??= (range[0] + range[1]) / 2;
    let min = anchor + (range[0] - anchor) * factor;
    let max = anchor + (range[1] - anchor) * factor;
    if (nonnegativeX && min < 0) { max -= min; min = 0; }
    const span = max - min;
    return Number.isFinite(min) && Number.isFinite(max) && Number.isFinite(span)
        && span > 32 * Number.EPSILON * Math.max(Math.abs(min), Math.abs(max), Number.MIN_VALUE)
        ? [min, max] : range;
}

export function panGraphRange(range, offset, nonnegativeX = false, logarithmic = false) {
    if (logarithmic) return logGraphRange(range, values => panGraphRange(values, offset));
    const applied = nonnegativeX ? Math.max(offset, -range[0]) : offset;
    const result = range.map(x => x + applied);
    return result.every(Number.isFinite) && result[1] > result[0] ? result : range;
}


function logGraphRange(range, transform) {
    if (!range.every(v => Number.isFinite(v) && v > 0) || !(range[1] > range[0])) return range;
    const result = transform(range.map(Math.log10)).map(v => 10 ** v);
    return result.every(v => Number.isFinite(v) && v > 0) && result[1] > result[0] ? result : range;
}

/** Text equations mirror htsMaterialLaw; shown for the selected material model. */
export function htsGraphFormula(kind, p) {
    if (!p) return { title: "Материал не выбран", lines: [] };
    const shape = "U(x) = max(0, 1 − |x|); u = |x|ᵃ; K(x; a, b) = U(u)ᵇ при b ≥ 0, (1 + u)ᵇ при b < 0. При b = 0: K = 1.";
    const jc = "Jc = JC0 · K(b_eff / j_HC0; JCa, JCb), b_eff = B_eff / μ₀.";
    const units = "b_eff, H, M — кА/м; J, Jc — А/мм²; j_gmin — МСм/м; E — В/м.";
    if (kind === "jc") return { title: "Jc(b_eff)", lines: [jc, shape, units] };
    if (kind === "ej") return { title: `E(J), j_type = ${p.j_type}`, lines: [
        jc,
        ...(p.j_type === 1 ? ["E(J) = 2J / {j_gmin · [1 + exp(U(b_eff / j_HC0) · U(J / Jc) / j1_delta)]}."]
            : p.j_type === 2 ? ["E(J) = (J / j_gmin) · (J / Jc)^(j2_n); показатель степени E по J равен j2_n + 1."]
                : ["Выбранная модель E(J) не поддерживается."]),
        "При Jc ≤ 0 решатель задаёт E(J) = 0.",
        shape, units,
    ] };
    if (kind === "mh") return { title: `M(H), m_type = ${p.m_type}`, lines: [
        ...(p.m_type === 1 ? ["M(H) = H · {2 / [1 + exp(U(H / m_HC0) / m1_delta)] − 1}.", shape, "Модель без гистерезиса."]
            : p.m_type === 3 ? ["F(H) = m3_Mmax · K(H / m_HC0; m3_a, m3_b).",
                "Предельная петля: M = −F(H) при возрастании H; M = +F(H) при убывании H.",
                "Начальная линия: M = −H от (0, 0) до первого H* ≥ 0, для которого H* = F(H*).",
                "Траектория использует предыдущее состояние (H_prev, M_prev). На предельной ветви при продолжении движения сохраняется её знак; иначе M = clip(M_prev − (H − H_prev), −F(H), F(H)).", shape]
                : ["Модель m_type = 2 зарезервирована; график для неё не строится."]),
        "H и M направлены вдоль оси c материала; единицы — кА/м.",
    ] };
    return { title: "Неизвестный график", lines: [] };
}
