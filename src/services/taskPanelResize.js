const MIN_WIDTHS = [360, 320, 320];

/** Resize adjacent task panels; their widths never depend on tab captions. */
export function installTaskPanelResize(grid) {
  const panels = [...grid.querySelectorAll(":scope > .task-browser-panel, :scope > .task-summary-panel, :scope > .task-results-panel")];
  const handles = [...grid.querySelectorAll(":scope > .task-panel-splitter")];
  const view = grid.ownerDocument.defaultView;
  let gesture = null;
  const widths = () => panels.map(panel => panel.getBoundingClientRect().width);
  const updateAria = () => {
    const sizes = widths();
    handles.forEach((handle, index) => {
      const total = sizes[index] + sizes[index + 1];
      if (total <= 0) return;
      const percent = value => String(Math.round(value / total * 100));
      handle.setAttribute("aria-valuemin", percent(MIN_WIDTHS[index]));
      handle.setAttribute("aria-valuemax", percent(total - MIN_WIDTHS[index + 1]));
      handle.setAttribute("aria-valuenow", percent(sizes[index]));
    });
  };
  function resize(index, sizes, delta) {
    const next = [...sizes], total = sizes[index] + sizes[index + 1];
    next[index] = Math.max(MIN_WIDTHS[index], Math.min(total - MIN_WIDTHS[index + 1], sizes[index] + delta));
    next[index + 1] = total - next[index];
    grid.style.gridTemplateColumns = next.map((size, i) => `minmax(${MIN_WIDTHS[i]}px, ${size}fr)`).join(" 10px ");
    updateAria();
  }
  function finish(event) {
    if (!gesture || (event?.pointerId !== undefined && event.pointerId !== gesture.id)) return;
    const previous = gesture;
    gesture = null;
    grid.classList.remove("is-resizing");
    try { previous.handle.releasePointerCapture(previous.id); } catch { /* Capture may already be released. */ }
  }
  const listeners = [];
  const listen = (target, type, listener) => {
    target.addEventListener(type, listener);
    listeners.push(() => target.removeEventListener(type, listener));
  };
  handles.forEach((handle, index) => {
    listen(handle, "pointerdown", event => {
      if (event.button !== 0 || event.isPrimary === false) return;
      finish();
      event.preventDefault();
      handle.focus();
      gesture = { handle, index, id: event.pointerId, x: event.clientX, sizes: widths() };
      grid.classList.add("is-resizing");
      try { handle.setPointerCapture(event.pointerId); } catch { /* Window listeners cover capture refusal. */ }
    });
    listen(handle, "lostpointercapture", finish);
    listen(handle, "dblclick", () => { finish(); grid.style.removeProperty("grid-template-columns"); updateAria(); });
    listen(handle, "keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const sizes = widths();
      const delta = event.key === "Home" ? -Infinity : event.key === "End" ? Infinity
        : (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 50 : 10);
      resize(index, sizes, delta);
    });
  });
  listen(view, "pointermove", event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    event.preventDefault();
    resize(gesture.index, gesture.sizes, event.clientX - gesture.x);
  });
  listen(view, "pointerup", finish);
  listen(view, "pointercancel", finish);
  listen(view, "blur", () => finish());
  const observer = new view.ResizeObserver(updateAria);
  observer.observe(grid);
  return () => { finish(); observer.disconnect(); listeners.forEach(dispose => dispose()); };
}
