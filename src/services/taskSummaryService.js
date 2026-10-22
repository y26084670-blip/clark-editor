import { DIRECTORIES } from "./schemas/common/constants.js";

import { eoCount, kvFlags } from "./solver/kvDerived.js";

const SUMMARY_FILE_NAME = "_summary.txt";
const RESULTS_SUMMARY_FILE_NAME = "_summary_out.txt";

export const TASK_SUMMARY_TEXT = Object.freeze({
  NO_INFORMATION: "нет сводки исходных данных — сохраните задание в редакторе",
  NO_CURRENT_FORMAT: "не содержит данных актуального формата",
  NO_RESULTS: "нет данных по результатам или расчет не проводился",
});

function isMissingEntry(error) {
  return error?.name === "NotFoundError" || error?.name === "TypeMismatchError";
}

async function readSummaryText(taskHandle) {
  let inputHandle;
  try {
    inputHandle = await taskHandle.getDirectoryHandle(DIRECTORIES.INPUT);
  } catch (error) {
    if (isMissingEntry(error)) return TASK_SUMMARY_TEXT.NO_CURRENT_FORMAT;
    throw error;
  }

  try {
    const summaryHandle = await inputHandle.getFileHandle(SUMMARY_FILE_NAME);
    const summaryFile = await summaryHandle.getFile();
    return await summaryFile.text();
  } catch (error) {
    if (isMissingEntry(error)) return TASK_SUMMARY_TEXT.NO_INFORMATION;
    throw error;
  }
}

export async function readTaskSummary(taskHandle) {
  return {
    summaryText: await readSummaryText(taskHandle),
  };
}

// Read results independently of input metadata and preserve the file's text.
export async function readTaskResultsSummary(taskHandle) {
  try {
    const outputHandle = await taskHandle.getDirectoryHandle(DIRECTORIES.OUTPUT);
    const summaryHandle = await outputHandle.getFileHandle(RESULTS_SUMMARY_FILE_NAME);
    const summaryFile = await summaryHandle.getFile();
    return await summaryFile.text();
  } catch (error) {
    if (isMissingEntry(error)) return TASK_SUMMARY_TEXT.NO_RESULTS;
    throw error;
  }
}

// Solver e10342f38d7dc0495df221c80f2119d9d54711fd:
// src/task/01_counters.jl, src/vsolver/02_solver.jl and 01_summary.jl.
// fm1: PPJN × IP, fm3: PPMN × IS, IP = IS = PPJ + PPM.
// src/base/defines.jl fixes REALM at Float32, independently of general.doubleFloat.
function formatMatrixSize(label, rows, columns) {
  const mib = 4 * rows * columns / 1024 ** 2;
  return `Матрица ${label}: ${rows} × ${columns}; ${mib.toFixed(6)} MiB (суммарно по MPI, Float32)`;
}

// A summary describes the same immutable BaseModel snapshot as the saved files.
export function formatTaskSummary(model, savedAt = new Date()) {
  const { general, elements = [], regions = [], amps = [], moves = [] } = model;
  if (!general || !Array.isArray(elements) || !Array.isArray(regions)) {
    throw new Error("Недостаточно данных для сводки задания");
  }
  let ppj = 0, ppm = 0, ppjn = 0, ppmn = 0, coils = 0;
  for (const record of elements) {
    if (record.targ === 3) coils = Math.max(coils, Math.abs(record.indCoil ?? 0));
    if (![0, 1, 2].includes(record.targ)) continue;
    const flags = kvFlags(record), count = 3 * eoCount(record);
    if (flags.rv) {
      ppj += count;
      if (record.targ === 0) ppjn += count;
    }
    if (flags.mv) {
      ppm += count;
      if (record.targ === 0) ppmn += count;
    }
  }
  for (const record of regions) coils = Math.max(coils, Math.abs(record.indCoil ?? 0));
  const lines = [
    `Сохранено редактором: ${savedAt.toISOString()}`,
    `Разрядность вычислений - ${general.doubleFloat ? "Double Float" : "Single Float"}`,
    `Число элементов: ${elements.filter(row => [0, 1, 2].includes(row.targ)).length}`,
    `Число областей: ${regions.length}`,
    `Число изм катушек: ${coils}`,
    `Число импульсов: ${amps?.length ?? 0}`,
    `Число траекторий: ${moves?.length ?? 0}`,
  ];
  if (elements.some(row => row.model === 2)) {
    if (general.htsMu) lines.push("ВТСП: Подключена магнитная подсистема");
    if (general.htsRo) lines.push("ВТСП: Подключена токовая подсистема");
    lines.push(`ВТСП: Режим ${general.htsRegimFC ? "FC" : "ZFC"}`);
  }
  if (general.evalForce) lines.push("Расчет силы/момента подключен");
  if (ppj > 0) lines.push(`Число компонент плотн тока J (PPJ): ${ppj}`);
  if (ppm > 0) lines.push(`Число компонент намагниченности M (PPM): ${ppm}`);
  if (ppj > 0) lines.push(formatMatrixSize("J", ppjn, ppj + ppm));
  if (ppm > 0) lines.push(formatMatrixSize("M", ppmn, ppj + ppm));
  if (ppj > 0 || ppm > 0) lines.push("Объём матриц указан без рабочих буферов, векторов и слабых операторов.");
  lines.push(`Шаг по времени, сек: ${general.timeStep}`,
    `Число интервалов по времени: ${general.countTimeSteps}`);
  return lines.join("\n") + "\n";
}

export async function writeTaskSummary(taskHandle, model, savedAt = new Date()) {
  const text = formatTaskSummary(model, savedAt);
  const input = await taskHandle.getDirectoryHandle(DIRECTORIES.INPUT, { create: true });
  const file = await input.getFileHandle(SUMMARY_FILE_NAME, { create: true });
  const stream = await file.createWritable();
  try {
    await stream.write(text);
    await stream.close();
  } catch (error) {
    try { await stream.abort(); } catch { /* Preserve the original write error. */ }
    throw error;
  }
}
