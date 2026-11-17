import fs from "node:fs/promises";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { tabRegistry } from "../runtime/editor/src/services/tabRegistry.js";
import { deserialize, serialize } from "../runtime/editor/src/services/model/modelSerializer.js";
import { getSketchContext } from "../runtime/editor/src/services/sketchContextService.js";
import { resetKvGeo, unpackKvVertices, validateKvVerticesDetailed } from "../runtime/editor/src/services/solver/geometryKv.js";
const context=getSketchContext();
assert.equal(crypto.createHash("sha256").update(context.profile).digest("hex"),context.sourceLock.sha256);
for(const schema of tabRegistry){
 const item=context.schemas.find(x=>x.id===schema.id);
 const stored=item.storage==="cluster"?JSON.parse(item.exampleOnlyNotTask):item.exampleOnlyNotTask.split("\n").map(JSON.parse);
 assert.deepEqual(serialize(deserialize(stored,schema),schema),stored);
}
const schema=context.schemas.find(s=>s.id==="elements");
const variants=schema.fields.geoType.enum.map(({value,label})=>{
 const geo=resetKvGeo(value).flat(Infinity), data=unpackKvVertices(geo,value);
 const check=validateKvVerticesDetailed(data.vertices,{doubleFloat:true});
 return {geoType:value,label,geo,vertices:data.vertices,unpackError:data.err,valid:check.valid};
});
if(variants.some(v=>v.unpackError||!v.valid))throw new Error("A native geometry example is invalid");
await fs.writeFile(new URL("../schemas/geometry-variants.json",import.meta.url),JSON.stringify({scope:"Native reset/unpack examples; not task conditions",variants},null,2)+"\n");
await fs.writeFile(new URL("../schemas/storage-contract.json",import.meta.url),JSON.stringify({schema:"clark-storage-descriptor/1",editorVersion:context.editorVersion,sourceLock:context.sourceLock,schemas:context.schemas},null,2)+"\n");
console.log(JSON.stringify({storageContracts:context.schemas.length,geometryVariants:variants.length,editorVersion:context.editorVersion}));
