import {faces, shellDefect} from "./hexCellShell.js";
import {sub, cross, dot, norm, same, orient3, integerPoints, quadPlane, realEpsilon, QUALITY_EPS_FACTOR} from "./geometryShape.js";
import {edgeVectors, jacobianColumns, det3, cellQuality} from "./hexJacobian.js";
import {validateKvVerticesDetailed} from "./geometryKv.js";
import {vertexPermutation} from "./medContactGeometry.js";
import {expandElementSymmetry} from "./symmetryExpansion.js";
import {applyMatrix4ToPoint} from "./rotation3d.js";
import {kvFlags} from "./kvDerived.js";

const axes=[0,1,2];
const location = c => `ШГ №${c.row+1}, ЭО №${c.index} [${c.ijk.map(n=>n+1).join(", ")}], ${c.image}`;
const imageName = im => `LS${im.ls+1}/AS${im.as+1}/PS${im.ps+1}/X${im.mirrorX}/Y${im.mirrorY}`;
// All four vertices of a bilinear layer suffice only for planarity at that
// layer; the mixed triple is cubic in the layer parameter. Four exact zeros
// prove it vanishes identically for every parallel grid section.
function flatGridDirections({vertices}) {
    return [[0,2,6,4],[0,1,5,4],[0,1,3,2]].every((ids,axis)=>{
        const stride=1<<axis;
        if (axes.some(d=>ids.every(i=>vertices[i][d]===vertices[ids[0]][d]
            && vertices[i+stride][d]===vertices[ids[0]+stride][d]))) return true;
        const p=integerPoints(vertices);
        // Denominator 3 common to each point. Signs and zero survive scaling.
        for (let t=0n;t<=3n;t++) {
            const [a,b,c,d]=ids.map(i=>axes.map(k=>(3n-t)*p[i][k]+t*p[i+stride][k]));
            if (dot(sub(b,a),cross(sub(c,a),sub(d,a)))!==0n) return false;
        }
        return true;
    });
}
const contactKey = (row,img,f) => `${row}/${img}/${f}`;
const faceAxis = f => 2-Math.floor(f/2);

// The reference cube, coned from its center to either triangulation of each
// face, has barycentric gradients with bounded 1-norm. If each corner moves
// < 1/64 in inverse edge coordinates, the piecewise affine displacement is a
// strict contraction. Both diagonals then give an embedded oriented shell.
function closeToAffine(points) {
    const columns=[1,2,4].map(i=>sub(points[i],points[0]));
    const dual=axes.map(d=>cross(columns[(d+1)%3],columns[(d+2)%3]));
    const det=dot(columns[0],dual[0]);
    if (!Number.isFinite(det) || !det) return false;
    return points.every((p,i)=>{
        const delta=sub(p,points[0]);
        return axes.every(d=>Math.abs(dot(dual[d],delta)/det-((i>>d)&1))<1/64);
    });
}

