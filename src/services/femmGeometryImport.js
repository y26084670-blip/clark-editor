import { geometryTaskEntries } from "./geometryPreparation.js";
import { sha256 } from "./sketchRequestService.js";

const mu0 = 4e-7 * Math.PI;
function property(block, key) {
  const line = block.split(/\r?\n/).find((s) => s.trimStart().startsWith(`<${key}>`));
  return line?.split("=").slice(1).join("=").trim().replace(/^"|"$/g, "");
}
export function femmCurrents(source) {
  const result = {};
  for (const [, block] of source.matchAll(/<BeginCircuit>([\s\S]*?)<EndCircuit>/gi)) {
    const name = property(block, "CircuitName"),
      amps = Number(property(block, "TotalAmps_re"));
    if (!name || !Number.isFinite(amps)) throw new Error("Некорректная цепь FEMM.");
    result[name] = amps;
  }
  return result;
}

export async function importFemm({ source, profile, length, currents, filename }) {
  // The calibrated profile fixes the winding labels, their areas and all steel boundaries.
  // Only real DC circuit amplitudes vary between the two original FEMM problems.
  const lines = source.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  if (lines.at(-1) === "") lines.pop();
  const structure = lines
    .map((line) => (line.trimStart().startsWith("<TotalAmps_re>") ? "<TotalAmps_re>" : line))
    .join("\n");
  if ((await sha256(structure)) !== profile.structureSha256)
    throw new Error(
      "Геометрия или описание FEMM отличается от профиля ТВВ-320. Этот профиль принимает исходную модель с изменёнными токами цепей.",
    );
  const original = femmCurrents(source);
  const applied = currents ?? original;
  if (Object.keys(original).some((key) => typeof applied[key] !== "number" || !Number.isFinite(applied[key])))
    throw new Error("Задайте конечный ток для каждой цепи.");
  if (!Number.isFinite(length) || length <= 2 * 2590)
    throw new Error("Для этого сечения чистого 2D длина X должна быть больше 5180 мм.");
  const kvs = structuredClone(profile.kvs);
  for (const kv of kvs)
    for (const index of [0, 2, 4, 6]) kv.geo[index] = (Math.sign(kv.geo[index]) * length) / 2;
  const densities = [],
    audit = [
      "KV,local_copy,azimuth_copy,FEM_label_1based,circuit,signed_turns,area_mm2,ampere_turns_A,J_X_A_mm2",
    ];
  for (const [kv, copy, azimuth, label, circuit, turns, area] of profile.windings) {
    const amps = turns * applied[circuit],
      density = amps / area;
    if (azimuth === 1 || kvs[kv - 1].sym.kya === 0) densities.push(density);
    audit.push([kv, copy, azimuth, label, circuit, turns, area, amps, density].join(","));
  }
  const materials = {};
  for (const [, block] of source.matchAll(/<BeginBlock>([\s\S]*?)<EndBlock>/gi)) {
    const count = Number(property(block, "BHPoints"));
    if (!count) continue;
    const points = block
      .split(/<BHPoints>[^\n]*\n/i)[1]
      .trim()
      .split(/\r?\n/)
      .map((row) => row.trim().split(/\s+/).map(Number));
    if (points.length !== count || points.some((p) => p.length !== 2 || !p.every(Number.isFinite)))
      throw new Error("Некорректная характеристика B(H).");
    materials[property(block, "BlockName")] = {
      tabl: [...points.map(([, h]) => h / 1000), ...points.map(([b, h]) => (b / mu0 - h) / 1000)],
      hip: 0,
      comment: "FEMM B(H) → CLARK M(H), кА/м",
    };
  }
  const notes = `ТВВ-320. Источник ${filename}, профиль из 19 магнитных и 5 обмоточных ШГ.\nДлина X = ${length} мм, поляризация A. FEMM (x,y) → CLARK (Y,Z).\nТоки, А: ${JSON.stringify(applied)}. Площади сечений и витки привязаны к меткам FEMM. Поле не рассчитывалось.`;
  return {
    summary: `24 ШГ · 144 сечения обмоток · 4476 магнитных ЭО · X = ${length} мм`,
    entries: geometryTaskEntries({
      ...profile,
      kvs,
      materials,
      notes,
      mhj: [{ v: [...densities, ...Array(2 * densities.length).fill(0)] }],
      extra: [{ name: "DOCS/windings.csv", data: audit.join("\n") + "\n" }],
    }),
  };
}
