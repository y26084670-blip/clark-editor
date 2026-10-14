import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import {
    GEOMETRY_CAMERA_COMMANDS,
    geometryCameraCommandFromKeyboardEvent,
    geometryCameraFrame,
    isGeometryCameraShortcutTarget,
    normalizeGeometryCameraCommand,
    snapshotGeometryCamera,
    restoreGeometryCamera,
    createGeometryAxisRotationController,
} from "../src/services/visualization/geometryCameraView.js";

const DIRECTIONAL_CASES = [
    ["VIEW_POSITIVE_X", "view-positive-x", [-1, 0, 0], [0, 0, 1]],
    ["VIEW_NEGATIVE_X", "view-negative-x", [1, 0, 0], [0, 0, 1]],
    ["VIEW_POSITIVE_Y", "view-positive-y", [0, -1, 0], [0, 0, 1]],
    ["VIEW_NEGATIVE_Y", "view-negative-y", [0, 1, 0], [0, 0, 1]],
    ["VIEW_POSITIVE_Z", "view-positive-z", [0, 0, -1], [0, -1, 0]],
    ["VIEW_NEGATIVE_Z", "view-negative-z", [0, 0, 1], [0, 1, 0]],
];

test("camera command constants expose every supported action", () => {
    assert.deepEqual(GEOMETRY_CAMERA_COMMANDS, {
        FIT_ALL: "fit-all",
        FIT_INITIAL: "fit-initial",
        VIEW_POSITIVE_X: "view-positive-x",
        VIEW_NEGATIVE_X: "view-negative-x",
        VIEW_POSITIVE_Y: "view-positive-y",
        VIEW_NEGATIVE_Y: "view-negative-y",
        VIEW_POSITIVE_Z: "view-positive-z",
        VIEW_NEGATIVE_Z: "view-negative-z",
    });

    for (const [constantName, value] of DIRECTIONAL_CASES) {
        assert.equal(GEOMETRY_CAMERA_COMMANDS[constantName], value);
    }
});

test("camera command normalizer accepts only exact supported values", () => {
    for (const value of Object.values(GEOMETRY_CAMERA_COMMANDS)) {
        assert.equal(normalizeGeometryCameraCommand(value), value);
    }

    for (const value of [
        undefined,
        null,
        "",
        "VIEW_POSITIVE_X",
        "view-positive-x ",
        "future-command",
        1,
        {},
    ]) {
        assert.equal(normalizeGeometryCameraCommand(value), null);
    }
});

test("directional commands define the expected camera offset and up vector", () => {
    for (const [, command, offset, up] of DIRECTIONAL_CASES) {
        assert.deepEqual(geometryCameraFrame(command), { offset, up });
    }
});

test("top and bottom views keep positive X toward screen right", () => {
    for (const command of [
        GEOMETRY_CAMERA_COMMANDS.VIEW_POSITIVE_Z,
        GEOMETRY_CAMERA_COMMANDS.VIEW_NEGATIVE_Z,
    ]) {
        const { offset, up } = geometryCameraFrame(command);
        const gaze = offset.map((component) => -component);
        const screenRight = [
            gaze[1] * up[2] - gaze[2] * up[1],
            gaze[2] * up[0] - gaze[0] * up[2],
            gaze[0] * up[1] - gaze[1] * up[0],
        ];

        assert.deepEqual(screenRight, [1, 0, 0]);
    }
});

test("fit and invalid commands have no fixed camera frame", () => {
    assert.equal(
        geometryCameraFrame(GEOMETRY_CAMERA_COMMANDS.FIT_ALL),
        null,
    );
    assert.equal(geometryCameraFrame("future-command"), null);
    assert.equal(geometryCameraFrame(null), null);
});

test("camera frames are independent mutable values for Three.js consumers", () => {
    const first = geometryCameraFrame(
        GEOMETRY_CAMERA_COMMANDS.VIEW_POSITIVE_X,
    );
    first.offset[0] = 99;
    first.up[2] = 99;

    assert.deepEqual(
        geometryCameraFrame(GEOMETRY_CAMERA_COMMANDS.VIEW_POSITIVE_X),
        {
            offset: [-1, 0, 0],
            up: [0, 0, 1],
        },
    );
});

