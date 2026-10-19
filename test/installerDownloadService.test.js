import test from "node:test";
import assert from "node:assert/strict";
import { createInstallerDownloadUri, validateInstallerDownloadConfiguration } from "../src/services/installerDownloadService.js";

test("installer command has a fresh request and no workspace, URL or executable arguments", () => {
  const a = new URL(createInstallerDownloadUri()), b = new URL(createInstallerDownloadUri());
  assert.equal(a.protocol, "clark:");
  assert.equal(a.host, "download-installer");
  assert.deepEqual([...a.searchParams.keys()], ["request"]);
  assert.match(a.searchParams.get("request"), /^[a-f0-9-]{36}$/);
  assert.notEqual(a.href, b.href);
});

test("direct download needs only HTTPS URL; stale optional size/hash are ignored", () => {
  const valid = { solverInstallerUrl: "https://cloud.mail.ru/public/1ugC/yyDJcyLdw" };
  assert.equal(validateInstallerDownloadConfiguration(valid), valid);
  assert.doesNotThrow(() => validateInstallerDownloadConfiguration({ ...valid, solverInstallerSize: 0, solverInstallerSha256: "obsolete" }));
  for (const url of ["http://host/file.exe", "https://user:pass@host/file", "https://host/file#fragment", "https://host:8443/file", "", undefined]) {
    assert.throws(() => validateInstallerDownloadConfiguration({ solverInstallerUrl: url }));
  }
});
