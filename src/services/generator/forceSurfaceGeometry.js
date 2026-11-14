import { boxesMeet, hexPoint, MED_FACES } from "../solver/medContactGeometry.js";
import { bilinearRegionNormals } from "../visualization/geometryDiscretization.js";

const axes = [0, 1, 2];
const sub = (a, b) => a.map((x, i) => x - b[i]);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const dot = (a, b) => a.reduce((sum, x, i) => sum + x*b[i], 0);
const middle = (a, b) => a.map((x, i) => x/2 + b[i]/2);

function boxPanels(box, sides) {
    const panels = [];
    for (const d of axes) for (const side of [0, 1]) {
        const value = box[d][side];
        if (sides[d] && value === 0) continue;
        const u = (d + 1) % 3, v = (d + 2) % 3;
        const quad = [[0,0], [1,0], [1,1], [0,1]].map(([i,j]) => {
            const p = [0,0,0]; p[d] = value; p[u] = box[u][i]; p[v] = box[v][j]; return p;
        });
        // FieldS takes (V4 - V1) × (V2 - V1), clockwise from outside.
        panels.push(side ? quad.reverse() : quad);
    }
    return panels;
}

// Prefer one four-corner TK where two adjacent triangles form a flat convex
// quad. Every remaining triangle is partitioned into three proper quads.
function meshPanels(solid, {reference, cast, sides, precision}, bounds) {
    const mesh = solid.getMesh(), data = mesh.vertProperties;
    // Reserve three mantissa bits at the model scale. Midpoints and a point
    // with barycentric weights (1/4,3/8,3/8) then remain representable even
    // in a single-precision task. Every subquad lies on its triangle's plane.
    const grid = 2 ** Math.ceil(Math.log2(8 * precision));
    const gridBounds = bounds.map(([lo,hi]) => [Math.ceil(lo/grid), Math.floor(hi/grid)]);
    const points = Array.from({length: mesh.numVert}, (_, i) => axes.map(d => {
        const local = data[i * mesh.numProp + d];
        // The WASM output mesh is Float32 even for double-precision inputs.
        if (sides[d] && local === Math.fround(-reference[d])) return 0;
        const world = local + reference[d];
        const [lo,hi] = gridBounds[d];
        return cast(Math.min(hi, Math.max(lo, Math.round(world/grid))) * grid);
    }));
    const pairs = [], singles = [], triangles = [], adjacent = new Map();
    for (let i = 0; i < mesh.triVerts.length; i += 3) {
        const ids = Array.from(mesh.triVerts.subarray(i, i+3));
        const index = triangles.length;
        triangles.push(ids);
        for (let j=0; j<3; j++) adjacent.set(`${ids[j]}:${ids[(j+1)%3]}`, index);
    }
    const consumed = new Set();
    for (const [index, ids] of triangles.entries()) {
        if (consumed.has(index)) continue;
        const triangle = ids.map(id => points[id]);
        const [a,b,c] = triangle, outward = cross(sub(b,a), sub(c,a));
        for (let j=0; j<3; j++) {
            const u = ids[j], v = ids[(j+1)%3];
            const peer = adjacent.get(`${v}:${u}`);
            if (peer === undefined || consumed.has(peer) || peer < index) continue;
            const w = triangles[peer].find(id => id !== u && id !== v);
            const quad = [v,ids[(j+2)%3],u,w].reverse().map(id => points[id]);
            if (!validPanel(quad,outward,precision)) continue;
            consumed.add(index); consumed.add(peer); pairs.push(quad); break;
        }
        if (consumed.has(index)) continue;
        singles.push([a,c,b]);
    }
    if (!singles.length) return pairs;
    // Split both sides of a shared edge when any triangular face needs its
    // midpoint. Clockwise ordering is already established for both lists.
    const panels = [];
    for (const face of [...pairs,...singles]) {
        const n = face.length;
        const mids = face.map((p,j) => middle(p,face[(j+1)%n]).map(cast));
        const center = n === 3 ? middle(middle(face[0], mids[1]), mids[1]) : middle(mids[0], mids[2]);
        const outward = cross(sub(face[n-1],face[0]),sub(face[1],face[0]));
        for (let j = 0; j < n; j++) {
            const quad = [face[j], mids[j], center, mids[(j+n-1)%n]];
            if (!validPanel(quad,outward,precision)) {
                throw new Error("Недостаточная точность координат для плоской невырожденной площадки.");
            }
            panels.push(quad);
        }
    }
    return panels;
}

function validPanel(quad, outward, precision) {
    const longest = Math.max(...quad.map((p,k) => Math.hypot(...sub(p,quad[(k+1)%4]))));
    const turns = quad.map((p,k) => cross(sub(quad[(k+3)%4],p), sub(quad[(k+1)%4],p)));
    return turns.every(n => dot(n,outward) > 0 && Math.hypot(...n) > longest*precision)
        && bilinearRegionNormals(quad).length === 1;
}

