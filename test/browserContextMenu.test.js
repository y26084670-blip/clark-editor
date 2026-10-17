import test from "node:test";
import assert from "node:assert/strict";
import { installBrowserContextMenuSuppression } from "../src/services/browserContextMenu.js";

test("browser menu cancellation leaves application context-menu handlers active", () => {
  const target = new EventTarget();
  const received = [];
  target.addEventListener("contextmenu", event => received.push(event.defaultPrevented));
  const dispose = installBrowserContextMenuSuppression(target);
  target.addEventListener("contextmenu", event => received.push(event.defaultPrevented));

  const event = new Event("contextmenu", { bubbles: true, cancelable: true });
  assert.equal(target.dispatchEvent(event), false);
  assert.deepEqual(received, [false, true]);
  assert.equal(event.defaultPrevented, true);
  dispose();
});

test("pointer gestures, keyboard and clipboard events keep their defaults; cleanup restores the menu", () => {
  const target = new EventTarget();
  const dispose = installBrowserContextMenuSuppression(target);
  for (const type of ["pointerdown", "pointermove", "pointerup", "wheel", "keydown", "copy", "paste"]) {
    const event = new Event(type, { cancelable: true });
    assert.equal(target.dispatchEvent(event), true, type);
    assert.equal(event.defaultPrevented, false, type);
  }
  dispose();
  const event = new Event("contextmenu", { cancelable: true });
  assert.equal(target.dispatchEvent(event), true);
  assert.equal(event.defaultPrevented, false);
});
