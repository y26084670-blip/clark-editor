import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "vite";
import { buildSketchRequest, sha256, checkSketchFiles, SKETCH_LIMITS } from "../src/services/sketchRequestService.js";
import { createStoredZip } from "../src/services/zipStore.js";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
after(() => server.close());
const { getSketchContext } = await server.ssrLoadModule("/src/services/sketchContextService.js");
const context = getSketchContext();
const png = new File([new Uint8Array([137,80,78,71,13,10,26,10,1,2,3])], "эскиз.png");
const build = (args = {}, options = {}) => buildSketchRequest({ files: [png], context, ...args }, options);

test("context contains seven current storage contracts, nested keys and real serializer examples", async () => {
  assert.equal(context.schemas.length, 7);
  assert.equal(await sha256(context.profile), context.sourceLock.sha256);
  const { tabRegistry } = await server.ssrLoadModule("/src/services/tabRegistry.js");
  const { deserialize, serialize } = await server.ssrLoadModule("/src/services/model/modelSerializer.js");
  for (const schema of tabRegistry) {
    const file = context.schemas.find(s => s.id === schema.id);
    const storage = file.storage === "cluster" ? JSON.parse(file.exampleOnlyNotTask) : file.exampleOnlyNotTask.split("\n").map(JSON.parse);
    assert.deepEqual(serialize(deserialize(storage, schema), schema), storage);
  }
  const kv = context.schemas.find(s => s.id === "elements");
  assert.ok(kv.fields["sym.vi"]); assert.equal(kv.fields.yc1, undefined);
  assert.equal(kv.fields.geo.storageOrder, "row");
  assert.equal(context.schemas.find(s => s.id === "mhj").fields.v.storageOrder, "column");
  assert.equal(context.schemas.find(s => s.id === "conrab").exampleOnlyNotTask.split("\n").length, 2);
});

test("independent Python ZIP reader checks CRC, bytes, user condition and manifest hashes", async () => {
  const result = await build({ title: "Кольца", description: "d=10 мм; материалы позже" }, { requestId: "test", createdAt: "2026-10-22T00:00:00Z" });
  const directory = await mkdtemp(join(tmpdir(), "clark-sketch-"));
  try {
    await writeFile(join(directory, "request.zip"), new Uint8Array(await result.zip.arrayBuffer()));
    const check = spawnSync("python", ["-c", `import zipfile,json,hashlib,sys
z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None
assert set(z.namelist())=={'README.txt','START.txt','REQUEST.md','context-lock.json','sketch/01.png'}
m=json.loads(z.read('context-lock.json'));r=z.read('REQUEST.md')
assert hashlib.sha256(r).hexdigest()==m['requestSha256']
assert hashlib.sha256(z.read('sketch/01.png')).hexdigest()==m['images'][0]['sha256']
assert 'd=10 мм; материалы позже' in r.decode() and m['images'][0]['originalName']=='эскиз.png'
assert m['knowledge']['sha256']
`, join(directory, "request.zip")], { encoding: "utf8" });
    assert.equal(check.status, 0, check.stderr);
    assert.match(result.request, /не готовое задание/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("sketch may have no dimensions or text; request keeps the gap explicit", async () => {
  assert.match((await build()).request, /условие пока не задано/);
});
test("unsupported, empty, too many and oversized images fail before packaging", () => {
  assert.throws(() => checkSketchFiles([]));
  assert.throws(() => checkSketchFiles(Array(4).fill(png)));
  assert.throws(() => checkSketchFiles([new File(["<svg/>"], "x.svg")]));
  assert.throws(() => checkSketchFiles([new File([], "x.png")]));
  const large = new File([new Uint8Array(SKETCH_LIMITS.eachBytes + 1)], "large.png");
  assert.throws(() => checkSketchFiles([large]), /8 МиБ/);
  const medium = new File([new Uint8Array(6 * 1024 * 1024)], "large.png");
  assert.throws(() => checkSketchFiles([medium,medium,medium]), /16 МиБ/);
});
test("mismatched image signature and context integrity are errors", async () => {
  await assert.rejects(build({files:[new File(["wrong"],"x.png")]}), /не соответствует/);
  await assert.rejects(build({context:{...context,profile:context.profile+'changed'}}), /зафиксированной/);
  await assert.rejects(build({context:{...context,schemas:[]}}), /полный контекст/);
});
test("abort before or during image reading produces no package", async () => {
  const controller = new AbortController();controller.abort();
  await assert.rejects(build({}, {signal:controller.signal}), {name:"AbortError"});
  const next = new AbortController();
  const late = new File([await png.arrayBuffer()],"late.png");
  late.slice = () => { next.abort(); return png.slice(); };
  await assert.rejects(build({files:[late]}, {signal:next.signal}), {name:"AbortError"});
});
test("ZIP refuses traversal, duplicate paths and excessive buffers", () => {
  for (const name of ["../a", "/a", "a//b", "a\\b", "C:a"]) assert.throws(() => createStoredZip([{name,data:"x"}]));
  assert.throws(() => createStoredZip([{name:"a",data:"x"},{name:"a",data:"y"}]));
  assert.throws(() => createStoredZip([{name:"a",data:new Uint8Array(32*1024*1024)}]), /32 МиБ/);
});
