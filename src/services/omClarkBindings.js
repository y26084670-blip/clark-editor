import { amplitudeReferenceRows, measurementCoilRows, moveReferenceRows } from "./references/modelReferenceViews.js";

// Directions are those of clark-server/1, i.e. relative to the field solver.
export const OM_CLARK_TYPES = Object.freeze({
  "task-pulse": { label: "Заданный импульс", direction: "Задание → модель", parts: ["amps"] },
  AMP: { label: "Управляемая амплитуда источника", direction: "Модель → Clark", parts: ["amps", "elements"] },
  PSI: { label: "Потокосцепление катушки", direction: "Clark → модель", parts: ["elements", "regions"] },
  MOVE: { label: "Первый угол движения", direction: "Модель → Clark", parts: ["moves", "elements", "regions"],
    note: "Текущий обмен управляет только первым углом; координаты и другие углы не передаются." },
  RSP: { label: "Сопротивление канала", direction: "Clark → модель", parts: ["amps"],
    note: "Канал сохранён для совместимости. Текущий решатель возвращает ноль." },
});

const label = (id, names) => `№${id}${names.length ? ` — ${[...new Set(names)].join(", ")}` : ""}`;

export function omClarkOptions(kind, models = {}) {
  if (kind === "PSI") {
    const coils = new Map();
    for (const [id, , , name] of measurementCoilRows({ models })) {
      if (!coils.has(id)) coils.set(id, []);
      coils.get(id).push(name);
    }
    return [...coils].map(([value, names]) => ({ value, label: label(value, names) }));
  }
  if (["AMP", "RSP", "task-pulse"].includes(kind)) {
    return (models.amps ?? []).map((_, i) => ({ value: i + 1,
      label: label(i + 1, amplitudeReferenceRows({ models, recordIndex: i }).map(row => row[1])) }));
  }
  if (kind === "MOVE") return (models.moves ?? []).map((_, i) => ({ value: i + 1,
    label: label(i + 1, moveReferenceRows({ models, recordIndex: i }).map(row => row[2])) }));
  return [];
}

export function omBindingParts(contract) {
  const kinds = [...contract.inputs, ...contract.outputs].map(group => group.kind);
  if (contract.tables.some(table => table.source === "task-pulse")) kinds.push("task-pulse");
  return [...new Set(["general", ...kinds.flatMap(kind => OM_CLARK_TYPES[kind]?.parts ?? [])])];
}

export function validateOMClarkBindings(coupling, models) {
  for (const side of ["inputs", "outputs"]) for (const group of coupling[side]) {
    const options = new Set(omClarkOptions(group.kind, models).map(item => item.value));
    for (const [index, value] of group.indices.entries()) if (!options.has(value)) {
      throw new Error(`${group.kind}, связь №${index + 1}: объект №${value ?? "—"} отсутствует в задании.`);
    }
  }
}
