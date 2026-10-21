import test from "node:test";
import assert from "node:assert/strict";
import { isProjectCatalog, listProjectCatalogs, prepareCatalogBinding, readCatalogBindingResult,
  CATALOG_REQUEST_FILE, CATALOG_RESULT_FILE } from "../src/services/taskAccessService.js";

function disk() {
  const files = new Map();
  return { name: "Диск Д", files, async getFileHandle(name, options) {
    if (!files.has(name) && !options?.create) throw new DOMException("missing", "NotFoundError");
    return { getFile: async () => new Blob([files.get(name)]), createWritable: async () => {
      let pending; return { write: async value => { pending = value; }, close: async () => files.set(name, pending), abort: async () => {} };
    } };
  } };
}
const catalogs = [{ name: "clark.projects" }, { name: "Clark.Расчёты" }];
test("catalog mask is case-insensitive, excludes only clark.app and unsafe path components", async () => {
  for (const name of ["clark.projects", "CLARK.Tests", "clark.app2", "clark.Расчёты"]) assert.ok(isProjectCatalog(name));
  for (const name of ["clark.app", "CLARK.APP", "clark.", "xclark.projects", "clark.x/../x", "clark.x\\y", "clark.x:", "clark.x ", "clark.x."]) assert.equal(isProjectCatalog(name), false, name);
  const dir = { async *entries() { for (const name of ["clark.10", "clark.2", "clark.app", "служебный"]) yield [name, { kind: "directory" }]; yield ["clark.file", { kind: "file" }]; } };
  assert.deepEqual((await listProjectCatalogs(dir)).map(item => item.name), ["clark.2", "clark.10"]);
});
test("one request contains separate workspace identifiers and never rewrites child markers", async () => {
  const root = disk();
  const request = await prepareCatalogBinding(root, catalogs);
  assert.deepEqual([...root.files.keys()], [CATALOG_REQUEST_FILE]);
  const saved = JSON.parse(root.files.get(CATALOG_REQUEST_FILE));
  assert.equal(saved.requestId, request.requestId);
  assert.equal(saved.catalogs.length, 2);
  assert.notEqual(saved.catalogs[0].workspaceId, saved.catalogs[1].workspaceId);
  assert.equal(new URL(request.uri).host, "bind-catalogs");
  assert.equal(new URL(request.uri).searchParams.get("name"), root.name);
  const again = await prepareCatalogBinding(root, catalogs);
  assert.notEqual(again.requestId, request.requestId);
  for (const bad of [[], [{ name: "clark.app" }], [{ name: "clark.a" }, { name: "CLARK.A" }]]) await assert.rejects(prepareCatalogBinding(root, bad));
});
test("confirmation matches the request, validates every catalog and reports partial errors", async () => {
  const root = disk(), request = await prepareCatalogBinding(root, catalogs);
  const put = result => root.files.set(CATALOG_RESULT_FILE, JSON.stringify(result));
  assert.equal(await readCatalogBindingResult(root, request), null);
  const complete = { schemaVersion: 1, requestId: request.requestId, state: "bound", catalogs: request.catalogs };
  put({ ...complete, requestId: crypto.randomUUID() }); assert.equal(await readCatalogBindingResult(root, request), null);
  put(complete); assert.deepEqual(await readCatalogBindingResult(root, request), complete);
  for (const value of [{ ...complete, catalogs: request.catalogs.slice(0, 1) }, { ...complete, catalogs: [request.catalogs[0], request.catalogs[0]] },
    { ...complete, catalogs: [{ ...request.catalogs[0], workspaceId: crypto.randomUUID() }] }, { ...complete, state: "pending" }]) {
    put(value); await assert.rejects(readCatalogBindingResult(root, request));
  }
  put({ ...complete, state: "error", catalogs: request.catalogs.slice(0, 1), message: "Отказано в доступе" });
  assert.equal((await readCatalogBindingResult(root, request)).catalogs.length, 1);
});