// Reconstruct the rounded output in the kernel and check the solids, including
// enclosed obstacles. The temporary cap on a mirror belongs to this check only.
function certifyPanels(panels, group, obstacles, options, neighbourhood, epsilon) {
    const {kernel, reference, sides} = options;
    const ids = new Map(), vertices = [], triangles = [];
    for (const quad of panels) {
        const face = quad.map(point => {
            const key = point.join(",");
            if (!ids.has(key)) {
                ids.set(key, vertices.length/3);
                vertices.push(...sub(point,reference));
            }
            return ids.get(key);
        });
        triangles.push(face[0],face[2],face[1], face[0],face[3],face[2]);
    }
    const mesh = new kernel.Mesh({numProp:3, vertProperties:Float32Array.from(vertices), triVerts:Uint32Array.from(triangles)});
    const actual = new kernel.Manifold(mesh);
    try {
        if (actual.status() !== "NoError" || actual.isEmpty())
            throw new Error("При округлении координат нарушилась замкнутость поверхности.");
        const missing = group.subtract(actual);
        try {
            if (!missing.isEmpty()) throw new Error("Округление координат вывело часть выбранной группы за поверхность.");
        } finally { missing.delete(); }
        // The neighbourhood ends on active mirror planes so omitted symmetry
        // caps are never counted as physical contact with the selected group.
        const outside = neighbourhood.subtract(actual);
        try {
            if (group.minGap(outside, epsilon*8) <= epsilon)
                throw new Error("В доступной точности поверхность касается выбранной группы.");
        } finally { outside.delete(); }
        for (const other of obstacles) if (actual.minGap(other, epsilon*8) <= epsilon) {
            throw new Error("В доступной точности поверхность касается постороннего элемента.");
        }
    } finally { actual.delete(); }
    return panels.filter(q => !sides.some((sign,d) => sign && q.every(p => p[d] === 0)));
}

function warped(vertices) {
    return MED_FACES.some(face => {
        const [a,b,c,d] = face.map(i => vertices[i]);
        const ab = sub(b,a), ac = sub(c,a), ad = sub(d,a);
        const n = cross(ab,ac);
        return Math.abs(dot(n,ad)) > 64*Number.EPSILON*Math.hypot(...n)*Math.hypot(...ad);
    });
}

// Each Q1 subcell, including either triangular split of a physical face, is
// contained in the convex hull of its eight controls. Tighten a warped hull
// only if it prevents separation, along the element's own subdivision grid.
function bodyHull(body, level, hull, union) {
    if (!level || !warped(body.vertices)) return hull(body.vertices);
    const n = body.dp.map(count => Math.min(count, 2**level));
    const pieces = [];
    for (let x=0; x<n[0]; x++) for (let y=0; y<n[1]; y++) for (let z=0; z<n[2]; z++) {
        // Breaks must lie on actual EO grid planes; intermediate coarse blocks
        // enclose the corresponding fine-cell controls as well.
        const starts = [x,y,z].map((i,d) => Math.floor(i*body.dp[d]/n[d])/body.dp[d]);
        const ends = [x,y,z].map((i,d) => Math.floor((i+1)*body.dp[d]/n[d])/body.dp[d]);
        const vertices = Array.from({length:8}, (_, i) => hexPoint(body.vertices,
            i&1 ? ends[0] : starts[0], i&2 ? ends[1] : starts[1], i&4 ? ends[2] : starts[2]));
        const piece = hull(vertices);
        if (piece.status() !== "NoError" || piece.isEmpty()) throw new Error("Не удалось восстановить объём ячейки элемента.");
        pieces.push(piece);
    }
    return union(pieces);
}

