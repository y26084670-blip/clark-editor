import { forceBodies, generateForceSurface } from "./forceSurface.js";
import { bounds, boxesMeet } from "../solver/medContactGeometry.js";
import { ForceSeparationError, needsCommonForceShell } from "./forceSurfaceGeometry.js";
import { forceSweepGeometry } from "./forceSurfaceSweep.js";

const physical = row => row.targ !== 3;
const groupOf = row => Number.isSafeInteger(row.take) && row.take > 0 ? row.take : 0;

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
    const ids = model.elements.map(row => physical(row) ? groupOf(row) : null);
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

function contactComponents(kernel,model,geometry,minimum,excluded) {
    const parent = model.elements.map((_, i) => i);
    function root(i) {
        while (parent[i] !== i) {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        return i;
    }
    const candidates = excluded.size ? {...geometry,bodies:geometry.bodies.filter(b => !excluded.has(b.index))} : geometry;
    visitClosePairs(kernel,model,candidates,minimum, (a,b) => root(a) !== root(b), (a,b) => {
        parent[root(b)] = root(a);
    });
    function ids() {
        const numbers = new Map();
        return model.elements.map((row,i) => {
            if (!physical(row) || excluded.has(i)) return 0;
            const key = root(i);
            if (!numbers.has(key)) numbers.set(key,numbers.size+1);
            return numbers.get(key);
        });
    }
    return {ids, merge(a,b) { parent[root(b)] = root(a); }};
}

export function buildForceGroups(kernel, model, {mode, indices = [], zeroIndices = [], group, distance,
    minimumGap = model.general?.forceGroupMinGap ?? (model.general?.forceFaceOffset > 0 ? 2 : 2*distance)}) {
    if (!Number.isFinite(minimumGap) || minimumGap < 0) throw new Error("Введите неотрицательный минимальный зазор.");
    const initial = forceBodies(model);
    if (!initial.bodies.length) throw new Error("В задании нет физических элементов.");
    const externalFaces = model.general?.forceFaceOffset > 0;
    let ids, replace, components;
    if (mode === "automatic") {
        components = contactComponents(kernel,model,initial,minimumGap,new Set(zeroIndices));
        ids = components.ids();
        replace = [...new Set(ids.filter(Boolean))];
    } else {
        if (mode !== "manual" || !Number.isSafeInteger(group) || group <= 0)
            throw new Error("Введите положительный целый номер группы.");
        if (!indices.length || indices.some(i => !model.elements[i] || !physical(model.elements[i])))
            throw new Error("Выберите физические элементы группы.");
        const selected = new Set(indices);
        ids = model.elements.map((row,i) => selected.has(i) ? group : groupOf(row));
        const conflicts = [];
        visitClosePairs(kernel,model,initial,externalFaces ? 0 : minimumGap,
            (a,b) => ids[a] > 0 && ids[b] > 0 && ids[a] !== ids[b] && (selected.has(a) || selected.has(b)),
            (a,b) => conflicts.push([a,b]));
        if (conflicts.length) {
            const [a,b] = conflicts[0];
            throw new Error(`Между элементами №${a+1} и №${b+1} недостаточно зазора для разных групп при пороге ${externalFaces ? 0 : minimumGap} мм.`);
        }
        replace = [...new Set([group,...indices.map(i => groupOf(model.elements[i])).filter(Boolean)])];
    }
    // Group 0 still supplies a field and remains an obstacle for positive-group shells.
    // In external-face mode the solver owns all force nodes, also during motion.
    const geometry = !externalFaces && replace.length ? forceSweepGeometry(model,distance,initial) : null;
    // A large group's extraction precision can exceed the initial pairwise
    // tolerance. If the shell builder identifies that pair, join and retry.
    for (;;) {
        const surfaces = [];
        let retry = false;
        for (const id of replace) {
            const members = ids.flatMap((value,i) => value === id ? [i] : []);
            if (!members.length) continue;
            try {
                const panels = externalFaces ? [] : generateForceSurface(kernel,model,members,distance,geometry);
                surfaces.push({id,members,panels});
            } catch (error) {
                if (geometry?.swept && error instanceof ForceSeparationError)
                    throw new Error(`Группа ${id}. Огибающие траекторий элементов №${error.pair[0]+1} и №${error.pair[1]+1} не разделяются неподвижной поверхностью. Сократите интервал или задайте общую группу.`);
                if (components && error instanceof ForceSeparationError &&
                    error.pair.every(i => ids[i] > 0) && ids[error.pair[0]] !== ids[error.pair[1]]) {
                    components.merge(...error.pair);
                    ids = components.ids();
                    replace = [...new Set(ids.filter(Boolean))];
                    retry = true;
                    break;
                }
                throw new Error(`Группа ${id}. ${error.message}`);
            }
        }
        if (!retry) return {ids,replace,surfaces,minimumGap,automatic:mode === "automatic",externalFaces,coverage:geometry?.coverage};
    }
}

function panelNodeCounts([a, b, c, d], step) {
    const length = (p, q) => Math.hypot(p[0]-q[0], p[1]-q[1], p[2]-q[2]);
    // FieldS includes the endpoints along 1–2 and 1–4.
    const n12 = 1 + Math.ceil(Math.max(length(a,b), length(d,c)) / step);
    const n14 = 1 + Math.ceil(Math.max(length(a,d), length(b,c)) / step);
    if (!Number.isSafeInteger(n12 * n14)) throw new Error("Слишком малый шаг по узлам для этой площадки.");
    return [[n12], [n14]];
}

export function applyForceGroups(model, plan, step, defaultRegion) {
    const elements = model.elements.map((row,i) => row.take === plan.ids[i] ? row : {...row,take:plan.ids[i]});
    if (plan.externalFaces) return {elements, regions:model.regions};
    if (!Number.isFinite(step) || step <= 0) throw new Error("Введите положительный шаг по узлам в миллиметрах.");
    const replaced = new Set(plan.replace);
    const regions = model.regions.filter(r => !(r.forceGroup > 0 && (plan.automatic || replaced.has(r.forceGroup))));
    for (const {id,panels} of plan.surfaces) for (const geo of panels)
        regions.push({...defaultRegion(),geoType:0,geo,dp:panelNodeCounts(geo, step),forceGroup:id,indMove:0});
    return {elements,regions};
}

// The transferred element becomes a group-0 source. Keep the old shell
// while it still has positive-group members.
export function excludeForceElements(model, indices, {preserveRegions = false} = {}) {
    const selected = new Set(indices);
    const elements = model.elements.map((row,i) => selected.has(i) && physical(row) && row.take !== 0 ? {...row,take:0} : row);
    if (preserveRegions || model.general?.forceFaceOffset > 0) return {elements, regions:model.regions};
    const removed = new Set(model.elements.filter((row,i) => selected.has(i) && physical(row)).map(groupOf).filter(Boolean));
    const used = new Set(elements.map(groupOf));
    const regions = model.regions.filter(r => !removed.has(r.forceGroup) || used.has(r.forceGroup));
    return {elements,regions};
}
