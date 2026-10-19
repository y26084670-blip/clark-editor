import { expandOMContract, omFieldDescriptor } from "./omClientService.js";

export const omValueAt = (data, path) => path.reduce((value, key) => value?.[key], data);
const pathAt = (path, index) => path.map(key => key === "$index" ? index : key);
const clone = value => structuredClone(value);

function axes(contract, name, data) {
  const expression = contract.arraySizes[name];
  return typeof expression === "number" ? [expression] : expression.split("*").map(key => data[key]);
}

function coordinates(index, dimensions) {
  const result = Array(dimensions.length);
  for (let i = dimensions.length - 1; i >= 0; i--) { result[i] = index % dimensions[i]; index = Math.floor(index / dimensions[i]); }
  return result;
}

function oldIndex(index, previous, next) {
  const point = coordinates(index, next);
  if (point.some((value, i) => value >= previous[i])) return -1;
  return point.reduce((value, coordinate, i) => value * previous[i] + coordinate, 0);
}

export function omFormGroups(contract, data) {
  return (contract.ui?.groups ?? []).map(group => {
    const count = group.repeat ? (Array.isArray(data[group.repeat]) ? data[group.repeat].length : 0) : 1;
    return { ...group, rows: Array.from({ length: count }, (_, index) => ({
      index,
      label: group.repeat ? coordinates(index, axes(contract, group.repeat, data))
        .map((value, axis) => `${group.rowLabels?.[axis] ?? "№"} ${value + 1}`).join(" · ") : "",
      fields: group.fields.map(field => ({ ...omFieldDescriptor(contract, field), path: pathAt(field.path, index) })),
    })) };
  });
}

function setAt(data, path, value) {
  if (path.some(key => ["__proto__", "prototype", "constructor"].includes(key))) throw new Error("Недопустимый путь параметра.");
  let target = data;
  for (const key of path.slice(0, -1)) {
    if (!target || !Object.hasOwn(target, key) || typeof target[key] !== "object" || target[key] === null) {
      throw new Error(`Отсутствует структура ${path.join("/")}. Исправьте JSON или примените шаблон.`);
    }
    target = target[key];
  }
  target[path.at(-1)] = value;
}

// All mutations return a complete new draft; callers decide whether to confirm removal.
export function changeOMField(preset, data, coupling, path, value) {
  const nextData = clone(data), nextCoupling = clone(coupling), contract = preset.contract;
  setAt(nextData, path, value);
  const removed = [];
  if (path.length === 1 && Object.hasOwn(contract.dimensions, path[0])) {
    const previous = expandOMContract(contract, data), next = expandOMContract(contract, nextData);
    for (const [name, size] of Object.entries(previous.arraySizes)) {
      if (!Array.isArray(data[name]) || data[name].length !== size) throw new Error(`Сначала исправьте размер ${name} в JSON.`);
    }
    const mappings = {};
    for (const [name, size] of Object.entries(next.arraySizes)) {
      const before = axes(contract, name, data), after = axes(contract, name, nextData);
      const mapping = Array.from({ length: size }, (_, i) => oldIndex(i, before, after));
      mappings[name] = mapping;
      const kept = new Set(mapping);
      if (data[name].some((_, i) => !kept.has(i))) removed.push(name);
      nextData[name] = mapping.map(i => clone(i >= 0 ? data[name][i] : preset.data[name]?.[0] ?? {}));
    }
    for (const side of ["inputs", "outputs"]) contract[side].forEach((group, g) => {
      const indices = [], old = coupling[side]?.[g]?.indices;
      if (!old || old.length !== previous[side][g].variables.length) throw new Error("Сначала исправьте число привязок в JSON.");
      let offset = 0;
      for (const variable of group.variables) {
        if (typeof variable === "object" && variable.repeat) {
          indices.push(...mappings[variable.repeat].map(i => i < 0 ? null : old[offset + i]));
          offset += previous.arraySizes[variable.repeat];
        } else indices.push(old[offset++]);
      }
      nextCoupling[side][g].indices = indices;
    });
  }
  return { data: nextData, coupling: nextCoupling, removed };
}

export function changeOMBinding(coupling, side, group, index, value) {
  const next = clone(coupling);
  next[side][group].indices[index] = value;
  return next;
}
