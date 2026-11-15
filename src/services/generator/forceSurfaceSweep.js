import { forceBodies } from "./forceSurface.js";
import { bounds } from "../solver/medContactGeometry.js";
import { buildGeometryTimeModel } from "../visualization/geometryTimeModel.js";

// A fixed shell must contain/exclude the complete swept volumes, including
// between solver steps. Trajectory tables use piecewise linear Euler angles
// and translations, exactly as buildGeometryTimeModel / solver moveRecall.
export function forceSweepGeometry(model, distance, initial = forceBodies(model)) {
    const moving = model.elements.flatMap((row,i) => row.targ !== 3 && row.indMove > 0 ? [i] : []);
    if (!moving.length) return initial;
    const count = model.general?.countTimeSteps ?? 0, step = model.general?.timeStep ?? 0;
    if (!Number.isSafeInteger(count) || count < 0 || !Number.isFinite(step) || (count > 0 && !(step > 0)))
        throw new Error("Для охвата траектории нужны корректные число интервалов и шаг времени.");
    const end = count*step;
    if (!Number.isFinite(end)) throw new Error("Интервал траектории выходит за диапазон времени.");
    if (!end) return initial;
    if (!(distance > 0) || !Number.isFinite(distance))
        throw new Error("Введите положительное расстояние в миллиметрах.");
    const times = new Set([0,end]);
    for (const index of moving) {
        const move = model.moves[model.elements[index].indMove-1];
        for (const table of [move.angle,move.position]) for (const [time] of table)
            if (time > 0 && time < end) times.add(time);
    }
    const poses = new Map();
    function pose(time) {
        if (!poses.has(time)) {
            if (poses.size >= 4096) throw new Error("Слишком много положений для огибающей. Сократите интервал траектории.");
            const general = {...model.general,countTimeSteps:time > 0 ? 1 : 0,timeStep:time};
            const frame = buildGeometryTimeModel({...model,general},model.moves,time > 0 ? 1 : 0);
            const elements = frame.model.elements.map(row => row.indMove ? {...row,indMove:0} : row);
            poses.set(time,{angles:frame.model.elements.map(row => row.symVi?.flat() ?? [0,0,0]),
                geometry:time === 0 ? initial : forceBodies({...frame.model,elements})});
        }
        return poses.get(time);
    }
    const radius = model.elements.map((_,i) => initial.bodies.find(b => b.index === i)?.motionRadius ?? 0);
    const padding = model.elements.map(() => 0);
    const knots = [...times].sort((a,b) => a-b), target = distance/64;
    const radians = Math.PI/180;
    for (let k=1;k<knots.length;k++) {
        const lo = knots[k-1], hi = knots[k], left = pose(lo), right = pose(hi);
        const angle = index => left.angles[index].reduce((s,v,d) => s+Math.abs(right.angles[index][d]-v)*radians,0);
        let divisions = 1;
        for (const index of moving) divisions = Math.max(divisions,
            Math.ceil(Math.sqrt(radius[index]/(8*target))*angle(index)));
        if (!Number.isSafeInteger(divisions) || divisions > 4095)
            throw new Error("Слишком большой поворот для огибающей. Сократите интервал траектории.");
        // ||p''|| <= radius*(|ax'|+|ay'|+|az'|)^2. Linear interpolation
        // differs from p(t) by at most max||p''||*dt^2/8. A cube padded by
        // that radius contains this entire error ball, not just sample nodes.
        for (const index of moving) padding[index] = Math.max(padding[index],
            radius[index]*(angle(index)/divisions)**2/8);
        for (let j=1;j<divisions;j++) pose(lo+(hi-lo)*j/divisions);
    }
    const snapshots = [...poses.values()].map(p => p.geometry);
    let swept = false;
    const bodies = initial.bodies.map((body,j) => {
        if (!moving.includes(body.index)) return body;
        const points = new Map();
        let changed = false;
        for (const snapshot of snapshots) for (const [v,point] of snapshot.bodies[j].vertices.entries()) {
            points.set(point.join(","),point);
            if (point.some((x,d) => x !== body.vertices[v][d])) changed = true;
        }
        if (!changed && padding[body.index] === 0) return body;
        swept = true;
        const hullVertices = [...points.values()], box = bounds(hullVertices);
        const scale = Math.max(...box.flat().map(Math.abs));
        const roundoff = 64*scale*(initial.cast === Number ? Number.EPSILON : 2**-23);
        const pad = padding[body.index]+roundoff;
        if (!Number.isFinite(pad)) throw new Error("Огибающая траектории выходит за диапазон координат.");
        return {...body,hullVertices,padding:pad,box:box.map(([lo,hi]) => [lo-pad,hi+pad])};
    });
    return {...initial,bodies,swept,coverage:{start:0,end,poses:poses.size}};
}
