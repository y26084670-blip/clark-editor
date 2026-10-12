import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { fitCameraToVisibleObjects } from "../src/services/visualization/geometryCameraFit.js";


test("camera fitting uses a 1e-6 squared-length threshold for short view vectors and near-parallel up axes", () => {
  const geometry=new THREE.BufferGeometry().setAttribute("position",new THREE.Float32BufferAttribute([-1,-1,-1,1,1,1],3));
  const object=new THREE.Points(geometry,new THREE.PointsMaterial());
  for(const distance of [.0005,.002]) {
    const camera=new THREE.PerspectiveCamera(45,1,.01,1000);camera.position.set(0,0,distance);
    const controls={target:new THREE.Vector3(),update(){camera.lookAt(this.target);camera.updateMatrixWorld();}};
    assert.equal(fitCameraToVisibleObjects(THREE,camera,controls,[object]),true);
    const backward=camera.position.clone().sub(controls.target).normalize();
    const expected=distance<.001?new THREE.Vector3(1,1,1).normalize():new THREE.Vector3(0,0,1);
    assert.ok(backward.distanceTo(expected)<1e-10);
  }
  for(const angle of [.0005,.002]) {
    const camera=new THREE.OrthographicCamera(-2,2,1,-1,.01,1000);camera.position.set(0,0,10);camera.up.set(Math.sin(angle),0,Math.cos(angle));
    const controls={target:new THREE.Vector3(),update(){camera.lookAt(this.target);camera.updateMatrixWorld();}};
    const wide=geometry.clone();wide.getAttribute("position").setX(0,-3);wide.getAttribute("position").setX(1,3);
    const layer=new THREE.Points(wide,object.material);
    assert.equal(fitCameraToVisibleObjects(THREE,camera,controls,[layer]),true);
    assert.ok(Math.abs(camera.top-(angle<.001?1.62:3.24))<1e-10);wide.dispose();
  }
  geometry.dispose();object.material.dispose();
});
