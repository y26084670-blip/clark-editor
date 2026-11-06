import test from 'node:test';
import assert from 'node:assert/strict';

// The standalone bridge installs its browser API when the controller imports it.
const originalWindow = globalThis.window;
globalThis.window = {};
const { createHorseSceneController } = await import('../src/services/horseSceneController.js');
const bridge = globalThis.window.HorsePointerBridge;
if (originalWindow === undefined) delete globalThis.window;
else globalThis.window = originalWindow;

class Target {
  listeners = new Map();
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  emit(type, event = {}) {
    for (const fn of [...(this.listeners.get(type) || [])]) fn({ type, currentTarget: this, ...event });
  }
  count() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); }
}
function setup(initialInert = false) {
  const view = new Target(), panel = new Target();
  const timers = new Map(), rafs = new Map(), samples = [], stops = [], errors = [];
  let next = 1, escapes = 0, focuses = 0;
  Object.assign(view, {
    location: { href: 'https://editor.example/clark-editor/' }, HorsePointerBridge: bridge,
    setTimeout(fn) { const id = next++; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) { const id = next++; rafs.set(id, fn); return id; },
    cancelAnimationFrame(id) { rafs.delete(id); },
  });
  const doc = { defaultView: view, baseURI: view.location.href, createElement() {
    const frame = new Target();
    Object.assign(frame, {
      isConnected: false, contentWindow: { HorseScene: {
        pointer(data) { samples.push(data); }, stop(reason) { stops.push(reason); },
      } },
      getBoundingClientRect: () => ({ left: 20, top: 30, width: 200, height: 100 }),
      focus() { frame.focused = true; },
      remove() { frame.isConnected = false; panel.frames = panel.frames.filter(f => f !== frame); },
    });
    return frame;
  } };
  Object.assign(panel, { ownerDocument: doc, open: true, isConnected: true, frames: [],
    appendChild(frame) { panel.frames.push(frame); frame.isConnected = true; },
    getBoundingClientRect: () => ({ left: 10, top: 20, right: 230, bottom: 140 }),
  });
  const content = { inert: initialInert };
  const controller = createHorseSceneController({ panel, content,
    button: { focus() { focuses++; } }, url: './assets/horse-scene.html',
    onEscape() { escapes++; panel.open = false; }, onError(error) { errors.push(error); },
  });
  function message(type, extra = {}, envelope = {}) {
    view.emit('message', { source: panel.frames[0]?.contentWindow, origin: 'https://editor.example',
      data: { channel: 'horse-scene', version: 1, type, ...extra }, ...envelope });
  }
  function clean() {
    assert.equal(panel.frames.length, 0); assert.equal(view.count(), 0);
    assert.equal(panel.count(), 0); assert.equal(timers.size, 0); assert.equal(rafs.size, 0);
    assert.equal(content.inert, initialInert);
  }
  return { view, panel, content, controller, timers, rafs, samples, stops, errors,
    message, clean, escapes: () => escapes, focuses: () => focuses };
}

test('lazy, single instance; ready clears timeout and interactive notifications keep scene alive', () => {
  const s = setup();
  assert.equal(s.panel.frames.length, 0);
  s.controller.show(); s.controller.show();
  assert.equal(s.panel.frames.length, 1); assert.equal(s.content.inert, true);
  const frame = s.panel.frames[0];
  s.message('ready'); assert.equal(s.timers.size, 0); assert.equal(frame.focused, true);
  for (const type of ['started', 'interactive', 'departing', 'dissolving', 'reaction', 'following']) s.message(type);
  assert.equal(s.panel.frames[0], frame);
  s.message('ended', { reason: 'completed' });
  assert.equal(s.panel.open, true); assert.equal(s.focuses(), 1);
  assert.deepEqual(s.stops, ['completed']); s.clean();
});

