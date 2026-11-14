import {add, sub, times, dot, cross, norm, same, integerPoints} from "./geometryShape.js";

const axes = [0,1,2];
const directions = axes.map(a => [0,1,2,3,4,5,6,7].filter(i => !(i & (1<<a))));
export const edgeVectors = points => directions.map((starts,a) => starts.map(i => sub(points[i+(1<<a)],points[i])));

export function jacobianColumns(edges, xyz) {
    return edges.map((vectors,a) => {
        const columns = [0,0,0];
        const [b,c] = axes.filter(d => d!==a);
        for (let k=0;k<4;k++) {
            const weight = (k&1 ? xyz[b] : 1-xyz[b])*(k&2 ? xyz[c] : 1-xyz[c]);
            for (let d=0;d<3;d++) columns[d] += weight*vectors[k][d];
        }
        return columns;
    });
}
export const det3 = ([a,b,c]) => dot(a,cross(b,c));

// Index i+3j+9k. A quadratic's middle Bernstein coefficient is
// 2*f(1/2) - (f(0)+f(1))/2. Integer passes retain a common factor of 2.
const lines = [1,3,9].map(stride => Array.from({length:27},(_,i)=>i).filter(i => Math.floor(i/stride)%3===0));
function coefficients(values, exact) {
    const b = values.slice();
    for (let a=0;a<3;a++) {
        const s=3**a;
        for (const i of lines[a]) {
            const p=b[i], q=b[i+s], r=b[i+2*s];
            if (exact) {
                b[i]=2n*p; b[i+s]=4n*q-p-r; b[i+2*s]=2n*r;
            } else b[i+s]=2*q-(p+r)/2;
        }
    }
    return b;
}
const digit = (i,a) => Math.floor(i/3**a)%3;
function exactCoefficients(points) {
    const edges=edgeVectors(integerPoints(points));
    const samples=Array.from({length:27},(_,i) => {
        const j=edges.map((vectors,a) => {
            const [b,c]=axes.filter(d=>d!==a);
            const s=digit(i,b), t=digit(i,c);
            const v=[0n,0n,0n];
            for (let k=0;k<4;k++) {
                const w=BigInt((k&1 ? s : 2-s)*(k&2 ? t : 2-t));
                for (const d of axes) v[d]+=w*vectors[k][d];
            }
            return v;
        });
        return det3(j);
    });
    return coefficients(samples,true);
}
function collapsedBoundary(points) {
    const faces=[], edges=[];
    for (const a of axes) {
        for (const side of [0,1]) {
            const corners=points.filter((_,i)=>((i>>a)&1)===side);
            if (new Set(corners.map(p=>p.join(","))).size<=2) faces.push({a,side});
        }
        for (const i of directions[a]) {
            if (same(points[i],points[i+(1<<a)])) edges.push({a,i});
        }
    }
    return p => faces.some(({a,side})=>p[a]===side)
        || edges.some(({a,i})=>axes.every(d=>d===a || p[d]===((i>>d)&1)));
}
function split(b,a) {
    const lo=b.slice(), hi=b.slice(), s=3**a;
    for (const i of lines[a]) {
        const p=b[i], q=b[i+s], r=b[i+2*s], middle=p+2n*q+r;
        lo[i]=4n*p; lo[i+s]=2n*(p+q); lo[i+2*s]=middle;
        hi[i]=middle; hi[i+s]=2n*(q+r); hi[i+2*s]=4n*r;
    }
    return [lo,hi];
}
const abs = n => n<0n ? -n : n;
const ratio = (n,d) => Number((n<<50n)/d)/2**50;
const interpolate = (lo,hi,x) => lo.map((v,a)=>v+(hi[a]-v)*x[a]);
function boundaryWitness(b,lo,hi,allowed) {
    for (const a of axes) {
        const s=3**a;
        for (const i of lines[a]) {
            const point=axes.map(d=>digit(i,d)/2);
            if (point.some(x=>x===.5)) continue;
            const p=b[i], q=b[i+s], r=b[i+2*s];
            const check=(value,t) => {
                point[a]=t;
                const location=interpolate(lo,hi,point);
                if (value<0n) return {status:"inverted",location};
                if (!value && !allowed(location)) return {status:"singular",location};
            };
            const end=check(p,0) || check(r,1);
            if (end) return end;
            // A quadratic has at most one strict interior minimum on an edge.
            if (p>q && r>q) {
                const value=p*r-q*q;
                const witness=check(value,ratio(p-q,p-2n*q+r));
                if (witness) return witness;
            }
        }
    }
}
// Nonnegative control coefficients imply strict positivity in each open
// stratum if one coefficient supported there is positive. Include internal
// subdivision interfaces: a zero there is still inside the original cell.
function zeroStratum(b,lo,hi,allowed) {
    for (let i=0;i<27;i++) {
        if (b[i]!==0n) continue;
        const mask=axes.map(a=>digit(i,a));
        if (b.some((v,j)=>v>0n && axes.every(a=>mask[a]===1 || digit(j,a)===mask[a]))) continue;
        const location=interpolate(lo,hi,mask.map(x=>x/2));
        if (!allowed(location)) return {status:"singular",location};
    }
}
export function certifyJacobian(points, samples, errorBound) {
    // The samples use normalized coordinates and edge interpolation. The
    // conservative guard covers three tensor conversions and the scalar triple.
    if (coefficients(samples,false).every(x=>x>errorBound)) return {status:"positive"};
    const allowed=collapsedBoundary(points);
    const pending=[{b:exactCoefficients(points),lo:[0,0,0],hi:[1,1,1],depth:0}];
    let visits=0, unresolved;
    while (pending.length && visits++<4096) {
        const {b,lo,hi,depth}=pending.pop();
        const witness=boundaryWitness(b,lo,hi,allowed);
        if (witness) return witness;
        if (b.every(x=>x>=0n)) {
            const zero=zeroStratum(b,lo,hi,allowed);
            if (zero) return zero;
            continue;
        }
        if (depth>=48) { unresolved={lo,hi}; continue; }
        const variation=axes.map(a=>{
            const s=3**a;
            let max=0n;
            for (const i of lines[a]) for (const j of [i,i+s]) {
                const delta=abs(b[j]-b[j+s]);
                if (delta>max) max=delta;
            }
            return max;
        });
        const a=variation.reduce((best,x,i)=>x>variation[best]?i:best,0);
        const mid=(lo[a]+hi[a])/2, lowEnd=hi.slice(), highStart=lo.slice();
        lowEnd[a]=highStart[a]=mid;
        const [left,right]=split(b,a);
        pending.push({b:right,lo:highStart,hi,depth:depth+1},{b:left,lo,hi:lowEnd,depth:depth+1});
    }
    const box=unresolved || pending.at(-1);
    return box ? {status:"unresolved",lo:box.lo,hi:box.hi} : {status:"positive"};
}