// An affine source has identical cells. Bound the effect of REAL rounding,
// including translations of all images, before skipping materialization.
function uniformAffine(block,eps) {
    const {record,vertices,dp}=block, edges=edgeVectors(vertices);
    if (!edges.every(row=>row.every(v=>same(v,row[0])))) return false;
    const columns=edges.map((row,i)=>row[0].map(x=>x/dp[i]));
    const det=Math.abs(det3(columns));
    const inverse=axes.map(d=>norm(cross(columns[(d+1)%3],columns[(d+2)%3]))/det);
    return Math.max(...inverse)*coordinateRadius(record,vertices)*eps*16 < 1/64;
}
function coordinateRadius(record,vertices) {
    return Math.max(...vertices.map(norm))+norm(record.dr?.flat()??[0,0,0])
        +norm(record.symR0?.flat()??[0,0,0])+Math.abs((record.symTx??0)*(record.symPs??1));
}
function gridPoint(v, x, y, z) {
    const lerp=(a,b,t)=>(1-t)*a+t*b;
    return axes.map(d=>lerp(lerp(lerp(v[0][d],v[1][d],x),lerp(v[2][d],v[3][d],x),y),
        lerp(lerp(v[4][d],v[5][d],x),lerp(v[6][d],v[7][d],x),y),z));
}
// Subdivide only in source coordinates. The derivative varies bilinearly on
// each cell; bounding its deviation from the center and from rounded corners
// gives a lower bound for the two quality indicators over that complete cell.
function regularGrid(block,eps,qualityWarning,medTolerance,warn) {
    if (!medTolerance && uniformAffine(block,eps)) return true;
    const {record,dp,vertices}=block;
    const error=8*eps*coordinateRadius(record,vertices)+2*medTolerance;
    const edges=edgeVectors(vertices), cols=jacobianColumns(edges,[.5,.5,.5]).map((v,d)=>v.map(x=>x/dp[d]));
    // Include all directions in one orthonormal frame. Their product of maximum
    // lengths bounds the scaled determinant; the inverse Frobenius bound
    // supplies a conservative lower bound on sigma_min at every point.
    const maxNorm=edges.map((row,d)=>Math.max(...row.map(norm))/dp[d]);
    const affinity=edges.map((row,d)=>Math.max(...row.map(v=>norm(sub(v.map(x=>x/dp[d]),cols[d])))));
    const sizes=cols.map(norm), centerDet=det3(cols);
    const columnError=affinity.map(x=>x+2*error);
    const upper=sizes.map((n,d)=>n+columnError[d]);
    const perturbation=upper.reduce((a,b)=>a*b,1)-sizes.reduce((a,b)=>a*b,1);
    const lower=centerDet-perturbation;
    const qBound=lower/upper.reduce((a,b)=>a*b,1);
    const rhoBound=lower/(upper[0]*upper[1]+upper[1]*upper[2]+upper[2]*upper[0])/Math.hypot(...upper);

    // Bound all mixed terms at once for an arbitrary grid cell. Edge second
    // differences are affine in the third parameter, so endpoints suffice.
    const second=[];
    for (const [a,b] of [[0,1],[0,2],[1,2]]) {
        const c=3-a-b;
        const mixed=[0,1<<c].map(i=>sub(sub(vertices[i+(1<<a)+(1<<b)],vertices[i+(1<<a)]),
            sub(vertices[i+(1<<b)],vertices[i])));
        second.push(Math.max(...mixed.map(norm))/(dp[a]*dp[b]));
    }
    const mixedBound=second.reduce((a,b)=>a+b,0);
    const inverseBound=(upper[0]*upper[1]+upper[1]*upper[2]+upper[2]*upper[0])/lower;
    if (lower>0 && (mixedBound+error)*inverseBound < 1/64
        && (qualityWarning || Math.min(qBound,rhoBound)>QUALITY_EPS_FACTOR*eps)) return true;

    // A structured extrusion (sector, trapezoid, bar) is a convex prism
    // throughout its subdivision. Work in the two-dimensional cross section.
    // The following margin is the physical distance from any nonincident vertex
    // to any face plane, times the smallest sine of a corner angle. It bounds
    // how far represented vertices may move without reversing a face triangle.
    const extruded=axes.find(d=>edges[d].every(v=>same(v,edges[d][0])));
    if (extruded===undefined || !Number.isFinite(mixedBound)) return false;
    const axis=extruded, a=(axis+1)%3, b=(axis+2)%3;
    const e=cols[axis], en=norm(e);
    if (!en) return false;
    if (orient3(vertices[0],vertices[1<<a],vertices[1<<b],vertices[(1<<a)+(1<<b)])!==0) return false;
    const pairs=[];
    for (let i=0;i<2;i++) for (let j=0;j<2;j++) {
        const pos=[0,0,0];pos[a]=i;pos[b]=j;
        const jcols=jacobianColumns(edges,pos);
        const u=jcols[a].map(x=>x/dp[a]), v=jcols[b].map(x=>x/dp[b]);
        const D=dot(e,cross(u,v));
        if (D<0) return false;
        pairs.push(D);
    }
    let minimum=Math.min(...pairs);
    if (!minimum) {
        // A triangular prism has one collapsed edge in each end plane.
        // On the first radial layer the quotient is a triangle. Its nonzero
        // corner determinants are 1/n of those of the unabbreviated triangle.
        const cycle=[0,1<<a,(1<<a)+(1<<b),1<<b];
        const collapsed=cycle.filter((v,i)=>same(vertices[v],vertices[cycle[(i+1)%4]]));
        if (collapsed.length!==1 || pairs.filter(x=>x===0).length!==2) return false;
        const corner=collapsed[0], next=cycle[(cycle.indexOf(corner)+1)%4];
        const radial=(corner^next)===(1<<a) ? b : a;
        minimum=Math.min(...pairs.filter(x=>x>0))/dp[radial];
    }
    const lengths=maxNorm;
    const areaMax=Math.max(lengths[0]*lengths[1],lengths[0]*lengths[2],lengths[1]*lengths[2]);
    const distance=minimum/areaMax, sine=minimum/lengths.reduce((s,v)=>s*v,1);
    // At a reference triangle the inverse frame rows are bounded by
    // areaMax/minimum. Center coning costs at most 16 in corner displacements.
    if (!(error < distance*sine/16)) return false;
    const qMin=minimum/lengths.reduce((s,v)=>s*v,1);
    const rhoMin=minimum/(3*areaMax*Math.hypot(...lengths));
    if (!qualityWarning && Math.min(qMin,rhoMin)<=2*QUALITY_EPS_FACTOR*eps) {
        const nodes=axes.map(d=>{
            const offset=.5/dp[d];
            return [...new Set([0,offset,1-offset,1])];
        });
        let lowest=Infinity, observed;
        for (const x of nodes[0]) for (const y of nodes[1]) for (const z of nodes[2]) {
            const point=[x,y,z], columns=jacobianColumns(edges,point);
            if (columns.some(v=>!norm(v))) continue; // allowed collapsed boundary
            const {q,rho}=cellQuality(columns,dp);
            if (Math.min(q,rho)<lowest) { lowest=Math.min(q,rho);observed={q,rho,point}; }
        }
        if (observed && lowest<QUALITY_EPS_FACTOR*eps) {
            const {q,rho,point}=observed;
            const ijk=point.map((t,d)=>Math.min(dp[d],Math.floor(t*dp[d])+1));
            warn(`ШГ №${block.row+1}, ЭО [${ijk.join(", ")}]: q = ${q.toPrecision(3)}, σmin/σmax = ${rho.toPrecision(3)}.`);
        } else {
            warn(`ШГ №${block.row+1}: возможна потеря точности ЭО. Нижние оценки q ≥ ${qMin.toPrecision(3)}, σmin/σmax ≥ ${rhoMin.toPrecision(3)}.`);
        }
    }
    return true;
}
function axialCount(r,general) {
    const count=r.symAs ?? 1;
    return general.fullAxialSymmetry && count>1 ? Math.floor((count+2)/2) : count;
}
function imageCount(r,general) {
    const mirrors=[general.mirrorSymmetryX,general.mirrorSymmetryY].filter(n=>n===0||n===1).length;
    return (r.symLs ?? 1)*axialCount(r,general)*(r.symPs ?? 1)*2**mirrors;
}
function buildCells(blocks,general,cast,ownerBases,fail) {
    const cells=[];
    const ordered=blocks.slice().sort((a,b)=>Number(kvFlags(b.record).rv)-Number(kvFlags(a.record).rv));
    for (const {record,row,vertices,dp} of ordered) {
        const physical={...record,symAs:axialCount(record,general)};
        const nl=record.symLs ?? 1, na=record.symKya ? 1 : physical.symAs, np=record.symKyp ? 1 : (record.symPs ?? 1);
        const instances=expandElementSymmetry(physical,general);
        const images=instances.map(im=>({matrix:im.matrix,image:imageName(im),
            native:(im.ls*na+(na===1 ? 0 : im.as))*np+(np===1 ? 0 : im.ps),
            parity:(im.mirrorX+im.mirrorY)%2 ? -1 : 1}));
        const pointCache=new Map();
        const point=(i,j,k)=>{
            const key=(i*(dp[1]+1)+j)*(dp[2]+1)+k;
            if (!pointCache.has(key)) pointCache.set(key,gridPoint(vertices,i/dp[0],j/dp[1],k/dp[2]));
            return pointCache.get(key);
        };
        for (let i=0;i<dp[0];i++) for (let j=0;j<dp[1];j++) for (let k=0;k<dp[2];k++) {
            const index=(i*dp[1]+j)*dp[2]+k+1;
            const local=Array.from({length:8},(_,v)=>point(i+(v&1),j+((v>>1)&1),k+((v>>2)&1)));
            for (const im of images) {
                const owner=ownerBases.get(row)+(index-1)*nl*na*np+im.native;
                const p=local.map(q=>applyMatrix4ToPoint(im.matrix,q).map(cast));
                if (!p.every(q=>q.every(Number.isFinite))) {
                    fail(row,`ШГ №${row+1}, ЭО №${index}: координаты образа вне диапазона REAL.`);
                    return null;
                }
                cells.push({p,local,owner,row,index,ijk:[i,j,k],dp,image:im.image,parity:im.parity});
            }
        }
    }
    return cells;
}
function binCoords(point,tol) {
    // Above the exact integer range adjacent representable coordinates on that
    // axis are already farther apart than tol. Other axes retain their bins.
    return point.map(x=>Number.isSafeInteger(Math.floor(x/tol)) ? Math.floor(x/tol) : "="+x);
}
function* nearKeys(key) {
    const options=key.map(x=>typeof x==="number" ? [x-1,x,x+1] : [x]);
    for (const x of options[0]) for (const y of options[1]) for (const z of options[2]) yield [x,y,z].join(",");
}
function cornerIds(cells,eps,fail) {
    let scale=0, spacing=Infinity;
    for (const {p} of cells) for (const [i,q] of p.entries()) {
        scale=Math.max(scale,...q.map(Math.abs));
        for (let j=0;j<i;j++) {
            const dist=norm(sub(q,p[j]));
            if (dist>0) spacing=Math.min(spacing,dist);
        }
    }
    const tol=Math.min(scale,spacing)*Math.max(16*eps,128*Number.EPSILON);
    const buckets=new Map(), nodes=[], exact=new Map();
    for (const c of cells) {
        c.ids=[];
        for (const p of c.p) {
            const exactKey=p.join(",");
            let id=exact.get(exactKey);
            if (id===undefined) {
                const key=binCoords(p,tol);
                // Exact duplicates, overwhelmingly common on rectangular grids,
                // bypass bin enumeration. Genuinely close points use all 27 bins.
                if (tol>0) for (const bin of nearKeys(key)) for (const other of buckets.get(bin) ?? []) {
                    if (!nodes[other].every((x,d)=>Math.abs(x-p[d])<=tol)) continue;
                    if (id!==undefined && id!==other) {
                        fail(c.row,`${location(c)}: неоднозначное совпадение геометрических узлов.`);
                        return null;
                    }
                    id=other;
                }
                if (id===undefined) {
                    id=nodes.length; nodes.push(p);
                    const k=key.join(",");
                    if (!buckets.has(k)) buckets.set(k,[]);
                    buckets.get(k).push(id);
                }
                exact.set(exactKey,id);
            }
            c.ids.push(id);
        }
    }
    return nodes;
}
const warpedFace = (p,eps) => { const plane=quadPlane(p,eps); return plane.height>plane.tolerance; };
function facePoints(c,f) { return faces[f].map(i=>c.p[i]); }
function alignMed(cells,nodes,med,eps,fail) {
    const contacts=med?.contacts?.filter(link=>link.compatible && !link.ignored && link.oldA!==-1 && link.oldB!==-1
        && !(link.oldA>0 && link.oldA!==link.b.block) && !(link.oldB>0 && link.oldB!==link.a.block)) ?? [];
    if (!contacts.length) return true;
    const lookup=new Map(), sets=new Map();
    for (const {a,b} of contacts) for (const f of [a,b]) lookup.set(contactKey(f.block-1,f.image,f.face),[]);
    for (const cell of cells) for (let f=0;f<6;f++) {
        const axis=faceAxis(f);
        if (cell.ijk[axis]===((f%2) ? cell.dp[axis]-1 : 0))
            lookup.get(contactKey(cell.row,cell.image,f))?.push(cell);
    }
    const root=id=>{
        let r=id;
        while (sets.has(r)) r=sets.get(r);
        if (id!==r) sets.set(id,r);
        return r;
    };
    const centroid=points=>axes.map(d=>points.reduce((v,p)=>v+p[d]/4,0));
    for (const {a,b} of contacts) {
        const left=lookup.get(contactKey(a.block-1,a.image,a.face)), right=lookup.get(contactKey(b.block-1,b.image,b.face));
        if (!left?.length || !right?.length) continue;
        const buckets=new Map();
        for (const c of right) {
            const p=facePoints(c,b.face), key=binCoords(centroid(p),med.tolerance).join(",");
            if (!buckets.has(key)) buckets.set(key,[]);
            buckets.get(key).push({c,p});
        }
        for (const c of left) {
            const p=facePoints(c,a.face);
            let matched=false;
            for (const k of nearKeys(binCoords(centroid(p),med.tolerance))) for (const other of buckets.get(k) ?? []) {
                const order=vertexPermutation(p,other.p,med.tolerance);
                if (!order) continue;
                if (matched) {fail(c.row,`${location(c)}: неоднозначная контактная грань MED №${a.face+1}.`);return false;}
                matched=true;
                if (!warpedFace(p,eps) && !warpedFace(other.p,eps)) continue;
                for (const [i,j] of order.entries()) {
                    const x=root(c.ids[faces[a.face][i]]), y=root(other.c.ids[faces[b.face][j]]);
                    if (x!==y) sets.set(Math.max(x,y),Math.min(x,y));
                }
            }
            if (!matched && warpedFace(p,eps)) {
                fail(c.row,`${location(c)}: не подтверждено соответствие узлов неплоской контактной грани MED №${a.face+1}.`);
                return false;
            }
        }
    }
    if (!sets.size) return true;
    const touched=new Set(sets.keys());
    for (const id of [...touched]) touched.add(root(id));
    for (const c of cells) {
        const ids=c.ids.map(root);
        if (new Set(ids).size!==new Set(c.ids).size) {
            fail(c.row,`${location(c)}: соответствие MED объединяет различные углы ЭО.`);return false;
        }
        c.ids=ids;
        c.p=c.p.map((v,i)=>touched.has(ids[i]) ? nodes[ids[i]] : v);
    }
    return true;
}