test('reject unrelated messages and an old iframe after reopening', () => {
  const s = setup(); s.controller.show();
  const old = s.panel.frames[0].contentWindow;
  const data = { channel: 'horse-scene', version: 1, type: 'ended', reason: 'escape' };
  for (const envelope of [{ source: {} }, { origin: 'https://other.example' },
    { data: { ...data, channel: 'other' } }, { data: { ...data, version: 2 } }]) {
    s.message('ended', { reason: 'escape' }, envelope);
  }
  assert.equal(s.panel.frames.length, 1); assert.equal(s.escapes(), 0);
  s.controller.stop(); s.controller.show();
  s.message('ended', { reason: 'escape' }, { source: old });
  assert.equal(s.panel.frames.length, 1);
  s.message('ended', { reason: 'escape' });
  assert.equal(s.escapes(), 1); s.clean();
});

test('short clicks are synchronous; moves coalesce; pointer leave and blur clear buttons', () => {
  const s = setup(); s.controller.show();
  s.view.emit('pointermove', { clientX: 40, clientY: 50, buttons: 0 });
  s.view.emit('pointermove', { clientX: 60, clientY: 60, buttons: 0 });
  assert.equal(s.rafs.size, 1); assert.equal(s.samples.length, 0);
  for (const [type, buttons] of [['pointerdown', 1], ['pointerup', 0]])
    s.view.emit(type, { clientX: 190, clientY: 65, buttons });
  assert.equal(s.rafs.size, 0);
  assert.deepEqual(s.samples.map(p => [p.x, p.y, p.inside, p.buttons, p.eventType]),
    [[.85, .35, true, 1, 'pointerdown'], [.85, .35, true, 0, 'pointerup']]);
  s.panel.emit('pointerleave'); assert.equal(s.samples.at(-1).inside, false);
  s.view.emit('pointerdown', { clientX: 190, clientY: 65, buttons: 1 });
  s.view.emit('blur'); assert.equal(s.samples.at(-1).buttons, 0);
  s.view.emit('pointermove', { clientX: 70, clientY: 60 });
  s.controller.dispose(); s.clean();
  const count = s.samples.length;
  s.view.emit('pointerdown', { clientX: 80, clientY: 60, buttons: 1 });
  s.controller.show(); assert.equal(s.samples.length, count); s.clean();
});

test('timeout, renderer error and iframe error restore content and allow retry', () => {
  for (const failure of ['timeout', 'message', 'iframe']) {
    const s = setup(); s.controller.show();
    if (failure === 'timeout') [...s.timers.values()][0]();
    else if (failure === 'message') s.message('error');
    else s.panel.frames[0].emit('error');
    assert.equal(s.errors.length, 1); s.clean();
    s.controller.show(); s.message('ready'); s.controller.stop(); s.clean();
  }
});

test('stop is idempotent and restores preexisting inert state without focus', () => {
  const s = setup(true); s.controller.show();
  const frame = s.panel.frames[0];
  s.controller.stop('panel-close', false); s.controller.stop(); s.controller.dispose();
  assert.equal(frame.count(), 0); assert.equal(s.focuses(), 0);
  assert.deepEqual(s.stops, ['panel-close']); s.clean();
  s.controller.show(); s.clean();
});

test('bridge posts versioned pointer command when the scene API is not ready', () => {
  const s = setup(); s.controller.show();
  const sent = []; const frame = s.panel.frames[0];
  delete frame.contentWindow.HorseScene;
  frame.contentWindow.postMessage = (data, origin) => sent.push({ data, origin });
  s.view.emit('pointerdown', { clientX: 120, clientY: 80, buttons: 1 });
  assert.equal(sent[0].origin, 'https://editor.example');
  assert.deepEqual(sent[0].data, { channel: 'horse-scene', version: 1, type: 'command', command: 'pointer',
    pointer: { x: .5, y: .5, inside: true, buttons: 1, eventType: 'pointerdown' } });
  s.message('ready'); assert.equal(sent.length, 2);
  s.controller.dispose(); s.clean();
});
