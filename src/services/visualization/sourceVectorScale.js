export const SOURCE_SCALE_MIN_EXPONENT = -4;
export const SOURCE_SCALE_MAX_EXPONENT = 4;

export function normalizeSourceVectorScale(value) {
  const scale = Number(value ?? 1);
  return Number.isFinite(scale)
    ? Math.max(10 ** SOURCE_SCALE_MIN_EXPONENT, Math.min(10 ** SOURCE_SCALE_MAX_EXPONENT, scale)) : 1;
}

export function sourceScaleLabel(scale) {
  return `×${normalizeSourceVectorScale(scale).toLocaleString("ru-RU", { maximumSignificantDigits: 4 })}`;
}
