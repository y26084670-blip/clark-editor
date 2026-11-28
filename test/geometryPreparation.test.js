import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import initOcct from "occt-import-js";
import { buildMeshRequest } from "../src/services/geometryPreparation.js";
import { femmCurrents, importFemm } from "../src/services/femmGeometryImport.js";
import { importStepMeshes } from "../src/services/stepGeometryImport.js";

const source = (file) => new URL("../public/geometry/" + file, import.meta.url);
const read = (name, encoding) => readFile(source(name), encoding);
const table = (task, name) =>
  task.entries
    .find((entry) => entry.name === "input3XX/" + name + ".txt")
    .data.trim()
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse);
const profile = JSON.parse(await read("tvv320-profile.json", "utf8"));

for (const [file, reference] of [
  ["TVV320_1.fem", "TVV320_2D"],
  ["TVV320_2.fem", "TVV320_load_2D"],
]) {
  test(file + " reproduces the native geometry, currents and both measured material tables", async () => {
    const sourceText = await read(file, "utf8");
    const result = await importFemm({ source: sourceText, profile, length: 6000, filename: file });
    const output = execFileSync(
      process.platform === "win32" ? "python" : "python3",
      [
        "-c",
        [
          "import json,zipfile,sys",
          "with zipfile.ZipFile(sys.argv[1]) as z:",
          " p='example/'+sys.argv[2]+'/input3XX/'",
          " print(json.dumps({n[len(p): -4]:([json.loads(z.read(n))] if '/xapLibFMM/' in n else [json.loads(x) for x in z.read(n).splitlines() if x]) for n in z.namelist() if n.startswith(p) and n.endswith('.txt')}))",
        ].join("\n"),
        fileURLToPath(source("03_CLARK_FEMM_2D.zip")),
        reference,
      ],
      { encoding: "utf8", maxBuffer: 4 * 1024 ** 2 },
    );
    // Native JSON writers may persist signed zero in an unexcited winding.
    const saved = JSON.parse(output, (_key, value) => Object.is(value, -0) ? 0 : value);
    for (const name of ["general", "kvs", "conrab", "tks", "mhj", "moves", "amplitudes"])
      assert.deepEqual(table(result, name), saved[name]);
    for (const name of Object.keys(saved).filter((key) => key.startsWith("xapLibFMM/")))
      assert.deepEqual(table(result, name)[0].tabl, saved[name][0].tabl);
  });
}
test("changing a FEMM excitation scales signed current density and a different cross section is rejected", async () => {
  const text = await read("TVV320_1.fem", "utf8");
  const args = { source: text, profile, length: 6000, filename: "custom.fem" };
  const original = await importFemm(args);
  const currents = { ...femmCurrents(text), F: 1460 };
  const modified = await importFemm({ ...args, currents, length: 8000 });
  assert.deepEqual(
    table(modified, "mhj")[0].v,
    table(original, "mhj")[0].v.map((v) => v / 2),
  );
  assert.equal(Math.abs(table(modified, "kvs")[0].geo[0]), 4000);
  await assert.rejects(importFemm({ ...args, source: text.replace("[Frequency]", "[Changed]") }), /профиля/);
  await assert.rejects(importFemm({ ...args, length: 100 }), /длина/);
});
test("STEP bodies retain their bounds, discretization and prescribed field, and unsupported solids fail", async () => {
  const occt = await initOcct();
  const model = occt.ReadStepFile(await read("magnet.step"), { linearUnit: "millimeter" });
  const options = { filename: "magnet.step", dp: [3, 4, 1], mz: 720 };
  const imported = importStepMeshes(model, options);
  const [kv] = table(imported, "kvs");
  assert.deepEqual(kv.dr, [-10, -20, -5]);
  assert.deepEqual(kv.geo.slice(0, 3), [20, 40, 10]);
  assert.deepEqual(kv.dp, options.dp);
  assert.deepEqual(table(imported, "mhj")[0].v, [...Array(24).fill(0), ...Array(12).fill(720)]);
  const body = model.meshes[0];
  assert.throws(() => importStepMeshes({ ...model, meshes: [body, body] }, options), /пересекаются/);
  assert.throws(
    () =>
      importStepMeshes({ ...model, meshes: [{ ...body, brep_faces: body.brep_faces.slice(1) }] }, options),
    /шесть/,
  );
  assert.throws(() => importStepMeshes(model, { ...options, dp: [1, 1, 1e9] }), /32 МиБ/);
});
test("the mesh protocol accepts the native Gmsh example and rejects a renamed non-mesh", async () => {
  const file = new File([await read("frame.msh")], "frame.msh");
  const data = await buildMeshRequest({ file, title: "Рамка", description: "Пять крупных блоков" });
  assert.ok(data.zip.size > file.size);
  await assert.rejects(buildMeshRequest({ file: new File(["not a mesh"], "other.msh") }), /заголовок/);
});
