import { createServer } from "vite";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({ root, server: { host: "127.0.0.1", port: 0 }, plugins: [{
  name: "launch-controls-fixture", configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (req.url !== "/__launch-controls") return next();
      res.setHeader("Content-Type", "text/html");
      res.end(await server.transformIndexHtml(req.url,
        '<html><body><div id="root"></div><script type="module" src="/test/browser/taskLaunchControls.fixture.jsx"></script></body></html>'));
    });
  },
}] });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
  headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(12000);
const errors = []; page.on("pageerror", error => errors.push(error.message));
const nativeLaunches = [];
const cdp = await page.context().newCDPSession(page);
await cdp.send("Page.enable");
cdp.on("Page.frameRequestedNavigation", event => {
  if (event.url.startsWith("clark://")) nativeLaunches.push(event.url);
});
let checks = 0;
const check = (name, value) => { assert.ok(value, name); checks++; console.log("PASS", name); };
const start = page.locator(".task-launch-start"), remove = page.locator(".task-launch-remove");
const refresh = page.getByRole("button", { name: "Обновить состояние расчета заданий", exact: true });
const mpi = page.getByRole("textbox", { name: "Число процессов MPI", exact: true });
const mode = name => page.getByRole("radio", { name, exact: true });
const ready = () => page.waitForFunction(() => {
  const button = document.querySelector(".task-launch-start");
  return button && !button.disabled;
});
const idle = () => page.waitForFunction(() => !document.querySelector(".task-launch-remove")?.disabled);
const reason = pattern => page.waitForFunction(pattern => document.querySelector(".task-launch-start").disabled
  && new RegExp(pattern).test(document.querySelector(".task-launch-start").title), pattern);
