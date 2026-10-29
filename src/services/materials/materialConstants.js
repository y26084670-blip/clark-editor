// Current JSON tables are variable-length; twelve is only the initial template.
export const FMM_MIN_TABLE_ROWS = 2;
export const FMM_DEFAULT_TABLE_ROWS = 12;

export const HTS_PARAMETER_NAMES = Object.freeze([
    "j_HC0",
    "JC0",
    "JCa",
    "JCb",
    "j_ani",
    "j_type",
    "j_gmin",
    "j1_delta",
    "j2_n",
    "m_type",
    "m_HC0",
    "m1_delta",
    "m3_Mmax",
    "m3_a",
    "m3_b",
    "KHabc",
    "Diag",
    "M3D",
]);

// solver/src/core/types.jl — defaults конструктора PropHTS.
export const HTS_EFFECTIVE_DEFAULTS = Object.freeze({
    j_ani: true,
    KHabc: 1,
    Diag: 0,
    M3D: false,
});
