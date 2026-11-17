import fs from "node:fs/promises";
import path from "node:path";
import { unpackKvVertices, validateKvVerticesDetailed } from "../runtime/editor/src/services/solver/geometryKv.js";
const dir=path.resolve(process.argv[2]||"");
if(!process.argv[2]) throw new Error("Usage: check_geometry.mjs CASE");
const read = async name => (await fs.readFile(path.join(dir,"input3XX",name),"utf8")).replace(/^\uFEFF/,"");
const general=JSON.parse(await read("general.txt"));
const records=(await read("kvs.txt")).split(/\r?\n/).filter(l=>l.trim()).map(JSON.parse);
const items=records.map((k,i)=>{
 const unpacked=unpackKvVertices(k.geo,k.geoType);
 const result=validateKvVerticesDetailed(unpacked.vertices,{doubleFloat:general.doubleFloat});
 return {kv:i+1,name:k.name,unpackError:unpacked.err,...result};
});
const valid=items.every(x=>x.unpackError===0&&x.valid);
console.log(JSON.stringify({scope:"Native local source-KV unpacking and global-Jacobian certification",valid,precision:general.doubleFloat?"Float64":"Float32",actualEOShellsChecked:false,contactsChecked:false,transformedImagesChecked:false,fullEditorPreflight:false,solverRun:false,items},null,2));
if(!valid)process.exitCode=1;
