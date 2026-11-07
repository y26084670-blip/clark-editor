import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { TaskLaunchWindow } from "../../src/components/tasks/TaskLaunchWindow.jsx";
import { selectionService } from "../../src/services/selectionService.js";
import { unsavedChangesService } from "../../src/services/unsavedChangesService.js";

const disk = await (await navigator.storage.getDirectory()).getDirectoryHandle("launch-controls-test", { create: true });
const root = await disk.getDirectoryHandle("clark.projects", { create: true });
const other = await disk.getDirectoryHandle("clark.other", { create: true });
const handles = {};
for (const catalog of [root, other]) {
  const project = await catalog.getDirectoryHandle("Project", { create: true });
  for (const name of ["One", "Two"]) handles[`${catalog.name}/Project/${name}`] = await project.getDirectoryHandle(name, { create: true });
}
async function write(name, value) {
  const stream = await (await root.getFileHandle(name, { create: true })).createWritable();
  await stream.write(typeof value === "string" ? value : JSON.stringify(value)); await stream.close();
}
async function read(name) { return JSON.parse(await (await (await root.getFileHandle(name)).getFile()).text()); }
let denied = false, attempts = 0, accepted = null;
function wrapper() {
  return { kind: "directory", name: root.name, resolve: root.resolve.bind(root),
    getDirectoryHandle: root.getDirectoryHandle.bind(root),
    getFileHandle(name, options) {
      if (name === "clark.launch.json" && options?.create) {
        attempts++;
        if (denied) throw new DOMException("Доступ к файлу запуска запрещён", "NotAllowedError");
      }
      return root.getFileHandle(name, options);
    },
  };
}
let initial;
try { initial = await read("clark.workspace.json"); }
catch { initial = { schemaVersion: 1, workspaceId: crypto.randomUUID(), rootName: root.name,
  bindingState: "bound", taskQueueVersion: 1, launchOptionsVersion: 1 }; }
await write("clark.workspace.json", initial);
await write("clark.tasks.txt", "Project/One\n");
const [source, setSource] = createSignal(wrapper());
const [binding, setBinding] = createSignal(initial);
const [bindingBusy, setBindingBusy] = createSignal(false);
const [blocked, setBlocked] = createSignal("");
async function workspace(change = {}) {
  const next = { ...binding(), ...change };
  await write("clark.workspace.json", next); setBinding(next);
}
window.controls = {
  workspace, bindingBusy: setBindingBusy, blocked: setBlocked,
  attempts: () => attempts, proof: () => read("clark.launch.json"),
  denyProof(value) { denied = value; },
  async queue(paths) { await write("clark.tasks.txt", paths.join("\n") + "\n"); setSource(wrapper()); },
  loaded(path, dirty = false) {
    selectionService.setLoadedTaskHandle(handles[path] ?? null);
    selectionService.setLoadedTaskPath(path ?? ""); selectionService.setLoadedTaskIsDemo(false);
    unsavedChangesService.clear();
    if (dirty) unsavedChangesService.setExplicitDirty("general", true);
  },
  async respond(state) {
    if (state === "accepted") accepted = await read("clark.launch.json");
    await write("clark.launch-result.json", { ...accepted, action: "solver", state, message: `Native ${state}`,
      exitCode: state === "completed" ? 0 : undefined });
  },
  async active(active, changes = {}) {
    await write("clark.iteration-status.json", { schemaVersion: 1, workspaceId: binding().workspaceId,
      sessionId: crypto.randomUUID(), taskId: 1, taskPath: "Project/One", active,
      tau: 0.3, eps: 0.005, updatedAt: new Date().toISOString(), ...changes });
  },
};
render(() => <TaskLaunchWindow open rootHandle={source()} diskHandle={disk}
  catalogs={[{ name: root.name, handle: root }, { name: other.name, handle: other }]}
  binding={binding()} bindingBusy={bindingBusy()} blockedMessage={blocked()}
  initialRect={{ x: 20, y: 20, width: 1100, height: 740 }}
  onNavigate={() => workspace()} onSave={() => unsavedChangesService.clear()} />, document.getElementById("root"));
window.controls.ready = true;