test("camera keyboard shortcuts map plain axes and Ctrl axes", () => {
    assert.equal(
        geometryCameraCommandFromKeyboardEvent({ code: "KeyA", key: "ф" }),
        GEOMETRY_CAMERA_COMMANDS.FIT_ALL,
    );

    for (const [key, positive, negative] of [
        ["x", "VIEW_POSITIVE_X", "VIEW_NEGATIVE_X"],
        ["Y", "VIEW_POSITIVE_Y", "VIEW_NEGATIVE_Y"],
        ["z", "VIEW_POSITIVE_Z", "VIEW_NEGATIVE_Z"],
    ]) {
        assert.equal(
            geometryCameraCommandFromKeyboardEvent({ code: `Key${key.toUpperCase()}`, key }),
            GEOMETRY_CAMERA_COMMANDS[positive],
        );
        assert.equal(
            geometryCameraCommandFromKeyboardEvent({ code: `Key${key.toUpperCase()}`, key, ctrlKey: true }),
            null,
        );
    }
});

test("camera shortcuts ignore modifier conflicts and editable controls", () => {
    for (const event of [
        { code: "KeyA", ctrlKey: true, shiftKey: true },
        { code: "KeyX", altKey: true },
        { code: "KeyY", metaKey: true },
        { code: "KeyZ", shiftKey: true },
        { key: "q" },
        null,
    ]) {
        assert.equal(geometryCameraCommandFromKeyboardEvent(event), null);
    }

    for (const tagName of ["INPUT", "SELECT", "TEXTAREA"]) {
        assert.equal(isGeometryCameraShortcutTarget({ tagName }), false);
    }
    assert.equal(
        isGeometryCameraShortcutTarget({ tagName: "DIV", isContentEditable: true }),
        false,
    );
    assert.equal(isGeometryCameraShortcutTarget({ tagName: "CANVAS" }), true);
});


test("Ctrl+A restores the same oblique orientation as a new 3D camera in either keyboard layout", () => {
    for (const key of ["a", "A", "ф", "Ф"]) {
        const command = geometryCameraCommandFromKeyboardEvent({ code: "KeyA", key, ctrlKey: true, target: { tagName: "CANVAS" } });
        assert.equal(command, GEOMETRY_CAMERA_COMMANDS.FIT_INITIAL);
        assert.deepEqual(geometryCameraFrame(command), { offset: [1,1,1], up: [0,0,1] });
    }
    for (const target of [{ tagName:"INPUT" }, { tagName:"TEXTAREA" }, { isContentEditable:true }]) {
        assert.equal(geometryCameraCommandFromKeyboardEvent({ code:"KeyA", ctrlKey:true, target }), null);
    }
    for (const state of [{ isComposing:true }, { defaultPrevented:true }, { altKey:true }, { shiftKey:true }, { metaKey:true }]) {
        assert.equal(geometryCameraCommandFromKeyboardEvent({ code:"KeyA", ctrlKey:true, ...state }), null);
    }
});


test("pre-flight view snapshots stay independent and restore both camera types after motion", () => {
  for(const projection of ["perspective","orthographic"]) {
    const camera=projection==="orthographic"?new THREE.OrthographicCamera(-4,4,2,-2,.01,100):new THREE.PerspectiveCamera(50,2,.01,100);
    camera.position.set(3,-2,7);camera.zoom=2.3;camera.rotateY(.4);camera.rotateZ(.7);
    camera.up.set(0,1,0).applyQuaternion(camera.quaternion);
    const controls={target:camera.position.clone().addScaledVector(camera.getWorldDirection(new THREE.Vector3()),5)};
    const saved=snapshotGeometryCamera(camera,controls,projection),expected=structuredClone(saved);
    camera.position.set(200,100,-300);camera.zoom=.2;camera.rotateX(1);controls.target.set(1,2,3);
    assert.deepEqual(saved,expected);
    assert.equal(restoreGeometryCamera(camera,controls,saved),true);
    const restored=snapshotGeometryCamera(camera,controls,projection);
    for(const key of ["position","up","target"])assert.deepEqual(restored[key],saved[key]);
    assert.equal(restored.zoom,saved.zoom);assert.equal(restored.projection,saved.projection);
    assert.ok(camera.quaternion.angleTo(new THREE.Quaternion().fromArray(saved.quaternion))<1e-7);
  }
});


