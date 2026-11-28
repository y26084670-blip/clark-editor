import { createStoredZip } from "./zipStore.js";
import { sha256 } from "./sketchRequestService.js";

export const geometryAsset = (name) =>
  `${typeof import.meta.env === "object" ? import.meta.env.BASE_URL : "/"}geometry/${name}`;
export const examples = {
  sketch: [
    { label: "Рамка и магнит — SVG", file: "frame.svg", conditions: "sketch.txt" },
    { label: "Рамка и магнит — PNG", file: "frame.png", conditions: "sketch.txt" },
  ],
  mesh: [{ label: "Рамка и магнит — сетка Gmsh", file: "frame.msh", conditions: "mesh.txt" }],
  direct: [
    { label: "FEMM · ТВВ-320, холостой ход", file: "TVV320_1.fem" },
    { label: "FEMM · ТВВ-320, нагрузка", file: "TVV320_2.fem" },
    { label: "STEP · прямоугольный магнит", file: "magnet.step" },
  ],
};
export async function fetchGeometryAsset(name, signal) {
  const response = await fetch(geometryAsset(name), { signal });
  if (!response.ok) throw new Error(`Не удалось прочитать образец ${name} (HTTP ${response.status}).`);
  return response;
}
export const meshPrompt =
  "Открой REQUEST.md и приложенную сетку. Выполни задание с общим контекстом CLARK. Сначала предложи крупные шестигранники по физическим границам, затем подбери внутреннее разбиение каждого.";
export const meshRules = `Прочитай узлы, элементы и метки областей. Определи размерность сетки и единицы. В каждой однородной области восстанови внешние контуры или поверхности по инцидентности. Сохрани окна, зазоры, интерфейсы, материал и цепи. Проверь происхождение ненадписанных границ. Для плоской сетки установи оси и условие вдоль X.
Предложи разбиение на крупные ШГ и обоснуй каждый разрез. Затем задай каждому ШГ своё dp, проверь геометрию, контакты и лимит RAM. Выдай папку input3XX, DOCS с таблицей соответствия и отчётом, ZIP для Editor. Расчёт поля выполняется по отдельному заданию.`;

export async function buildMeshRequest({ file, title, description }, { signal } = {}) {
  if (!file || !/\.msh$/i.test(file.name) || !file.size || file.size > 24 * 1024 ** 2) {
    throw new Error("Выберите непустую сетку Gmsh .msh до 24 МиБ.");
  }
  const prefix = await file.slice(0, 512).text();
  if (!/^\s*\$MeshFormat\s+[\d.]+\s+[01]\s+\d+/u.test(prefix))
    throw new Error("В файле отсутствует заголовок Gmsh MSH.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  signal?.throwIfAborted();
  const request = `# ${title || "Геометрия CLARK по сетке"}\n\nФайл пользователя: ${JSON.stringify(file.name)}. Копия: source/model.msh.\n\n## Условие\n\n${description}\n\n## Построение\n\n${meshRules}\n`;
  const lock = { file: file.name, sha256: await sha256(bytes) };
  const zip = createStoredZip([
    { name: "START.txt", data: meshPrompt },
    { name: "REQUEST.md", data: request },
    { name: "source/model.msh", data: bytes },
    { name: "source.json", data: JSON.stringify(lock) },
  ]);
  return { zip, filename: `clark-mesh-${crypto.randomUUID()}.zip`, prompt: meshPrompt };
}

// These entries are generated locally and contain only relative paths chosen by the importers.
export async function writeGeometryTask(root, entries) {
  for (const { name, data } of entries) {
    const parts = name.split("/");
    let directory = root;
    for (const part of parts.slice(0, -1))
      directory = await directory.getDirectoryHandle(part, { create: true });
    const handle = await directory.getFileHandle(parts.at(-1), { create: true });
    const stream = await handle.createWritable();
    try {
      await stream.write(data);
      await stream.close();
    } catch (error) {
      await stream.abort().catch(() => {});
      throw error;
    }
  }
}
export function geometryTaskEntries({
  general,
  kvs,
  tks = [],
  conrab,
  mhj,
  materials = {},
  notes,
  extra = [],
}) {
  const tables = { general: [general], kvs, tks, conrab, amplitudes: [], moves: [], mhj };
  const entries = Object.entries(tables).map(([key, rows]) => ({
    name: `input3XX/${key}.txt`,
    data: typeof rows === "string" ? rows : rows.map((row) => JSON.stringify(row) + "\n").join(""),
  }));
  for (const [name, material] of Object.entries(materials)) {
    entries.push({ name: `input3XX/xapLibFMM/${name}.txt`, data: JSON.stringify(material) });
  }
  return [
    ...entries,
    { name: "input3XX/_nogo.e3d", data: "Проверить и сохранить задание в Editor.\n" },
    { name: "DOCS/README.txt", data: notes + "\n" },
    ...extra,
  ];
}
