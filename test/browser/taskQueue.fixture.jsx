import { render } from "solid-js/web";
import App from "../../src/App.jsx";
import { initializeTaskDirectory } from "../../src/services/taskTemplateService.js";
import { selectionService } from "../../src/services/selectionService.js";
import { unsavedChangesService } from "../../src/services/unsavedChangesService.js";

const opfs = await navigator.storage.getDirectory();
try { await opfs.removeEntry("task-queue-test", { recursive: true }); }
catch (error) { if (error.name !== "NotFoundError") throw error; }
const disk = await opfs.getDirectoryHandle("task-queue-test", { create: true });
const roots = {}, handles = {};
async function write(root, name, text) {
  const writable = await (await root.getFileHandle(name, { create: true })).createWritable();
  await writable.write(text); await writable.close();
}
async function read(root, name) { return (await (await root.getFileHandle(name)).getFile()).text(); }
for (const name of ["clark.projects", "CLARK.Tests"]) {
  const root = roots[name] = await disk.getDirectoryHandle(name, { create: true });
  await write(root, "clark.workspace.json", JSON.stringify({ schemaVersion: 1,
    workspaceId: crypto.randomUUID(), rootName: name, bindingState: "bound", taskQueueVersion: 1 }));
  for (const projectName of ["Проект 1", "Проект 2"]) {
    const project = await root.getDirectoryHandle(projectName, { create: true });
    const task = await project.getDirectoryHandle("Задание", { create: true });
    handles[`${name}/${projectName}/Задание`] = task;
    await initializeTaskDirectory(task);
  }
}
window.showDirectoryPicker = async () => disk;
window.queueFixture = {
  ready: true,
  read: (name, root = "clark.projects") => read(roots[root], name),
  async ack(state = "accepted") {
    const proof = JSON.parse(await read(roots["clark.projects"], "clark.launch.json"));
    await write(roots["clark.projects"], "clark.launch-result.json", JSON.stringify({ ...proof,
      action: "solver", state, message: "Проверка запуска очереди", exitCode: state === "completed" ? 0 : undefined }));
  },
  async setDirty(path) {
    selectionService.setLoadedTaskHandle(handles[path]);
    selectionService.setLoadedTaskIsDemo(false);
    selectionService.setLoadedTaskPath(path ?? "");
    await new Promise(resolve => setTimeout(resolve, 100));
    unsavedChangesService.setExplicitDirty("general", Boolean(path));
  },
};
render(() => <App />, document.getElementById("root"));