test("Ctrl and Shift restore fixed-axis rotation without snapping or fitting", async () => {
 const {geometryAxisRotationFromKeyboardEvent: targetAxis, geometryOriginAxisRotationFromKeyboardEvent: originAxis, rotateGeometryCameraAroundAxis: rotate}=await import("../src/services/visualization/geometryCameraView.js");
 for(const axis of ["X","Y","Z"]){
  assert.equal(targetAxis({code:`Key${axis}`,ctrlKey:true}),axis.toLowerCase());
  assert.equal(originAxis({code:`Key${axis}`,shiftKey:true}),axis.toLowerCase());
  assert.equal(targetAxis({code:`Key${axis}`,ctrlKey:true,shiftKey:true}),null);
  assert.equal(targetAxis({code:`Key${axis}`,ctrlKey:true,target:{tagName:"INPUT"}}),null);
  for(const target of [{tagName:"SELECT"},{tagName:"INPUT",type:"checkbox"},{tagName:"INPUT",type:"range"}]){
   assert.equal(targetAxis({code:`Key${axis}`,ctrlKey:true,target},{allowControls:true}),axis.toLowerCase());
   assert.equal(originAxis({code:`Key${axis}`,shiftKey:true,target},{allowControls:true}),axis.toLowerCase());
  }
  assert.equal(targetAxis({code:`Key${axis}`,ctrlKey:true,target:{tagName:"INPUT",type:"number"}},{allowControls:true}),null);
 }
 for(const origin of [false,true]){
  const camera=new THREE.PerspectiveCamera(45,1,.1,100);camera.position.set(4,5,6);camera.up.set(0,0,1);
  const controls={target:new THREE.Vector3(1,2,3),update(){}};camera.lookAt(controls.target);const target=controls.target.clone();
  const pivot=origin?new THREE.Vector3():controls.target.clone();const distance=camera.position.distanceTo(pivot);const zoom=camera.zoom;
  assert.equal(rotate(camera,controls,"z",Math.PI/2,{pivot,rotateTarget:origin}),true);
  assert.ok(Math.abs(camera.position.distanceTo(pivot)-distance)<1e-10);assert.equal(camera.zoom,zoom);
  if(origin)assert.ok(controls.target.distanceTo(target)>1);else assert.deepEqual(controls.target,target);
 }
});

// Real Three.js controls and dispatched DOM events, without a WebGL renderer.
function axisGestureFixture(projection = "perspective") {
    const owner = new EventTarget(), win = new EventTarget(), element = new EventTarget();
    owner.defaultView = win; owner.hidden = false;
    let dialog = false, allowed = true, rotations = 0, picks = 0;
    owner.querySelector = () => dialog ? {} : null;
    element.ownerDocument = owner; element.style = {};
    element.getRootNode = () => owner;
    element.clientWidth = element.clientHeight = 500;
    element.setPointerCapture = element.releasePointerCapture = () => {};
    const camera = projection === "orthographic"
        ? new THREE.OrthographicCamera(-5, 5, 5, -5, .01, 1000)
        : new THREE.PerspectiveCamera(45, 1, .01, 1000);
    camera.position.set(4, 5, 6); camera.up.set(0, 0, 1); camera.zoom = 2;
    let controls = new OrbitControls(camera, element);
    controls.target.set(1, 2, 3); controls.update();
    const states = [];
    const controller = createGeometryAxisRotationController({
        element, getCamera: () => camera, getControls: () => controls, canStart: () => allowed,
        onStateChange(active) {
            states.push(active);
            if (!active) {
                const target = controls.target.clone(); controls.dispose();
                controls = new OrbitControls(camera, element); controls.target.copy(target); controls.update();
            }
        },
        onRotate: () => rotations++, onPointerMove: () => picks++,
    });
    const emit = (target, type, properties = {}) => {
        const event = new Event(type, { cancelable: true });
        const { target: focus = target, ...values } = properties;
        Object.assign(event, { altKey: false, ctrlKey: false, shiftKey: false, metaKey: false,
            pointerId: 1, pointerType: "mouse", ...values });
        Object.defineProperty(event, "target", { value: focus });
        target.dispatchEvent(event); return event;
    };
    return {
        owner, win, element, camera, controller, states, emit,
        get controls() { return controls; }, get rotations() { return rotations; }, get picks() { return picks; },
        set allowed(value) { allowed = value; }, set dialog(value) { dialog = value; },
        enter: (x = 100, y = 100) => emit(element, "pointerenter", { clientX: x, clientY: y }),
        key: (type, code, flags) => emit(owner, type, { code, key: code, ...flags }),
        move: (x, y, flags) => emit(element, "pointermove", {
            clientX: x, clientY: y, movementX: 0, movementY: 0, ...flags,
        }),
        close() { controller.dispose(); controls.dispose(); },
    };
}

