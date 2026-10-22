import { createComponent } from "solid-js";
import { render } from "solid-js/web";
import { WhatsNewDialog as EditorWhatsNewDialog } from "../../src/components/updates/WhatsNewDialog.jsx";
import { findVersionContext } from "../../src/services/changeNotifications.js";

const app = location.pathname.endsWith("viewer") ? "viewer" : "editor";
const WhatsNewDialog = app === "viewer"
  ? (await import(/* @vite-ignore */ window.updateComponent)).WhatsNewDialog : EditorWhatsNewDialog;
// Only the native filesystem/process boundary is simulated. Both applications
// use their production component, feed client and shared browser storage.
const files = new Map();
const catalog = { async getFileHandle(name) {
  if (!files.has(name)) throw new DOMException("missing", "NotFoundError");
  return { async getFile() { return { async text() { return files.get(name); } }; } };
} };
const write = (name, value) => files.set(name, JSON.stringify(value));
write("clark.workspace.json", { schemaVersion: 1, bindingState: "bound",
    workspaceId: "11111111-1111-4111-8111-111111111111", launchOptionsVersion: 1,
    appVersion: "0.10.9", appVersionCheckedAt: "2026-10-22T00:00:00Z" });
let nativeVersion = "0.10.10";
window.updateFixture = { calls: [], ready: false, setNativeVersion: value => { nativeVersion = value; } };
const openNative = uri => {
  updateFixture.calls.push(uri);
  const params = new URL(uri).searchParams;
  void write("clark.settings.json", { schemaVersion: 1, workspaceId: params.get("workspace"), requestId: params.get("request"),
    appVersion: nativeVersion, appVersionCheckedAt: new Date().toISOString(), mpiRanks: 1 });
};
render(() => createComponent(WhatsNewDialog, { app, feedUrl: location.origin + "/__updates/feed", openNative,
  getVersionContext: () => findVersionContext([{ handle: catalog }]) }), document.getElementById("root"));
updateFixture.ready = true;
