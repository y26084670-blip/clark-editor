// Task-owned OM input files. No solver, compiler or model state lives here.
export const OM_SELECTION_FILE = "om-client.json";
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const own = (value, key) => Object.hasOwn(value, key);
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = message => { throw new Error(message); };
const token = value => typeof value === "string"
  && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value) && !value.includes("..");
export const formatOMJson = value => JSON.stringify(value, null, 2) + "\n";

export function parseOMJson(text, name = "JSON") {
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) fail(`${name}: JSON превышает 4 МиБ.`);
  let value;
  try { value = JSON.parse(text.replace(/^\uFEFF/, "")); }
  catch (error) { fail(`${name}: ${error.message}`); }
  // JSON.parse otherwise silently discards repeated keys, including escaped ones.
  const tokens = text.match(/"(?:[^"\\]|\\.)*"|[{}\[\]:,]|[^\s{}\[\]:,]+/g) ?? [];
  const stack = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t === "{") stack.push(new Set());
    else if (t === "[") stack.push(null);
    else if (t === "}" || t === "]") stack.pop();
    else if (t.startsWith('"') && tokens[i + 1] === ":") {
      const key = JSON.parse(t), keys = stack.at(-1);
      if (keys?.has(key)) fail(`${name}: повторное свойство «${key}».`);
      keys?.add(key);
    }
  }
  const pending = [value];
  while (pending.length) {
    const item = pending.pop();
    if (typeof item === "number" && !Number.isFinite(item)) fail(`${name}: число вне допустимого диапазона.`);
    if (item && typeof item === "object") for (const child of Object.values(item)) pending.push(child);
  }
  return value;
}

export function validateOMSelection(selection) {
  if (!record(selection) || selection.schema !== "clark-om-client/1") fail("Неподдерживаемый om-client.json.");
  for (const name of ["model", "version", "dataFile", "couplingFile"]) {
    if (!token(selection[name])) fail(`om-client.json: недопустимое значение «${name}».`);
  }
  const names = [OM_SELECTION_FILE, selection.dataFile, selection.couplingFile].map(name => name.toLowerCase());
  if (new Set(names).size !== 3 || names.some(name => !name.endsWith(".json"))) {
    fail("Имена трёх JSON-файлов должны различаться и иметь расширение .json.");
  }
  return selection;
}

function valueAt(data, path) {
  if (!Array.isArray(path) || !path.length) fail("В пресете указан пустой путь параметра.");
  let value = data;
  for (const key of path) {
    if (!(typeof key === "string" || (Number.isInteger(key) && key >= 0))
      || value === null || typeof value !== "object" || !own(value, key)) {
      fail(`В данных отсутствует «${path.join("/")}».`);
    }
    value = value[key];
  }
  return value;
}

