// Read-only comparison of the on-disk solver results. Coordinates and HEADER
// metadata are never included in the residual. Each physical array has its own
// RMS over scalar components, points and all saved time steps.
const MU0 = 4 * Math.PI * 1e-7;
const group = (label, unit, factor = 1) => ({ label, unit, factor });
const formats = {
  MH: [3, 2, true, [group("M", "кА/м"), group("H", "кА/м")]],
  JE: [3, 2, true, [group("J", "А/мм²"), group("E", "В/м")]],
  HS: [3, 1, true, [group("B", "Тл")]],
  HV: [3, 1, true, [group("B", "Тл")]],
  AS: [3, 1, true, [group("A", "Тл·м", MU0)]],
  AV: [3, 1, true, [group("A", "Тл·м", MU0)]],
  Q: [1, 1, true, [group("Q", "МВт/м³")]],
  FM: [3, 2, false, [group("F", "Н"), group("момент", "Н·м")]],
  PSI: [1, 1, false, [group("Ψ", "Вб")]],
  MH_WORK: [1, 1, true, [group("невязка M", "кА/м")]],
  JE_WORK: [1, 1, true, [group("невязка J", "А/мм²")]],
};
const missing = error => error?.name === "NotFoundError";
const abort = signal => { if (signal?.aborted) throw new DOMException("Сравнение отменено", "AbortError"); };
const sorted = rows => [...rows].sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true }));
const scalar = value => ArrayBuffer.isView(value) || Array.isArray(value) ? value[0] : value;
const integer = (value, minimum = 0) => {
  const original = scalar(value), number = Number(original);
  if (!Number.isSafeInteger(number) || number < minimum
    || (typeof original === "bigint" && BigInt(number) !== original)) throw new Error("Некорректный размер H5");
  return number;
};

export async function listComparisonTasks(projects, { signal } = {}) {
  const tasks = [], notices = [];
  for (const project of sorted(projects)) {
    abort(signal);
    try {
      const entries = [];
      for await (const [name, handle] of project.handle.entries()) {
        abort(signal);
        if (handle.kind === "directory") entries.push({ name, handle });
      }
      for (const task of sorted(entries)) tasks.push({ ...task, key: `${project.name}/${task.name}`, label: `${project.name} / ${task.name}` });
    } catch (error) {
      abort(signal);
      notices.push(`${project.name}: ${error.message}`);
    }
  }
  return { tasks, notices };
}

export function parseFinalTimings(text = "") {
  const blocks = [...text.matchAll(/Итого за расч[её]т\s*:/giu)];
  if (!blocks.length) return [null, null, null, null];
  const tail = text.slice(blocks.at(-1).index + blocks.at(-1)[0].length);
  const labels = ["Полное время", "Матрица", "Расч[её]т источников", "Расч[её]т поля"];
  return labels.map(label => {
    const value = tail.match(new RegExp(`^\\s*${label}\\s*\\(мин\\)\\s*:\\s*([+\\-\\d.,eE]+)\\s*$`, "imu"))?.[1];
    const number = value === undefined ? NaN : Number(value.replace(",", "."));
    return Number.isFinite(number) && number >= 0 ? number : null;
  });
}

export async function readComparisonTask(task, { signal } = {}) {
  abort(signal);
  let output;
  try { output = await task.handle.getDirectoryHandle("output3XX"); }
  catch (error) {
    if (!missing(error)) throw error;
    return { label: task.label, files: [], timings: [null, null, null, null] };
  }
  const files = [], names = new Set();
  for await (const [name, handle] of output.entries()) {
    abort(signal);
    if (handle.kind !== "file" || !/\.h5$/iu.test(name)) continue;
    const key = name.toLowerCase();
    if (names.has(key)) throw new Error(`Неоднозначные имена H5: ${name}`);
    names.add(key);
    try { files.push({ name, file: await handle.getFile() }); }
    catch (error) { files.push({ name, error: error.message }); }
  }
  let timings = [null, null, null, null], timingError = "";
  try { timings = parseFinalTimings(await (await (await output.getFileHandle("timing.txt")).getFile()).text()); }
  catch (error) { if (!missing(error)) timingError = `timing.txt: ${error.message}`; }
  abort(signal);
  return { label: task.label, files: sorted(files), timings, timingError };
}

