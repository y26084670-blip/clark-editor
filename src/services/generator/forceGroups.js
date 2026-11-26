import { forceBodies } from "./forceSurface.js";
import { bounds, boxesMeet } from "../solver/medContactGeometry.js";
import { needsCommonForceShell } from "./forceSurfaceGeometry.js";

const physical = row => row.targ !== 3;
export const forceSourceGroup = row => Number.isSafeInteger(row.take) && row.take > 0 ? row.take : 0;

// Sweep expanded bounding boxes first. Only a candidate pair needs a solid
// distance query. Mirror, local, axial and periodic images retain the source ID.
function visitClosePairs(kernel,model,geometry,minimum,relevant,visit) {
    if (!Number.isFinite(minimum) || minimum < 0)
        throw new Error("Укажите конечный неотрицательный минимальный зазор в миллиметрах.");
    const signs = key => [0,1].includes(model.general?.[key]) ? [1,-1] : [1];
    const copies = [];
    let scale = 0;
    for (const body of geometry.bodies) {
        for (const x of signs("mirrorSymmetryX")) for (const y of signs("mirrorSymmetryY")) {
            const vertices = body.vertices.map(p => [x*p[0],y*p[1],p[2]]);
            const box = bounds(vertices);
            scale = Math.max(scale,...box.flat().map(Math.abs));
            copies.push({...body,vertices,box});
        }
    }
    // Upper bound for the pairwise coordinate and WASM tolerances.
    const reach = Math.max(minimum, 16*scale*2**-23);
    copies.sort((a,b) => a.box[0][0]-b.box[0][0]);
    for (let i=0;i<copies.length;i++) {
        const a=copies[i];
        for (let j=i+1;j<copies.length;j++) {
            const b=copies[j];
            if (b.box[0][0]>a.box[0][1]+reach) break;
            if (a.index===b.index || !relevant(a.index,b.index) || !boxesMeet(a.box,b.box,reach)) continue;
            if (needsCommonForceShell(kernel,a,b,minimum,geometry.cast)) visit(a.index,b.index);
        }
    }
}

export function conflictingForceContacts(kernel, model, minimum=model.general?.forceGroupMinGap ?? 2) {
    const externalFaces = model.general?.forceFaceOffset > 0;
    const ids = model.elements.map(row => physical(row) ? forceSourceGroup(row) : null);
    if (new Set(ids.filter(id => id !== null && (externalFaces || id > 0))).size < 2) return [];
    const conflicts = new Map();
    visitClosePairs(kernel,model,forceBodies(model),externalFaces ? 0 : minimum,
        (a,b) => ids[a] !== ids[b] && (externalFaces || (ids[a] > 0 && ids[b] > 0)),
        (a,b) => {
            const pair = [Math.min(a,b),Math.max(a,b)];
            conflicts.set(pair.join(","),pair);
        });
    return [...conflicts.values()];
}

// Assign positive IDs to the connected components in the initial physical geometry.
export function buildForceGroups(kernel, model, zeroIndices = []) {
    const geometry = forceBodies(model);
    if (!geometry.bodies.length) throw new Error("В задании нет физических элементов.");
    const excluded = new Set(zeroIndices);
    const candidates = geometry.bodies.filter(body => !excluded.has(body.index) && (model.elements[body.index].take ?? 0) >= 0);
    const parent = model.elements.map((_, index) => index);
    function root(index) {
        while (parent[index] !== index) {
            parent[index] = parent[parent[index]];
            index = parent[index];
        }
        return index;
    }
    const minimum = model.general?.forceGroupMinGap ?? 2;
    visitClosePairs(kernel, model, {...geometry, bodies:candidates}, minimum,
        (a, b) => root(a) !== root(b),
        (a, b) => { parent[root(b)] = root(a); });

    const components = new Map();
    const ids = model.elements.map((row, index) => {
        if (!physical(row)) return 0;
        if (row.take < 0) return row.take;
        if (excluded.has(index)) return 0;
        const key = root(index);
        if (!components.has(key)) components.set(key, {id:components.size + 1, members:[]});
        const group = components.get(key);
        group.members.push(index);
        return group.id;
    });
    return {ids, groups:[...components.values()]};
}

export function applyForceGroups(elements, ids) {
    return elements.map((row, index) => row.take === ids[index] ? row : {...row, take:ids[index]});
}

export function excludeForceElements(elements, indices) {
    const selected = new Set(indices);
    return elements.map((row, index) =>
        selected.has(index) && physical(row) && row.take !== 0 ? {...row, take:0} : row);
}
