export const sub = (a, b) => a.map((x, i) => x - b[i]);
export const add = (a, b) => a.map((x, i) => x + b[i]);
export const times = (a, s) => a.map(x => x * s);
export const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
export const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
export const norm = a => Math.hypot(...a);
export const same = (a, b) => a.every((x, i) => x === b[i]);
export const QUALITY_EPS_FACTOR = 1024;
export const realEpsilon = doubleFloat => doubleFloat ? Number.EPSILON : 2 ** -23;

// All finite IEEE coordinates are dyadic. Use a common integer unit for exact
// signs only when an ordinary floating determinant is within its roundoff bound.
const bits = new DataView(new ArrayBuffer(8));
export function integerPoints(points) {
    let base = Infinity;
    const dyadic = points.map(p => p.map(x => {
        if (x === 0) return [0n, 0];
        bits.setFloat64(0, x);
        const word = bits.getBigUint64(0);
        const exponent = Number((word >> 52n) & 2047n);
        let m = word & ((1n << 52n) - 1n);
        if (exponent) m += 1n << 52n;
        const e = (exponent || 1) - 1075;
        base = Math.min(base, e);
        return [x < 0 ? -m : m, e];
    }));
    return dyadic.map(p => p.map(([m,e]) => m ? m << BigInt(e-base) : 0n));
}
const sign = x => x > 0 ? 1 : x < 0 ? -1 : 0;
function area2(a, b, c) {
    return (a[0]-c[0])*(b[1]-c[1]) - (a[1]-c[1])*(b[0]-c[0]);
}
export function orient2(a, b, c) {
    const det = area2(a,b,c);
    const size = Math.abs((a[0]-c[0])*(b[1]-c[1])) + Math.abs((a[1]-c[1])*(b[0]-c[0]));
    if (Math.abs(det) > 8*Number.EPSILON*size) return sign(det);
    // Axis-aligned segments are common, including after projection.
    if ([0,1].some(d => a[d]===b[d] && a[d]===c[d])) return 0;
    return sign(area2(...integerPoints([a,b,c])));
}
export function orient3(a, b, c, d) {
    if ([0,1,2].some(k => a[k]===b[k] && a[k]===c[k] && a[k]===d[k])) return 0;
    const u = sub(b,a), v = sub(c,a), w = sub(d,a);
    const det = dot(u,cross(v,w));
    if (Math.abs(det) > 32*Number.EPSILON*norm(u)*norm(v)*norm(w)) return sign(det);
    const [o,p,q,r] = integerPoints([a,b,c,d]);
    return sign(dot(sub(p,o),cross(sub(q,o),sub(r,o))));
}
export function dropAxis(p, d) { return [p[(d+1)%3], p[(d+2)%3]]; }
export function largestAxis(v) {
    const lengths = v.map(Math.abs);
    return lengths.indexOf(Math.max(...lengths));
}
export function onSegment2(a, b, p) {
    return orient2(a,b,p) === 0 && p.every((x,i) => x >= Math.min(a[i],b[i]) && x <= Math.max(a[i],b[i]));
}
export function segmentsMeet2(a,b,c,d) {
    if (orient2(a,b,c)*orient2(a,b,d)<0 && orient2(c,d,a)*orient2(c,d,b)<0) return true;
    return onSegment2(a,b,c) || onSegment2(a,b,d) || onSegment2(c,d,a) || onSegment2(c,d,b);
}

// Same largest-triangle height and REAL tolerance as weak_warped_quad.
export function quadPlane(points, eps) {
    const [a,b,c,d] = points, ab=sub(b,a), ac=sub(c,a), ad=sub(d,a);
    const normals = [cross(ab,ac), cross(ac,ad), cross(ab,ad), cross(sub(c,b),sub(d,b))];
    const lengths = normals.map(norm), area = Math.max(...lengths);
    const extent = Math.max(norm(ab),norm(ac),norm(ad));
    const coordinate = Math.max(...points.flat().map(Math.abs));
    const height = area ? Math.abs(dot(normals[0],ad))/area : 0;
    return {area, extent, height, normal:normals[lengths.indexOf(area)], tolerance:eps*(8*coordinate+32*extent)};
}

