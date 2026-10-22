// Filesystem-only operations. A verified destination is retained on any partial
// relocation; the caller receives its handle and whether deletion was attempted.
import { DIRECTORIES, TASK_UNAPPROVED_FILE } from "./schemas/common/constants.js";
import { readTaskList, writeTaskList, invalidateLaunchRequest } from "./taskLaunchService.js";

export function validateTaskName(value) {
  if (typeof value !== "string" || !value || value !== value.trim()
      || value.length > 120 || /[<>:"/\\|?*\u0000-\u001f]/u.test(value)
      || /[. ]$/u.test(value) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(value)) {
    throw new Error("Введите имя до 120 символов без служебных символов, пробелов по краям и зарезервированных имён Windows.");
  }
  return value;
}

export function includeTaskInput(path) {
  const parts = path.toLowerCase().split("/");
  return !parts.some(name => [DIRECTORIES.OUTPUT.toLowerCase(), "logs", "tmp", "temp", ".git"].includes(name))
    && !/(?:\.log|\.tmp|\.temp|~)$/iu.test(parts.at(-1))
    && !["_summary_out.txt", TASK_UNAPPROVED_FILE].includes(parts.at(-1));
}

async function writeFile(directory, name, bytes) {
  const handle = await directory.getFileHandle(name, { create: true });
  const stream = await handle.createWritable();
  try {
    await stream.write(bytes);
    await stream.close();
  } catch (error) {
    try { await stream.abort(); } catch { /* Keep the original failure. */ }
    throw error;
  }
}

async function directoryAt(root, path, create = false) {
  let directory = root;
  for (const name of path.split("/").filter(Boolean)) {
    directory = await directory.getDirectoryHandle(name, { create });
  }
  return directory;
}

async function hashFile(handle) {
  const file = await handle.getFile();
  const bytes = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return { size: file.size, hash: Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("") };
}

async function manifest(root, include, prefix = "", result = []) {
  for await (const [name, handle] of root.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (!include(path)) continue;
    result.push({ path, kind: handle.kind, ...(handle.kind === "file" ? await hashFile(handle) : {}) });
    if (handle.kind === "directory") await manifest(handle, include, path, result);
  }
  return result.sort((a, b) => a.path.localeCompare(b.path, "en"));
}

async function assertManifest(root, expected, include) {
  if (JSON.stringify(await manifest(root, include)) !== JSON.stringify(expected)) {
    throw new Error(`Содержимое «${root.name}» изменилось или проверка целостности не пройдена.`);
  }
}

async function assertUnused(parent, name) {
  for await (const [existing] of parent.entries()) {
    if (existing.normalize("NFC").toLowerCase() === name.normalize("NFC").toLowerCase()) {
      throw new Error(`Имя «${name}» уже занято. Перезапись запрещена.`);
    }
  }
}

async function copyManifest(source, target, entries) {
  for (const entry of entries) {
    if (entry.kind === "directory") {
      await directoryAt(target, entry.path, true);
    } else {
      const parts = entry.path.split("/");
      const name = parts.pop();
      const input = await directoryAt(source, parts.join("/"));
      const output = await directoryAt(target, parts.join("/"), true);
      await writeFile(output, name, await (await input.getFileHandle(name)).getFile());
    }
  }
}

export async function suggestTaskCopyName(parent, name) {
  const names = new Set();
  for await (const [entry] of parent.entries()) names.add(entry.normalize("NFC").toLowerCase());
  const base = name.slice(0, 100) + " — копия";
  let candidate = base;
  for (let i = 2; names.has(candidate.normalize("NFC").toLowerCase()); i++) candidate = `${base} ${i}`;
  return candidate;
}

// Only the list in the selected root is owned by the GUI. An external move
// removes the old row; it cannot invent an absolute path or edit another root.
async function prepareListUpdate(root, source, destinationParent, name, relocate) {
  if (!root) return async () => {};
  const before = await readTaskList(root);
  if (!before.exists) return async () => {};
  const oldSegments = source ? await root.resolve(source) : null;
  const parentSegments = await root.resolve(destinationParent);
  const oldPath = oldSegments?.join("/").toLowerCase();
  const newPath = parentSegments?.length === 1 ? [...parentSegments, name].join("/") : null;
  const entries = before.entries.flatMap(entry => {
    if (!relocate || entry.path.toLowerCase() !== oldPath) return [entry];
    return newPath ? [{ ...entry, path: newPath }] : [];
  });
  if (newPath && !entries.some(entry => entry.path.toLowerCase() === newPath.toLowerCase())) {
    entries.push({ path: newPath, enabled: false });
  }
  // Reject obsolete destination rows instead of merging their enabled state.
  if (newPath && before.entries.some(entry => entry.path.toLowerCase() === newPath.toLowerCase())) {
    throw new Error("В списке запуска уже есть путь назначения. Обновите список и повторите операцию.");
  }
  return async () => {
    if (JSON.stringify(await readTaskList(root)) !== JSON.stringify(before)) {
      throw new Error("Список запуска изменился во время операции. Источник сохранён; проверьте список.");
    }
    await writeTaskList(root, entries);
  };
}

async function deleteTaskDirectory({ root, sourceParent, source }) {
  // Удалять разрешено только выбранное задание непосредственно в проекте.
  const assertSource = async () => {
    if (!root || !sourceParent || !source
        || (await root.resolve(sourceParent))?.length !== 1
        || (await sourceParent.resolve(source))?.length !== 1
        || (await root.resolve(source))?.length !== 2) {
      throw new Error("Выберите задание внутри текущего проекта. Корень и каталог проекта удалять нельзя.");
    }
    const current = await sourceParent.getDirectoryHandle(source.name);
    if (!await current.isSameEntry(source)) throw new Error("Каталог задания был заменён. Обновите список и выберите его заново.");
  };
  await assertSource();
  const before = await readTaskList(root);
  const oldPath = (await root.resolve(source)).join("/").toLowerCase();
  const result = { name: source.name, deletionStarted: false, sourceRemoved: false };
  try {
    if (JSON.stringify(await readTaskList(root)) !== JSON.stringify(before)) {
      throw new Error("Список запуска изменился во время операции. Обновите список и повторите удаление.");
    }
    await assertSource();
    // Сначала исключаем запуск удаляемого задания. Сбой записи оставляет каталог.
    if (before.exists) {
      await writeTaskList(root, before.entries.filter(entry => entry.path.toLowerCase() !== oldPath));
    } else {
      await invalidateLaunchRequest(root);
    }
    await assertSource();
    result.deletionStarted = true;
    await sourceParent.removeEntry(source.name, { recursive: true });
    result.sourceRemoved = true;
    return result;
  } catch (cause) {
    const state = result.deletionStarted
      ? "Удаление началось и могло завершиться частично. Проверьте оставшиеся файлы; восстановление через Undo недоступно."
      : "Каталог задания не удалялся.";
    const error = new Error(`Не удалось удалить «${sourceParent.name}/${source.name}». ${state} Список запуска мог быть изменён.\n${cause.message}`, { cause });
    error.operationResult = result;
    throw error;
  }
}

export async function runTaskDirectoryOperation({ kind, root, sourceParent, source, destinationParent, name, initialize }) {
  if (kind === "delete") return deleteTaskDirectory({ root, sourceParent, source });
  if (!["create", "copy", "rename", "move"].includes(kind)) throw new Error("Неизвестная операция с заданием.");
  validateTaskName(name);
  const relocate = kind === "rename" || kind === "move";
  if (kind !== "create" && !source) throw new Error("Выберите исходное задание.");
  if (relocate && (!sourceParent || !(await sourceParent.resolve(source))?.length
      || (await sourceParent.resolve(source)).length !== 1)) throw new Error("Исходный каталог задания недоступен.");
  if (source && await source.resolve(destinationParent) !== null) {
    throw new Error("Нельзя разместить задание внутри самого себя.");
  }
  const destinationPath = root ? await root.resolve(destinationParent) : null;
  if (destinationPath !== null && destinationPath.length !== 1) {
    throw new Error("В базовом каталоге выберите каталог проекта, а не корень или вложенное задание.");
  }
  if (kind === "move") {
    try {
      await destinationParent.getDirectoryHandle(DIRECTORIES.INPUT);
      throw new Error("Выбран каталог задания. Выберите каталог проекта назначения.");
    } catch (error) { if (error.name !== "NotFoundError") throw error; }
  }
  await assertUnused(destinationParent, name);
  const publishList = await prepareListUpdate(root, source, destinationParent, name, relocate);
  const include = kind === "copy" ? includeTaskInput : () => true;
  if (kind === "copy") await source.getDirectoryHandle(DIRECTORIES.INPUT);
  const expected = source ? await manifest(source, include) : null;
  // Recheck after the potentially long read and immediately before creation.
  await assertUnused(destinationParent, name);
  const target = await destinationParent.getDirectoryHandle(name, { create: true });
  const result = { handle: target, name, verified: false, deletionStarted: false, sourceRemoved: false };
  let ownsTarget = false;
  let guardInput = null;
  const markerPath = `${DIRECTORIES.INPUT}/${TASK_UNAPPROVED_FILE}`;
  try {
    // Detect a competing creator where possible; FS Access has no exclusive mkdir.
    for await (const _ of target.entries()) throw new Error("Каталог назначения уже содержит файлы.");
    ownsTarget = true;
    // Block incomplete current-format destinations from being launched. For a
    // legacy-only relocation, do not invent input3XX and change import semantics.
    if (!relocate || expected.some(entry => entry.path === DIRECTORIES.INPUT && entry.kind === "directory")) {
      guardInput = await target.getDirectoryHandle(DIRECTORIES.INPUT, { create: true });
      await writeFile(guardInput, TASK_UNAPPROVED_FILE, "Операция с каталогом ещё не завершена.\n");
    }
    if (kind === "create") {
      if (typeof initialize !== "function") throw new Error("Не задан начальный комплект.");
      await initialize(target);
    } else {
      await copyManifest(source, target, expected);
      const extraGuard = guardInput && !expected.some(entry => entry.path === markerPath);
      await assertManifest(target, expected, path => include(path) && !(extraGuard && path === markerPath));
      await assertManifest(source, expected, include);
    }
    if (!relocate) {
      const input = await target.getDirectoryHandle(DIRECTORIES.INPUT, { create: true });
      await writeFile(input, TASK_UNAPPROVED_FILE, "Требуется проверка и сохранение в редакторе.\n");
    }
    result.verified = true;
    await publishList();
    if (relocate) {
      // A second check protects against edits while publishing the task list.
      await assertManifest(source, expected, include);
      const current = await sourceParent.getDirectoryHandle(source.name);
      if (!await current.isSameEntry(source)) throw new Error("Исходный каталог был заменён.");
      result.deletionStarted = true;
      await sourceParent.removeEntry(source.name, { recursive: true });
      result.sourceRemoved = true;
      if (guardInput && !expected.some(entry => entry.path === markerPath)) await guardInput.removeEntry(TASK_UNAPPROVED_FILE);
    }
    return result;
  } catch (cause) {
    if (ownsTarget && guardInput && !result.verified) {
      try { await writeFile(guardInput, TASK_UNAPPROVED_FILE, "Операция не завершена. Проверьте содержимое задания.\n"); }
      catch { cause.message += " Не удалось записать защитный маркер; не запускайте назначение."; }
    }
    const state = result.deletionStarted
      ? "Удаление источника началось и могло завершиться частично. Проверенная полная копия сохранена в назначении."
      : "Источник не удалялся. Каталог назначения сохранён для проверки; повторная операция не перезапишет его.";
    const error = new Error(`Операция не завершена. Назначение: «${destinationParent.name}/${name}». ${state}\n${cause.message}`, { cause });
    error.operationResult = result;
    throw error;
  }
}

// Projects are direct children of the selected catalog. Reuse the task file
// manifest/verification mechanism, but update every launch path in the project.
export async function runProjectDirectoryOperation({ kind, root, source, name }) {
  if (!root || root.kind !== "directory") throw new Error("Выберите базовый каталог проектов.");
  if (!["create", "rename", "delete"].includes(kind)) throw new Error("Неизвестная операция с проектом.");
  const key = value => value.normalize("NFC").toLowerCase();
  const assertSource = async () => {
    if (!source || (await root.resolve(source))?.length !== 1) {
      throw new Error("Выберите проект непосредственно в текущем базовом каталоге.");
    }
    const current = await root.getDirectoryHandle(source.name);
    if (!await current.isSameEntry(source)) throw new Error("Каталог проекта был заменён. Выберите его заново.");
  };
  const assertEmpty = async directory => {
    for await (const _ of directory.entries()) throw new Error("Проект не пуст: в каталоге есть файлы или подкаталоги. Удаление запрещено.");
  };
  if (kind !== "create") await assertSource();
  if (kind === "delete") await assertEmpty(source);
  else { validateTaskName(name); await assertUnused(root, name); }
  if (kind === "create") {
    const handle = await root.getDirectoryHandle(name, { create: true });
    await assertEmpty(handle);
    return { handle, name, verified: true };
  }

  const before = await readTaskList(root);
  if (kind === "rename" && before.entries.some(entry => key(entry.path.split("/")[0]) === key(name))) {
    throw new Error("В списке запуска уже есть пути проекта назначения. Обновите список и повторите операцию.");
  }
  const entries = before.entries.flatMap(entry => {
    const [project, ...parts] = entry.path.split("/");
    if (key(project) !== key(source.name)) return [entry];
    return kind === "delete" ? [] : [{ ...entry, path: [name, ...parts].join("/") }];
  });
  const publishList = async () => {
    if (JSON.stringify(await readTaskList(root)) !== JSON.stringify(before)) {
      throw new Error("Список запуска изменился во время операции. Источник сохранён; проверьте список.");
    }
    if (before.exists) await writeTaskList(root, entries);
    else await invalidateLaunchRequest(root);
  };
  const result = { name: kind === "delete" ? source.name : name, verified: false, deletionStarted: false, sourceRemoved: false };
  const guards = [];
  try {
    if (kind === "delete") {
      await assertSource(); await assertEmpty(source);
      await publishList();
      await assertSource(); await assertEmpty(source);
      result.deletionStarted = true;
      // Never recursively remove a project through the empty-project command:
      // a concurrent file creation must make removal fail, not delete that file.
      await root.removeEntry(source.name, { recursive: false });
      result.sourceRemoved = true;
      return result;
    }
    const include = () => true;
    const expected = await manifest(source, include);
    await assertSource(); await assertUnused(root, name);
    const target = await root.getDirectoryHandle(name, { create: true });
    result.handle = target;
    await assertEmpty(target);
    for (const entry of expected) {
      const parts = entry.path.split("/");
      if (entry.kind !== "directory" || parts.length !== 2 || parts[1] !== DIRECTORIES.INPUT) continue;
      const marker = `${entry.path}/${TASK_UNAPPROVED_FILE}`;
      const input = await directoryAt(target, entry.path, true);
      await writeFile(input, TASK_UNAPPROVED_FILE, "Переименование проекта ещё не завершено.\n");
      if (!expected.some(item => item.path === marker)) guards.push({ input, marker });
    }
    await copyManifest(source, target, expected);
    const addedGuards = new Set(guards.map(item => item.marker));
    await assertManifest(target, expected, path => !addedGuards.has(path));
    await assertManifest(source, expected, include);
    result.verified = true;
    await publishList();
    await assertManifest(source, expected, include);
    await assertSource();
    result.deletionStarted = true;
    await root.removeEntry(source.name, { recursive: true });
    result.sourceRemoved = true;
    for (const { input } of guards) await input.removeEntry(TASK_UNAPPROVED_FILE);
    return result;
  } catch (cause) {
    const state = kind === "delete"
      ? "Непустой каталог не удаляется. Проверьте проект и список запуска."
      : result.deletionStarted
        ? "Удаление источника началось и могло завершиться частично. Проверенная полная копия сохранена в назначении."
        : "Источник не удалялся. Если назначение создано, оно сохранено для проверки и не будет перезаписано.";
    const error = new Error(`Операция с проектом не завершена. Проект: «${root.name}/${result.name}». ${state}\n${cause.message}`, { cause });
    error.operationResult = result;
    throw error;
  }
}
