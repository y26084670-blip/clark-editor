import {sub, cross, norm, same, orient3, orient2, dropAxis, largestAxis, onSegment2} from "./geometryShape.js";
import {bounds, boxesMeet} from "./medContactGeometry.js";

// Outward cyclic order in solver/02_weak_face_geometry.jl, not tensor-bit order.
export const faces = [[0,2,3,1],[4,5,7,6],[0,1,5,4],[2,6,7,3],[0,4,6,2],[1,3,7,5]];

function inside2(p,tri) {
    const turns=tri.map((a,i)=>orient2(a,tri[(i+1)%3],p));
    return !(turns.includes(1) && turns.includes(-1));
}
function coplanarSegmentHits(segment,tri,common) {
    const s=segment.map(p=>dropAxis(p,tri.axis));
    const t=tri.projected;
    const allowed=p=>common.some(q=>same(p,dropAxis(q,tri.axis)));
    if (s.some(p=>!allowed(p) && inside2(p,t))) return true;
    for (let i=0;i<3;i++) {
        const a=t[i], b=t[(i+1)%3];
        if (!allowed(a) && onSegment2(...s,a)) return true;
        if (orient2(...s,a)*orient2(...s,b)<0 && orient2(a,b,s[0])*orient2(a,b,s[1])<0) return true;
    }
    return false;
}
function edgeHits(tri,other,common) {
    const t=other.points;
    for (let i=0;i<3;i++) {
        const a=tri.points[i], b=tri.points[(i+1)%3];
        const sa=orient3(...t,a), sb=orient3(...t,b);
        if (sa*sb>0) continue;
        if (sa===0 && sb===0) {
            if (coplanarSegmentHits([a,b],other,common)) return true;
        } else if (sa===0 || sb===0) {
            const p=sa===0 ? a : b;
            if (!common.some(q=>same(p,q)) && inside2(dropAxis(p,other.axis),other.projected)) return true;
        } else {
            // Strictly through the plane. Three oriented edge planes are the
            // barycentric half spaces of the intersection on this triangle.
            const sides=t.map((p,k)=>orient3(a,b,p,t[(k+1)%3]));
            if (!(sides.includes(-1) && sides.includes(1))) return true;
        }
    }
    return false;
}
function overlap(a,b) {
    if (!boxesMeet(a.box,b.box,0)) return false;
    const common=a.points.filter(p=>b.points.some(q=>same(p,q)));
    if (common.length===3) return true;
    if (common.length===2) {
        const p=a.points.find(v=>!common.includes(v));
        const q=b.points.find(v=>!common.some(c=>same(v,c)));
        if (orient3(...common,p,q)!==0) return false;
        const [s,t]=common.map(v=>dropAxis(v,a.axis));
        return orient2(s,t,dropAxis(p,a.axis))*orient2(s,t,dropAxis(q,a.axis))>0;
    }
    return edgeHits(a,b,common) || edgeHits(b,a,common);
}
function triangle(points,face,nodes) {
    const [a,b,c]=points, normal=cross(sub(b,a),sub(c,a));
    if (!norm(normal)) return null;
    const axis=largestAxis(normal);
    return {points,face,nodes,box:bounds(points),axis,projected:points.map(p=>dropAxis(p,axis))};
}

// A shell may touch itself in a facet diagonal even when its signed volume
// and the entire trilinear Jacobian are positive. Include adjacent faces.
export function shellDefect(vertices,splits) {
    const triangles=[];
    for (const [face,indices] of faces.entries()) {
        const unique=indices.filter((v,i)=>indices.slice(0,i).every(w=>!same(vertices[v],vertices[w])));
        if (unique.length<3) continue; // A boundary edge or vertex of a wedge/pyramid.
        const [a,b,c,d]=indices;
        const halves=unique.length===3 ? [unique] : splits[face]===-1 ? [[a,b,d],[b,c,d]] : [[a,b,c],[a,c,d]];
        for (const nodes of halves) {
            const tri=triangle(nodes.map(i=>vertices[i]),face,nodes);
            if (!tri) return `вырожденный треугольник грани ${face+1} (узлы ${nodes.map(i=>i+1).join("–")})`;
            triangles.push(tri);
        }
    }
    for (let i=0;i<triangles.length;i++) for (let j=0;j<i;j++) {
        const a=triangles[j], b=triangles[i];
        if (overlap(a,b)) return `самопересечение оболочки между гранями ${a.face+1} и ${b.face+1}`
            + ` (треугольники ${a.nodes.map(v=>v+1).join("–")} и ${b.nodes.map(v=>v+1).join("–")})`;
    }
    return null;
}
