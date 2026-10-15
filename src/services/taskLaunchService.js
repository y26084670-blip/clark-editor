// Portable task lists and the filesystem handoff to the installed Clark launcher.
// No absolute filesystem path is obtained or constructed by the browser.
export const TASK_LIST_FILE = "clark.tasks.txt";
export const WORKSPACE_FILE = "clark.workspace.json";
export const PROOF_FILE = "clark.launch.json";
export const RESULT_FILE = "clark.launch-result.json";
export const SETTINGS_FILE = "clark.settings.json";
export const LAUNCH_ACTIONS = Object.freeze(["solver", "circuit", "modelica", "import"]);

const SCHEMA_VERSION = 1;
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESULT_STATES = new Set(["accepted", "completed", "error"]);
const pathKey = path => path.toLowerCase();

function requireRoot(root) {
  if (!root || root.kind !== "directory") {
    throw new Error("Выберите базовый каталог с проектами.");
  }
}

function requireGuid(value) {
  if (typeof value !== "string" || !GUID_PATTERN.test(value)) {
    throw new Error("Некорректный идентификатор связи с Clark. Свяжите каталог повторно.");
  }
  return value.toLowerCase();
}

function normalizeTaskPath(value) {
  if (typeof value !== "string") throw new Error("Путь задания должен быть текстом.");
  const path = value.trim().replaceAll("\\", "/");
  const segments = path.split("/");
  if (segments.length < 2 || segments.some(segment => (
    !segment || segment === "." || segment === ".."
    || /[<>:"|?*\u0000-\u001f]/.test(segment)
  ))) {
    throw new Error("Ожидается относительный путь «проект/задание» внутри базового каталога.");
  }
  return segments.join("/");
}

async function readTextFile(root, name) {
  requireRoot(root);
  try {
    const handle = await root.getFileHandle(name);
    return await (await handle.getFile()).text();
  } catch (error) {
    if (error?.name === "NotFoundError") return null;
    throw error;
  }
}

async function writeTextFile(root, name, text, { create = true } = {}) {
  requireRoot(root);
  const handle = await root.getFileHandle(name, { create });
  const writable = await handle.createWritable();
  try {
    await writable.write(text);
    await writable.close();
  } catch (error) {
    try { await writable.abort(); } catch { /* Preserve the original write failure. */ }
    throw error;
  }
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

function collectEntries(entries) {
  const unique = new Map();
  for (const entry of entries) {
    const path = normalizeTaskPath(entry.path);
    const key = pathKey(path);
    const previous = unique.get(key);
    unique.set(key, {
      path: previous?.path ?? path,
      // A duplicate disabled line must not accidentally enable the same task.
      enabled: entry.enabled === true && (previous?.enabled ?? true),
    });
  }
  return [...unique.values()];
}

function parseTaskList(text, { tolerateInvalid = false } = {}) {
  const entries = [];
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    const enabled = !line.startsWith("*");
    try {
      entries.push({
        path: normalizeTaskPath(enabled ? line : line.slice(1).trim()),
        enabled,
      });
    } catch (error) {
      if (tolerateInvalid) continue;
      throw new Error(
        `Некорректная строка ${index + 1} в «${TASK_LIST_FILE}». `
        + `${error.message} Нажмите «Обновить список», чтобы собрать его из каталогов заданий.`,
      );
    }
  }
  return collectEntries(entries);
}

export async function readTaskList(root) {
  const text = await readTextFile(root, TASK_LIST_FILE);
  return { exists: text !== null, entries: text === null ? [] : parseTaskList(text) };
}

export async function invalidateLaunchRequest(root) {
  try {
    // Close the invalidation before changing the list that a launch could read.
    await writeTextFile(root, PROOF_FILE, "", { create: false });
  } catch (error) {
    if (error?.name !== "NotFoundError") throw error;
  }
}

export async function writeTaskList(root, entries) {
  const normalized = collectEntries(entries);
  const text = normalized.map(entry => `${entry.enabled ? "" : "*"}${entry.path}`).join("\n");
  await invalidateLaunchRequest(root);
  await writeTextFile(root, TASK_LIST_FILE, text ? text + "\n" : "");
  return { exists: true, entries: normalized };
}

export async function refreshTaskList(root) {
  requireRoot(root);
  const previousText = await readTextFile(root, TASK_LIST_FILE);
  // Update is the explicit way to replace invalid/obsolete rows with actual tasks.
  const previous = new Map(
    parseTaskList(previousText ?? "", { tolerateInvalid: true })
      .map(entry => [pathKey(entry.path), entry.enabled]),
  );
  const discovered = [];
  // Match the project/task discovery used by Tasks, including pre-import tasks.
  for await (const [projectName, project] of root.entries()) {
    if (project.kind !== "directory") continue;
    for await (const [taskName, task] of project.entries()) {
      if (task.kind !== "directory") continue;
      const path = normalizeTaskPath(`${projectName}/${taskName}`);
      discovered.push({ path, enabled: previous.get(pathKey(path)) ?? false });
    }
  }
  discovered.sort((left, right) => (
    left.path.localeCompare(right.path, "ru", { numeric: true, sensitivity: "base" })
    || left.path.localeCompare(right.path, "ru")
  ));
  return writeTaskList(root, discovered);
}

export function setTaskListEntriesEnabled(root, entries, selectedPaths, enabled) {
  const selected = new Set([...selectedPaths].map(path => pathKey(normalizeTaskPath(path))));
  return writeTaskList(root, entries.map(entry => ({
    ...entry,
    enabled: selected.has(pathKey(entry.path)) ? enabled === true : entry.enabled,
  })));
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
    if (action === "import") throw new Error("Для импорта число процессов MPI не задаётся.");
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
