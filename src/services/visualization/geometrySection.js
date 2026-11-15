// Slice the same world-space triangles the viewport displays. Each volume owns
// its own contours, so an air gap or a neighbouring material cannot be filled.
const localBounds = new WeakMap();

function meetsPlane(THREE, primitive, matrix, axis, coordinate) {
  let box = localBounds.get(primitive);
  if (!box) {
    box = new THREE.Box3().setFromArray(primitive.vertices);
    localBounds.set(primitive, box);
  }
  let low = matrix[12 + axis], high = low;
  for (let k = 0; k < 3; k++) {
    const a = matrix[4 * k + axis] * box.min.getComponent(k);
    const b = matrix[4 * k + axis] * box.max.getComponent(k);
    low += Math.min(a, b);
    high += Math.max(a, b);
  }
  const epsilon = 8 * Number.EPSILON * Math.max(Math.abs(low), Math.abs(high), Math.abs(coordinate));
  return coordinate >= low - epsilon && coordinate <= high + epsilon;
}

// Trace the bounded faces of the planar segment graph. At a plane through
// a vertex, several contours may meet; take the next clockwise outgoing edge.
function closedContours(points, segments) {
  const neighbors = points.map(() => []);
  for (const [a, b] of segments) {
    neighbors[a].push(b);
    neighbors[b].push(a);
  }
  for (const [i, adjacent] of neighbors.entries()) {
    const angle = j => Math.atan2(points[j].y - points[i].y, points[j].x - points[i].x);
    adjacent.sort((a, b) => angle(a) - angle(b));
  }
  const visited = new Set(), rings = [];
  for (let i = 0; i < neighbors.length; i++) for (const j of neighbors[i]) {
    let a = i, b = j;
    const ring = [];
    while (!visited.has(a + ':' + b)) {
      visited.add(a + ':' + b);
      ring.push(a);
      const next = neighbors[b];
      const c = next[(next.indexOf(a) + next.length - 1) % next.length];
      a = b; b = c;
    }
    if (a !== i || b !== j || ring.length < 3) continue;
    const base = points[ring[0]];
    let area = 0;
    for (let k = 1; k + 1 < ring.length; k++) {
      const p = points[ring[k]], q = points[ring[k + 1]];
      area += (p.x - base.x) * (q.y - base.y) - (p.y - base.y) * (q.x - base.x);
    }
    if (area > 0) rings.push(ring);
  }
  return rings;
}

