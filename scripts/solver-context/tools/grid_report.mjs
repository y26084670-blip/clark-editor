import fs from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { eoCount } from "../runtime/editor/src/services/solver/kvDerived.js";

function checkedProduct(values, fields) {
  if (!values.every(n => Number.isSafeInteger(n) && n > 0)) {
    throw new Error("Expected positive integer counts in " + fields);
  }
  const result = values.reduce((product, n) => product * n, 1);
  if (!Number.isSafeInteger(result)) throw new Error("Count exceeds exact integer range in " + fields);
  return result;
}

async function readGrid(directory) {
  const read = async name => (await fs.readFile(path.join(directory, "input3XX", name), "utf8")).replace(/^\uFEFF/, "");
  const raw = (await read("kvs.txt")).split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
  const general = JSON.parse(await read("general.txt"));
  const symmetry = Object.fromEntries(["fullAxialSymmetry", "mirrorSymmetryX", "mirrorSymmetryY"].map(k => [k, general[k]]));
  const totals = { physicalBlocksBeforeGlobalMirrors: 0, physicalSourceEO: 0, independentUnknownEO: 0,
                   independentPrescribedM: 0, independentPrescribedJ: 0 };
  const blocks = raw.map((kv, i) => {
    if (![0, 1, 2, 3].includes(kv.targ) || !Array.isArray(kv.dp) || kv.dp.length !== 3) {
      throw new Error("Invalid targ or dp in KV " + (i + 1));
    }
    const cellCount = checkedProduct(kv.dp, "dp");
    const images = checkedProduct([kv.sym.ls, kv.sym.as, kv.sym.ps], "ls/as/ps");
    const physical = checkedProduct([cellCount, images], "dp and images");
    const independent = eoCount(kv);
    if (kv.targ !== 3) {
      totals.physicalBlocksBeforeGlobalMirrors += images;
      totals.physicalSourceEO += physical;
      if (kv.targ === 0) totals.independentUnknownEO += independent;
      if (kv.targ === 1) totals.independentPrescribedM += independent;
      if (kv.targ === 2) totals.independentPrescribedJ += independent;
    }
    return {index: i + 1, name: kv.name, targ: kv.targ, dp: kv.dp, images, physical, independent};
  });
  if (!Object.values(totals).every(Number.isSafeInteger)) throw new Error("Total exceeds exact integer range");
  const summary = {kvRecords: raw.length, virtualKV: raw.filter(k => k.targ === 3).length,
                   ...totals, symmetry, blocks,
                   scope: "Source EO counts before global mirrors. Virtual KVs listed separately. Matrix layout and observation counts are not derived here."};
  return {raw, summary};
}

function compare(before, after) {
  const changes = [];
  const grids = [];
  for (let i = 0; i < Math.max(before.raw.length, after.raw.length); i++) {
    const a = before.raw[i], b = after.raw[i];
    if (!a || !b) {
      changes.push({index: i + 1, fields: [a ? "removedKV" : "addedKV"]});
      continue;
    }
    const changed = [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .filter(key => key !== "dp" && !isDeepStrictEqual(a[key], b[key]));
    if (changed.length) changes.push({index: i + 1, fields: changed});
    if (!isDeepStrictEqual(a.dp, b.dp)) grids.push({index: i + 1, before: a.dp, after: b.dp});
  }
  const sameGlobalSymmetry = isDeepStrictEqual(before.summary.symmetry, after.summary.symmetry);
  return {sameBlocksAndAttributes: !changes.length && sameGlobalSymmetry, sameGlobalSymmetry,
          changedOutsideDp: changes, changedDp: grids, before: before.summary, after: after.summary,
          scope: "Stored KV records by row (all fields except dp) and global symmetry. Check material tables, MHJ, observations and other files separately."};
}

const dirs = process.argv.slice(2);
if (dirs.length < 1 || dirs.length > 2) {
  console.error("Usage: node tools/grid_report.mjs CASE [REFINED_CASE]");
  process.exitCode = 2;
} else {
  try {
    const first = await readGrid(dirs[0]);
    const report = dirs.length === 1 ? first.summary : compare(first, await readGrid(dirs[1]));
    console.log(JSON.stringify(report, null, 2));
    if (report.sameBlocksAndAttributes === false) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
