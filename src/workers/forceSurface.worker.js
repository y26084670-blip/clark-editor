import createModule from "manifold-3d/manifold";
import wasmUrl from "manifold-3d/manifold.wasm?url";
import { buildForceGroups, conflictingForceContacts } from "../services/generator/forceGroups.js";

self.onmessage = async ({data}) => {
    try {
        const kernel = await createModule({ locateFile: () => wasmUrl });
        kernel.setup();
        if (data.validate) {
            self.postMessage({pairs:conflictingForceContacts(kernel,data.model)});
            return;
        }
        self.postMessage({plan: buildForceGroups(kernel, data.model, data.options)});
    } catch (error) {
        self.postMessage({error: error.message || String(error)});
    }
};
