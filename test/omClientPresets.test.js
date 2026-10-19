import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

test("saved presets keep newest-first order and replace builds by model and label", async () => {
  const template = JSON.parse(await readFile(new URL("../src/data/om-presets/circuit-single.json", import.meta.url)));
  const preset = (label, version) => ({ ...structuredClone(template), label,
    selection: { ...template.selection, version } });
  const newest = preset("A", "new"), other = preset("B", "middle"), old = preset("A", "old");
  let stored = JSON.stringify([newest, other, old]);
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true,
    value: { getItem: () => stored, setItem: (_key, value) => { stored = value; } } });
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
  try {
    const { readOMPresets, rememberOMPreset, omPresetKey, findOMPreset } = await server.ssrLoadModule("/src/services/omClientPresets.js");
    const { presets, notice } = readOMPresets();
    assert.equal(notice, "");
    assert.deepEqual(presets.slice(0, 2).map(p => [p.label, p.selection.version]), [["A", "new"], ["B", "middle"]]);
    assert.equal(presets.filter(p => p.label === "A").length, 1);
    const rebuilt = preset("A", "newer");
    assert.equal(omPresetKey(rebuilt), omPresetKey(old));
    const incompatible = preset("A", "new");
    incompatible.contract.dataSchema = "other/1";
    assert.notEqual(omPresetKey(incompatible), omPresetKey(rebuilt));
    assert.equal(findOMPreset([incompatible, rebuilt], rebuilt.selection, rebuilt.data), rebuilt);
    assert.equal(findOMPreset([rebuilt], { model: "other" }, rebuilt.data), null);
    assert.equal(findOMPreset([incompatible], rebuilt.selection, rebuilt.data), null);
    assert.equal(rememberOMPreset(rebuilt, presets), "");
    assert.deepEqual(JSON.parse(stored).map(p => [p.label, p.selection.version]), [["A", "newer"], ["B", "middle"]]);
  } finally {
    await server.close();
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
  }
});