export function intersectSection(THREE, primitive, instance, { axis, coordinate, side }) {
  if (primitive.kind === 'region-line' || !meetsPlane(THREE, primitive, instance.matrix, axis, coordinate)) return null;
  const xyz = primitive.vertices, indices = primitive.indices, volume = primitive.kind === 'element-volume';
  const u = (axis + 1) % 3, v = (axis + 2) % 3;
  const transform = new THREE.Matrix4().fromArray(instance.matrix);
  const vertices = [], distances = [];
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < xyz.length; k += 3) {
    const p = new THREE.Vector3().fromArray(xyz, k).applyMatrix4(transform);
    const d = p.getComponent(axis) - coordinate;
    vertices.push(p); distances.push(d);
    lo = Math.min(d, lo); hi = Math.max(d, hi);
  }
  const eps = 8 * Number.EPSILON * Math.max(Math.abs(coordinate), Math.abs(lo), Math.abs(hi));
  if (lo > eps || hi < -eps || (volume && (side > 0 ? hi : -lo) <= eps)) return null;
  const signs = distances.map(d => Math.abs(d) <= eps ? 0 : Math.sign(d));
  const points = [], projected = [], nodes = new Map(), edges = new Map();
  function node(point) {
    const x = point.getComponent(u), y = point.getComponent(v), key = x + ',' + y;
    if (!nodes.has(key)) {
      nodes.set(key, points.length);
      points.push(point.clone().setComponent(axis, coordinate));
      projected.push(new THREE.Vector2(x, y));
    }
    return nodes.get(key);
  }
  function segment(a, b, coplanar) {
    if (a === b) return;
    const key = Math.min(a, b) + ':' + Math.max(a, b);
    const edge = edges.get(key) ?? { pair: [a, b], crosses: false, flat: 0 };
    if (coplanar) edge.flat++;
    else edge.crosses = true;
    edges.set(key, edge);
  }
  const crossings = new Map();
  function crossing(i, j) {
    const a = Math.min(i, j), b = Math.max(i, j), key = a + ':' + b;
    if (!crossings.has(key)) {
      const t = distances[a] / (distances[a] - distances[b]);
      crossings.set(key, node(vertices[a].clone().lerp(vertices[b], t)));
    }
    return crossings.get(key);
  }
  for (let k = 0; k < indices.length; k += 3) {
    const tri = [indices[k], indices[k + 1], indices[k + 2]];
    if (tri.every(i => signs[i] === 0)) {
      for (let n = 0; n < 3; n++) segment(node(vertices[tri[n]]), node(vertices[tri[(n+1)%3]]), true);
      continue;
    }
    const hits = new Set();
    for (let n = 0; n < 3; n++) {
      const i = tri[n], j = tri[(n + 1) % 3];
      if (signs[i] === 0) hits.add(node(vertices[i]));
      else if (signs[i] * signs[j] < 0) hits.add(crossing(i, j));
    }
    if (hits.size === 2) { const [a, b] = hits; segment(a, b, false); }
  }
  const segments = [...edges.values()].filter(e => e.crosses || e.flat % 2).map(e => e.pair);
  if (!segments.length) return null;
  const triangles = [];
  if (volume) {
    // A section of one hexahedron can have separate components. Never join
    // them by angular sorting around a shared centroid.
    for (const ring of closedContours(projected, segments)) {
      const contour = ring.map(i => projected[i]);
      for (const face of THREE.ShapeUtils.triangulateShape(contour, [])) triangles.push(face.map(i => ring[i]));
    }
  }
  return { points, segments, triangles };
}

export function buildSectionLayer(THREE, batches, plane, styleFor) {
  const root = new THREE.Group();
  root.name = 'geometry-section';
  for (const { primitive, instances } of batches) {
    if (primitive.kind === 'region-line') continue;
    const lines = [], faces = [], lineOwners = [], faceOwners = [];
    for (const instance of instances) {
      const cut = intersectSection(THREE, primitive, instance, plane);
      if (!cut) continue;
      for (const edge of cut.segments) {
        for (const i of edge) cut.points[i].toArray(lines, lines.length);
        lineOwners.push(instance);
      }
      for (const triangle of cut.triangles) {
        for (const i of triangle) cut.points[i].toArray(faces, faces.length);
        faceOwners.push(instance);
      }
    }
    if (!lines.length) continue;
    const style = styleFor(primitive, instances[0]);
    function add(positions, owners, isFace) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const material = isFace ? new THREE.MeshBasicMaterial({
        color: style.color, side: THREE.DoubleSide, polygonOffset: true,
        polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      }) : new THREE.LineBasicMaterial({ color: faces.length ? style.edgeColor : style.color });
      // The cut is exactly on the clipping plane. Avoid numerical clipping
      // of its own fragments after the camera-space Float32 transformation.
      material.onBeforeCompile = shader => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', '');
      };
      const object = isFace ? new THREE.Mesh(geometry, material) : new THREE.LineSegments(geometry, material);
      object.userData = { source: primitive.source,
        pick: { kind: isFace ? 'mesh' : 'line', span: isFace ? 1 : 2, instances: owners } };
      object.renderOrder = isFace ? 1 : 2;
      root.add(object);
    }
    if (faces.length) add(faces, faceOwners, true);
    add(lines, lineOwners, false);
  }
  return root;
}
