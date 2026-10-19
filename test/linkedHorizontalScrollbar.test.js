import test from "node:test";
import assert from "node:assert/strict";
import { installLinkedHorizontalScrollbar } from "../src/services/linkedHorizontalScrollbar.js";

function fixture() {
  const element = (values = {}) => Object.assign(new EventTarget(), {
    style: {}, hidden: false, scrollLeft: 0, ...values,
  });
  const viewport = element({ clientWidth: 1100, scrollWidth: 1800, scrollTop: 27 });
  const scrollbar = element();
  const track = element();
  let enabled = true;
  const controller = installLinkedHorizontalScrollbar({ viewport, scrollbar, track, isEnabled: () => enabled });
  return { viewport, scrollbar, track, controller, setEnabled: value => { enabled = value; } };
}

test("the upper scrollbar follows viewport width and scrolls the shared tab/task surface", t => {
  const f = fixture();
  t.after(() => f.controller.dispose());
  assert.equal(f.scrollbar.hidden, false);
  assert.equal(f.scrollbar.style.width, "1100px");
  assert.equal(f.track.style.width, "1800px");
  f.scrollbar.scrollLeft = 420;
  f.scrollbar.dispatchEvent(new Event("scroll"));
  assert.equal(f.viewport.scrollLeft, 420);
  assert.equal(f.viewport.scrollTop, 27);
  f.viewport.scrollLeft = 175;
  f.viewport.dispatchEvent(new Event("scroll"));
  assert.equal(f.scrollbar.scrollLeft, 175);
});

test("resizing hides an unnecessary bar and restores it at the current scroll position", t => {
  const f = fixture();
  t.after(() => f.controller.dispose());
  f.viewport.clientWidth = 1800;
  f.controller.refresh();
  assert.equal(f.scrollbar.hidden, true);
  f.viewport.clientWidth = 1200;
  f.viewport.scrollLeft = 90;
  f.controller.refresh();
  assert.equal(f.scrollbar.hidden, false);
  assert.equal(f.scrollbar.style.width, "1200px");
  assert.equal(f.scrollbar.scrollLeft, 90);
});

test("leaving the task tab disables the mirror without scrolling other tabs", t => {
  const f = fixture();
  t.after(() => f.controller.dispose());
  f.viewport.scrollLeft = 200;
  f.setEnabled(false);
  f.controller.refresh();
  assert.equal(f.scrollbar.hidden, true);
  f.scrollbar.dispatchEvent(new Event("scroll"));
  assert.equal(f.viewport.scrollLeft, 200);
  f.setEnabled(true);
  f.viewport.scrollWidth = 1900;
  f.controller.refresh();
  assert.equal(f.scrollbar.hidden, false);
  assert.equal(f.track.style.width, "1900px");
  assert.equal(f.scrollbar.scrollLeft, 200);
});

test("cleanup removes both listeners and later refresh cannot reveal the old bar", () => {
  const f = fixture();
  f.controller.dispose();
  f.viewport.scrollLeft = 300;
  f.viewport.dispatchEvent(new Event("scroll"));
  assert.equal(f.scrollbar.scrollLeft, 0);
  f.scrollbar.hidden = false;
  f.scrollbar.scrollLeft = 50;
  f.scrollbar.dispatchEvent(new Event("scroll"));
  assert.equal(f.viewport.scrollLeft, 300);
  f.scrollbar.hidden = true;
  f.controller.refresh();
  assert.equal(f.scrollbar.hidden, true);
});