export function resultFilePairs(first, second) {
  const a = new Map(first.map(file => [file.name.toLowerCase(), file]));
  const b = new Map(second.map(file => [file.name.toLowerCase(), file]));
  return sorted([...new Set([...a.keys(), ...b.keys()])].map(key => ({ name: (a.get(key) ?? b.get(key)).name, first: a.get(key), second: b.get(key) })));
}

function describeFile(file) {
  const read = key => {
    const data = file.get(`HEADER/${key}`);
    if (!data) throw new Error(`Не найден HEADER/${key}`);
    return data.value;
  };
  const columns = integer(read("columns"), 1), arrays = integer(read("arrCount"));
  const coordinates = integer(read("hasCoo"));
  if (coordinates > 1) throw new Error("Некорректный HEADER/hasCoo");
  const stride = integer(columns * arrays + 3 * coordinates, 1);
  const steps = file.keys().filter(key => /^\d+$/u.test(key)).map(key => {
    const index = integer(Number(key));
    const shape = file.get(key).shape;
    if (!Array.isArray(shape) || shape.length !== 2 || shape[1] !== stride) throw new Error(`Несовместимая форма записи ${key}`);
    return { key, index, rows: integer(shape[0]) };
  }).sort((a, b) => a.index - b.index);
  if (new Set(steps.map(step => step.index)).size !== steps.length) throw new Error("Неоднозначные номера временных шагов");
  const records = integer(steps.reduce((sum, step) => sum + step.rows, 0));
  const timeStep = scalar(file.get("HEADER/RANGES/time_step")?.value);
  return { columns, arrays, coordinates, stride, steps, records, timeStep };
}

// Scaled sum of squares avoids squaring very large or tiny differences directly.
function addDifference(state, difference) {
  if (!Number.isFinite(difference)) throw new Error("Нечисловая или бесконечная невязка");
  state.count++;
  if (!Number.isSafeInteger(state.count)) throw new Error("Слишком много компонент для точного подсчёта");
  const absolute = Math.abs(difference);
  if (!absolute) return;
  if (absolute > state.scale) {
    state.sum = 1 + state.sum * (state.scale / absolute) ** 2;
    state.scale = absolute;
  } else state.sum += (absolute / state.scale) ** 2;
}

export function compareH5Results(name, first, second, { chunkRows = 16384 } = {}) {
  integer(chunkRows, 1);
  const a = describeFile(first), b = describeFile(second);
  if (a.records !== b.records) return { message: `число записей различается: ${a.records} / ${b.records}` };
  if (a.steps.length !== b.steps.length) return { message: `число временных записей различается: ${a.steps.length} / ${b.steps.length}` };
  if (a.columns !== b.columns || a.arrays !== b.arrays || a.coordinates !== b.coordinates) return { message: "структура колонок не совпадает" };
  if (a.steps.some((step, i) => step.index !== b.steps[i].index || step.rows !== b.steps[i].rows)) return { message: "номера шагов или число записей по шагам не совпадают" };
  if (Number.isFinite(a.timeStep) && Number.isFinite(b.timeStep) && a.timeStep !== b.timeStep) return { message: "шаг по времени не совпадает" };
  if (!a.records) return { message: "нет записей в обоих заданиях" };
  const format = formats[name.replace(/\.h5$/iu, "").toUpperCase()];
  if (!format) return { message: "неизвестны физические величины и размерности колонок" };
  if (format[0] !== a.columns || format[1] !== a.arrays || Number(format[2]) !== a.coordinates) return { message: "структура колонок не соответствует формату файла" };
  const states = format[3].map(definition => ({ ...definition, count: 0, sum: 0, scale: 0 }));
  for (let step = 0; step < a.steps.length; step++) {
    for (let start = 0; start < a.steps[step].rows; start += chunkRows) {
      const end = Math.min(a.steps[step].rows, start + chunkRows);
      const left = first.get(a.steps[step].key).slice([[start, end], []]);
      const right = second.get(b.steps[step].key).slice([[start, end], []]);
      if (![left, right].every(values => values instanceof Float32Array || values instanceof Float64Array)
        || left.length !== (end - start) * a.stride || right.length !== left.length) throw new Error("Ожидались массивы REAL32/REAL64 указанного размера");
      for (let row = 0; row < end - start; row++) {
        for (let array = 0; array < states.length; array++) {
          const state = states[array], offset = row * a.stride + a.coordinates * 3 + array * a.columns;
          for (let component = 0; component < a.columns; component++) {
            const x = left[offset + component], y = right[offset + component];
            if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`${state.label}: нечисловые или бесконечные результаты`);
            addDifference(state, (x - y) * state.factor);
          }
        }
      }
    }
  }
  return { records: a.records, groups: states.map(state => ({ label: state.label, unit: state.unit,
    components: state.count, rms: state.scale * Math.sqrt(state.sum / state.count) })) };
}

