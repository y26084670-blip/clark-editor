import { MaterialBatchConflictError } from "../taskMaterialLibraryService.js";
import { createFmmMaterialFile } from "../materialImport/xapLibImporter.js";
import { FMM_DEFAULT_TABLE_ROWS } from "./materialConstants.js";

function positiveNumber(value, label) {
  if (value == null || (typeof value === "string" && !value.trim())) {
    throw new Error(`${label}: требуется конечное положительное число.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${label}: требуется конечное положительное число.`);
  }
  return number;
}

/** Pure generation: no files, library revisions or model mutations. */
export function createConstantMuFmm({ mu, hMax } = {}) {
  mu = positiveNumber(mu, "μ");
  hMax = positiveNumber(hMax, "Hmax");
  // No grouping or exponent notation: a portable filename with two decimals.
  const name = mu.toLocaleString("en-US", {
    useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  const hip = mu - 1;
  const tabl = Array.from({ length: FMM_DEFAULT_TABLE_ROWS }, (_, i) => {
    const h = i === FMM_DEFAULT_TABLE_ROWS - 1 ? hMax : hMax * (i / (FMM_DEFAULT_TABLE_ROWS - 1));
    const m = hip * h;
    if (!Number.isFinite(m)) throw new Error("Значения M выходят за допустимый числовой диапазон.");
    return [h, m === 0 ? 0 : m];
  });
  if (tabl.some((row, i) => i > 0 && row[0] <= tabl[i - 1][0])) {
    throw new Error("Hmax слишком мал для 12 различных точек таблицы.");
  }
  const record = { name, tabl, hip,
    comment: `μ = ${mu}; M = (μ − 1)H; Hmax = ${hMax} кА/м.` };
  createFmmMaterialFile(record); // Validate the standard filename and format now.
  return record;
}

/** Explicit Save overwrites this one named local characteristic. */
export async function saveConstantMuFmm({ taskHandle, record, service }) {
  const material = createFmmMaterialFile(record);
  const options = { taskHandle, kind: "FMM", materials: [material], sourceName: "μ = const" };
  let batch;
  try {
    batch = await service.writeImportedBatch(options);
  } catch (error) {
    if (!(error instanceof MaterialBatchConflictError)) throw error;
    // Save explicitly authorizes replacement. Recheck the observed SHA at the
    // second preflight: a concurrent external edit must not be overwritten.
    batch = await service.writeImportedBatch({
      ...options, overwrite: true, expectedConflicts: error.conflicts,
    });
  }
  const result = batch.results[0];
  return { ...record, _taskLibraryRecord: {
    source: "task", kind: "FMM", name: record.name,
    fileName: material.fileName, relativePath: result.path,
    byteSize: result.byteSize, sha256: result.sha256, data: material.data,
  } };
}

export function matchesConstantMuRecord(record, name) {
  const key = value => String(value ?? "").normalize("NFC").toLocaleLowerCase("ru-RU");
  return key(record.name) === key(name)
    || key(record._taskLibraryRecord?.fileName) === key(`${name}.txt`);
}
