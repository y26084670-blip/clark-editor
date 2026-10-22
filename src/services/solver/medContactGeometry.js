// MED order and matching tolerance: solver/src/task/04_current_topology.jl.
// No render meshes, visibility filters, or 0.03 mm size tolerance enter here.
export const MED_FACES = Object.freeze([
    [0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4],
    [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5],
]);
export const MED_FACE_NAMES = Object.freeze(["ζ−", "ζ+", "η−", "η+", "ξ−", "ξ+"]);
// solver/TTask.currentFaceAxes; normal subdivisions do not affect the contact.
export function singlePrescribedContactPatch(face, dp) {
    const axes = face.index < 2 ? [0,1] : face.index < 4 ? [0,2] : [1,2];
    return axes.every(d => dp[d] === 1);
}
const sub = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const norm = a => Math.hypot(...a);
const mean = p => [0, 1, 2].map(d => p.reduce((s, v) => s + v[d] / p.length, 0));
const distance = (a, b) => Math.max(...sub(a, b).map(Math.abs));

export function medTolerance(scale, doubleFloat = false) {
    return Math.max(16 * (doubleFloat ? Number.EPSILON : 2 ** -23), 128 * Number.EPSILON)
        * Math.max(scale, doubleFloat ? 2 ** -1022 : 2 ** -126);
}

export function bounds(points) {
    return [0, 1, 2].map(d => [Math.min(...points.map(p => p[d])), Math.max(...points.map(p => p[d]))]);
}
export function boxesMeet(a, b, tol) {
    return a.every(([lo, hi], d) => lo <= b[d][1] + tol && b[d][0] <= hi + tol);
}

// Four-vertex bijection, including repeated vertices of a valid wedge/pyramid.
export function vertexPermutation(a, b, tol) {
    if (a.length !== b.length) return null;
    const order = [], used = new Set();
    function visit(i) {
        if (i === a.length) return true;
        for (let j = 0; j < b.length; j++) {
            if (used.has(j) || distance(a[i], b[j]) > tol) continue;
            used.add(j); order[i] = j;
            if (visit(i + 1)) return true;
            used.delete(j);
        }
        return false;
    }
    return visit(0) ? order : null;
}

export function hexPoint(vertices, x, y, z) {
    const result = [0, 0, 0];
    for (let v = 0; v < 8; v++) {
        const w = (v & 1 ? x : 1-x) * (v & 2 ? y : 1-y) * (v & 4 ? z : 1-z);
        for (let d = 0; d < 3; d++) result[d] += w * vertices[v][d];
    }
    return result;
}

export function physicalHex(vertices, tol, doubleFloat = true) {
    const center = mean(vertices), box = bounds(vertices);
    const faces = MED_FACES.map((ids, index) => {
        const points = ids.map(i => vertices[i]), fc = mean(points);
        let normal = cross(sub(points[2], points[0]), sub(points[3], points[1]));
        if (dot(normal, sub(fc, center)) < 0) normal = normal.map(x => -x);
        const n = norm(normal);
        normal = n ? normal.map(x => x/n) : [0, 0, 0];
        const perimeter = points.reduce((s, p, i) => s + norm(sub(p, points[(i+1)%4])), 0);
        const collapsed = n <= tol * perimeter;
        const planar = collapsed || points.every(p => Math.abs(dot(normal, sub(p, fc))) <= tol);
        return { index, points, center: fc, normal, collapsed, planar, box: bounds(points) };
    });
    // The eight-node map must retain its orientation in the interior. Boundary
    // collapse is allowed (the supported pyramid has four coincident vertices).
    let orientation = 0;
    const local = vertices.map(p=>sub(p,vertices[0]));
    const eps = doubleFloat ? Number.EPSILON : 2**-23;
    const gauss = [(1-1/Math.sqrt(3))/2,(1+1/Math.sqrt(3))/2];
    const jacobian = (x,y,z) => {
        const u = sub(hexPoint(local, 1, y, z), hexPoint(local, 0, y, z));
        const v = sub(hexPoint(local, x, 1, z), hexPoint(local, x, 0, z));
        const w = sub(hexPoint(local, x, y, 1), hexPoint(local, x, y, 0));
        return {det:dot(u,cross(v,w)),limit:64*eps*norm(u)*norm(v)*norm(w)};
    };
    for (const x of gauss) for (const y of gauss) for (const z of gauss) {
        const {det,limit} = jacobian(x,y,z);
        if (!Number.isFinite(det) || Math.abs(det)<=limit || (orientation && Math.sign(det) !== orientation)) {
            return { error: "Вырожденный или самопересекающийся шестигранник." };
        }
        orientation = Math.sign(det);
    }
    for (const x of [0,.5,1]) for (const y of [0,.5,1]) for (const z of [0,.5,1]) {
        const {det,limit} = jacobian(x,y,z);
        if (!Number.isFinite(det) || det*orientation< -limit) return {error:"Самопересечение ШГ: якобиан меняет знак."};
    }
    for (const face of faces) {
        if (face.collapsed || !face.planar) continue;
        if (vertices.some(p => dot(face.normal, sub(p, face.center)) > tol)) {
            return { error: "Невыпуклый или самопересекающийся шестигранник." };
        }
    }
    return { vertices, center, box, faces, planar: faces.every(f => f.planar) };
}

