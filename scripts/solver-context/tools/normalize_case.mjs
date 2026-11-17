import fs from "node:fs/promises";
import path from "node:path";
import { tabRegistry } from "../runtime/editor/src/services/tabRegistry.js";
import { deserialize, serialize } from "../runtime/editor/src/services/model/modelSerializer.js";
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Usage: normalize_case.mjs INPUT_CASE NEW_OUTPUT_CASE");
const src=path.resolve(input), dst=path.resolve(output);
try { await fs.access(dst); throw new Error("Output already exists; choose a new directory"); } catch(e) { if(e.code!=="ENOENT") throw e; }
const stages=[];
for (const schema of tabRegistry) {
  const name=schema.config.file, file=path.join(src,"input3XX",name);
  let text;
  try { text=await fs.readFile(file,"utf8"); } catch(e) { if(e.code!=="ENOENT" || schema.config.required) throw e; text=""; }
  text=text.replace(/^\uFEFF/,"");
  const data=schema.config.storage==="cluster" ? JSON.parse(text) : text.split(/\r?\n/).filter(x=>x.trim()).map(JSON.parse);
  if(name==="conrab.txt" && data.length!==2) throw new Error("conrab.txt requires two profiles");
  const stored=serialize(deserialize(data,schema),schema);
  const result=schema.config.storage==="cluster" ? JSON.stringify(stored)+"\n" : stored.map(r=>JSON.stringify(r)).join("\n")+(stored.length?"\n":"");
  stages.push({name,result});
}
await fs.mkdir(path.join(dst,"input3XX"),{recursive:true});
for(const item of stages) await fs.writeFile(path.join(dst,"input3XX",item.name),item.result,"utf8");
for(const name of ["xapLibFMM","xapLibHTS"]) {
  try { const a=path.join(src,"input3XX",name); const s=await fs.lstat(a); if(s.isSymbolicLink()) throw new Error("Material directory must not be a symlink"); await fs.cp(a,path.join(dst,"input3XX",name),{recursive:true}); }
  catch(e){if(e.code!=="ENOENT")throw e;}
}
try { await fs.cp(path.join(src,"DOCS"),path.join(dst,"DOCS"),{recursive:true}); } catch(e){if(e.code!=="ENOENT")throw e;}
await fs.mkdir(path.join(dst,"DOCS"),{recursive:true});
await fs.writeFile(path.join(dst,"input3XX","_nogo.e3d"),"Prepared externally; full Editor check/save pending.\n");
await fs.writeFile(path.join(dst,"DOCS","normalization.json"),JSON.stringify({scope:"Native Editor schema serialization of seven files",fullEditorPreflight:false,solverRun:false,files:stages.map(x=>x.name)},null,2)+"\n");
console.log(JSON.stringify({output:dst,files:stages.length,fullEditorPreflight:false,solverRun:false}));
