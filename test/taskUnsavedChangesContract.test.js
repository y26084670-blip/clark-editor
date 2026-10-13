import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DIRECTORIES, TABS } from "../src/services/schemas/common/constants.js";

const tasksUrl = new URL("../src/tabs/Tasks.jsx", import.meta.url);
const appUrl = new URL("../src/App.jsx", import.meta.url);

const tasksSource = await readFile(tasksUrl, "utf8");
function taskFunctions(startMarker, endMarker) {
    const start = tasksSource.indexOf(startMarker), end = tasksSource.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start);
    return tasksSource.slice(start, end);
}
// Execute the actual selection, load and confirmation paths without JSX.
const createTaskLoading = new Function("dependencies", `
    const { batch, clearLoadedTaskState, selectionService, props, TABS, DIRECTORIES,
        setSelectedTask, selectedTask, setTaskInfo, setTaskResultsText, EMPTY_TASK_INFO,
        readTaskSummary, readTaskResultsSummary, loadedTaskHandle, unsavedChangesService,
        setPendingTaskLoad, pendingTaskLoad, unsavedDialog, returnToEditingButton,
        operation, galleryBusy, selectionReceiving, rootHandle, getFullPath, showLoadError, console,
        lastTaskHistory, projects, selectedProject, tasks } = dependencies;
    let taskLoadRevision = 0, taskInfoRevision = 0;
    ${taskFunctions("  const commitTaskLoad =", "  const handleLaunchComplete =")}
    ${taskFunctions("  const requestTaskLoad =", "  const taskLoaded =")}
    return { commitTaskLoad, selectTaskCandidate, requestTaskLoad, confirmTaskLoad, returnToEditing };
`);

function taskLoadingRuntime() {
    const state = { selected: null, loaded: null, path: "", active: TABS.TASKS.id,
        pending: null, dirty: false, opened: [], errors: [], returned: 0, galleryBusy: false, remembered: [] };
    const api = createTaskLoading({
        batch: callback => callback(),
        clearLoadedTaskState: () => { state.loaded = null; state.path = ""; },
        selectionService: {
            setLoadedTaskIsDemo() {},
            setLoadedTaskPath: value => { state.path = value; },
            setLoadedTaskHandle: value => { state.loaded = value; },
        },
        props: { onOpenTab: tab => {
            state.active = tab; state.opened.push({ tab, loaded: state.loaded, path: state.path });
        }, onReturnToEditing: () => { state.returned++; } },
        TABS, DIRECTORIES,
        setSelectedTask: value => { state.selected = value; }, selectedTask: () => state.selected,
        setTaskInfo() {}, setTaskResultsText() {}, EMPTY_TASK_INFO: {},
        readTaskSummary: async () => ({}), readTaskResultsSummary: async () => "",
        loadedTaskHandle: () => state.loaded, unsavedChangesService: { hasDirty: () => state.dirty },
        setPendingTaskLoad: value => { state.pending = value; }, pendingTaskLoad: () => state.pending,
        unsavedDialog: { open: false, showModal() { this.open = true; }, close() { this.open = false; } },
        returnToEditingButton: null, operation: () => null, rootHandle: () => ({ name: "Projects" }),
        galleryBusy: () => state.galleryBusy,
        selectionReceiving: () => false,
        projects: () => [{ name: "Project" }], selectedProject: () => "Project",
        tasks: () => state.selected ? [state.selected] : [],
        lastTaskHistory: {
            capture(_projects, _project, _tasks, task) { return { task: task.handle }; },
            async remember(snapshot) { if (snapshot) state.remembered.push(snapshot); },
        },
        getFullPath: async (_root, handle) => `Projects/${handle.name}`,
        showLoadError: name => state.errors.push(name), console: { log() {}, error() {} },
    });
    return { state, ...api };
}

function taskCandidate(name, getDirectoryHandle = async () => ({})) {
    return { name, handle: { name, getDirectoryHandle } };
}

test("task selection is committed only by the explicit load action", async () => {
    const source = await readFile(tasksUrl, "utf8");

    assert.match(source, /onClick=\{\(\) => selectTaskCandidate\(task\)\}/u);
    assert.match(source, /class="task-load-label"[\s\S]*?Загрузить для редактирования/u);
    assert.match(source, /const commitTaskLoad = .*clearLoadedTaskState\(\)/su);
    assert.match(source, /getDirectoryHandle\(DIRECTORIES\.INPUT\)/u);
    assert.doesNotMatch(source, /Текущее выбранное задание/u);
});

test("task replacement is guarded by a two-action modal", async () => {
    const source = await readFile(tasksUrl, "utf8");

    assert.match(source, /unsavedChangesService\.hasDirty\(\)/u);
    assert.match(source, /class="task-unsaved-dialog"/u);
    assert.match(source, /onCancel=\{\(event\) => event\.preventDefault\(\)\}/u);
    assert.match(source, />\s*Загрузить без сохранения\s*</u);
    assert.match(source, />\s*Вернуться к редактированию\s*</u);
    assert.match(source, /props\.onReturnToEditing\?\.\(\)/u);
});

