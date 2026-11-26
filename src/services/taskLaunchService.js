// Filesystem handoff to the installed Clark launcher.
import { requireRoot, readTextFile, writeTextFile, PROOF_FILE, invalidateLaunchRequest } from "./taskListFile.js";
export { TASK_LIST_FILE, PROOF_FILE, readTaskList, writeTaskList, refreshTaskList, setTaskListEntriesEnabled, invalidateLaunchRequest } from "./taskListFile.js";
export const WORKSPACE_FILE = "clark.workspace.json";
export const RESULT_FILE = "clark.launch-result.json";
export const SETTINGS_FILE = "clark.settings.json";
export const LAUNCH_ACTIONS = Object.freeze(["solver", "circuit", "modelica", "import", "unblock"]);

const SCHEMA_VERSION = 1;
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESULT_STATES = new Set(["accepted", "completed", "error"]);
function requireGuid(value) {
  if (typeof value !== "string" || !GUID_PATTERN.test(value)) {
    throw new Error("Некорректный идентификатор связи с Clark. Свяжите каталог повторно.");
  }
  return value.toLowerCase();
}

async function readJsonFile(root, name) {
  const text = await readTextFile(root, name);
  if (text === null) return null;
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error(`Не удалось прочитать служебный файл «${name}».`);
  }
}

function writeJsonFile(root, name, value) {
  return writeTextFile(root, name, JSON.stringify(value, null, 2) + "\n");
}

export async function readWorkspaceBinding(root) {
  const marker = await readJsonFile(root, WORKSPACE_FILE);
  if (marker === null) return null;
  if (marker.schemaVersion !== SCHEMA_VERSION
    || typeof marker.rootName !== "string"
    || !["pending", "bound"].includes(marker.bindingState)) {
    throw new Error("Некорректные данные связи с Clark. Свяжите каталог повторно.");
  }
  return { ...marker, workspaceId: requireGuid(marker.workspaceId) };
}

export async function prepareWorkspaceBinding(root) {
  requireRoot(root);
  const workspaceId = globalThis.crypto.randomUUID();
  await invalidateLaunchRequest(root);
  await writeJsonFile(root, WORKSPACE_FILE, {
    schemaVersion: SCHEMA_VERSION,
    workspaceId,
    rootName: root.name,
    bindingState: "pending",
  });
  const query = new URLSearchParams({ request: workspaceId, name: root.name });
  return { workspaceId, uri: `clark://bind?${query}` };
}

export async function prepareLaunchRequest(root, binding) {
  requireRoot(root);
  const workspaceId = requireGuid(binding?.workspaceId);
  const current = await readWorkspaceBinding(root);
  if (current?.workspaceId !== workspaceId || current.bindingState !== "bound") {
    throw new Error("Сначала свяжите базовый каталог с Clark.");
  }
  const requestId = globalThis.crypto.randomUUID();
  await writeJsonFile(root, PROOF_FILE, {
    schemaVersion: SCHEMA_VERSION,
    workspaceId,
    requestId,
  });
  return { workspaceId, requestId };
}

// Keep opening the URI synchronous in the click handler; prepare files beforehand.
export function parseMpiRanks(value) {
  const text = String(value ?? "").trim();
  if (!text || text.toLowerCase() === "default") return null;
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) > 2147483647) {
    throw new Error("Число процессов MPI: целое число от 1 до 2147483647 или default.");
  }
  return Number(text);
}

export function formatMpiRanks(value) {
  return Number.isInteger(value) && value >= 1 && value <= 2147483647 ? String(value) : "default";
}

export function createNativeSettingsRequest(binding) {
  if (binding?.bindingState !== "bound" || binding.launchOptionsVersion !== 1) return null;
  const workspaceId = requireGuid(binding.workspaceId);
  const requestId = globalThis.crypto.randomUUID();
  const query = new URLSearchParams({ workspace: workspaceId, request: requestId });
  return { workspaceId, requestId, uri: `clark://settings?${query}` };
}

export async function readRuntimeSettings(root, request) {
  const result = await readJsonFile(root, SETTINGS_FILE);
  if (result === null || result.requestId !== request.requestId
    || result.workspaceId !== request.workspaceId) return null;
  if (result.schemaVersion !== SCHEMA_VERSION
    || (result.mpiRanks !== null && formatMpiRanks(result.mpiRanks) === "default")) {
    throw new Error("Некорректные настройки запуска Clark.");
  }
  return result;
}

export function createNativeLaunchUri(workspaceId, action, requestId, mpiRanks = null) {
  if (!LAUNCH_ACTIONS.includes(action)) throw new Error("Неизвестное действие Clark.");
  const query = new URLSearchParams({
    workspace: requireGuid(workspaceId),
    action,
    request: requireGuid(requestId),
  });
  const ranks = parseMpiRanks(mpiRanks);
  if (ranks !== null) {
    if (action === "import" || action === "unblock") throw new Error("Для импорта и разблокировки число процессов MPI не задаётся.");
    query.set("mpiRanks", String(ranks));
  }
  return `clark://run?${query}`;
}

export async function readLaunchResult(root, requestId) {
  const expectedRequest = requireGuid(requestId);
  const result = await readJsonFile(root, RESULT_FILE);
  if (result === null || typeof result.requestId !== "string"
    || result.requestId.toLowerCase() !== expectedRequest) return null;
  if (result.schemaVersion !== SCHEMA_VERSION || !RESULT_STATES.has(result.state)
    || !LAUNCH_ACTIONS.includes(result.action) || typeof result.message !== "string") {
    throw new Error("Некорректный ответ запускателя Clark.");
  }
  return {
    ...result,
    workspaceId: requireGuid(result.workspaceId),
    requestId: expectedRequest,
  };
}