const clamp = x => Math.max(0,Math.min(1,x));
function segmentMinimum(p, direction) {
    const sq = dot(direction,direction);
    return norm(add(p,times(direction,sq ? clamp(-dot(p,direction)/sq) : 0)));
}
// The oriented bilinear surface density is affine. Minimize its norm on its
// parallelogram in normal space, including the interior perpendicular foot.
function minimumDensity(g, gu, gv) {
    let best = Math.min(segmentMinimum(g,gu), segmentMinimum(add(g,gv),gu),
        segmentMinimum(g,gv), segmentMinimum(add(g,gu),gv));
    const normal = cross(gu,gv), square = dot(normal,normal);
    if (square > 0) {
        const u = -dot(cross(g,gv),normal)/square, v = -dot(cross(gu,g),normal)/square;
        if (u >= 0 && u <= 1 && v >= 0 && v <= 1) best = Math.min(best, norm(add(add(g,times(gu,u)),times(gv,v))));
    }
    return best;
}

export function validatePanel(raw, {doubleFloat, force = false}) {
    const issues = [], eps = realEpsilon(doubleFloat);
    const issue = (level,message) => issues.push({level,message});
    if (!Array.isArray(raw) || raw.length!==4 || !Array.from(raw).every(row=>
        Array.isArray(row) && row.length===3 && Array.from(row).every(Number.isFinite))) {
        issue("error","Некорректные координаты площадки.");
        return issues;
    }
    const p = raw.map(row => row.map(doubleFloat ? Number : Math.fround));
    if (!p.flat().every(Number.isFinite)) {
        issue("error","Неконечные координаты площадки в выбранной разрядности.");
        return issues;
    }
    const [a,b,c,d] = p;
    for (let i=0;i<4;i++) for (let j=i+1;j<4;j++) {
        if (same(p[i],p[j]) && !same(raw[i],raw[j])) {
            issue("error",`Вершины ${i+1} и ${j+1} площадки совпали при округлении в выбранной разрядности.`);
            return issues;
        }
    }
    if ((same(a,b) && same(c,d)) || (!force && same(a,d) && same(b,c))) return issues;
    const plane = quadPlane(p,eps);
    if (!plane.area || same(a,c) || same(b,d)) {
        issue("error","Вырожденная площадка: нулевая площадь или совпали противоположные вершины.");
        return issues;
    }
    const triangle = p.some((point,i) => same(point,p[(i+1)%4]));
    if (triangle) {
        // Factor out the single zero on the collapsed edge before assessing quality.
        const reduced = plane.area / plane.extent / plane.extent;
        if (reduced < QUALITY_EPS_FACTOR*eps) issue("warning",`Треугольная площадка близка к вырождению: 2S/L² = ${reduced.toPrecision(3)}.`);
        return issues;
    }
    const warped = plane.height > plane.tolerance;
    if (warped) issue(force ? "error" : "warning",
        `Неплоская площадка: отклонение ${plane.height.toPrecision(4)} мм (допуск ${plane.tolerance.toPrecision(3)} мм).`
        + (force ? " Для поверхности расчёта силы/момента требуется плоская площадка." : ""));
    if (!warped) {
        const projected = p.map(point => dropAxis(point,largestAxis(plane.normal)));
        const [s,t,u,v] = projected;
        const crossing = segmentsMeet2(s,t,u,v) || segmentsMeet2(t,u,v,s);
        const turns = projected.map((q,i) => orient2(q,projected[(i+1)%4],projected[(i+2)%4]));
        const concave = turns.includes(1) && turns.includes(-1);
        if (crossing || concave || turns.includes(0)) {
            // A skew 3D contour can cross in projection only. Its affine area
            // cannot vanish when the four represented vertices are noncoplanar.
            if (orient3(a,b,c,d) === 0) {
                issue("error",crossing ? "Перекрученная площадка: противоположные рёбра контура пересекаются или перекрываются."
                    : concave ? "Невыпуклая площадка: при обходе вершин меняется знак поворота."
                    : "Вырожденный угол площадки: три последовательные вершины коллинеарны.");
                return issues;
            }
            issue("warning",`Почти плоская площадка: проекция контура вырождена или невыпукла, отклонение ${plane.height.toPrecision(4)} мм.`);
        }
    }
    const u = times(sub(b,a),1/plane.extent), v = times(sub(d,a),1/plane.extent);
    const twist = sub(times(sub(c,d),1/plane.extent),u);
    const g = cross(v,u), gu = cross(twist,u), gv = cross(v,twist);
    const min = minimumDensity(g,gu,gv);
    if (min < QUALITY_EPS_FACTOR*eps) issue("warning",`Площадка близка к вырождению: min |G|/L² = ${min.toPrecision(3)}.`);
    return issues;
}