export function formatFileComparison(name, result) {
  if (result.message) return `${name} — ${result.message}`;
  return `${name} — ${result.groups.map(item => `${item.label}: ${item.rms === 0 ? "0" : item.rms.toExponential(6)} ${item.unit}`).join("; ")}`;
}

export function compareResultFilePairs(first, second, open, onProgress = () => {}) {
  const lines = [];
  for (const pair of resultFilePairs(first, second)) {
    onProgress(`Сравнение ${pair.name}…`);
    if (!pair.first || !pair.second) {
      lines.push(`${pair.name} — есть только в задании ${pair.first ? 1 : 2}`);
      continue;
    }
    let a, b;
    try {
      if (pair.first.error || pair.second.error) throw new Error(pair.first.error || pair.second.error);
      a = open(0, pair.first); b = open(1, pair.second);
      lines.push(formatFileComparison(pair.name, compareH5Results(pair.name, a, b)));
    } catch (error) { lines.push(`${pair.name} — ошибка: ${error.message}`); }
    finally { a?.close(); b?.close(); }
  }
  return lines;
}

export function formatComparisonReport(first, second, lines) {
  const number = value => Number.isFinite(value) ? String(value) : "нет данных";
  const timings = ["Полное", "Матрицы", "Источники", "Поле"].map((label, i) => `${label}:\t${number(first.timings[i])}\t${number(second.timings[i])}`);
  return [`Задание 1: ${first.label}`, `Задание 2: ${second.label}`,
    "Абсолютная СКН по компонентам всех сохранённых шагов; координаты исключены.", "",
    ...(lines.length ? lines : ["H5-файлы отсутствуют в обоих заданиях."]), "",
    "Итоговое время (мин):\tзадание 1\tзадание 2", ...timings,
    ...[first, second].flatMap((task, i) => task.timingError ? [`Задание ${i + 1}: ${task.timingError}`] : [])].join("\n");
}

export async function compareTaskResults(first, second, { signal, onProgress = () => {}, workerFactory } = {}) {
  const a = await readComparisonTask(first, { signal }), b = await readComparisonTask(second, { signal });
  abort(signal);
  const lines = await new Promise((resolve, reject) => {
    const worker = workerFactory();
    let settled = false;
    const stop = (error, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", cancel);
      worker.onmessage = null; worker.onerror = null;
      worker.terminate();
      if (error) reject(error); else resolve(value);
    };
    const cancel = () => stop(new DOMException("Сравнение отменено", "AbortError"));
    signal?.addEventListener("abort", cancel, { once: true });
    worker.onmessage = ({ data }) => {
      if (signal?.aborted) return;
      if (data.type === "progress") onProgress(data.message);
      else if (data.type === "complete") stop(null, data.lines);
      else if (data.type === "error") stop(new Error(data.message));
    };
    worker.onerror = event => stop(new Error(event.message || "Ошибка чтения H5"));
    try { worker.postMessage({ first: a.files, second: b.files }); }
    catch (error) { stop(error); }
  });
  abort(signal);
  return formatComparisonReport(a, b, lines);
}
