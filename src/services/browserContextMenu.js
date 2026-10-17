/** Cancel the browser menu after application handlers receive the event. */
export function installBrowserContextMenuSuppression(target) {
  const preventBrowserMenu = event => event.preventDefault();
  // Bubble only: custom menus, pointer gestures and keyboard shortcuts keep
  // their own handlers. Portals in the same document are covered as well.
  target.addEventListener("contextmenu", preventBrowserMenu);
  return () => target.removeEventListener("contextmenu", preventBrowserMenu);
}
