import { DIRECTORIES } from "./schemas/common/constants.js";
import { JWEAK_LOCAL_FILE, parseJweakLocal } from "./solver/jweakLocalValidation.js";

// Read-only companion file. Only NotFoundError for the file itself means an
// ordinary task. Failure to access input3XX/permissions is never an absence.
async function readBytes(taskHandle) {
    const input = await taskHandle.getDirectoryHandle(DIRECTORIES.INPUT);
    let handle;
    try { handle = await input.getFileHandle(JWEAK_LOCAL_FILE); }
    catch (error) {
        if (error?.name === "NotFoundError") return null;
        throw error;
    }
    const file = await handle.getFile();
    return new Uint8Array(await file.arrayBuffer());
}

export async function loadJweakLocal(taskHandle) {
    try {
        const bytes = await readBytes(taskHandle);
        if (bytes === null) return { status: "absent" };
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return { status: "ready", data: parseJweakLocal(text), bytes };
    } catch (error) {
        return { status: "error", error: `${JWEAK_LOCAL_FILE}: ${error?.message ?? error}` };
    }
}

// One load ticket per task/reload, independent of edits in unrelated tabs.
// Publishing an attachment never creates history, dirty state or disk writes.
export function createJweakLocalLoader(publish, read = loadJweakLocal) {
    let revision = 0;
    return {
        async load(taskHandle) {
            const ticket = ++revision;
            if (!taskHandle) { publish(null); return; }
            publish({ status: "loading" });
            let section;
            try { section = await read(taskHandle); }
            catch (error) { section = { status: "error", error: `${JWEAK_LOCAL_FILE}: ${error?.message ?? error}` }; }
            if (ticket === revision) publish(section);
        },
        dispose() { revision += 1; },
    };
}
