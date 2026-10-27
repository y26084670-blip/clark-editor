import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "vite";
import { buildSketchRequest, sha256, checkSketchFiles, SKETCH_DEFAULT_DESCRIPTION, SKETCH_LIMITS } from "../src/services/sketchRequestService.js";
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
test("packager uses the edited condition without enforcing the UI example", async () => {
  const condition = request => request.split("## Условие пользователя\n")[1].split("## Эскизы")[0];
  assert.ok(condition((await build({description:SKETCH_DEFAULT_DESCRIPTION})).request).includes(SKETCH_DEFAULT_DESCRIPTION));
  const changed = condition((await build({description:"d=12 мм, использовать не более 36 шестигранников"})).request);
  assert.match(changed,/не более 36/); assert.doesNotMatch(changed,/не более 20/);
  const cleared = condition((await build({description:""})).request);
  assert.match(cleared,/условие пока не задано/); assert.doesNotMatch(cleared,/не более 20/);
});
test("the profile's collapsed-edge prism remains a valid volume after discretization", async () => {
  const section=context.profile.split('<a id="sketch-wedge-01"></a>')[1];
  assert.ok(section,"The self-contained profile must include the worked prism");
  const recipe=JSON.parse(section.match(/```json\n([\s\S]*?)\n```/u)[1]);
  const {unpackKvVertices,validateKvVerticesDetailed}=await server.ssrLoadModule('/src/services/solver/geometryKv.js');
  const {physicalHex,hexPoint,medTolerance}=await server.ssrLoadModule('/src/services/solver/medContactGeometry.js');
  const edges=[[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];
  const sub=(a,b)=>a.map((x,i)=>x-b[i]);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
  const gauss=[(1-1/Math.sqrt(3))/2,(1+1/Math.sqrt(3))/2];
  for(const doubleFloat of [false,true]) {
    const cast=doubleFloat?x=>x:Math.fround;
    const {vertices:v,err}=unpackKvVertices(recipe.geo.map(cast),recipe.geoType);
    assert.equal(err,0);assert(validateKvVerticesDetailed(v,{GEO_ANGLE:.1}).valid);
    const tol=medTolerance(10,doubleFloat),hex=physicalHex(v,tol,doubleFloat);
    assert.equal(hex.error,undefined);assert.deepEqual(hex.faces.filter(f=>f.collapsed).map(f=>f.index),[5]);
    assert.equal(recipe.med[5],-1);
    let volume=0,minimumEdge=Infinity,count=0,collapsedEdges=0;
    const [nx,ny,nz]=recipe.dp;
    for(let i=0;i<nx;i++)for(let j=0;j<ny;j++)for(let k=0;k<nz;k++) {
      const c=Array.from({length:8},(_,p)=>hexPoint(v,(i+(p&1))/nx,(j+((p>>1)&1))/ny,(k+((p>>2)&1))/nz));
      assert(validateKvVerticesDetailed(c,{GEO_ANGLE:.1}).valid);
      assert.equal(physicalHex(c,tol,doubleFloat).error,undefined);count++;
      for(const [a,b] of edges){const length=Math.hypot(...sub(c[a],c[b]));if(length===0)collapsedEdges++;else minimumEdge=Math.min(minimumEdge,length);}
      for(const x of gauss)for(const y of gauss)for(const z of gauss) {
        const u=sub(hexPoint(c,1,y,z),hexPoint(c,0,y,z));
        const t=sub(hexPoint(c,x,1,z),hexPoint(c,x,0,z));
        const w=sub(hexPoint(c,x,y,1),hexPoint(c,x,y,0));
        const det=dot(u,cross(t,w));assert(det>0);volume+=det/8;
      }
    }
    assert.equal(count,8);assert.equal(collapsedEdges,8);assert.equal(minimumEdge,1.5);assert(Math.abs(volume-120)<1e-10);
    const bad=structuredClone(v);bad[2]=[...bad[0]];bad[6]=[...bad[4]];
    assert.equal(validateKvVerticesDetailed(bad,{GEO_ANGLE:.1}).checks.edge13,false);
  }
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