// Convex-polyhedron separating axes include face normals AND edge cross
// products; face normals alone miss overlaps of arbitrarily rotated solids.
export function volumesOverlap(a, b, tol) {
    const edges = h => h.faces.flatMap(f => f.points.map((p, i) => sub(f.points[(i+1)%4], p)));
    const ae = edges(a), be = edges(b);
    const axes = [...a.faces, ...b.faces].map(f => f.normal);
    for (const u of ae) for (const v of be) axes.push(cross(u, v));
    for (const raw of axes) {
        const n = norm(raw);
        if (n === 0) continue;
        const axis = raw.map(x => x/n);
        // Subtract one common origin to avoid cancellation after translation.
        const project = h => h.vertices.map(p => dot(sub(p, a.center), axis));
        const ap = project(a), bp = project(b);
        if (Math.min(Math.max(...ap), Math.max(...bp))
            - Math.max(Math.min(...ap), Math.min(...bp)) <= tol) return false;
    }
    return true;
}

const cross2 = (a, b) => a[0]*b[1] - a[1]*b[0];
const minus2 = (a, b) => [a[0]-b[0], a[1]-b[1]];
function polygonArea(p) {
    return Math.abs(p.reduce((s, a, i) => s + cross2(a, p[(i+1)%p.length]), 0))/2;
}

// Coplanar convex polygon clipping detects containment and intersections even
// when neither boundary has a vertex on the other boundary.
export function faceOverlapArea(a, b, tol) {
    if (a.collapsed || b.collapsed || !a.planar || !b.planar) return 0;
    if (b.points.some(p => Math.abs(dot(a.normal, sub(p, a.center))) > tol)) return 0;
    const drop = a.normal.map(Math.abs).indexOf(Math.max(...a.normal.map(Math.abs)));
    const project = points => points.map(p => sub(p, a.center).filter((_, d) => d !== drop));
    let polygon = project(a.points);
    const clip = project(b.points);
    const signed = clip.reduce((s, p, i) => s + cross2(p, clip[(i+1)%4]), 0);
    const sign = Math.sign(signed);
    for (let i = 0; i < 4 && polygon.length; i++) {
        const start = clip[i], edge = minus2(clip[(i+1)%4], start);
        if (Math.hypot(...edge) === 0) continue;
        const side = p => sign * cross2(edge, minus2(p, start));
        const next = [];
        for (let k = 0; k < polygon.length; k++) {
            const p = polygon[k], q = polygon[(k+1)%polygon.length], sp = side(p), sq = side(q);
            if (sp >= 0) next.push(p);
            if ((sp >= 0) !== (sq >= 0)) {
                const t = sp/(sp-sq);
                next.push(p.map((v, d) => v + t*(q[d]-v)));
            }
        }
        polygon = next;
    }
    return polygon.length < 3 ? 0 : polygonArea(polygon)/Math.abs(a.normal[drop]);
}

