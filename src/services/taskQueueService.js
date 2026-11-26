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

export { createTaskQueueEntry, restoreTaskQueueRoot } from "./taskListFile.js";

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