// A signed graph on (owner,face). The first warped slot in solver order
// seeds 1–3; a cyclic shift by one exchanges the two diagonal candidates.
export function faceSplits(cells,eps,fail,reference) {
    const first=new Map(), neighbors=new Map(), warped=new Set(), slotCell=new Map();
    for (const c of cells) for (const [f,indices] of faces.entries()) {
        const slot=6*c.owner+f, points=facePoints(c,f), ids=indices.map(i=>c.ids[i]);
        if (warpedFace(points,eps)) {
            warped.add(slot);
            if (new Set(ids).size<4) {fail(c.row,`${location(c)}: неразличимые узлы неплоской грани №${f+1}.`);return null;}
        }
        if (new Set(ids).size<4) continue;
        const key=ids.slice().sort((a,b)=>a-b).join(",");
        const pair=(a,b)=>a<b ? a+","+b : b+","+a;
        const ac=pair(ids[0],ids[2]), bd=pair(ids[1],ids[3]);
        if (!first.has(key)) {first.set(key,{slot,ac,bd});slotCell.set(slot,c);continue;}
        const other=first.get(key);
        const relation=other.ac===ac ? 1 : other.bd===ac ? -1 : 0;
        if (!relation || (reference && ((reference.get(slot)??0)!==relation*(reference.get(other.slot)??0)))) {
            fail(c.row,`${location(c)}: несовместимый обход или разрез общей грани №${f+1} с ${location(slotCell.get(other.slot))}.`);
            return null;
        }
        if (slot===other.slot && relation===1) continue;
        for (const [s,t] of [[slot,other.slot],[other.slot,slot]]) {
            if (!neighbors.has(s)) neighbors.set(s,[]);
            neighbors.get(s).push([t,relation]);
        }
    }
    if (reference) return reference;
    const plan=new Map();
    for (const seed of [...warped].sort((a,b)=>a-b)) {
        if (plan.has(seed)) continue;
        const stack=[seed];
        plan.set(seed,1);
        while (stack.length) {
            const slot=stack.pop();
            for (const [t,relation] of neighbors.get(slot) ?? []) {
                const split=plan.get(slot)*relation;
                if (!plan.has(t)) {plan.set(t,split);stack.push(t);}
                else if (plan.get(t)!==split) {
                    const c=slotCell.get(t) ?? cells.find(cell=>cell.owner===Math.floor(t/6));
                    fail(c.row,`${location(c)}: контакты или образы требуют противоположных диагоналей грани №${t%6+1}.`);
                    return null;
                }
            }
        }
    }
    return plan;
}
// Unlike a planar reference face, an intermediate layer of a trilinear block
// can be warped. This matches weak_block_has_facets on the undeformed source.
function warpedLayers({vertices,dp},eps) {
    if (faces.some(ids=>warpedFace(ids.map(i=>vertices[i]),eps))) return true;
    const lowFaces=[[0,2,6,4],[0,1,5,4],[0,1,3,2]];
    for (const axis of axes) {
        if (dp[axis]===1) continue;
        const ids=lowFaces[axis], stride=1<<axis;
        const sides=ids.map(i=>sub(vertices[i+stride],vertices[i]));
        if (sides.every(edge=>same(edge,sides[0]))) continue;
        // Identically planar layers can also lie in axis-aligned planes.
        if (axes.some(d=>ids.every(i=>vertices[i][d]===vertices[ids[0]][d]
            && vertices[i+stride][d]===vertices[ids[0]+stride][d]))) continue;
        // Very fine grids go through the explicit completeness handling below.
        if (dp[axis]>4096) return true;
        for (let k=1;k<dp[axis];k++) {
            const t=k/dp[axis];
            const layer=ids.map((i,j)=>vertices[i].map((x,d)=>x+t*sides[j][d]));
            if (warpedFace(layer,eps)) return true;
        }
    }
    return false;
}
function blockBounds(block,general) {
    const count=imageCount(block.record,general);
    if (!Number.isSafeInteger(count) || count>1024) return null;
    const ranges=axes.map(()=>[Infinity,-Infinity]);
    const r=block.record, physical={...r,symAs:axialCount(r,general)};
    for (const {matrix} of expandElementSymmetry(physical,general)) for (const v of block.vertices) {
        const p=applyMatrix4ToPoint(matrix,v);
        for (const d of axes) {ranges[d][0]=Math.min(ranges[d][0],p[d]); ranges[d][1]=Math.max(ranges[d][1],p[d]);}
    }
    return ranges;
}
function nearby(a,b,tolerance) {
    if (!a || !b) return true;
    return axes.every(d=>a[d][0]<=b[d][1]+tolerance && b[d][0]<=a[d][1]+tolerance);
}