const editable = async () => await remove.first().isEnabled() && await refresh.isEnabled()
  && await page.getByRole("radio").evaluateAll(inputs => inputs.every(input => !input.disabled));
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__launch-controls`);
  await ready();
  check("ready queue enables launch and local controls", await start.isEnabled() && await editable() && await mpi.isEnabled());
  const proof = await page.evaluate(() => controls.proof());
  await page.locator(".task-launch-row .task-status-name").dblclick(); await idle(); await ready();
  check("navigation preserves the prepared request without browser refocus", (await page.evaluate(() => controls.proof())).requestId === proof.requestId);
  await page.evaluate(() => controls.workspace({ bindingState: "pending" })); await reason("Свяжите");
  check("missing binding blocks launch but leaves list editing and MPI available", await editable() && await mpi.isEnabled());
  await page.evaluate(() => controls.workspace({ bindingState: "bound", workspaceId: crypto.randomUUID() })); await ready();
  check("a new binding automatically prepares a request", await start.isEnabled());
  await page.evaluate(async () => { controls.bindingBusy(true); await controls.workspace({ workspaceId: crypto.randomUUID() }); });
  check("binding in progress locks mutable controls", await start.isDisabled() && await mpi.isDisabled()
    && await remove.first().isDisabled() && await refresh.isDisabled() && await mode("расчёт").isDisabled());
  await page.evaluate(() => controls.bindingBusy(false)); await ready();
  check("readiness recovers after binding finishes without a focus event", await editable());
  await page.evaluate(async () => {
    await controls.workspace({ taskQueueVersion: undefined });
    await controls.queue(["Project/One", "../clark.other/Project/One"]);
  }); await reason("нескольких каталогов"); await idle();
  let attempts = await page.evaluate(() => controls.attempts()); await page.waitForTimeout(150);
  check("unsupported cross-catalog launch explains the reason without a retry loop", await editable()
    && await page.evaluate(() => controls.attempts()) === attempts);
  await page.evaluate(() => controls.workspace({ taskQueueVersion: 1 })); await ready();
  check("cross-catalog readiness recovers when launcher support appears", await start.isEnabled());
  await page.evaluate(() => controls.queue(["Project/One"])); await ready();
  await mpi.fill("0"); await reason("Число процессов");
  check("invalid MPI blocks launching, not list editing or mode selection", await editable() && await mpi.isEnabled());
  await mode("импорт").check(); await ready();
  check("import ignores MPI errors and disables the MPI field", await mpi.isDisabled());
  await start.click();
  check("import confirmation remains available with MPI excluded", await page.getByRole("button", { name: "Выполнить импорт", exact: true }).isEnabled());
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  await mode("расчёт").check(); await reason("Число процессов"); await mpi.fill("default"); await ready();
  await page.evaluate(() => controls.workspace({ launchOptionsVersion: undefined })); await ready();
  check("legacy launcher still accepts default MPI", await start.isEnabled());
  await mpi.fill("2"); await reason("выбора числа процессов");
  check("an unsupported explicit MPI override gives a specific reason", await mpi.isEnabled());
  await mpi.fill("default"); await ready();
  await page.evaluate(() => controls.workspace({ launchOptionsVersion: 1 })); await mpi.fill("2"); await ready();
  check("a supported explicit MPI override enables launch", await start.isEnabled());
  await mode("ОМ клиент").check(); await ready();
  await page.evaluate(() => controls.queue(["Project/One", "Project/Two"])); await reason("ровно одно задание"); await idle();
  check("OM mode requires one queued task while removal remains active", await editable() && await mpi.isEnabled());
  await remove.last().click(); await ready();
  check("removing the extra OM task automatically restores launch", await remove.count() === 1);
  await mode("расчёт").check();
  await page.evaluate(() => { controls.loaded("clark.projects/Project/Two", true); controls.blocked("Сохраните изменения OM-модели"); }); await ready();
  check("editor and OM drafts outside the queue do not block launching", await start.isEnabled());
  await page.evaluate(() => controls.loaded("clark.projects/Project/One")); await reason("OM-модели");
  check("an OM draft belonging to a queued task blocks launch", await editable());
  await page.evaluate(() => controls.blocked("")); await ready();
  await page.evaluate(() => controls.loaded("clark.projects/Project/One", true)); await reason("Сохраните изменения задания");
  check("queued editor changes offer saving while launch is blocked", await page.getByRole("button", { name: "Сохранить модель", exact: true }).isEnabled());
  await page.getByRole("button", { name: "Сохранить модель", exact: true }).click(); await ready();
  check("saving the queued model restores launch", await start.isEnabled());
  await page.evaluate(async () => { controls.denyProof(true); await controls.workspace({ workspaceId: crypto.randomUUID() }); });
  await reason("Не удалось подготовить запуск"); await idle();
  attempts = await page.evaluate(() => controls.attempts()); await page.waitForTimeout(150);
  check("preparation errors leave editing available and do not spin", await editable()
    && await page.evaluate(() => controls.attempts()) === attempts);
  await page.evaluate(() => { controls.denyProof(false); window.dispatchEvent(new Event("focus")); }); await ready();
  check("restored file access clears the preparation error", await page.locator(".task-launch-error").count() === 0);
  await start.click();
  check("native acceptance wait locks all mutable launch controls", await start.isDisabled() && await mpi.isDisabled()
    && await remove.first().isDisabled() && await refresh.isDisabled() && await mode("расчёт").isDisabled());
  check("the idle launch opens one native request", nativeLaunches.length === 1);
  await page.evaluate(() => controls.respond("accepted")); await ready();
  check("native acceptance releases queue controls", await editable());
  const acceptedProof = await page.evaluate(() => controls.proof());
  for (const name of ["расчёт", "ОМ клиент", "импорт"]) {
    await mode(name).check(); await start.click();
    const dialog = page.getByRole("dialog", { name: "Задание выполняется", exact: true });
    await dialog.waitFor({ state: "visible" });
    check(`an accepted run blocks ${name} with a close-only modal`, /до окончания текущего расчёта/.test(await dialog.innerText())
      && await dialog.getByRole("button", { name: "Закрыть", exact: true }).count() === 1
      && await dialog.getByRole("button").count() === 1 && nativeLaunches.length === 1
      && await page.locator(".task-launch-import-confirm").count() === 0);
    if (name === "расчёт" && process.env.TASK_LAUNCH_MODAL_SCREENSHOT) {
      await page.screenshot({ path: process.env.TASK_LAUNCH_MODAL_SCREENSHOT });
    }
    await dialog.getByRole("button", { name: "Закрыть", exact: true }).click();
    check(`closing the ${name} warning restores focus to Start`, await start.evaluate(button => button === document.activeElement));
  }
  check("blocked attempts preserve the prepared request", (await page.evaluate(() => controls.proof())).requestId === acceptedProof.requestId);
  await page.evaluate(() => controls.respond("completed"));
  await page.waitForFunction(() => document.querySelector(".task-launch-notice")?.textContent === "Native completed"); await ready();
  await mode("расчёт").check();
  await page.evaluate(() => controls.active(true));
  await page.waitForFunction(() => !document.querySelector(".iteration-control-submit").disabled);
  await page.reload(); await ready();
  await page.waitForFunction(() => !document.querySelector(".iteration-control-submit").disabled);
  await start.click();
  const activeDialog = page.getByRole("dialog", { name: "Задание выполняется", exact: true });
  await activeDialog.waitFor({ state: "visible" });
  check("a live native task blocks launching after page reload without an in-memory pending run", nativeLaunches.length === 1);
  await page.keyboard.press("Escape");
  check("Escape closes the active-task warning and restores focus", await activeDialog.isHidden()
    && await start.evaluate(button => button === document.activeElement));
  await page.evaluate(() => controls.active(false));
  await page.waitForFunction(() => document.querySelector(".iteration-control-submit").disabled);
  await mode("импорт").check(); await start.click();
  await page.evaluate(() => controls.active(true));
  await page.waitForFunction(() => !document.querySelector(".iteration-control-submit").disabled);
  await page.getByRole("button", { name: "Выполнить импорт", exact: true }).click();
  await activeDialog.waitFor({ state: "visible" });
  check("an active task appearing during import confirmation also prevents native launch", nativeLaunches.length === 1
    && await page.locator(".task-launch-import-confirm").count() === 0);
  await activeDialog.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.evaluate(() => controls.active(false));
  await page.waitForFunction(() => document.querySelector(".iteration-control-submit").disabled);
  await mode("расчёт").check();
  await start.click();
  check("a completed native task permits the next launch", nativeLaunches.length === 2 && await start.isDisabled());
  await page.evaluate(() => controls.respond("accepted")); await ready();
  await page.evaluate(() => controls.respond("completed"));
  await page.waitForFunction(() => document.querySelector(".task-launch-notice")?.textContent === "Native completed"); await ready();
  await remove.first().click();
  await page.waitForFunction(() => !document.querySelector(".task-launch-row"));
  check("empty queue disables launch and refresh while MPI and modes remain editable", await start.isDisabled()
    && await refresh.isDisabled() && await mpi.isEnabled() && await mode("ОМ клиент").isEnabled());
  check("no browser exceptions", errors.length === 0);
  console.log(`Task launch controls PASS: ${checks} checks`);
} finally { await browser.close(); await server.close(); }