export function matchingFaces(a, b, tol) {
    return !a.collapsed && !b.collapsed && dot(a.normal, b.normal) < -0.5
        && vertexPermutation(a.points, b.points, tol) !== null;
}

/** A shared bilinear patch may be warped. Certify opposite volumes for slabs
 * whose generators are parallel: their common convex projection is identical,
 * while every generator of one slab is strictly on the other side. This does
 * not replace the patch by either diagonal's triangular approximation. */
export function extrudedContactSeparates(a, b, tol) {
    for(const af of a.faces) for(const bf of b.faces) {
        if(!matchingFaces(af,bf,tol)) continue;
        const direction=sub(a.vertices[MED_FACES[af.index^1][0]],af.points[0]);
        const length=norm(direction);
        if(length<=tol) continue;
        const axis=direction.map(x=>x/length);
        const side=(hex,face,sign)=>MED_FACES[face.index^1].every((id,i)=>{
            const d=sub(hex.vertices[id],face.points[i]);
            return norm(cross(d,axis))<=tol && sign*dot(d,axis)>tol;
        });
        if(!side(a,af,1)||!side(b,bf,-1)) continue;
        const turns=af.points.map((p,i)=>dot(cross(sub(af.points[(i+1)%4],p),
            sub(af.points[(i+2)%4],af.points[(i+1)%4])),axis));
        if(turns.every(x=>x>0)||turns.every(x=>x<0)) return true;
    }
    return false;
}

export function onlyBoundaryIntersection(a,b,tol) {
    const widths=a.box.map(([lo,hi],d)=>Math.min(hi,b.box[d][1])-Math.max(lo,b.box[d][0]));
    if(widths.filter(w=>w>tol).length<2) return true;
    for(const [plane,other] of [[a,b],[b,a]]) {
        if(!plane.planar||plane.collapsed) continue;
        const distances=other.points.map(p=>dot(plane.normal,sub(p,plane.center)));
        if(distances.every(d=>d>=-tol)||distances.every(d=>d<=tol)) {
            if(distances.filter(d=>Math.abs(d)<=tol).length<=2) return true;
        }
    }
    return false;
}

function facePoint(points, u, v) {
    return [0, 1, 2].map(d => (1-u)*(1-v)*points[0][d] + u*(1-v)*points[1][d]
        + u*v*points[2][d] + (1-u)*v*points[3][d]);
}
export function faceGrid(face, dp, budget = 1_000_000) {
    const axes = face.index < 2 ? [0, 1] : face.index < 4 ? [0, 2] : [1, 2];
    const [nu, nv] = axes.map(d => dp[d]);
    if (!Number.isSafeInteger(nu*nv) || nu*nv > budget) throw new Error("Сетка стыка превышает бюджет анализа; MED не изменён.");
    const result = [];
    for (let u = 0; u < nu; u++) for (let v = 0; v < nv; v++) {
        result.push([[u,v], [u+1,v], [u+1,v+1], [u,v+1]].map(([i,j]) => facePoint(face.points,i/nu,j/nv)));
    }
    return result;
}
export function matchingGrids(a, adp, b, bdp, tol) {
    const ag = faceGrid(a, adp), bg = faceGrid(b, bdp);
    if (ag.length !== bg.length) return false;
    const key = p => p.map(x => Math.floor(x/tol));
    const bins = new Map();
    bg.forEach((face, i) => {
        const k = key(mean(face)).join(",");
        if (!bins.has(k)) bins.set(k, []);
        bins.get(k).push(i);
    });
    const used = new Set();
    for (const face of ag) {
        const q = key(mean(face)), matches = [];
        for (let x=-1;x<=1;x++) for (let y=-1;y<=1;y++) for (let z=-1;z<=1;z++) {
            for (const i of bins.get([q[0]+x,q[1]+y,q[2]+z].join(",")) ?? []) {
                if (!used.has(i) && vertexPermutation(face,bg[i],tol)) matches.push(i);
            }
        }
        if (matches.length !== 1) return false;
        used.add(matches[0]);
    }
    return true;
}