function number(value, label, minimum = -Infinity) {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${label}: требуется конечное число.`);
  if (value < minimum) fail(`${label}: требуется число >= ${minimum}.`);
}

export const usesTaskPulses = preset => preset?.contract?.tables?.some(table => table.source === "task-pulse") ?? false;

function validatePoints(points, label, scale = 1) {
  if (!Array.isArray(points) || points.length < 2) fail(`${label}: нужны хотя бы две точки [время, значение].`);
  let previous = -Infinity;
  for (const point of points) {
    if (!Array.isArray(point) || point.length !== 2) fail(`${label}: точка должна содержать два числа.`);
    number(point[0], `${label}: время`); number(point[1], `${label}: значение`);
    if (point[0] <= previous) fail(`${label}: время должно строго возрастать.`);
    number(point[1] * scale, `${label}: значение после масштабирования`);
    previous = point[0];
  }
}

// Expand only the active prefix. This contract language has no model-name dispatch.
export function expandOMContract(contract, data) {
  const dimensions = contract.dimensions ?? {};
  for (const [name, rule] of Object.entries(dimensions)) {
    const value = data[name];
    if (!Number.isInteger(value) || value < rule.minimum || value > 10000) fail(`${name}: требуется целое число от ${rule.minimum} до 10000.`);
    if (rule.maximum !== undefined && value > rule.maximum) fail(`${name}: задано ${value}, пакет допускает не более ${rule.maximum}.`);
  }
  const sizes = Object.fromEntries(Object.entries(contract.arraySizes).map(([name, expression]) => {
    const size = typeof expression === "number" ? expression : expression.split("*").reduce((value, key) => {
      if (!own(dimensions, key)) fail(`Неописанная размерность «${key}».`);
      return value * data[key];
    }, 1);
    if (!Number.isInteger(size) || size < 0 || size > 10000) fail(`${name}: недопустимое число элементов (предел 10000).`);
    return [name, size];
  }));
  let variant;
  if (contract.variants) {
    const selected = contract.variants.filter(item => Object.entries(item.when).every(([key, value]) => data[key] === value));
    if (selected.length !== 1) fail("Данные должны однозначно выбирать вариант модели; floatingNeutral должен быть true или false.");
    [variant] = selected;
    for (const [name, minimum] of Object.entries(variant.minimumSizes)) {
      if (!own(sizes, name) || sizes[name] < minimum) fail(`${variant.key}: требуется минимум ${minimum} элементов ${name}.`);
    }
  }
  const substitute = (value, index) => {
    if (typeof value === "string") return value === "$index" ? index : value.replaceAll("{i}", String(index + 1));
    if (Array.isArray(value)) return value.map(item => substitute(item, index));
    if (record(value)) return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "repeat")
      .map(([key, item]) => [key, substitute(item, index)]));
    return value;
  };
  const rows = values => values.flatMap(value => {
    if (!record(value) || !own(value, "repeat")) return [value];
    if (!own(sizes, value.repeat)) fail(`Неизвестный массив repeat: ${value.repeat}.`);
    return Array.from({ length: sizes[value.repeat] }, (_, index) => substitute(value, index));
  });
  const names = values => rows(values).map(value => typeof value === "string" ? value : value.variable);
  return { ...contract, arraySizes: sizes, selectedVariant: variant?.key,
    parameterBindings: rows(contract.parameterBindings), tables: rows(contract.tables),
    inputs: contract.inputs.map(group => ({ ...group, variables: names(group.variables) })),
    outputs: contract.outputs.map(group => ({ ...group, variables: names(group.variables) })) };
}

// The optional context is the task's read-only BaseModel.amps representation.
// A standalone preset can validate references before a particular task is known.
export function validateOMInputs(selection, data, coupling, preset, amplitudes) {
  validateOMSelection(selection);
  if (data?.schema === "clark-circuit/1") fail("Формат clark-circuit/1 больше не поддерживается. Выберите новый пресет с импульсами и заполните данные модели в формате clark-circuit/2.");
  if (!preset || preset.selection.model !== selection.model || preset.selection.version !== selection.version) fail("Загрузите пресет выбранной OM-модели и версии.");
  if (!record(data) || data.schema !== preset.contract.dataSchema) fail(`${selection.dataFile}: требуется схема ${preset.contract.dataSchema}.`);
  const contract = expandOMContract(preset.contract, data);
  for (const [key, expected] of Object.entries(contract.structural)) {
    if (data[key] !== expected) fail(`${key}: значение закреплено при сборке модели (${JSON.stringify(expected)}). Выберите соответствующий пресет.`);
  }
  for (const [key, size] of Object.entries(contract.arraySizes)) {
    if (!Array.isArray(data[key]) || data[key].length !== size) fail(`${key}: требуется ${size} записей.`);
  }
  for (const name of ["acceptanceTolerance", "integrationTolerance"]) {
    number(data[name], name, 0);
    if (data[name] === 0) fail(`${name}: допуск должен быть больше нуля.`);
  }
  for (const binding of contract.parameterBindings) {
    const value = valueAt(data, binding.path), label = binding.path.join("/");
    if (binding.type === "real" || binding.type === "integer") {
      number(value, label);
      if (binding.type === "integer" && (!Number.isInteger(value) || Math.abs(value) > 2147483647)) fail(`${label}: требуется целое число в диапазоне Int32.`);
      if (binding.minimum !== undefined && value < binding.minimum) fail(`${label}: минимум ${binding.minimum}.`);
      if (binding.maximum !== undefined && value > binding.maximum) fail(`${label}: максимум ${binding.maximum}.`);
    } else if (binding.type === "boolean") {
      if (typeof value !== "boolean") fail(`${label}: требуется true или false.`);
    } else if (binding.type === "string") {
      if (typeof value !== "string" || /[\x00-\x1f]/.test(value)) fail(`${label}: требуется однострочный текст.`);
    } else fail(`Неизвестный тип параметра пресета: ${binding.type}.`);
  }
  if (usesTaskPulses(preset) && amplitudes !== undefined) {
    if (!Array.isArray(amplitudes)) fail("Некорректный список импульсов задания.");
    amplitudes.forEach((amplitude, index) => validatePoints(amplitude?.impuls, `Импульс №${index + 1}`));
  }
  for (const table of contract.tables) {
    if (table.source !== "task-pulse") fail("Пресет: временные зависимости должны ссылаться на импульсы задания (source: task-pulse).");
    const pulse = valueAt(data, table.pulsePath), scale = valueAt(data, table.scalePath);
    const label = table.pulsePath.join("/");
    if (!Number.isInteger(pulse) || pulse < 1 || pulse > 2147483647) fail(`${label}: номер импульса должен быть положительным целым числом Int32.`);
    number(scale, table.scalePath.join("/"));
    if (amplitudes !== undefined) {
      if (!Array.isArray(amplitudes) || !amplitudes[pulse - 1]) fail(`${label}: импульс №${pulse} отсутствует во вкладке «Амплитуды».`);
      validatePoints(amplitudes[pulse - 1].impuls, `Импульс №${pulse}`, scale);
    }
  }
  if (!record(coupling) || coupling.schema !== "clark-server/1") fail(`${selection.couplingFile}: требуется схема clark-server/1.`);
  for (const side of ["inputs", "outputs"]) {
    const actual = coupling[side], expected = contract[side];
    if (!Array.isArray(actual) || actual.length !== expected.length) fail(`${side}: число групп должно быть ${expected.length}.`);
    actual.forEach((group, index) => {
      const target = expected[index];
      if (!record(group) || group.kind !== target.kind || !Array.isArray(group.indices)
        || group.indices.length !== target.variables.length) fail(`${side}[${index}]: требуется ${target.kind}, индексов: ${target.variables.length}.`);
      for (const id of group.indices) {
        if (!Number.isInteger(id) || id < 1 || id > 2147483647) fail(`${side}[${index}]: индексы должны быть положительными целыми числами.`);
      }
    });
  }
  return { selection, data, coupling };
}

export function validateOMPreset(preset) {
  if (!record(preset) || preset.schema !== "clark-om-preset/2" || typeof preset.label !== "string" || !preset.label.trim()) fail("Ожидается editor-preset.json со схемой clark-om-preset/2 и названием label.");
  validateOMSelection(preset.selection);
  const contract = preset.contract;
  if (!record(contract) || typeof contract.dataSchema !== "string" || !record(contract.structural)
    || !record(contract.dimensions) || !record(contract.arraySizes) || !Array.isArray(contract.parameterBindings) || !Array.isArray(contract.tables)) fail("Пресет не содержит полного описания параметров модели.");
  for (const value of Object.values(contract.structural)) {
    if (!["string", "number", "boolean"].includes(typeof value)) fail("Структурный параметр пресета должен быть скалярным.");
  }
  for (const size of Object.values(contract.arraySizes)) {
    if (!(Number.isInteger(size) && size >= 0 && size <= 10000)
      && !(typeof size === "string" && /^[A-Za-z_]\w*(\*[A-Za-z_]\w*)*$/.test(size))) fail("Некорректный размер массива в пресете.");
  }
  for (const rule of Object.values(contract.dimensions)) {
    if (!record(rule) || !Number.isInteger(rule.minimum) || rule.minimum < 1
      || (rule.maximum !== undefined && (!Number.isInteger(rule.maximum) || rule.maximum < rule.minimum || rule.maximum > 10000))) fail("Некорректный предел размерности пресета.");
  }
  if (contract.variants !== undefined) {
    if (!Array.isArray(contract.variants) || !contract.variants.length) fail("В пресете отсутствуют варианты модели.");
    for (const variant of contract.variants) {
      if (!record(variant) || !token(variant.key) || !record(variant.when) || !Object.keys(variant.when).length
        || !record(variant.minimumSizes) || Object.values(variant.minimumSizes).some(value => !Number.isInteger(value) || value < 1 || value > 10000)) fail("Некорректный вариант модели.");
    }
  }
  for (const binding of contract.parameterBindings) {
    if (!record(binding)) fail("Некорректное описание параметра в пресете.");
    for (const bound of ["minimum", "maximum"]) if (own(binding, bound)) number(binding[bound], bound);
  }
  for (const side of ["inputs", "outputs"]) {
    const kinds = side === "inputs" ? ["AMP", "MOVE"] : ["PSI", "RSP"];
    if (!Array.isArray(contract[side])) fail(`В пресете отсутствует ${side}.`);
    for (const group of contract[side]) {
      if (!record(group) || !kinds.includes(group.kind) || !Array.isArray(group.variables)
        || !group.variables.length || group.variables.some(name => !(typeof name === "string" && name)
          && !(record(name) && typeof name.variable === "string" && name.variable && typeof name.repeat === "string"))) fail(`Некорректная группа ${side} в пресете.`);
    }
  }
  validateOMInputs(preset.selection, preset.data, preset.coupling, preset);
  return preset;
}

export async function readOMPresetFile(file) {
  if (file.size > MAX_JSON_BYTES) fail("Пресет превышает 4 МиБ.");
  return validateOMPreset(parseOMJson(await file.text(), file.name));
}

async function readText(directory, name) {
  try {
    const file = await (await directory.getFileHandle(name)).getFile();
    if (file.size > MAX_JSON_BYTES) fail(`${name}: файл превышает 4 МиБ.`);
    return await file.text();
  } catch (error) {
    if (error.name === "NotFoundError") return null;
    throw error;
  }
}

export async function readOMTask(task) {
  const input = await task.getDirectoryHandle("input3XX");
  const raw = await readText(input, OM_SELECTION_FILE);
  const baseline = { [OM_SELECTION_FILE]: raw };
  if (raw === null) return { selection: null, dataText: "", couplingText: "", baseline };
  const selection = validateOMSelection(parseOMJson(raw, OM_SELECTION_FILE));
  const values = await Promise.all([selection.dataFile, selection.couplingFile].map(name => readText(input, name)));
  baseline[selection.dataFile] = values[0]; baseline[selection.couplingFile] = values[1];
  return { selection, dataText: values[0] ?? "", couplingText: values[1] ?? "", baseline };
}

export async function readOMTaskPulses(input) {
  let text;
  try { text = await (await (await input.getFileHandle("amplitudes.txt")).getFile()).text(); }
  catch (error) {
    if (error.name === "NotFoundError") fail("Сохраните импульсы вкладки «Амплитуды»: файл amplitudes.txt отсутствует.");
    throw error;
  }
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);
  if (lines.at(-1) === "") lines.pop();
  const amplitudes = lines.map((line, index) => {
    if (!line.trim()) fail(`amplitudes.txt: пустая запись №${index + 1}.`);
    const item = parseOMJson(line, `amplitudes.txt, импульс №${index + 1}`);
    if (!record(item) || !Number.isInteger(item.n) || item.n < 2 || item.n > 2147483647 || !Array.isArray(item.impuls)
      || item.impuls.length !== 2 * item.n) fail(`amplitudes.txt: неверный размер импульса №${index + 1}.`);
    const impuls = Array.from({ length: item.n }, (_, i) => [item.impuls[i], item.impuls[i + item.n]]);
    validatePoints(impuls, `Импульс №${index + 1}`);
    return { impuls };
  });
  return { amplitudes, text };
}

async function writeText(directory, name, text) {
  const stream = await (await directory.getFileHandle(name, { create: true })).createWritable();
  try { await stream.write(text); await stream.close(); }
  catch (error) { try { await stream.abort(); } catch { /* Original failure. */ } throw error; }
}

export async function saveOMTask(task, draft, preset, baseline) {
  const selection = draft.selection;
  const data = parseOMJson(draft.dataText, selection.dataFile);
  const coupling = parseOMJson(draft.couplingText, selection.couplingFile);
  const input = await task.getDirectoryHandle("input3XX");
  const pulses = usesTaskPulses(preset) ? await readOMTaskPulses(input) : null;
  validateOMInputs(selection, data, coupling, preset, pulses?.amplitudes);
  // Check the original files and every new target before any write.
  const values = { [selection.dataFile]: formatOMJson(data), [selection.couplingFile]: formatOMJson(coupling),
    [OM_SELECTION_FILE]: formatOMJson(selection) };
  for (const [name, text] of Object.entries(values)) {
    if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) fail(`${name}: форматированный JSON превышает 4 МиБ.`);
  }
  const previous = {};
  for (const name of new Set([...Object.keys(baseline), ...Object.keys(values)])) {
    const actual = await readText(input, name);
    if (actual !== (own(baseline, name) ? baseline[name] : null)) fail(`${name} изменён вне этого окна. Перечитайте файлы перед сохранением.`);
    previous[name] = actual;
  }
  const attempted = [];
  try {
    // The selector is committed last. On an I/O error restore our own writes.
    for (const [name, text] of Object.entries(values)) {
      if (pulses && (await readOMTaskPulses(input)).text !== pulses.text) fail("amplitudes.txt изменён во время сохранения. Перечитайте импульсы и повторите сохранение OM-данных.");
      if (await readText(input, name) !== previous[name]) fail(`${name} изменён во время сохранения.`);
      attempted.push(name);
      await writeText(input, name, text);
    }
  } catch (error) {
    const unrestored = [];
    for (const name of attempted.reverse()) {
      try {
        const actual = await readText(input, name);
        if (actual === previous[name]) continue;
        if (actual !== values[name] && !(previous[name] === null && actual === "")) { unrestored.push(name); continue; }
        if (previous[name] === null) await input.removeEntry(name);
        else await writeText(input, name, previous[name]);
      } catch { unrestored.push(name); }
    }
    fail(`Не удалось сохранить OM-данные: ${error.message}` + (unrestored.length
      ? ` Проверьте файлы перед запуском: ${unrestored.join(", ")}.` : " Исходные файлы сохранены."));
  }
  return { selection, dataText: values[selection.dataFile], couplingText: values[selection.couplingFile], baseline: values };
}