// All booleans, containment and minimum-gap queries operate on solids. In
// particular a foreign solid entirely inside the first box is a conflict.
export function encloseBodies(kernel, options) {
    const {selected, obstacles, sides, reference, distance, precision, cast} = options;
    const outer = options.outer.map(range => [...range]);
    if (!obstacles.length) return boxPanels(outer, sides);
    // An axis-aligned gap separates the entire group from this obstacle.
    // Put just that wall in the middle of the available gap.
    for (const obstacle of obstacles) {
        let best = null;
        for (const d of axes) for (const side of [0,1]) {
            const limit = options.groupBox[d][side], near = obstacle.box[d][1-side];
            const gap = side ? near-limit : limit-near;
            if (gap > 0 && (!best || gap > best.gap)) best = {d,side,limit,near,gap};
        }
        if (!best) continue;
        const {d,side,limit,near} = best, midpoint = cast(limit/2+near/2);
        if (midpoint === limit || midpoint === near) continue;
        outer[d][side] = side ? Math.min(outer[d][side],midpoint) : Math.max(outer[d][side],midpoint);
    }
    const candidates = obstacles.filter(body => boxesMeet(body.box,outer,0));
    if (!candidates.length) return boxPanels(outer,sides);
    const owned = [], keep = solid => { owned.push(solid); return solid; };
    const {Manifold} = kernel;
    const hull = vertices => keep(Manifold.hull(vertices.map(p => sub(p,reference))));
    const union = parts => parts.length === 1 ? parts[0] : keep(Manifold.union(parts));
    const makeBox = box => {
        const cube = keep(Manifold.cube(box.map(([lo,hi]) => hi-lo)));
        return keep(cube.translate(box.map(([lo],d) => lo-reference[d])));
    };
    const valid = s => s.status() === 'NoError' && !s.isEmpty() && s.volume() > 0;
    // Reserve enough clearance for extraction to the WASM Float32 triangle
    // buffer, as well as the precision used by the task itself.
    const span = Math.max(...outer.map(([lo,hi]) => hi-lo));
    const epsilon = Math.max(precision*2, span*2**-23);
    const reach = Math.max(distance*2, epsilon*16);
    const clip = solid => {
        for (const d of axes) if (sides[d]) {
            const normal = [0,0,0]; normal[d] = sides[d];
            solid = keep(solid.trimByPlane(normal, -reference[d]*sides[d]));
        }
        return solid;
    };
    try {
        const wrap = makeBox(outer);
        const groupParts = selected.map(b => ({body:b, solid:clip(hull(b.vertices))})).filter(p => !p.solid.isEmpty());
        for (const {solid} of groupParts) if (!valid(solid)) throw new Error("Вырожденный объём выбранного элемента.");
        if (!groupParts.length) throw new Error("В основном полупространстве отсутствует выбранный объём.");
        let group = union(groupParts.map(p => p.solid));
        const cuts = [], excluded = [];
        for (const body of candidates) {
            let other = hull(body.vertices);
            if (!valid(other)) throw new Error(`Вырожденный объём элемента №${body.index + 1}.`);
            if (wrap.minGap(other, reach) > epsilon*4) continue;
            let gap = group.minGap(other, reach);
            if (gap <= epsilon*8) {
                // Retry only ambiguous envelopes. A conservative envelope can
                // overlap a different solid near a warped face even in free air.
                for (let level=1; level<=3 && gap<=epsilon*8; level++) {
                    let refined = false;
                    if (warped(body.vertices) && body.dp.some(n => n > 2**(level-1))) {
                        other = bodyHull(body,level,hull,union); refined = true;
                    }
                    for (const p of groupParts) {
                        if (p.solid.minGap(other,reach)>epsilon*8 || !warped(p.body.vertices)
                            || !p.body.dp.some(n => n>2**(level-1))) continue;
                        p.solid = clip(bodyHull(p.body,level,hull,union)); refined = true;
                    }
                    if (!refined) break;
                    group = union(groupParts.map(p => p.solid));
                    gap = group.minGap(other,reach);
                }
            }
            if (!(gap > epsilon*8)) {
                const nearest = groupParts.map(p => ({index:p.body.index, gap:p.solid.minGap(other,reach)}))
                    .reduce((best,p) => p.gap < best.gap ? p : best);
                throw new Error(`Не удалось провести поверхность в зазоре между элементами №${nearest.index+1} и №${body.index+1} (контакт, пересечение или предел точности).`);
            }
            if (wrap.minGap(other, reach) > epsilon*4) continue;
            // A cube of half-width r is inside a sphere of radius sqrt(3)*r.
            // Even its farthest point therefore cannot reach the selected body.
            const r = Math.min(distance, gap/(2*Math.sqrt(3)));
            const padding = keep(Manifold.cube(2*r, true));
            cuts.push(keep(other.minkowskiSum(padding)));
            excluded.push(other);
        }
        if (!cuts.length) return boxPanels(outer, sides);
        const result = keep(wrap.subtract(union(cuts)));
        if (!valid(result)) throw new Error("Не удалось построить разделяющий объём.");
        // Rectangular cutouts from a whole side can still leave a simple box.
        const b = result.boundingBox();
        const remainingBox = axes.map(d => [b.min[d], b.max[d]].map(x => cast(x+reference[d])));
        const candidate = makeBox(remainingBox);
        if (keep(candidate.subtract(result)).isEmpty() && keep(result.subtract(candidate)).isEmpty()) return boxPanels(remainingBox,sides);
        const neighbourhood = clip(makeBox(outer.map(([lo,hi]) => [lo-reach, hi+reach])));
        return certifyPanels(meshPanels(result,options,outer), group, excluded, {...options,kernel}, neighbourhood, epsilon);
    } finally {
        for (let i=owned.length-1; i>=0; i--) owned[i].delete();
    }
}
