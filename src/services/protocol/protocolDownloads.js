export const PROTOCOL_MAX_BYTES = 256 * 1024 * 1024;
const PROTOCOL_SIZE_ERROR = "Протокол превышает 256 МиБ.";
function protocolFilename(value) {
  const name = String(value).trim();
  if (!name || name.length > 120 || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name)
    || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name) || !/^.+\.html$/i.test(name)) {
    throw new Error("Укажите имя файла с расширением .html без символов пути.");
  }
  return name;
}
async function listTaskProtocols(task) {
  const names = [];
  let directory;
  try { directory = await task.handle.getDirectoryHandle("DOCS", { create: false }); }
  catch (error) { if (error.name === "NotFoundError") return []; throw error; }
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind === "file" && /\.html$/i.test(name)) names.push(name);
  }
  return names.sort((a, b) => a.localeCompare(b, "ru", { numeric: true }));
}


// Only file metadata is read while scanning the task list, never the HTML/media.
export async function listTaskProtocolDownloads(taskHandle, { signal } = {}) {
  signal?.throwIfAborted();
  const names = await listTaskProtocols({ handle: taskHandle });
  signal?.throwIfAborted();
  if (!names.length) return [];
  const directory = await taskHandle.getDirectoryHandle("DOCS", { create: false });
  const entries = [];
  for (const name of names) {
    signal?.throwIfAborted();
    const handle = await directory.getFileHandle(protocolFilename(name), { create: false });
    const file = await handle.getFile();
    signal?.throwIfAborted();
    entries.push({ name, handle, size: file.size, lastModified: file.lastModified });
  }
  return entries;
}

export async function scanTaskProtocolDownloads(tasks, { signal, concurrency = 6 } = {}) {
  const result = new Map();
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(tasks.length, Math.max(1, Math.floor(concurrency) || 1)) }, async () => {
    while (index < tasks.length) {
      signal?.throwIfAborted();
      const task = tasks[index++];
      try {
        result.set(task.handle, { files: await listTaskProtocolDownloads(task.handle, { signal }), error: "" });
      } catch (error) {
        signal?.throwIfAborted();
        if (error.name === "AbortError") throw error;
        result.set(task.handle, { files: [], error: error.message || "Не удалось проверить протоколы в DOCS." });
      }
    }
  }));
  signal?.throwIfAborted();
  return result;
}

export async function readProtocolDownload(entry, { signal } = {}) {
  signal?.throwIfAborted();
  const name = protocolFilename(entry.name);
  // Read afresh: the original file may have changed since the task-list scan.
  const file = await entry.handle.getFile();
  signal?.throwIfAborted();
  if (!file.size) throw new Error(`Протокол «${name}» пуст.`);
  if (file.size > PROTOCOL_MAX_BYTES) throw new Error(PROTOCOL_SIZE_ERROR);
  return { name, blob: file.slice(0, file.size, "text/html;charset=utf-8") };
}
