import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
    getFilePickerErrorMessage,
    getFileSystemAccessSupport,
    isFilePickerCancellation,
} from "../src/services/fileSystemAccessSupport.js";

const source = await readFile(new URL("../src/tabs/Tasks.jsx", import.meta.url), "utf8");
const start = source.indexOf("  const handlePickDirectory = async () => {");
const end = source.indexOf("  // выбор проекта", start);
assert.ok(start >= 0 && end > start);

// Execute the component's picker with browser permissions and directory state mocked.
const createPicker = new Function("dependencies", `
    const {
        window, bindingBusy, operation, galleryBusy, getFileSystemAccessSupport, showTaskError,
        rootHandle, invalidateBrowserSelection, resetWorkspaceBinding,
        setRootHandle, setRootName, setProjects, setSelectedProject, setTasks,
        setSelectedTask, setTaskInfo, setTaskResultsText, getSubdirs, lastTaskHistory,
        isFilePickerCancellation, getFilePickerErrorMessage, console,
    } = dependencies;
    let directoryPickRevision = 0, selectionRevision = 0, disposed = false;
    const EMPTY_TASK_INFO = Object.freeze({ summaryText: "" });
    ${source.slice(start, end)}
    return handlePickDirectory;
`);

function runtime(picker) {
    const state = { root: null, projects: [], errors: [], permissions: [], resets: 0, galleryBusy: false, historyRoots: [] };
    const pick = createPicker({
        window: {
            isSecureContext: true,
            showDirectoryPicker: async options => {
                state.permissions.push(options);
                return picker();
            },
        },
        bindingBusy: () => false, operation: () => null, galleryBusy: () => state.galleryBusy,
        getFileSystemAccessSupport, isFilePickerCancellation, getFilePickerErrorMessage,
        showTaskError: message => state.errors.push(message),
        rootHandle: () => state.root,
        invalidateBrowserSelection: () => 0,
        resetWorkspaceBinding: () => state.resets++,
        setRootHandle: value => { state.root = value; },
        setRootName: value => { state.rootName = value; },
        setProjects: value => { state.projects = value; },
        setSelectedProject() {}, setTasks() {}, setSelectedTask() {},
        setTaskInfo() {}, setTaskResultsText() {},
        getSubdirs: async handle => handle.projects,
        lastTaskHistory: { async open(handle) { state.historyRoots.push(handle); } },
        console: { error() {} },
    });
    return { state, pick };
}

test("editor accepts project roots of any name with read-write permission", async () => {
    for (const name of ["clark.projects", "Расчёты 2026", "custom-projects"]) {
        const handle = { name, projects: [{ name: "Project" }] };
        const { state, pick } = runtime(() => handle);
        await pick();
        assert.equal(state.root, handle);
        assert.deepEqual(state.projects, handle.projects);
        assert.equal(state.rootName, `Корневой каталог: ${name}`);
        assert.deepEqual(state.permissions, [{ mode: "readwrite" }]);
        assert.equal(state.resets, 1);
        assert.deepEqual(state.historyRoots, [handle]);
        assert.deepEqual(state.errors, []);
    }
});

test("cancelling the editor picker preserves the current directory", async () => {
    const { state, pick } = runtime(() => {
        throw new DOMException("Cancelled", "AbortError");
    });
    const previous = { name: "Previous" };
    state.root = previous;
    await pick();
    assert.equal(state.root, previous);
    assert.deepEqual(state.errors, []);
    assert.equal(state.resets, 0);
});

test("denied browser access is still reported by the editor", async () => {
    const { state, pick } = runtime(() => {
        throw new DOMException("Denied", "NotAllowedError");
    });
    const previous = { name: "Previous" };
    state.root = previous;
    await pick();
    assert.equal(state.root, previous);
    assert.equal(state.errors.length, 1);
    assert.match(state.errors[0], /разреш|доступ/iu);
    assert.equal(state.resets, 0);
});

test("editor waits for GIF deletion before allowing a different root", async () => {
    const handle = { name: "Next", projects: [] };
    const { state, pick } = runtime(() => handle);
    const previous = { name: "Previous", isSameEntry: async () => false };state.root = previous;state.galleryBusy = true;
    await pick();assert.equal(state.root, previous);assert.deepEqual(state.permissions, []);
    state.galleryBusy = false;await pick();assert.equal(state.root, handle);
});
