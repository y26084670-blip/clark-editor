/** Mirror a scroll viewport with a native scrollbar placed near its headings. */
export function installLinkedHorizontalScrollbar({ viewport, scrollbar, track, isEnabled }) {
  let disposed = false;

  function fromViewport() {
    if (!scrollbar.hidden && scrollbar.scrollLeft !== viewport.scrollLeft) {
      scrollbar.scrollLeft = viewport.scrollLeft;
    }
  }

  function fromScrollbar() {
    if (!scrollbar.hidden && viewport.scrollLeft !== scrollbar.scrollLeft) {
      viewport.scrollLeft = scrollbar.scrollLeft;
    }
  }

  function refresh() {
    if (disposed) return;
    const width = viewport.clientWidth;
    const contentWidth = viewport.scrollWidth;
    scrollbar.hidden = !isEnabled() || width <= 0 || contentWidth <= width + 1;
    scrollbar.style.width = `${width}px`;
    track.style.width = `${contentWidth}px`;
    if (scrollbar.hidden) scrollbar.scrollLeft = 0;
    else fromViewport();
  }

  viewport.addEventListener("scroll", fromViewport);
  scrollbar.addEventListener("scroll", fromScrollbar);
  refresh();
  return {
    refresh,
    dispose() {
      disposed = true;
      viewport.removeEventListener("scroll", fromViewport);
      scrollbar.removeEventListener("scroll", fromScrollbar);
      scrollbar.hidden = true;
    },
  };
}
