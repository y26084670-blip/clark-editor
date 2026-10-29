import { dataService } from "./dataService.js";
import { DIRECTORIES, VALIDATION_LEVELS } from "./schemas/common/constants.js";
import generalSchema from "./schemas/general.schema.js";
import elementsSchema from "./schemas/elements.schema.js";
import { TASK_PLANAR_MODE_FILE } from "./taskStatusService.js";
import { buildGeometryScene } from "./visualization/geometrySceneModel.js";

// Serialize marker writes so a check already in flight cannot restore a stale
// marker after Save has invalidated it. Input files themselves are never changed.
let pending = Promise.resolve();
function serial(operation) {
    const result = pending.then(operation);
    pending = result.catch(() => {});
    return result;
}

async function removeMarker(input) {
    try { await input.removeEntry(TASK_PLANAR_MODE_FILE); }
    catch (error) { if (error?.name !== "NotFoundError") throw error; }
}

export function clearPlanarModeMarker(taskHandle) {
    return serial(async () => {
        const input = await taskHandle.getDirectoryHandle(DIRECTORIES.INPUT);
        await removeMarker(input);
    });
}

export function refreshPlanarModeMarker(taskHandle, {
    load = (handle, schema, diagnostics) => dataService.load(handle, schema, diagnostics),
    isCurrent = () => true,
} = {}) {
    return serial(async () => {
        const input = await taskHandle.getDirectoryHandle(DIRECTORIES.INPUT);
        const diagnostics = [];
        // Always classify the persisted geometry. Unsaved edits affect only the
        // live Editor label and must not change another application's disk status.
        const [general, elements] = await Promise.all([
            load(taskHandle, generalSchema, diagnostics),
            load(taskHandle, elementsSchema, diagnostics),
        ]);
        if (!isCurrent()) return null;
        const planar = Boolean(general && elements?.length
            && !diagnostics.some(item => item.level === VALIDATION_LEVELS.ERROR)
            && buildGeometryScene({ general, elements }).planar2D);
        if (planar) await input.getFileHandle(TASK_PLANAR_MODE_FILE, { create: true });
        else await removeMarker(input);
        return planar;
    });
}
