import { isProjectCatalog, readTaskQueueCatalog } from "./projectDiskAccessService.js";

export const TASK_DRAG_TYPE = "application/x-clark-task";
const keyOf = value => value.toLowerCase();

// The queue belongs to its original catalog, independently of browser selection.
export function describeTaskQueue(root, catalogs, entries) {
  return entries.filter(entry => entry.enabled).map(entry => {
    const parts = entry.path.split("/");
    const sibling = parts[0] === "..";
    const catalog = sibling ? parts[1] : root.name;
    const taskPath = (sibling ? parts.slice(2) : parts).join("/");
    const rootHandle = sibling
      ? catalogs.find(item => keyOf(item.name) === keyOf(catalog))?.handle ?? null : root;
    return { ...entry, rootHandle, taskPath, displayPath: `${catalog}/${taskPath}` };
  });
}

export async function createTaskQueueEntry(queueRoot, disk, source) {
  const root = source?.rootHandle;
  if (!queueRoot || !disk || !root || !source.handle || !isProjectCatalog(root.name)) {
    throw new Error("Перетащите задание из списка выбранного проекта.");
  }
  const [origin, location, parts] = await Promise.all([
    disk.resolve(queueRoot), disk.resolve(root), root.resolve(source.handle),
  ]);
  if (origin?.length !== 1 || location?.length !== 1 || parts?.length !== 2
    || keyOf(origin[0]) !== keyOf(queueRoot.name) || keyOf(location[0]) !== keyOf(root.name)) {
    throw new Error("Задание должно находиться в каталоге с проектами выбранного диска.");
  }
  const taskPath = parts.join("/");
  const sameCatalog = keyOf(origin[0]) === keyOf(location[0]);
  return { path: sameCatalog ? taskPath : `../${location[0]}/${taskPath}`, enabled: true };
}

export async function restoreTaskQueueRoot(disk, catalogs, readCatalog = readTaskQueueCatalog) {
  const saved = await readCatalog(disk);
  const remembered = catalogs.find(item => keyOf(item.name) === keyOf(saved ?? ""));
  if (remembered) return remembered.handle;
  // До появления сохранённого адреса используем последний записанный список.
  const lists = await Promise.all(catalogs.map(async catalog => {
    try {
      const file = await (await catalog.handle.getFileHandle("clark.tasks.txt")).getFile();
      return { handle: catalog.handle, modified: file.lastModified };
    } catch (error) {
      if (error?.name === "NotFoundError") return null;
      throw error;
    }
  }));
  return lists.filter(Boolean).sort((left, right) => right.modified - left.modified)[0]?.handle ?? null;
}

export function taskQueueWindowRect(panels, viewport = window) {
  const middle = panels?.querySelector(".task-summary-panel")?.getBoundingClientRect();
  const right = panels?.querySelector(".task-results-panel")?.getBoundingClientRect();
  const x = Math.max(0, Math.min(middle?.left ?? viewport.innerWidth / 3, viewport.innerWidth - 1));
  const y = Math.max(0, Math.min(middle?.top ?? 8, viewport.innerHeight - 1));
  const bottom = Math.min(viewport.innerHeight, Math.max(middle?.bottom ?? viewport.innerHeight, right?.bottom ?? viewport.innerHeight));
  return { x, y, width: Math.max(1, Math.min(right?.right ?? viewport.innerWidth, viewport.innerWidth) - x),
    height: Math.max(1, bottom - y) };
}

export function watchTaskQueueWindowRect(panels, update, browser = window) {
  const refresh = () => update(taskQueueWindowRect(panels, browser));
  const observer = new browser.ResizeObserver(refresh);
  for (const name of [".task-summary-panel", ".task-results-panel"]) {
    const panel = panels?.querySelector(name);
    if (panel) observer.observe(panel);
  }
  browser.addEventListener("resize", refresh);
  browser.addEventListener("scroll", refresh, true);
  refresh();
  return () => { observer.disconnect(); browser.removeEventListener("resize", refresh); browser.removeEventListener("scroll", refresh, true); };
}
