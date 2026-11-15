// Numerical owner: y26084670-blip/solver, commit e17678e18d11ae0ec79d54918bc540ce58f23a95,
// src/core/02_model_hts.jl, blob d8fc3138c498608c116ed67ee41ffc84e4da17df.
// K_BASE/K_POW -> htsBase/htsShape; HTS_JCval -> htsCriticalCurrent;
// htsCurrentResponse (rho) -> htsResistivity; E=rho*J -> htsElectricField;
// htsMagneticComponent -> htsMagneticValue / htsMagneticEnvelope.
// Library units: b_eff=B_eff/mu0, H, M in kA/m; J in A/mm²;
// gamma in MS/m. These units give E in V/m without a conversion factor.
// The magnetic preview is a material characteristic along c, not a field solution.

export const htsBase = x => Math.max(0, 1 - Math.abs(x));

export function htsShape(x, a, b) {
    const u = Math.abs(x) ** a;
    return b >= 0 ? htsBase(u) ** b : 1 / (1 + u) ** (-b);
}

const etanh = (x, delta) => 2 / (1 + Math.exp(x / delta));

export function htsCriticalCurrent(p, beff) {
    return p.JC0 * htsShape(beff / p.j_HC0, p.JCa, p.JCb);
}

export function htsResistivity(p, J, beff) {
    const jc = htsCriticalCurrent(p, beff);
    // This is the solver's explicit branch, including the compact-law cutoff.
    if (!(jc > 0)) return 0;
    const relative = J / jc;
    if (p.j_type === 1) {
        const uH = htsBase(beff / p.j_HC0);
        return etanh(uH * htsBase(relative), p.j1_delta) / p.j_gmin;
    }
    if (p.j_type === 2) return relative ** p.j2_n / p.j_gmin;
    return 0;
}

export function htsElectricField(p, J, beff) {
    return J * htsResistivity(p, J, beff);
}

export function htsMagneticEnvelope(p, H) {
    return p.m3_Mmax * htsShape(H / p.m_HC0, p.m3_a, p.m3_b);
}

export function htsMagneticValue(p, H, previousH = 0, previousM = 0) {
    if (p.m_type === 1) {
        return (etanh(htsBase(H / p.m_HC0), p.m1_delta) - 1) * H;
    }
    if (p.m_type !== 3) return 0;
    const limit = htsMagneticEnvelope(p, H);
    const oldLimit = htsMagneticEnvelope(p, previousH);
    const dh = H - previousH;
    const onLoop = previousM !== 0
        && Math.abs(Math.abs(previousM) - oldLimit)
            <= 8 * Number.EPSILON * Math.max(Math.abs(previousM), oldLimit);
    if (onLoop && (
        Math.abs(H - previousH) <= 16 * Number.EPSILON * Math.max(Math.abs(H), Math.abs(previousH))
        || (previousM < 0) !== (dh < 0)
    )) return previousM < 0 ? -limit : limit;
    const departure = previousM - dh;
    return Math.abs(departure) <= limit
        ? departure : departure < 0 ? -limit : limit;
}

// First contact of the virgin line M=-H with the lower limiting branch.
// Its endpoint is solved independently of the plotting mesh and zoom.
export function htsInitialContact(p) {
    if (htsMagneticEnvelope(p, 0) === 0) return 0;
    let hi = Math.max(p.m_HC0, p.m3_Mmax);
    for (let i = 0; i < 64 && hi < htsMagneticEnvelope(p, hi); i++) hi *= 2;
    if (!Number.isFinite(hi) || hi < htsMagneticEnvelope(p, hi)) {
        throw new Error("Не найдено пересечение начальной линии с предельной кривой.");
    }
    let lo = 0;
    // Locate the first crossing before refining it; do not assume the envelope
    // is monotone for every editable pair of shape exponents.
    for (let i = 1; i <= 512; i++) {
        const H = hi * i / 512;
        if (H >= htsMagneticEnvelope(p, H)) { hi = H; break; }
        lo = H;
    }
    for (let i = 0; i < 64; i++) {
        const mid = lo + (hi - lo) / 2;
        if (mid === lo || mid === hi) break;
        if (mid < htsMagneticEnvelope(p, mid)) lo = mid;
        else hi = mid;
    }
    return lo + (hi - lo) / 2;
}
