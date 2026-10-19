// Actual Solid UI and native OPFS; no solver or OS directory picker is required.
import { createServer } from "vite";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = process.env.CHECK_OUTPUT || "/tmp/editor-om-panel";
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const checks = [], errors = [];
let server, browser;
const passed = name => { checks.push(name); console.log(`PASS ${checks.length}: ${name}`); };
try {
  server = await createServer({ root, server: { port: 0, strictPort: false }, cacheDir: "/tmp/editor-om-panel-vite" });
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 600 } });
  page.setDefaultTimeout(10000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/test/browser/omModelPanel.html`);
  const button = name => page.getByRole("button", { name, exact: true });
  const field = name => page.getByRole("spinbutton", { name, exact: true });
  const dataJSON = () => page.locator(".om-client-data");
  const couplingJSON = () => page.locator(".om-client-coupling");
  const current = async () => { await button("JSON").click(); return { data: JSON.parse(await dataJSON().inputValue()), coupling: JSON.parse(await couplingJSON().inputValue()) }; };
  const form = () => button("Параметры и связи").click();
  const edit = async (name, value) => { await field(name).fill(String(value)); await field(name).blur(); };
  const read = name => page.evaluate(name => omPanelFixture.read(name), name);
  await field("Число фаз").waitFor();
  assert.equal(await field("Число фаз").inputValue(), "3");
  const coil = page.getByRole("combobox", { name: "PSI · fieldPort.flux[1]", exact: true });
  assert.match((await coil.locator("option").allTextContents()).join("|"), /№2 — Статор A, Статор B/);
  assert.equal(await coil.locator("option[value='2']").count(), 1);
  assert.equal(await page.locator(".om-client-data").count(), 0);
  passed("Default form and grouped coil names at 1100×600");
  const pulseBefore = await read("amplitudes.txt");
  await edit("Индуктивность · Фаза 1 · Ветвь 1", 0.125);
  let value = await current();
  assert.equal(value.data.branches[0].L_H, 0.125);
  assert.deepEqual(value.data.extension, { untouched: "vendor data" });
  value.data.extension.fromJSON = 123;
  await dataJSON().fill(JSON.stringify(value.data)); await form();
  assert.equal(await field("Индуктивность · Фаза 1 · Ветвь 1").inputValue(), "0.125");
  passed("Form/JSON share a draft and retain unknown fields");

  await edit("Ветвей на фазу", 2);
  value = await current();
  assert.deepEqual(value.coupling.inputs[0].indices, [1, null, 2, null, 3, null]);
  assert.deepEqual(value.data.branches.filter((_, i) => i % 2 === 0).map(row => row.R_Ohm), [10, 11, 12]);
  await form(); assert.equal(await button("Сохранить").isDisabled(), true);
  await edit("Ветвей на фазу", 1);
  await button("Отмена").click();
  assert.equal(await field("Ветвей на фазу").inputValue(), "2");
  value = await current(); assert.equal(value.data.branches.length, 6); await form();
  await edit("Ветвей на фазу", 1); await button("Продолжить").click();
  value = await current();
  assert.deepEqual(value.coupling.inputs[0].indices, [1, 2, 3]);
  assert.deepEqual(value.coupling.outputs[0].indices, [2, 7, 9]); await form();
  passed("Coordinate-preserving resize, empty new links, cancel and confirmed reduction");

  value = await current(); value.coupling.outputs[0].indices[0] = 999;
  await couplingJSON().fill(JSON.stringify(value.coupling)); await form();
  assert.equal(await coil.getAttribute("aria-invalid"), "true");
  assert.match(await coil.locator("option:checked").textContent(), /999.*отсутствует/);
  assert.equal(await button("Сохранить").isDisabled(), true);
  await coil.selectOption("2"); assert.equal(await coil.getAttribute("aria-invalid"), "false");
  passed("Missing object remains explicit until user chooses a replacement");

  await page.evaluate(() => omPanelFixture.setDirtyParts(["elements"]));
  assert.equal(await button("Сохранить").isDisabled(), true);
  await page.evaluate(() => omPanelFixture.setDirtyParts([]));
  await button("Сохранить").click();
  await page.waitForFunction(() => !omPanelFixture.state().busy && !omPanelFixture.state().dirty);
  const saved = JSON.parse(await read("circuit-config.json"));
  assert.equal(saved.branches[0].L_H, 0.125); assert.equal(saved.extension.fromJSON, 123);
  assert.equal(await read("amplitudes.txt"), pulseBefore);
  await button("Перечитать").click(); await field("Число фаз").waitFor();
  assert.equal(await field("Индуктивность · Фаза 1 · Ветвь 1").inputValue(), "0.125");
  passed("Task dirty guard, native OPFS save/reload, unchanged pulse bank");
  await page.screenshot({ path: `${output}/circuit-panel.png` });
  await page.locator('.om-model-form').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await page.screenshot({ path: `${output}/bindings-panel.png` });

  const custom = { schema: "clark-om-preset/2", label: "Контроллер — проверка",
    selection: { schema: "clark-om-client/1", model: "controller", dataFile: "controller.json", couplingFile: "server-config.json" },
    data: { schema: "controller/1", gain: 4, mode: "fast", acceptanceTolerance: 1e-6, integrationTolerance: 1e-10 },
    coupling: { schema: "clark-server/1", inputs: [{ kind: "AMP", indices: [1] }], outputs: [{ kind: "PSI", indices: [2] }] },
    contract: { dataSchema: "controller/1", structural: {}, dimensions: {}, arraySizes: {}, tables: [],
      parameterBindings: [{ parameter: "gain", path: ["gain"], type: "real", minimum: 0 }],
      inputs: [{ kind: "AMP", variables: ["drive"] }], outputs: [{ kind: "PSI", variables: ["measurement"] }],
      ui: { schema: "clark-om-panel/1", groups: [{ id: "control", label: "Регулятор", fields: [
        { path: ["gain"], label: "Усиление" }, { path: ["mode"], label: "Режим", type: "string",
          options: [{ value: "fast", label: "Быстрый" }, { value: "slow", label: "Медленный" }] },
      ] }] } } };
  await page.locator("input[type=file]").setInputFiles({ name: "editor-preset.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(custom)) });
  await page.getByRole("combobox", { name: "Шаблон для применения" }).selectOption({ label: custom.label });
  await button("Применить").click(); await button("Отмена").click(); await field("Число фаз").waitFor();
  await button("Применить").click(); await button("Продолжить").click();
  await field("Усиление").waitFor();
  assert.equal(await field("Число фаз").count(), 0);
  await page.getByRole("combobox", { name: "Режим", exact: true }).selectOption('"slow"');
  await edit("Усиление", 8); await button("Сохранить").click();
  await page.waitForFunction(() => !omPanelFixture.state().busy && !omPanelFixture.state().dirty);
  assert.equal(JSON.parse(await read("controller.json")).mode, "slow");
  assert.equal(JSON.parse(await read("controller.json")).gain, 8);
  assert.equal(JSON.parse(await read("om-client.json")).model, "controller");
  assert.deepEqual(JSON.parse(await read("circuit-config.json")), saved);
  passed("Imported different model replaces its panel only after confirmation and saves its own JSON");

  delete custom.contract.ui; custom.label = "Контроллер без панели";
  await page.locator("input[type=file]").setInputFiles({ name: "editor-preset.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(custom)) });
  await dataJSON().waitFor(); assert.equal(await button("Параметры и связи").isDisabled(), true);
  assert.equal(JSON.parse(await dataJSON().inputValue()).gain, 8);
  passed("Legacy preset falls back to JSON without replacing task values");
  assert.deepEqual(errors, []);
  await writeFile(`${output}/result.json`, JSON.stringify({ checks, errors }, null, 2));
} finally { await browser?.close(); await server?.close(); }
