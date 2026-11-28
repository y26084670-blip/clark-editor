import { ZIP_MAX_BYTES } from "./zipStore.js";
import { geometryTaskEntries } from "./geometryPreparation.js";
import defaults from "./geometryTaskDefaults.json" with { type: "json" };

function rectangularBody(mesh) {
  const positions = mesh.attributes?.position?.array,
    indices = mesh.index?.array;
  const label = mesh.name || "Тело STEP";
  const unsupported = () =>
    new Error(
      `«${label}»: требуются шесть прямоугольных граней параллельно координатным плоскостям. Разделите тело на поддерживаемые блоки в CAD.`,
    );
  if (!positions?.length || !indices || mesh.brep_faces?.length !== 6 || !positions.every(Number.isFinite))
    throw unsupported();
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    const axis = i % 3;
    lo[axis] = Math.min(lo[axis], positions[i]);
    hi[axis] = Math.max(hi[axis], positions[i]);
  }
  const size = hi.map((v, i) => v - lo[i]);
  const tolerance = Math.max(...size) * 1e-7;
  if (size.some((side) => side <= tolerance)) throw unsupported();
  const faces = new Set();
  for (const { first, last } of mesh.brep_faces) {
    if (last !== first + 1) throw unsupported();
    const ids = indices.slice(3 * first, 3 * (last + 1));
    const corners = ids.map((index) => {
      let key = 0;
      for (let axis = 0; axis < 3; axis++) {
        const v = positions[index * 3 + axis];
        if (Math.abs(v - hi[axis]) <= tolerance) key |= 1 << axis;
        else if (!(Math.abs(v - lo[axis]) <= tolerance)) throw unsupported();
      }
      return key;
    });
    if (
      new Set(corners).size !== 4 ||
      new Set(corners.slice(0, 3)).size !== 3 ||
      new Set(corners.slice(3)).size !== 3
    )
      throw unsupported();
    const plane = [0, 1, 2].find((axis) => corners.every((v) => ((v ^ corners[0]) & (1 << axis)) === 0));
    if (plane === undefined) throw unsupported();
    const common = [...new Set(corners.slice(0, 3).filter((v) => corners.slice(3).includes(v)))];
    if (common.length !== 2 || (common[0] ^ common[1]) !== (7 ^ (1 << plane))) throw unsupported();
    faces.add(2 * plane + ((corners[0] >> plane) & 1));
  }
  if (faces.size !== 6) throw unsupported();
  return { name: label, lo, hi, size };
}

export function importStepMeshes(result, { filename, dp, mz }) {
  if (!result.success || !result.meshes?.length) throw new Error("В STEP не найдено геометрических тел.");
  if (dp.length !== 3 || !dp.every((n) => Number.isSafeInteger(n) && n >= 1) || !Number.isFinite(mz))
    throw new Error("Укажите три целых положительных разбиения и конечную Mz.");
  const boxes = result.meshes.map(rectangularBody);
  const count = boxes.length * dp.reduce((a, b) => a * b, 1);
  const magnitude = JSON.stringify(mz);
  if (!Number.isSafeInteger(count) || count * (5 + magnitude.length) + 8 > ZIP_MAX_BYTES)
    throw new Error("Таблица M превышает размер пакета 32 МиБ. Уменьшите разбиение.");
  const mhj = '{"v":[' + "0,".repeat(2 * count) + (magnitude + ",").repeat(count - 1) + magnitude + "]}\n";
  for (let i = 0; i < boxes.length; i++)
    for (const b of boxes.slice(0, i)) {
      const a = boxes[i],
        tol = Math.max(...a.size, ...b.size) * 1e-7;
      if (a.lo.every((v, k) => Math.min(a.hi[k], b.hi[k]) - Math.max(v, b.lo[k]) > tol))
        throw new Error(`Объёмы «${a.name}» и «${b.name}» пересекаются.`);
    }
  const kvs = boxes.map((b, i) => ({
    ...defaults.kv,
    name: `${i + 1}. ${b.name}`.slice(0, 60),
    geoType: 2,
    geo: [...b.size, ...Array(21).fill(0)],
    dr: b.lo,
    dp,
    targ: 1,
  }));
  const notes = `Источник STEP: ${filename}. Единицы CLARK — мм. Каждое прямоугольное тело соответствует одному ШГ.\nЗаданная намагниченность M=(0,0,${mz}) кА/м. Разбиение каждого ШГ: ${dp.join(" × ")}. Поле не рассчитывалось.`;
  return {
    summary: `${kvs.length} ШГ · ${count} ЭО · Mz = ${mz} кА/м`,
    entries: geometryTaskEntries({
      ...defaults,
      kvs,
      mhj,
      notes,
    }),
  };
}

let engine;
export async function importStep(bytes, options) {
  if (!engine)
    engine = (async () => {
      const [{ default: init }, { default: wasm }] = await Promise.all([
        import("occt-import-js"),
        import("occt-import-js/dist/occt-import-js.wasm?url"),
      ]);
      return init({ locateFile: () => wasm });
    })().catch((error) => {
      engine = undefined;
      throw error;
    });
  const occt = await engine;
  return importStepMeshes(occt.ReadStepFile(bytes, { linearUnit: "millimeter" }), options);
}