export function validateSubdivision(blocks,general,med,{reference,maxCells=24000}={}) {
    const errors=new Map(), warnings=new Map(), eps=realEpsilon(general.doubleFloat);
    const fail=(row,message)=>{if (!errors.has(row)) errors.set(row,message);};
    const result={errors,warnings,plan:null};
    const contacts=new Set((med?.contacts ?? []).filter(link=>link.compatible && link.oldA!==-1 && link.oldB!==-1)
        .flatMap(link=>[link.a.block-1,link.b.block-1]));
    const regular=blocks.map(b=>regularGrid(b,eps,b.qualityWarning,contacts.has(b.row) ? med.tolerance : 0,
        message=>warnings.set(b.row,message)));
    // Even when every diagonal is safe for the individual shell, contact
    // and symmetry cycles still have to agree on the actual shared diagonal.
    const flat=blocks.map((b,i)=>regular[i] && (!warpedLayers(b,eps) || flatGridDirections(b)));
    if (flat.every(Boolean)) return result;
    // A grid with exactly planar layers and certified embedded cells has no
    // warped slots, even on a partial-face contact. A MED tolerance can,
    // however, snap its corners to a warped neighbor; keep that whole block.
    // Near-flat faces still participate in shared corner/diagonal matching.
    // Keep original slot numbers across filtering and across moving/reference poses.
    let ownerCount=0;
    const ownerBases=new Map();
    for (const b of blocks.slice().sort((a,b)=>Number(kvFlags(b.record).rv)-Number(kvFlags(a.record).rv))) {
        const r=b.record;
        ownerBases.set(b.row,ownerCount);
        ownerCount+=b.dp.reduce((p,n)=>p*n,1)*(r.symLs??1)*(r.symKya ? 1 : axialCount(r,general))*(r.symKyp ? 1 : r.symPs??1);
        if (!Number.isSafeInteger(6*ownerCount)) {
            fail(b.row,"Число независимых ЭО не позволяет точно представить номер грани. Проверка не завершена.");
            return result;
        }
    }
    {
        const essential=blocks.map((b,i)=>!flat[i] || contacts.has(b.row));
        const bounds=blocks.map(b=>blockBounds(b,general));
        const scale=bounds.reduce((v,box)=>box ? Math.max(v,...box.flat().map(Math.abs)) : v,0);
        const tolerance=Math.max(med?.tolerance ?? 0,64*eps*scale);
        const kept=new Set(), queue=[];
        for (const [i,needed] of essential.entries()) if (needed) {kept.add(i);queue.push(i);}
        while (queue.length) {
            const i=queue.pop();
            for (const [j,other] of blocks.entries()) {
                if (kept.has(j) || !nearby(bounds[i],bounds[j],tolerance) || flatGridDirections(other)) continue;
                kept.add(j);queue.push(j);
            }
        }
        blocks=blocks.filter((_,i)=>kept.has(i));
    }
    let count=0;
    for (const b of blocks) {
        count+=b.dp.reduce((p,n)=>p*n,1)*imageCount(b.record,general);
        if (!Number.isSafeInteger(count) || count>maxCells) {
            fail(b.row,`Проверка оболочек ЭО не завершена: нужен перебор более ${maxCells} ЭО с образами. Корректность не подтверждена.`);
            return result;
        }
    }
    const cells=buildCells(blocks,general,general.doubleFloat ? Number : Math.fround,ownerBases,fail);
    if (!cells?.length) return result;
    const nodes=cornerIds(cells,eps,fail);
    if (!nodes || !alignMed(cells,nodes,med,eps,fail)) return result;
    const plan=faceSplits(cells,eps,fail,reference);
    if (!plan) return result;
    result.plan=plan;
    const quality=new Map();
    for (const c of cells) {
        if (errors.has(c.row)) continue;
        const edges=edgeVectors(c.p), center=jacobianColumns(edges,[.5,.5,.5]);
        if (!(det3(center)*c.parity>0)) {fail(c.row,`${location(c)}: вырожденный или инвертированный якобиан ЭО.`);continue;}
        const oriented=c.parity<0 ? c.p.map((_,i)=>c.p[i^1]) : c.p;
        // A rounded grid vertex may coincide with its neighbor. A collapse
        // carried by the source wedge/pyramid is intentional; a new one is not.
        if (c.ids.some((id,i)=>c.ids.slice(0,i).some((other,j)=>other===id && !same(c.local[i],c.local[j])))) {
            fail(c.row,`${location(c)}: различные узлы ЭО совпали в выбранной разрядности.`);continue;
        }
        const regular=closeToAffine(c.p);
        const measure=regular ? cellQuality(center,[1,1,1]) : validateKvVerticesDetailed(oriented,{doubleFloat:general.doubleFloat});
        if (!regular && !measure.valid) {fail(c.row,`${location(c)}: не подтверждена положительность якобиана ЭО в выбранной разрядности.`);continue;}
        if (!regular) {
            const problem=shellDefect(c.p,faces.map((_,f)=>plan.get(6*c.owner+f)??0));
            if (problem) {fail(c.row,`${location(c)}: ${problem}.`);continue;}
        }
        const {q,rho}=regular ? measure : measure.measurements.quality;
        const worst=Math.min(Math.abs(q),rho);
        if (worst<QUALITY_EPS_FACTOR*eps && worst<(quality.get(c.row)??Infinity)) {
            quality.set(c.row,worst);
            warnings.set(c.row,`${location(c)}: тонкий или сильно скошенный ЭО, |q| = ${Math.abs(q).toPrecision(3)}, σmin/σmax = ${rho.toPrecision(3)}.`);
        }
    }
    return result;
}
