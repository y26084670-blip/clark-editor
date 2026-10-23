// Follow the tabs' actual edges and fit labels to the available widths.
export function installHeaderTabAlignment({ header, tabs }) {
  if (!header || !tabs) return () => {};
  const view = header.ownerDocument.defaultView;
  const ids = ["tasks", "moves", "mhj", "fmmLibrary", "htsLibrary", "conrab"];
  const buttons = new Map(ids.map(id => [id, tabs.querySelector(`[data-tab-id="${id}"]`)]));
  if (ids.some(id => !buttons.get(id))) return () => {};
  const tabButtons = Array.from(tabs.querySelectorAll("[data-tab-id]"));
  const actions = Array.from(header.querySelectorAll(
    ".validation-controls > .model-validation-button, .header-save-start > .general-information-button, " +
    ".header-documentation > .documentation-button, .header-news > .whats-new-button, .task-info-title",
  ));
  const caps = new Map([...tabButtons, ...actions].map(button => [button, parseFloat(view.getComputedStyle(button).fontSize)]));
  const originalActionFonts = new Map(actions.map(button => [button, button.style.fontSize]));
  const originalTabFont = tabs.style.getPropertyValue("--tab-label-font-size");
  const originalTabCount = tabs.style.getPropertyValue("--tab-count");
  tabs.style.setProperty("--tab-count", String(tabButtons.length));
  const context = header.ownerDocument.createElement("canvas").getContext("2d");
  function fittedSize(button, bold = false) {
    const isTitle = button.classList.contains("task-info-title");
    const label = button.querySelector(".tab-label, .validation-button-label") || button;
    const text = isTitle ? button.textContent.trim() : label === button
      ? Array.from(button.childNodes).filter(node => node.nodeType === 3).map(node => node.textContent).join("").trim()
      : label.textContent.trim();
    const cap = caps.get(button);
    if (!context || !text) return cap;
    const lines = isTitle
      ? Array.from(button.children).map(node => node.textContent.trim()).filter(Boolean)
      : [text];
    const style = view.getComputedStyle(button);
    const font = view.getComputedStyle(label);
    const siblings = isTitle ? [] : Array.from(button.children).filter(child => {
      const childStyle = view.getComputedStyle(child);
      return child !== label && childStyle.display !== "none" && !["absolute", "fixed"].includes(childStyle.position);
    });
    const reserved = siblings.reduce((sum, child) => sum + child.getBoundingClientRect().width, 0)
      + siblings.length * (parseFloat(style.columnGap) || 0);
    const available = button.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - reserved - 1;
    const fits = size => {
      context.font = `${bold ? 700 : font.fontWeight} ${size}px ${font.fontFamily}`;
      return lines.every(line => context.measureText(line).width <= available);
    };
    let low = 0, high = Math.floor(cap * 100) / 100;
    if (fits(high)) return high;
    // Font hinting can round glyph widths at small sizes; measure candidates
    // instead of assuming that text width scales exactly with font size.
    for (let i = 0; i < 12; i++) {
      const size = (low + high) / 2;
      if (fits(size)) low = size;
      else high = size;
    }
    return Math.max(1, Math.floor(low * 100) / 100);
  }
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
    // Reserve the bold active-label width for every tab, so selection never
    // changes the common font size. Indicators and their gaps stay unchanged.
    const tabFont = `${Math.min(...tabButtons.map(button => fittedSize(button, true)))}px`;
    if (tabs.style.getPropertyValue("--tab-label-font-size") !== tabFont) tabs.style.setProperty("--tab-label-font-size", tabFont);
    for (const button of actions) {
      const size = `${fittedSize(button)}px`;
      if (button.style.fontSize !== size) button.style.fontSize = size;
    }
  }
  const schedule = () => { if (!disposed && !frame) frame = view.requestAnimationFrame(measure); };
  const observer = view.ResizeObserver ? new view.ResizeObserver(schedule) : null;
  observer?.observe(header); observer?.observe(tabs);
  for (const button of tabs.querySelectorAll("[data-tab-id]")) observer?.observe(button);
  const contentObserver = view.MutationObserver ? new view.MutationObserver(schedule) : null;
  contentObserver?.observe(header, { childList: true, characterData: true, subtree: true });
  tabs.addEventListener("scroll", schedule, { passive: true });
  view.addEventListener("resize", schedule);
  header.ownerDocument.fonts?.ready.then(schedule);
  measure();
  return () => {
    disposed = true;
    observer?.disconnect();
    contentObserver?.disconnect();
    if (frame) view.cancelAnimationFrame(frame);
    tabs.removeEventListener("scroll", schedule);
    view.removeEventListener("resize", schedule);
    header.classList.remove("task-info-bar--aligned");
    for (const name of variables) header.style.removeProperty(name);
    if (originalTabFont) tabs.style.setProperty("--tab-label-font-size", originalTabFont);
    else tabs.style.removeProperty("--tab-label-font-size");
    if (originalTabCount) tabs.style.setProperty("--tab-count", originalTabCount);
    else tabs.style.removeProperty("--tab-count");
    for (const [button, font] of originalActionFonts) {
      if (font) button.style.fontSize = font;
      else button.style.removeProperty("font-size");
    }
  };
}
