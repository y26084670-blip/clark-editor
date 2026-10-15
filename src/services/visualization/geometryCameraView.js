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
    return event.ctrlKey ? null : commands.positive; // Ctrl+axis belongs to mouse rotation.
}

export function isGeometryCameraShortcutTarget(target, { allowControls = false } = {}) {
    if (target?.isContentEditable) return false;
    const tagName = String(target?.tagName ?? "").toLowerCase();
    if (allowControls && tagName === "select") return true;
    if (allowControls && tagName === "input") return ["range", "checkbox", "radio", "button", "submit", "reset"].includes(target.type);
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

export const GEOMETRY_AXIS_ROTATION = Object.freeze({ X: "x", Y: "y", Z: "z" });

function axisFromModifiedKeyboardEvent(event, modifier, options) {
    if (!event || event.defaultPrevented || event.isComposing
        || event.metaKey
        || !isGeometryCameraShortcutTarget(event.target, options)) return null;
    const valid = modifier === "alt"
        ? (event.ctrlKey || event.altKey) && !event.shiftKey && !(event.ctrlKey && event.altKey)
        : event.shiftKey && !event.altKey && !event.ctrlKey;
    if (!valid) return null;
    if (event.code === "KeyX") return GEOMETRY_AXIS_ROTATION.X;
    if (event.code === "KeyY") return GEOMETRY_AXIS_ROTATION.Y;
    if (event.code === "KeyZ") return GEOMETRY_AXIS_ROTATION.Z;
    return null;
}

export function geometryAxisRotationFromKeyboardEvent(event, options) {
    return axisFromModifiedKeyboardEvent(event, "alt", options);
}

export function geometryOriginAxisRotationFromKeyboardEvent(event, options) {
    return axisFromModifiedKeyboardEvent(event, "shift", options);
}

let axisDiagnosticSequence = 0;

/** Temporary, bounded console tracing; uses existing input/render calls, never timers or GPU readback. */
export function createGeometryAxisRotationDiagnostics({
    element, getCamera, getControls, getContext = () => ({}), version,
    now = () => performance.now(), write = message => console.info(message),
}) {
    const viewport = ++axisDiagnosticSequence, started = now();
    let stats = null, lastSummary = started, sessionStarted = started, lastInput = null, pendingSince = null;
    let expectedCamera = null, expectedControls = null, lastKey = "", lastKeyAt = -Infinity;
    const expected = [], drawn = [];
    const describe = node => node ? `${node.tagName ?? "unknown"}${node.type ? `[${node.type}]` : ""}${
        typeof node.className === "string" && node.className.trim() ? `.${node.className.trim().split(/\s+/).join(".")}` : ""}` : null;
    const pose = (camera, controls, output) => {
        if (!camera || !controls) return null;
        const p = camera.position, q = camera.quaternion, u = camera.up, t = controls.target;
        output.splice(0, output.length, p.x, p.y, p.z, q.x, q.y, q.z, q.w, u.x, u.y, u.z, t.x, t.y, t.z, camera.zoom);
        return output;
    };
    const emit = (event, data = {}) => write(`[axis-rotation] ${JSON.stringify({
        viewport, ms: Math.round(now() - started), event, ...data, context: getContext(),
    })}`);
    const flags = event => ({ code: event?.code, key: event?.key, alt: Boolean(event?.altKey), ctrl: Boolean(event?.ctrlKey),
        shift: Boolean(event?.shiftKey), meta: Boolean(event?.metaKey), prevented: Boolean(event?.defaultPrevented),
        target: describe(event?.target), focus: describe(element.ownerDocument.activeElement) });
    function begin() {
        stats = { moves: 0, rotations: 0, rotationRejected: 0, dx: 0, dy: 0, angleRad: 0,
            noBaseline: 0, pointerChanges: 0, zeroDelta: 0, canvasEnters: 0, canvasLeaves: 0,
            handlerMs: 0, maxHandlerMs: 0, maxInputGapMs: 0,
            renderRequests: 0, scheduled: 0, coalesced: 0, blocked: 0, frames: 0, renderMs: 0, maxRenderMs: 0,
            maxWaitMs: 0, overwrittenFrames: 0, geometryUpdates: 0, resizes: 0 };
        expected.length = drawn.length = 0; expectedCamera = expectedControls = null;
        pendingSince = lastInput = null; sessionStarted = lastSummary = now();
    }
    function summary(reason) {
        if (!stats) return;
        emit("summary", { reason, elapsedMs: now() - sessionStarted, ...stats, unpaintedRotation: pendingSince !== null,
            cameraAfterRotation: [...expected], cameraAtDraw: [...drawn],
            poseOrder: "position[3], quaternion[4], up[3], target[3], zoom" });
        lastSummary = now();
    }
    function sample() { if (stats && now() - lastSummary >= 1000) summary("sampling"); }
    emit("ready", { version, browser: element.ownerDocument.defaultView?.navigator?.userAgent,
        summaryIntervalMs: 1000 });
    return {
        key(event, data) {
            const axisKey = /^Key[XYZ]$/.test(event.code) || /^[xyzчня]$/i.test(event.key ?? "");
            if (!axisKey && !(data.inside && /^(Alt|Control|Shift)/.test(event.code))) return;
            const signature = `${event.code}:${data.reason}:${data.axis}:${event.altKey}:${event.ctrlKey}:${event.shiftKey}`;
            if (event.repeat && signature === lastKey && now() - lastKeyAt < 1000) return;
            lastKey = signature; lastKeyAt = now();
            if (axisKey && !stats && data.reason !== "accepted") begin();
            emit("key", { ...flags(event), repeat: Boolean(event.repeat), composing: Boolean(event.isComposing), ...data });
        },
        mode(axis, pivot) {
            if (stats) summary("mode-change");
            begin(); stats.axis = axis; stats.pivot = pivot; stats.inside = true;
            emit("mode", { axis, pivot, controlsEnabled: getControls()?.enabled });
        },
        end(reason, event) {
            if (!stats) return;
            summary(reason); emit("stop", { reason, ...flags(event) });
            stats = null; expectedCamera = expectedControls = null; pendingSince = null;
        },
        keyUp(event) {
            if (!(event.altKey || event.ctrlKey || event.shiftKey)) this.end("modifiers-released", event);
        },
        edge(inside) {
            if (stats) { stats.inside = inside; stats[inside ? "canvasEnters" : "canvasLeaves"]++; }
        },
        pointerStart(event) {
            if (!stats) return null;
            const at = now(); stats.moves++; stats.inside = true;
            if (lastInput !== null) stats.maxInputGapMs = Math.max(stats.maxInputGapMs, at - lastInput);
            lastInput = at;
            stats.lastPointer = { x: event.clientX, y: event.clientY, id: event.pointerId, type: event.pointerType,
                movementX: event.movementX, movementY: event.movementY, buttons: event.buttons,
                alt: event.altKey, ctrl: event.ctrlKey, shift: event.shiftKey, meta: event.metaKey };
            return at;
        },
        pointerDelta(dx, dy, reason) {
            if (!stats) return;
            if (reason) stats[reason]++;
            else { stats.dx += dx; stats.dy += dy; if (dx === 0 && dy === 0) stats.zeroDelta++; }
        },
        pointerEnd(at) {
            if (!stats || at === null) return;
            const elapsed = now() - at; stats.handlerMs += elapsed; stats.maxHandlerMs = Math.max(stats.maxHandlerMs, elapsed);
            sample();
        },
        rotated(angle, changed, direction) {
            if (!stats) return;
            stats.direction = direction;
            if (!changed) { stats.rotationRejected++; return; }
            stats.rotations++; stats.angleRad += angle;
            expectedCamera = getCamera(); expectedControls = getControls();
            pose(expectedCamera, expectedControls, expected);
            pendingSince ??= now();
        },
        renderRequest(result) {
            if (!stats) return;
            stats.renderRequests++;
            stats[result === "scheduled" ? "scheduled" : result === "already-queued" ? "coalesced" : "blocked"]++;
            stats.lastRenderRequest = result;
        },
        beginRender({ geometry, resize }) {
            if (!stats) return null;
            stats.geometryUpdates += Number(geometry); stats.resizes += Number(resize);
            return now();
        },
        beforeDraw() {
            if (!stats) return;
            const camera = getCamera(), controls = getControls();
            pose(camera, controls, drawn);
            if (pendingSince === null) return;
            const overwritten = camera !== expectedCamera || controls !== expectedControls || expected.some((value, index) =>
                !Number.isFinite(drawn[index]) || Math.abs(value - drawn[index]) > 1e-8 * Math.max(1, Math.abs(value), Math.abs(drawn[index])));
            if (overwritten) {
                stats.overwrittenFrames++;
                stats.lastOverwrite = { cameraReplaced: camera !== expectedCamera, controlsReplaced: controls !== expectedControls,
                    cameraAfterRotation: [...expected], cameraAtDraw: [...drawn] };
            }
            stats.maxWaitMs = Math.max(stats.maxWaitMs, now() - pendingSince);
        },
        endRender(at, painted) {
            if (!stats || at === null) return;
            const elapsed = now() - at; stats.renderMs += elapsed; stats.maxRenderMs = Math.max(stats.maxRenderMs, elapsed);
            if (painted) { stats.frames++; pendingSince = null; }
            sample();
        },
    };
}

/** Own one viewport's axis gesture, using CSS coordinates outside pointer lock. */
export function createGeometryAxisRotationController({
    element, getCamera, getControls, canStart = () => true,
    onStateChange = () => {}, onRotate = () => {},
    onPointerMove = () => {}, onPointerLeave = () => {},
    diagnostics = null,
}) {
    const owner = element.ownerDocument, win = owner.defaultView;
    let axis = null, pivot = "target", inside = false, previous = null, dragAxis = null;
    let motionX = 0, motionY = 0;
    let ownedControls = null, previousEnabled = true, disposed = false;
    const point = event => Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
        ? { x: event.clientX, y: event.clientY, id: event.pointerId } : null;
    const unavailableReason = () => disposed ? "disposed" : owner.hidden ? "document-hidden"
        : owner.querySelector("dialog[open]") ? "modal-dialog-open" : !canStart() ? "viewport-unavailable" : null;
    const modifierHeld = event => !event.metaKey && (pivot === "origin"
        ? event.shiftKey && !event.altKey && !event.ctrlKey
        : (event.altKey || event.ctrlKey) && !event.shiftKey && !(event.altKey && event.ctrlKey));
    function resetDirection() { dragAxis = null; motionX = motionY = 0; }
    function stop(reason = "external-stop", event) {
        diagnostics?.end(reason, event);
        if (!axis) return;
        axis = null; resetDirection();
        if (getControls() === ownedControls) ownedControls.enabled = previousEnabled;
        ownedControls = null;
        if (!disposed) onStateChange(false);
    }
    function keyDown(event) {
        const blocked = !inside ? "pointer-outside-canvas" : unavailableReason();
        if (blocked) { diagnostics?.key(event, { inside, reason: blocked }); stop(blocked, event); return; }
        const targetAxis = geometryAxisRotationFromKeyboardEvent(event, { allowControls: true });
        const originAxis = geometryOriginAxisRotationFromKeyboardEvent(event, { allowControls: true });
        const nextAxis = targetAxis ?? originAxis, nextPivot = originAxis ? "origin" : "target";
        if (!nextAxis) {
            const reason = event.defaultPrevented ? "event-already-prevented" : event.isComposing ? "composing"
                : event.metaKey ? "meta-modifier" : !isGeometryCameraShortcutTarget(event.target, { allowControls: true }) ? "editing-input"
                : !/^Key[XYZ]$/.test(event.code) ? "axis-key-required" : "modifier-combination";
            diagnostics?.key(event, { inside, reason });
            if (axis && !modifierHeld(event)) stop("keyboard-modifier-lost", event);
            return;
        }
        const controls = getControls();
        if (!controls || !getCamera()) { diagnostics?.key(event, { inside, reason: "camera-or-controls-missing" }); return; }
        diagnostics?.key(event, { inside, reason: "accepted", axis: nextAxis, pivot: nextPivot });
        event.preventDefault();
        if (axis === nextAxis && pivot === nextPivot) return;
        const wasActive = Boolean(axis);
        if (!wasActive) {
            ownedControls = controls; previousEnabled = controls.enabled;
            controls.enabled = false;
        }
        axis = nextAxis; pivot = nextPivot; resetDirection();
        diagnostics?.mode(axis, pivot);
        if (!wasActive) onStateChange(true);
    }
    function keyUp(event) {
        if (axis && !modifierHeld(event)) stop("modifier-released", event);
        diagnostics?.keyUp(event);
    }
    function pointerEnter(event) { inside = true; previous = point(event); resetDirection(); diagnostics?.edge(true); }
    function pointerMove(event) {
        const diagnosticStart = diagnostics?.pointerStart(event);
        try {
            inside = true;
            const before = previous;
            previous = point(event);
            const blocked = unavailableReason();
            if (blocked) { stop(blocked, event); previous = null; return; }
            if (axis && !modifierHeld(event)) stop("pointer-modifier-lost", event);
            if (!axis) { onPointerMove(event); return; }
            event.preventDefault();
            if (!before || !previous || before.id !== previous.id) {
                diagnostics?.pointerDelta(0, 0, before && previous ? "pointerChanges" : "noBaseline");
                resetDirection(); return;
            }
            const dx = previous.x - before.x, dy = previous.y - before.y;
            diagnostics?.pointerDelta(dx, dy);
            if (dx === 0 && dy === 0) return;
            // Remember direction over about 8 CSS pixels, rather than locking it to
            // the first tiny movement. A 2:1 margin keeps diagonal input from jittering.
            const distance = Math.hypot(dx, dy), keep = Math.exp(-distance / 8);
            motionX = motionX * keep + Math.abs(dx) / distance * (1 - keep);
            motionY = motionY * keep + Math.abs(dy) / distance * (1 - keep);
            if (!dragAxis) dragAxis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
            else if (motionX > motionY * 2) dragAxis = "x";
            else if (motionY > motionX * 2) dragAxis = "y";
            const movement = dragAxis === "x" ? dx : -dy;
            const camera = getCamera(), controls = getControls(), origin = pivot === "origin";
            if (!camera || !controls) { stop("camera-or-controls-missing", event); return; }
            const changed = rotateGeometryCameraAroundAxis(camera, controls, axis, movement * 0.006, {
                pivot: origin ? new camera.position.constructor() : controls.target,
                rotateTarget: origin, updateControls: false,
            });
            diagnostics?.rotated(movement * 0.006, changed, dragAxis);
            if (changed) onRotate();
        } finally { diagnostics?.pointerEnd(diagnosticStart); }
    }
    function pointerLeave() {
        inside = false; previous = null; resetDirection(); diagnostics?.edge(false); onPointerLeave();
    }
    function blur(event) { inside = false; previous = null; stop("window-blur", event); }
    element.addEventListener("pointerenter", pointerEnter);
    element.addEventListener("pointermove", pointerMove);
    element.addEventListener("pointerleave", pointerLeave);
    owner.addEventListener("keydown", keyDown, true);
    owner.addEventListener("keyup", keyUp, true);
    win?.addEventListener("blur", blur);
    return {
        get active() { return Boolean(axis); },
        stop,
        dispose() {
            disposed = true; stop("dispose"); previous = null;
            element.removeEventListener("pointerenter", pointerEnter);
            element.removeEventListener("pointermove", pointerMove);
            element.removeEventListener("pointerleave", pointerLeave);
            owner.removeEventListener("keydown", keyDown, true);
            owner.removeEventListener("keyup", keyUp, true);
            win?.removeEventListener("blur", blur);
        },
    };
}

export function rotateGeometryCameraAroundAxis(camera, controls, axis, angle, {
    pivot = controls?.target,
    rotateTarget = false,
    updateControls = true,
} = {}) {
    if (!camera?.position || !camera?.up || !controls?.target
        || !Number.isFinite(angle) || angle === 0
        || !Object.values(GEOMETRY_AXIS_ROTATION).includes(axis)) return false;
    if (!pivot) return false;
    const offset = camera.position.clone().sub(pivot);
    if (!(offset.lengthSq() > 0)) return false;
    const basis = axis === GEOMETRY_AXIS_ROTATION.X ? [1,0,0]
        : axis === GEOMETRY_AXIS_ROTATION.Y ? [0,1,0] : [0,0,1];
    const quaternion = camera.quaternion?.constructor
        ? new camera.quaternion.constructor().setFromAxisAngle(
            new camera.position.constructor(...basis),
            angle,
          )
        : null;
    if (!quaternion) return false;
    offset.applyQuaternion(quaternion);
    camera.up.applyQuaternion(quaternion).normalize();
    camera.position.copy(pivot).add(offset);
    if (rotateTarget) {
        const targetOffset = controls.target.clone().sub(pivot).applyQuaternion(quaternion);
        controls.target.copy(pivot).add(targetOffset);
    }
    camera.lookAt(controls.target);
    if (updateControls) controls.update?.();
    return true;
}
