import test from "node:test";
import assert from "node:assert/strict";
import { pickProjectDisk } from "../src/services/taskAccessService.js";

test("disk picker asks read-write access once and accepts a user disk with service directories", async () => {
  const calls = [];
  const disk = { name: "D:", async *entries() {
    for (const name of ["System Volume Information", "$RECYCLE.BIN", "clark.app", "clark.projects"])
      yield [name, { name, kind: "directory" }];
  } };
  const selected = await pickProjectDisk({ isSecureContext: true, showDirectoryPicker: async options => { calls.push(options); return disk; } });
  assert.equal(selected.handle, disk);
  assert.deepEqual(selected.catalogs.map(c => c.name), ["clark.projects"]);
  assert.deepEqual(calls, [{ id: "clark-project-disk", mode: "readwrite" }]);
});

test("cancelled and denied disk selection leave the caller without a new disk", async () => {
  for (const name of ["AbortError", "NotAllowedError"]) {
    await assert.rejects(pickProjectDisk({ isSecureContext: true, showDirectoryPicker: async () => { throw new DOMException(name, name); } }), { name });
  }
  await assert.rejects(pickProjectDisk({ isSecureContext: false }), /HTTPS|безопасн|поддерж/i);
});