const AXIS_GESTURE_MODIFIERS = [
    ["AltLeft", { altKey: true }, false],
    ["ControlLeft", { ctrlKey: true }, false],
    ["ShiftLeft", { shiftKey: true }, true],
];
const axisVector = axis => new THREE.Vector3(...({ x: [1,0,0], y: [0,1,0], z: [0,0,1] }[axis]));

test("axis keyboard/mouse gestures use client coordinates with real OrbitControls in both projections", () => {
    for (const projection of ["perspective", "orthographic"]) {
        for (const [modifier, flags, origin] of AXIS_GESTURE_MODIFIERS) for (const axis of ["x", "y", "z"]) {
            const f = axisGestureFixture(projection);
            try {
                f.enter(); f.key("keydown", modifier, flags);
                assert.equal(f.key("keydown", `Key${axis.toUpperCase()}`, { ...flags, key: "ч" }).defaultPrevented, true);
                assert.equal(f.controller.active, true); assert.equal(f.controls.enabled, false);
                f.key("keyup", `Key${axis.toUpperCase()}`, flags);
                assert.equal(f.controller.active, true, "releasing the axis key retains the mode");
                const position = f.camera.position.clone(), up = f.camera.up.clone(), target = f.controls.target.clone();
                const pivot = origin ? new THREE.Vector3() : target;
                for (let i = 1; i <= 30; i++) f.move(100 + i * 2, 100, flags);
                const turn = new THREE.Quaternion().setFromAxisAngle(axisVector(axis), 60 * .006);
                assert.ok(f.camera.position.distanceTo(position.sub(pivot).applyQuaternion(turn).add(pivot)) < 1e-10);
                assert.ok(f.camera.up.distanceTo(up.applyQuaternion(turn)) < 1e-10);
                assert.ok(f.controls.target.distanceTo(origin ? target.clone().applyQuaternion(turn) : target) < 1e-10);
                assert.equal(f.camera.zoom, 2); assert.equal(f.rotations, 30); assert.equal(f.picks, 0);
                const pose = f.camera.position.clone(), orientation = f.camera.quaternion.clone();
                f.key("keyup", modifier);
                assert.equal(f.controller.active, false); assert.equal(f.controls.enabled, true);
                assert.ok(f.camera.position.distanceTo(pose) < 1e-10, "rebasing controls preserves position");
                assert.ok(f.camera.quaternion.angleTo(orientation) < 1e-7, "rebasing controls preserves orientation");
                f.emit(f.element, "pointerdown", { button: 0, clientX: 160, clientY: 100 });
                f.move(180, 100, { buttons: 1 });
                f.emit(f.element, "pointerup", { button: 0, clientX: 180, clientY: 100 });
                assert.ok(f.camera.position.distanceTo(pose) > .01, "ordinary mouse orbit works after releasing the modifier");
                assert.deepEqual(f.states, [true, false]);
            } finally { f.close(); }
        }
    }
});

test("diagonal and vertical gestures rotate continuously instead of cancelling or changing sign per event", () => {
    for (const [dx, dy] of [[2,2], [-2,-2], [0,2], [0,-2]]) for (const [, flags] of AXIS_GESTURE_MODIFIERS) {
        const f = axisGestureFixture();
        try {
            f.enter(); f.key("keydown", "KeyZ", flags);
            const initial = f.camera.quaternion.clone();
            for (let i = 1; i <= 30; i++) {
                f.move(100 + i * dx, 100 + i * dy, flags);
                assert.ok(Math.abs(f.camera.quaternion.angleTo(initial) - i * .012) < 1e-7);
                f.key("keydown", "KeyZ", { ...flags, repeat: true });
            }
            assert.equal(f.rotations, 30);
        } finally { f.close(); }
    }
    const f = axisGestureFixture();
    try {
        f.enter(); f.key("keydown", "KeyZ", { altKey: true });
        for (let i = 1; i <= 30; i++) f.move(100 + i * 2, 100 + i * 2 + i % 2, { altKey: true });
        assert.equal(f.rotations, 30, "small changes of diagonal slope do not cancel the gesture");
    } finally { f.close(); }
});

