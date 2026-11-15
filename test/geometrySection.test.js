import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { intersectSection, buildSectionLayer } from '../src/services/visualization/geometrySection.js';
import { geometryHitInstance } from '../src/services/visualization/geometryPicking.js';
import { buildGeometryScene } from '../src/services/visualization/geometrySceneModel.js';

const vec = a => a.map(v => [v]);
const element = { geoType: 2, geo: [[2, 3, 4]], dp: vec([1,1,1]), dr: vec([0,0,0]),
  symVi: vec([0,0,0]), symR0: vec([0,0,0]), symYl: 0, symYa: 0, symTx: 0, symLs: 1, symAs: 1, symPs: 1 };
const scene = buildGeometryScene({ general: { mirrorSymmetryX: -1, mirrorSymmetryY: -1 }, elements: [element] });
const box = scene.primitives[0], image = box.instances[0];
const plane = (axis, coordinate, side = 1) => ({ axis, coordinate, side });
const section = (s, p = box, i = image) => intersectSection(THREE, p, i, s);
const area = cut => cut.triangles.reduce((a, face) => a + new THREE.Triangle(...face.map(i => cut.points[i])).getArea(), 0);

test('three orthogonal cuts retain their area and all triangles lie on the plane', () => {
  for (const [axis, extent, expected] of [[0,2,12],[1,3,8],[2,4,6]]) {
    for (const side of [-1, 1]) {
      const cut = section(plane(axis, extent / 2, side));
      assert.equal(area(cut), expected);
      assert.ok(cut.points.every(p => p.getComponent(axis) === extent / 2));
    }
  }
  assert.equal(section(plane(0, 10)), null);
  assert.equal(area(section(plane(0, 0, 1))), 12);
  assert.equal(section(plane(0, 0, -1)), null);
});

test('a coplanar region exposes its perimeter, a transverse region only its intersection', () => {
  const patch = { kind: 'region-surface', vertices: [0,0,0, 2,0,0, 2,2,0, 0,2,0], indices: [0,1,2,0,2,3] };
  assert.equal(section(plane(2,0), patch).segments.length, 4);
  const slice = section(plane(0,1), patch);
  assert.equal(slice.segments.length, 2);
  assert.deepEqual(slice.triangles, []);
  assert.equal(section(plane(0,1), {...patch, kind:'region-line'}), null);
});

test('material geometry and picking preserve separate images and the gap between them', () => {
  const copy = {...image, ls:1, matrix: new THREE.Matrix4().makeTranslation(0,5,0).elements};
  const layer = buildSectionLayer(THREE, [{primitive:box, instances:[image, copy]}], plane(0,1),
    () => ({color:0x56789a, edgeColor:0x222222}));
  const mesh = layer.children.find(o => o.isMesh);
  layer.updateMatrixWorld(true);
  const hit = y => new THREE.Raycaster(new THREE.Vector3(-2,y,1), new THREE.Vector3(1,0,0)).intersectObject(mesh)[0];
  assert.equal(geometryHitInstance(hit(1)), image);
  assert.equal(hit(4), undefined);
  assert.equal(geometryHitInstance(hit(6)), copy);
  assert.equal(mesh.material.color.getHex(), 0x56789a);
});

test('reflected and tilted images and warped faces use the displayed surface triangulation', () => {
  const matrix = new THREE.Matrix4().makeRotationX(0.45).scale(new THREE.Vector3(-1,1,1));
  const cut = section(plane(0,-1), box, {...image,matrix:matrix.elements});
  assert.ok(Math.abs(area(cut) - 12) < 1e-10);
  const p = {...box, vertices:Array.from(box.vertices)};
  p.vertices[3*7+2] += 1;
  const warped = section(plane(1,1.2), p);
  assert.ok(area(warped) > 8);
  assert.ok(warped.points.every(p => p.y === 1.2));
});
