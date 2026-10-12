export const GEOMETRY_CAMERA_COMMANDS = Object.freeze({
    FIT_ALL: "fit-all",
    FIT_INITIAL: "fit-initial",
    VIEW_POSITIVE_X: "view-positive-x",
    VIEW_NEGATIVE_X: "view-negative-x",
    VIEW_POSITIVE_Y: "view-positive-y",
    VIEW_NEGATIVE_Y: "view-negative-y",
    VIEW_POSITIVE_Z: "view-positive-z",
    VIEW_NEGATIVE_Z: "view-negative-z",
});

const COMMAND_VALUES = new Set(Object.values(GEOMETRY_CAMERA_COMMANDS));

const KEYBOARD_COMMANDS = Object.freeze({
    KeyX: Object.freeze({
        positive: GEOMETRY_CAMERA_COMMANDS.VIEW_POSITIVE_X,
        negative: GEOMETRY_CAMERA_COMMANDS.VIEW_NEGATIVE_X,
    }),
    KeyY: Object.freeze({
        positive: GEOMETRY_CAMERA_COMMANDS.VIEW_POSITIVE_Y,
        negative: GEOMETRY_CAMERA_COMMANDS.VIEW_NEGATIVE_Y,
    }),
    KeyZ: Object.freeze({
        positive: GEOMETRY_CAMERA_COMMANDS.VIEW_POSITIVE_Z,
        negative: GEOMETRY_CAMERA_COMMANDS.VIEW_NEGATIVE_Z,
    }),
});

const CAMERA_FRAMES = Object.freeze({
    [GEOMETRY_CAMERA_COMMANDS.FIT_INITIAL]: Object.freeze({
        offset: Object.freeze([1, 1, 1]),
        up: Object.freeze([0, 0, 1]),
    }),
    [GEOMETRY_CAMERA_COMMANDS.VIEW_POSITIVE_X]: Object.freeze({
        offset: Object.freeze([-1, 0, 0]),
        up: Object.freeze([0, 0, 1]),
    }),
    [GEOMETRY_CAMERA_COMMANDS.VIEW_NEGATIVE_X]: Object.freeze({
        offset: Object.freeze([1, 0, 0]),
        up: Object.freeze([0, 0, 1]),
    }),
    [GEOMETRY_CAMERA_COMMANDS.VIEW_POSITIVE_Y]: Object.freeze({
        offset: Object.freeze([0, -1, 0]),
        up: Object.freeze([0, 0, 1]),
    }),
    [GEOMETRY_CAMERA_COMMANDS.VIEW_NEGATIVE_Y]: Object.freeze({
        offset: Object.freeze([0, 1, 0]),
        up: Object.freeze([0, 0, 1]),
    }),
    [GEOMETRY_CAMERA_COMMANDS.VIEW_POSITIVE_Z]: Object.freeze({
        offset: Object.freeze([0, 0, -1]),
        up: Object.freeze([0, -1, 0]),
    }),
    [GEOMETRY_CAMERA_COMMANDS.VIEW_NEGATIVE_Z]: Object.freeze({
        offset: Object.freeze([0, 0, 1]),
        up: Object.freeze([0, 1, 0]),
    }),
});

export function normalizeGeometryCameraCommand(value) {
    return typeof value === "string" && COMMAND_VALUES.has(value)
        ? value
        : null;
}

export function geometryCameraFrame(value) {
    const command = normalizeGeometryCameraCommand(value);
    const frame = command ? CAMERA_FRAMES[command] : null;
    if (!frame) return null;

    return {
        offset: [...frame.offset],
        up: [...frame.up],
    };
}

export function geometryCameraCommandFromKeyboardEvent(event) {
    if (!event || event.defaultPrevented || event.isComposing
        || event.altKey || event.metaKey || event.shiftKey
        || !isGeometryCameraShortcutTarget(event.target)) return null;

    if (event.code === "KeyA") {
        return event.ctrlKey ? GEOMETRY_CAMERA_COMMANDS.FIT_INITIAL : GEOMETRY_CAMERA_COMMANDS.FIT_ALL;
    }

    const commands = KEYBOARD_COMMANDS[event.code];
    if (!commands) return null;
    return event.ctrlKey ? commands.negative : commands.positive;
}

export function isGeometryCameraShortcutTarget(target) {
    if (target?.isContentEditable) return false;
    const tagName = String(target?.tagName ?? "").toLowerCase();
    return !["input", "select", "textarea"].includes(tagName);
}

/** Small numeric view state only: no retained scene, renderer or result buffers. */
export function snapshotGeometryCamera(camera, controls, projection) {
    return {
        projection, position: camera.position.toArray(), quaternion: camera.quaternion.toArray(),
        up: camera.up.toArray(), target: controls.target.toArray(), zoom: camera.zoom,
        near: camera.near, far: camera.far,
        ...(camera.isOrthographicCamera ? { halfHeight: (camera.top - camera.bottom) / 2 }
            : { fov: camera.fov }),
    };
}

export function restoreGeometryCamera(camera, controls, state) {
    const finiteArray = (value, size) => Array.isArray(value) && value.length === size && value.every(Number.isFinite);
    if (!state || (state.projection === "orthographic") !== Boolean(camera.isOrthographicCamera)
        || !finiteArray(state.position, 3) || !finiteArray(state.quaternion, 4)
        || !finiteArray(state.up, 3) || !finiteArray(state.target, 3)
        || !(state.zoom > 0) || !Number.isFinite(state.zoom)
        || !(state.far > state.near) || !Number.isFinite(state.near) || !Number.isFinite(state.far)
        || (camera.isOrthographicCamera ? !(state.halfHeight > 0) || !Number.isFinite(state.halfHeight)
            : !(state.fov > 0 && state.fov < 180))) return false;
    camera.position.fromArray(state.position);
    camera.quaternion.fromArray(state.quaternion).normalize();
    camera.up.fromArray(state.up);
    controls.target.fromArray(state.target);
    camera.zoom = state.zoom; camera.near = state.near; camera.far = state.far;
    if (camera.isOrthographicCamera) {
        const aspect = Math.abs((camera.right - camera.left) / (camera.top - camera.bottom));
        camera.top = state.halfHeight; camera.bottom = -state.halfHeight;
        camera.left = -state.halfHeight * aspect; camera.right = state.halfHeight * aspect;
    } else camera.fov = state.fov;
    camera.updateProjectionMatrix();
    controls.update?.();
    return true;
}
