import createModule from "manifold-3d/manifold";
import wasmUrl from "manifold-3d/manifold.wasm?url";
import { generateForceSurface } from "../services/generator/forceSurface.js";

self.onmessage = async ({data}) => {
    try {
        const kernel = await createModule({ locateFile: () => wasmUrl });
        kernel.setup();
        self.postMessage({panels: generateForceSurface(kernel, data.model, data.indices, data.distance)});
    } catch (error) {
        self.postMessage({error: error.message || String(error)});
    }
};
