import test from "node:test";
import assert from "node:assert/strict";
import { createInstallerDownloadUri, validateInstallerMetadata } from "../src/services/installerDownloadService.js";

test("installer command has a fresh request and no workspace, URL or executable arguments", () => {
  const a = new URL(createInstallerDownloadUri()), b = new URL(createInstallerDownloadUri());
  assert.equal(a.protocol, "clark:");
  assert.equal(a.host, "download-installer");
  assert.deepEqual([...a.searchParams.keys()], ["request"]);
  assert.match(a.searchParams.get("request"), /^[a-f0-9-]{36}$/);
  assert.notEqual(a.href, b.href);
});

test("direct download requires complete HTTPS metadata; ordinary configuration stays compatible", () => {
  const valid = { solverInstallerUrl: "https://cloud.mail.ru/public/1ugC/yyDJcyLdw", solverInstallerSize: 752657701, solverInstallerSha256: "a".repeat(64) };
  assert.equal(validateInstallerMetadata(valid), valid);
  for (const patch of [{ solverInstallerUrl: "http://host/file.exe" }, { solverInstallerUrl: "https://user:pass@host/file" },
    { solverInstallerUrl: "https://host/file#fragment" }, { solverInstallerSize: 0 }, { solverInstallerSize: 1.5 },
    { solverInstallerSize: "752657701" }, { solverInstallerSha256: "" }, { solverInstallerSha256: "z".repeat(64) }]) {
    assert.throws(() => validateInstallerMetadata({ ...valid, ...patch }));
  }
  assert.throws(() => validateInstallerMetadata({ solverInstallerUrl: valid.solverInstallerUrl }));
});