test("tab headers expose reactive saved-state indicators", async () => {
    const source = await readFile(appUrl, "utf8");

    assert.match(source, /class="tab-change-indicator"|"tab-change-indicator": true/u);
    assert.match(source, /dirty: unsavedChangesService\.isDirty\(tab\.id\)/u);
    assert.match(source, /unsavedChangesService\.setBaseline\(schema\.id, itemModel\)/u);
    assert.match(source, /handleReturnToEditing/u);
});

test("selecting a row stays in Tasks; successful load opens General after task state is committed", async () => {
    const h = taskLoadingRuntime(), task = taskCandidate("New task");
    await h.selectTaskCandidate(task);
    assert.equal(h.state.active, TABS.TASKS.id); assert.deepEqual(h.state.opened, []);
    assert.deepEqual(h.state.remembered, []);
    await h.requestTaskLoad();
    assert.deepEqual(h.state.opened, [{ tab: TABS.GENERAL.id, loaded: task.handle, path: "Projects/New task" }]);
    assert.deepEqual(h.state.remembered, [{ task: task.handle }]);
});

test("GIF deletion blocks candidate changes and editor loads until it finishes", async () => {
    const h = taskLoadingRuntime(), task = taskCandidate("Selected"), other = taskCandidate("Other");
    await h.selectTaskCandidate(task);h.state.galleryBusy = true;
    await h.selectTaskCandidate(other);await h.requestTaskLoad();
    assert.equal(h.state.selected, task);assert.equal(h.state.loaded, null);assert.deepEqual(h.state.opened, []);
    h.state.galleryBusy = false;await h.selectTaskCandidate(other);await h.requestTaskLoad();
    assert.equal(h.state.selected, other);assert.equal(h.state.loaded, other.handle);
});

test("unsaved changes require confirmation before General opens; cancelling does not switch there", async () => {
    const h = taskLoadingRuntime(), task = taskCandidate("Replacement");
    h.state.loaded = { name: "Original" }; h.state.dirty = true;
    await h.selectTaskCandidate(task); await h.requestTaskLoad();
    assert.deepEqual(h.state.opened, []); assert.ok(h.state.pending);
    assert.deepEqual(h.state.remembered, []);
    h.returnToEditing();
    assert.deepEqual(h.state.opened, []); assert.equal(h.state.pending, null); assert.equal(h.state.returned, 1);
    assert.deepEqual(h.state.remembered, []);
    await h.requestTaskLoad(); h.confirmTaskLoad();
    assert.equal(h.state.active, TABS.GENERAL.id); assert.equal(h.state.loaded, task.handle);
    assert.deepEqual(h.state.remembered, [{ task: task.handle }]);
});

test("missing input and a stale editor load do not navigate away from Tasks", async () => {
    const h = taskLoadingRuntime();
    await h.selectTaskCandidate(taskCandidate("Missing", async () => { throw new DOMException("Missing", "NotFoundError"); }));
    await h.requestTaskLoad();
    assert.deepEqual(h.state.errors, ["Missing"]); assert.deepEqual(h.state.opened, []);
    let finish;
    const delayed = new Promise(resolve => { finish = resolve; });
    await h.selectTaskCandidate(taskCandidate("Old", () => delayed));
    const load = h.requestTaskLoad();
    await h.selectTaskCandidate(taskCandidate("Latest"));
    finish({}); await load;
    assert.equal(h.state.loaded, null); assert.equal(h.state.active, TABS.TASKS.id);
    assert.deepEqual(h.state.opened, []);
    assert.deepEqual(h.state.remembered, []);
});

test("rebinding a renamed or moved loaded task updates its handle without switching tabs", () => {
    const h = taskLoadingRuntime(), task = taskCandidate("Renamed");
    h.state.active = TABS.ELEMENTS.id;
    h.commitTaskLoad({ task, fullPath: "Other project/Renamed", openEditor: false });
    assert.equal(h.state.loaded, task.handle); assert.equal(h.state.path, "Other project/Renamed");
    assert.equal(h.state.active, TABS.ELEMENTS.id); assert.deepEqual(h.state.opened, []);
    assert.deepEqual(h.state.remembered, []);
    assert.match(taskFunctions("  async function finishTaskOperation(", "  let taskErrorCloseButton;"),
        /commitTaskLoad\(\{[^\n]+openEditor: false \}\)/u);
});

test("confirmation saves the originally requested task rather than a later preview row", async () => {
    const h = taskLoadingRuntime(), requested = taskCandidate("Requested"), preview = taskCandidate("Preview");
    h.state.loaded = {}; h.state.dirty = true;
    await h.selectTaskCandidate(requested); await h.requestTaskLoad();
    await h.selectTaskCandidate(preview); h.confirmTaskLoad();
    assert.equal(h.state.loaded, requested.handle);
    assert.deepEqual(h.state.remembered, [{ task: requested.handle }]);
});

test("opening the demo never writes a base directory's last-task record", () => {
    const h = taskLoadingRuntime();
    h.commitTaskLoad({ task: { ...taskCandidate("Demo"), isDemo: true }, fullPath: "Demo", lastTaskSnapshot: { task: {} } });
    assert.deepEqual(h.state.remembered, []);
});
