// Own one disposable scene inside the existing About dialog. The dialog keeps
// its native cancel/close handling; no additional keyboard handler is installed.
export function createHorseSceneController({ panel, content, button, url, onEscape, onError }) {
  const view = panel.ownerDocument.defaultView;
  const sceneURL = new URL(url, panel.ownerDocument.baseURI);
  let currentFrame = null;
  let loadTimer = null;
  let previousInert = false;
  let disposed = false;

  function stop(reason = "cancelled", restoreFocus = true) {
    const frame = currentFrame;
    if (!frame) return;
    // Clear identity before stop() can queue an ended event from the old frame.
    currentFrame = null;
    view.clearTimeout(loadTimer);
    loadTimer = null;
    view.removeEventListener("message", onMessage);
    frame.removeEventListener("error", onLoadError);
    try { frame.contentWindow?.HorseScene?.stop(reason); } catch { /* Remove even an unloaded frame. */ }
    frame.remove();
    content.inert = previousInert;
    if (restoreFocus && panel.isConnected && panel.open && !content.inert) {
      button.focus({ preventScroll: true });
    }
  }

  function fail(reason) {
    stop(reason);
    onError?.(reason === "load-timeout"
      ? "Не удалось загрузить сцену «Лошадь». Попробуйте открыть её снова."
      : "Не удалось показать сцену «Лошадь». Попробуйте открыть её снова.");
  }

  function onLoadError(event) {
    if (event.currentTarget === currentFrame) fail("load-error");
  }

  function onMessage(event) {
    const frame = currentFrame;
    if (!frame || event.source !== frame.contentWindow || event.origin !== sceneURL.origin) return;
    const data = event.data;
    if (!data || data.channel !== "horse-scene" || data.version !== 1) return;
    if (data.type === "ready") {
      view.clearTimeout(loadTimer);
      loadTimer = null;
      if (panel.open) frame.focus();
    } else if (data.type === "ended") {
      if (data.reason === "escape") {
        stop("panel-close", false);
        if (panel.open) onEscape();
      } else {
        stop(data.reason);
      }
    } else if (data.type === "error") {
      fail("error");
    }
  }

  function show() {
    if (disposed || currentFrame || !panel.open) return;
    const frame = panel.ownerDocument.createElement("iframe");
    frame.className = "about-horse-frame";
    frame.title = "Лошадь — анимация";
    frame.src = sceneURL.href;
    currentFrame = frame;
    previousInert = content.inert;
    content.inert = true;
    view.addEventListener("message", onMessage);
    frame.addEventListener("error", onLoadError);
    loadTimer = view.setTimeout(() => {
      if (currentFrame === frame) fail("load-timeout");
    }, 20000);
    panel.appendChild(frame);
  }

  return {
    show,
    stop,
    dispose() {
      disposed = true;
      stop("panel-destroy", false);
    },
  };
}