// One-sided Jacobi SVD avoids squaring the condition number in JᵀJ.
export function cellQuality(columns,dp) {
    const j=columns.map((v,d)=>times(v,1/dp[d]));
    const sizes=j.map(norm), scale=Math.max(...sizes);
    if (!scale || sizes.includes(0)) return {q:0,rho:0};
    const q=det3(j.map((v,d)=>times(v,1/sizes[d])));
    const s=j.map(v=>times(v,1/scale));
    for (let sweep=0;sweep<12;sweep++) {
        let changed=false;
        for (const [p,r] of [[0,1],[0,2],[1,2]]) {
            const a=dot(s[p],s[p]), b=dot(s[r],s[r]), h=dot(s[p],s[r]);
            if (Math.abs(h)<=8*Number.EPSILON*Math.sqrt(a)*Math.sqrt(b)) continue;
            const tau=(b-a)/(2*h), t=(tau<0?-1:1)/(Math.abs(tau)+Math.hypot(1,tau));
            const c=1/Math.hypot(1,t), sn=c*t, u=s[p], v=s[r];
            s[p]=sub(times(u,c),times(v,sn));
            s[r]=add(times(u,sn),times(v,c));
            changed=true;
        }
        if (!changed) break;
    }
    const sigmas=s.map(norm);
    return {q,rho:Math.min(...sigmas)/Math.max(...sigmas)};
}

// Transport the low tangent frame with the shortest rotation of its normal.
// The polar rotation angle of F = B_high B_low⁻¹ is atan2(F21-F12,F11+F22).
export function twistAngles(edges) {
    return axes.map(axis=>{
        const i=(axis+1)%3, j=(axis+2)%3;
        const frame=side=>{
            const point=[.5,.5,.5]; point[axis]=side;
            const cols=jacobianColumns(edges,point);
            const a=cols[i], b=cols[j], n=cross(a,b), length=norm(n);
            return length ? {a,b,n:times(n,1/length)} : null;
        };
        const low=frame(0), high=frame(1);
        if (!low || !high) return null;
        const axisVector=cross(low.n,high.n), cosine=dot(low.n,high.n);
        if (1+cosine<=32*Number.EPSILON) return null;
        const transport=v=>add(add(v,cross(axisVector,v)),times(cross(axisVector,cross(axisVector,v)),1/(1+cosine)));
        const a=transport(low.a), b=transport(low.b);
        const e=times(a,1/norm(a)), f=cross(high.n,e);
        const a11=norm(a), a12=dot(e,b), a22=dot(f,b);
        const h11=dot(e,high.a), h12=dot(e,high.b), h21=dot(f,high.a), h22=dot(f,high.b);
        return Math.atan2(h21*a22-h12*a11+h11*a12, h11*a22+h22*a11-h21*a12)*180/Math.PI;
    });
}
