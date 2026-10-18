import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../src/components/tasks/TaskLaunchWindow.jsx", import.meta.url), "utf8");
const code = source.slice(source.indexOf("  function launch(action)"), source.indexOf("  async function acceptRun"));
test("OM launch explains zero or multiple enabled tasks before issuing a native request", () => {
  for (const count of [0, 2, 7]) {
    let message = "", dialogs = 0, requests = 0;
    const run = new Function("launchReady", "enabledEntries", "setModelicaError", "modelicaDialog", "canLaunch", "proof",
      `${code}; return launch;`)(() => true, () => Array(count).fill({ enabled: true }), value => { message = value; },
      { open: false, showModal() { dialogs++; } }, () => count > 0, () => { requests++; });
    run("modelica");
    assert.equal(dialogs, 1); assert.equal(requests, 0);
    assert.match(message, /ровно одно задание/); assert.ok(message.endsWith(`${count}.`));
  }
});
