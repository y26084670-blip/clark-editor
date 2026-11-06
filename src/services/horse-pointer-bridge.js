/* Attach once per iframe; call the returned function when removing it. */
(() => {
  'use strict';
  function attach(owner, frame) {
    if (!owner || !frame) throw new TypeError('Owner panel and iframe are required');
    const win = owner.ownerDocument.defaultView;
    const origin = new URL(frame.src, win.location.href).origin;
    let pending = 0, disposed = false, last = null;
    function deliver(data) {
      if (disposed || !frame.isConnected || !frame.contentWindow) return;
      try {
        if (frame.contentWindow.HorseScene?.pointer) {
          frame.contentWindow.HorseScene.pointer(data);
          return;
        }
      } catch (_) { /* Cross-origin frames use the same guarded message API. */ }
      frame.contentWindow.postMessage({
        channel: 'horse-scene', version: 1, type: 'command',
        command: 'pointer', pointer: data
      }, origin === 'null' ? '*' : origin);
    }
    function flush() { pending = 0; if (last) deliver(last); }
    function move(event) {
      const panel = owner.getBoundingClientRect(), scene = frame.getBoundingClientRect();
      if (scene.width < 1 || scene.height < 1) return;
      last = {
        x: (event.clientX - scene.left) / scene.width,
        y: (event.clientY - scene.top) / scene.height,
        inside: event.clientX >= panel.left && event.clientX <= panel.right &&
                event.clientY >= panel.top && event.clientY <= panel.bottom,
        buttons: event.buttons || 0,
        eventType: event.type
      };
      if (event.type === 'pointerdown' || event.type === 'pointerup') {
        if (pending) win.cancelAnimationFrame(pending);
        pending = 0; deliver(last);
      } else if (!pending) pending = win.requestAnimationFrame(flush);
    }
    function leave() {
      last = {...(last || {x:.5, y:.5}), inside:false, buttons:0};
      if (pending) win.cancelAnimationFrame(pending);
      pending = 0; deliver(last);
    }
    function ready(event) {
      if (event.source === frame.contentWindow && event.origin === origin &&
          event.data?.channel === 'horse-scene' && event.data.version === 1 &&
          event.data.type === 'ready' && last) deliver(last);
    }
    for (const type of ['pointermove', 'pointerdown', 'pointerup']) win.addEventListener(type, move, true);
    win.addEventListener('pointercancel', leave, true);
    win.addEventListener('blur', leave);
    owner.addEventListener('pointerleave', leave);
    win.addEventListener('message', ready);
    return function detach() {
      if (disposed) return;
      leave(); disposed = true;
      for (const type of ['pointermove', 'pointerdown', 'pointerup']) win.removeEventListener(type, move, true);
      win.removeEventListener('pointercancel', leave, true);
      win.removeEventListener('blur', leave);
      owner.removeEventListener('pointerleave', leave);
      win.removeEventListener('message', ready);
    };
  }
  window.HorsePointerBridge = Object.freeze({attach});
})();
