import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import {
    GEOMETRY_CAMERA_COMMANDS,
    geometryCameraCommandFromKeyboardEvent,
    geometryCameraFrame,
    isGeometryCameraShortcutTarget,
    normalizeGeometryCameraCommand,
    snapshotGeometryCamera,
    restoreGeometryCamera,
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
            GEOMETRY_CAMERA_COMMANDS[negative],
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
