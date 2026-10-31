// Browser/native handoff. Only the native launcher accesses the shared memory.
export const ITERATION_STATUS_FILE = "clark.iteration-status.json";
export const ITERATION_REQUEST_FILE = "clark.iteration-request.json";
export const ITERATION_STATUS_MAX_AGE = 5000;
export const matrixIndexNames = ["element", "d1", "d2", "d3", "as", "ps", "ls"];
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function formatIterationValue(value, parameter) {
  return Number(value).toLocaleString("en-US", { useGrouping: false,
    minimumFractionDigits: parameter === "TAU" ? 4 : 10,
    maximumFractionDigits: parameter === "TAU" ? 4 : 10 });
}

export function parseIterationValue(text, parameter) {
  const source = String(text).trim().replace(",", ".");
  const value = /^[+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(source) ? Number(source) : NaN;
  const rounded = Number(formatIterationValue(value, parameter));
  if (!Number.isFinite(value) || !Number.isFinite(rounded)
    || (parameter === "TAU" ? value < 0.0001 || value > 1 || rounded < 0.0001 : value <= 0 || rounded <= 0)) {
    throw new Error(parameter === "TAU" ? "TAU: допустимы значения от 0.0001 до 1.0000."
      : "EPS должен быть положительным и представимым с 10 десятичными знаками.");
  }
  return rounded;
}

export function iterationTaskKey(status) {
  return status?.active ? `${status.sessionId}:${status.taskId}` : "";
}

export async function readIterationStatus(root, binding, now = Date.now()) {
  if (!root || binding?.bindingState !== "bound") return null;
  let text;
  try { text = await (await (await root.getFileHandle(ITERATION_STATUS_FILE)).getFile()).text(); }
  catch (error) { if (error?.name === "NotFoundError") return null; throw error; }
  // An atomic native replacement may briefly be unreadable; the UI fails closed.
  let status;
  try { status = JSON.parse(text.replace(/^\uFEFF/, "")); } catch { return null; }
  if (!status || typeof status !== "object" || Array.isArray(status)) return null;
  const age = now - Date.parse(status.updatedAt);
  if (status.schemaVersion !== 1 || status.workspaceId !== binding.workspaceId
    || !GUID.test(status.sessionId) || !Number.isFinite(age) || age < -1000
    || age > ITERATION_STATUS_MAX_AGE || status.active !== true) return null;
  if (!Number.isInteger(status.taskId) || status.taskId < 1 || typeof status.taskPath !== "string"
    || !Number.isFinite(status.tau) || status.tau <= 0 || status.tau > 1
    || !Number.isFinite(status.eps) || status.eps <= 0) return null;
  return status;
}

export async function sendIterationRequest(root, binding, status, values) {
  if (!values || !Object.keys(values).length) throw new Error("Отметьте нужные параметры активной задачи.");
  const parameters = {};
  for (const name of Object.keys(values)) {
    if (name === "MatrixBlock") {
      const address = {};
      for (const key of matrixIndexNames) {
        const raw = String(values[name]?.[key] ?? "").trim(), index = Number(raw);
        if (!/^\d+$/.test(raw) || !Number.isSafeInteger(index) || index < 1 || index > 2147483647)
          throw new Error(`Матричные элементы: ${key} — целый номер от 1 до 2147483647.`);
        address[key] = index;
      }
      parameters[name] = address;
      continue;
    }
    if (name === "MResidual" || name === "JResidual") {
      if (values[name] !== true) throw new Error("Признак записи невязки должен быть true.");
      parameters[name] = true;
      continue;
    }
    if (name !== "TAU" && name !== "EPS") throw new Error("Неизвестный параметр итераций.");
    parameters[name] = parseIterationValue(values[name], name);
  }
  const current = await readIterationStatus(root, binding);
  if (!current || iterationTaskKey(current) !== iterationTaskKey(status)) {
    throw new Error("Активное задание изменилось. Повторите ввод для нового задания.");
  }
  if (parameters.MatrixBlock && current.matrixBlockSupported !== true)
    throw new Error("Для записи матричных элементов требуется обновлённый Solver и его программа запуска.");
  const requestId = crypto.randomUUID();
  const handle = await root.getFileHandle(ITERATION_REQUEST_FILE, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(JSON.stringify({ schemaVersion: 1, workspaceId: binding.workspaceId,
      sessionId: current.sessionId, taskId: current.taskId, requestId, parameters }) + "\n");
    await writable.close();
  } catch (error) {
    try { await writable.abort(); } catch { /* Preserve the write error. */ }
    throw error;
  }
  return requestId;
}
