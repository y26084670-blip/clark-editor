// The tabs own their widths. Follow their actual edges rather than duplicating
// flex sizing, font metrics, active-label widths, or horizontal scroll offsets.
export function installHeaderTabAlignment({ header, tabs }) {
  if (!header || !tabs) return () => {};
  const view = header.ownerDocument.defaultView;
  const ids = ["moves", "mhj", "fmmLibrary", "htsLibrary", "conrab"];
  const buttons = new Map(ids.map(id => [id, tabs.querySelector(`[data-tab-id="${id}"]`)]));
  if (ids.some(id => !buttons.get(id))) return () => {};
  let frame = 0, disposed = false;
  const variables = new Set();
  function measure() {
    frame = 0;
    if (disposed || !header.isConnected || !tabs.isConnected) return;
    const origin = header.getBoundingClientRect().left;
    for (const [id, button] of buttons) {
      const bounds = button.getBoundingClientRect();
      for (const [edge, value] of Object.entries({ left: bounds.left - origin, right: bounds.right - origin, width: bounds.width })) {
        const name = `--header-${id}-${edge}`, text = `${value}px`;
        variables.add(name);
        if (header.style.getPropertyValue(name) !== text) header.style.setProperty(name, text);
      }
    }
    header.classList.add("task-info-bar--aligned");
  }
  const schedule = () => { if (!disposed && !frame) frame = view.requestAnimationFrame(measure); };
  const observer = view.ResizeObserver ? new view.ResizeObserver(schedule) : null;
  observer?.observe(header); observer?.observe(tabs);
  for (const button of tabs.querySelectorAll("[data-tab-id]")) observer?.observe(button);
  tabs.addEventListener("scroll", schedule, { passive: true });
  view.addEventListener("resize", schedule);
  header.ownerDocument.fonts?.ready.then(schedule);
  measure();
  return () => {
    disposed = true;
    observer?.disconnect();
    if (frame) view.cancelAnimationFrame(frame);
    tabs.removeEventListener("scroll", schedule);
    view.removeEventListener("resize", schedule);
    header.classList.remove("task-info-bar--aligned");
    for (const name of variables) header.style.removeProperty(name);
  };
}