test("axis rotation is independent of event coalescing and movementX/Y units", () => {
    const poses = [];
    for (const count of [1, 4, 60]) {
        const f = axisGestureFixture();
        try {
            f.enter(); f.key("keydown", "KeyX", { altKey: true });
            for (let i = 1; i <= count; i++) f.move(100 + 120 * i / count, 100, {
                altKey: true, movementX: 999, movementY: -999,
            });
            poses.push(f.camera.quaternion.clone());
        } finally { f.close(); }
    }
    for (const pose of poses) assert.ok(pose.angleTo(poses[0]) < 1e-7);
});

test("direct axis rotation crosses the old orbit poles without clamping or accumulating drift", () => {
    const f = axisGestureFixture();
    try {
        f.camera.position.set(0, 4, 0); f.camera.up.set(0,0,1); f.controls.target.set(0,0,0); f.controls.update();
        const initial = f.camera.position.clone();
        f.enter(); f.key("keydown", "KeyX", { altKey: true });
        for (let i = 1; i <= 36; i++) {
            f.move(100 + i * (Math.PI * 2 / 36) / .006, 100, { altKey: true });
            const expected = initial.clone().applyAxisAngle(axisVector("x"), i * Math.PI * 2 / 36);
            assert.ok(f.camera.position.distanceTo(expected) < 1e-10);
        }
        f.key("keyup", "AltLeft");
        assert.ok(f.camera.position.distanceTo(initial) < 1e-10);
    } finally { f.close(); }
});

test("axis gestures reset pointer baselines on leave, re-entry, pointer changes and lost modifiers", () => {
    const f = axisGestureFixture();
    try {
        f.enter(); f.key("keydown", "KeyZ", { shiftKey: true }); f.move(102,100,{shiftKey:true});
        f.emit(f.element, "pointerleave"); f.enter(1000,1000);
        const before = f.camera.quaternion.clone();
        f.move(1002,1000,{shiftKey:true});
        assert.ok(Math.abs(f.camera.quaternion.angleTo(before) - .012) < 1e-7);
        f.move(5000,5000,{shiftKey:true,pointerId:2}); assert.equal(f.rotations,2);
        f.move(5002,5000,{shiftKey:true,pointerId:2}); assert.equal(f.rotations,3);
        f.move(5004,5000,{pointerId:2});
        assert.equal(f.controller.active,false); assert.equal(f.controls.enabled,true); assert.equal(f.rotations,3);
        f.key("keydown","KeyX",{altKey:true}); f.emit(f.win,"blur");
        assert.equal(f.controller.active,false); assert.equal(f.key("keydown","KeyZ",{altKey:true}).defaultPrevented,false);
    } finally { f.close(); }
});

test("axis gestures preserve editor, dialog, flight/export and disposal boundaries", () => {
    const f = axisGestureFixture();
    try {
        f.enter();
        for (const target of [{ tagName:"INPUT",type:"number" },{tagName:"TEXTAREA"},{isContentEditable:true}]) {
            assert.equal(f.key("keydown","KeyX",{altKey:true,target}).defaultPrevented,false);
            assert.equal(f.controller.active,false);
        }
        f.dialog=true; f.key("keydown","KeyX",{altKey:true}); assert.equal(f.controller.active,false);
        f.dialog=false; f.allowed=false; f.key("keydown","KeyX",{altKey:true}); assert.equal(f.controller.active,false);
        f.allowed=true; f.owner.hidden=true; f.key("keydown","KeyX",{altKey:true}); assert.equal(f.controller.active,false);
        f.owner.hidden=false; f.key("keydown","KeyX",{altKey:true}); assert.equal(f.controller.active,true);
        f.allowed=false; f.move(102,100,{altKey:true}); assert.equal(f.controller.active,false); assert.equal(f.controls.enabled,true);
        f.allowed=true; f.key("keydown","KeyX",{altKey:true}); f.controller.dispose();
        const pose=f.camera.position.clone(); f.move(104,100,{altKey:true}); f.key("keydown","KeyY",{shiftKey:true});
        assert.equal(f.controller.active,false); assert.equal(f.controls.enabled,true); assert.deepEqual(f.camera.position,pose);
    } finally { f.close(); }
});
