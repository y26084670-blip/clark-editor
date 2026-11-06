import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { preview } from "vite";

// Run after npm run build:pages. Exercises the shipped app and its hashed HTML
// asset at the Pages base path, including real playback and native dialog ESC.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = process.env.CHECK_OUTPUT || "/tmp/clark-about-horse-check";
const base = process.env.CHECK_BASE || "/clark-editor/";
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const server = await preview({ root, base, preview: { host: "127.0.0.1", port: 0, strictPort: false } });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, headless: true,
  args: [...JSON.parse(process.env.CHROMIUM_ARGS || "[]"), "--no-sandbox", "--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(() => localStorage.setItem("e3d.generalInformation.openAtStartup", "false"));
const page = await context.newPage();
const errors = [];
const sceneRequests = [];
page.on("pageerror", error => errors.push(error.message));
page.on("request", request => { if (/horse-scene.*\.html/.test(request.url())) sceneRequests.push(request.url()); });
const panel = page.locator(".about-dialog");
const eye = page.locator(".about-horse-button");
const content = page.locator(".about-content");
const frameElement = page.locator(".about-horse-frame");
const near = (a, b, label) => assert.ok(Math.abs(a - b) < 0.1, `${label}: ${a} vs ${b}`);
async function noSceneListeners() {
  assert.equal(await page.evaluate(() => window.horseListeners.size()), 0,
    "scene and bridge release every parent listener");
}
async function sameRect(expected, label) {
  const actual = await panel.boundingBox();
  for (const key of ["x", "y", "width", "height"]) near(actual[key], expected[key], `${label} ${key}`);
}
async function openPanel() {
  await page.locator(".about-button").click();
  await page.locator(".about-dialog[open]").waitFor();
}
async function start() {
  await eye.click();
  const frame = await (await frameElement.elementHandle()).contentFrame();
  await frame.waitForFunction(() => window.HorseScene?.getState().state === "playing");
  await page.waitForFunction(() => document.activeElement === document.querySelector(".about-horse-frame"));
  await frameElement.evaluate(el => {
    window.testHorseAPI = el.contentWindow.HorseScene;
    window.testHorseSource = el.contentWindow;
  });
  return frame;
}
async function expectClosed(reason) {
  // Native dialog.close() clears open synchronously, then dispatches close.
  await page.waitForFunction(() => !document.querySelector(".about-dialog").open
    && !document.querySelector(".about-horse-frame"));
  assert.equal(await frameElement.count(), 0);
  assert.equal(await content.evaluate(el => el.inert), false);
  const state = await page.evaluate(() => window.testHorseAPI.getState());
  assert.equal(state.reason, reason);
  assert.equal(state.renderer, null);
  assert.ok(await page.locator(".about-button").evaluate(el => document.activeElement === el));
  await noSceneListeners();
}

try {
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  await page.goto(`${origin}${base}`);
  await page.locator(".task-info-bar--aligned").waitFor();
  const access = page.locator(".task-access-dialog[open]");
  if (await access.count()) await access.getByRole("button", { name: "Закрыть", exact: true }).click();
  assert.equal(sceneRequests.length, 0, "the scene is not loaded with the application");
  await openPanel();
  await panel.evaluate(owner => {
    const records = [];
    for (const target of [window, owner]) {
      const add = target.addEventListener.bind(target), remove = target.removeEventListener.bind(target);
      target.addEventListener = (type, listener, options) => {
        if (["pointermove", "pointerdown", "pointerup", "pointercancel", "pointerleave", "blur", "message"].includes(type)) {
          records.push({ target, type, listener, capture: options === true || !!options?.capture });
        }
        add(type, listener, options);
      };
      target.removeEventListener = (type, listener, options) => {
        const capture = options === true || !!options?.capture;
        const index = records.findIndex(record => record.target === target && record.type === type
          && record.listener === listener && record.capture === capture);
        if (index !== -1) records.splice(index, 1);
        remove(type, listener, options);
      };
    }
    window.horseListeners = { size: () => records.length };
  });
  assert.equal(sceneRequests.length, 0, "opening About does not preload the scene");
  const original = await panel.boundingBox();
  const heading = await page.locator(".about-title").boundingBox();
  const eyeBounds = await eye.boundingBox();
  assert.ok(eyeBounds.x > heading.x + heading.width, "eye is to the right of the title");
  await page.screenshot({ path: `${output}/about.png` });

  let frame = await start();
  assert.equal(await content.evaluate(el => el.inert), true);
  await sameRect(original, "during playback");
  const frameBounds = await frameElement.boundingBox();
  near(frameBounds.x, original.x + 1, "iframe starts at the inner border");
  near(frameBounds.y, original.y + 1, "iframe fills panel height");
  near(frameBounds.width, original.width - 2, "iframe fills panel width");
  near(frameBounds.height, original.height - 2, "iframe fills panel height");
  assert.ok(await panel.evaluate(el => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight), "no panel scrollbars");
  await eye.evaluate(el => { el.click(); el.click(); });
  assert.equal(await frameElement.count(), 1, "repeated activation creates no second iframe");
  const state = await frame.evaluate(() => window.HorseScene.getState());
  console.log("PASS lazy load, unchanged panel bounds, inert content, single scene; renderer:", state.renderer);
  const assetResponse = await page.request.get(sceneRequests[0]);
  assert.equal(assetResponse.status(), 200);
  assert.deepEqual(await assetResponse.body(), await readFile(new URL("../src/assets/horse-scene.html", import.meta.url)), "production asset is byte-identical");
  assert.ok(new URL(sceneRequests[0]).pathname.startsWith(`${base}assets/`), "asset respects the deployment base");

  await page.evaluate(() => {
    const source = document.querySelector(".about-horse-frame").contentWindow;
    const valid = { channel: "horse-scene", version: 1, type: "ended", reason: "escape" };
    for (const [origin, sender, data] of [
      [location.origin, window, valid], ["https://invalid.example", source, valid],
      [location.origin, source, { ...valid, channel: "other" }],
      [location.origin, source, { ...valid, version: 2 }],
    ]) window.dispatchEvent(new MessageEvent("message", { origin, source: sender, data }));
  });
  assert.equal(await frameElement.count(), 1, "unrelated messages are ignored");
  await frame.waitForFunction(() => window.HorseScene.getState().time >= 9);
  await page.screenshot({ path: `${output}/horse.png` });
  await frame.waitForFunction(() => window.HorseScene.getState().phase === "interactive", null, { timeout: 20000 });
  assert.equal(await frame.evaluate(() => window.HorseScene.getState().introDuration), 18);
  assert.equal(await frame.evaluate(() => window.HorseScene.getState().duration), null);
  await frame.waitForFunction(() => window.HorseScene.getState().time >= 25, null, { timeout: 15000 });
  assert.equal(await frameElement.count(), 1, "interactive scene remains after the old 24-second endpoint");

  // Observe the real bridge API without changing scene behavior. Parent events
  // represent the owner's header/border; iframe events use its own handlers.
  await frame.evaluate(() => {
    const api = window.HorseScene;
    window.bridgeSamples = [];
    window.HorseScene = { ...api, pointer: data => { window.bridgeSamples.push(data); return api.pointer(data); } };
  });
  const clickSamples = await panel.evaluate(owner => {
    const frame = owner.querySelector("iframe"), rect = frame.getBoundingClientRect();
    for (const [type, buttons] of [["pointerdown", 1], ["pointerup", 0]]) {
      owner.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: rect.left + rect.width * .85,
        clientY: rect.top + rect.height * .35, buttons }));
    }
    return frame.contentWindow.bridgeSamples.slice(-2);
  });
  assert.deepEqual(clickSamples.map(sample => [sample.eventType, sample.buttons, sample.inside]),
    [["pointerdown", 1, true], ["pointerup", 0, true]], "short clicks reach the scene synchronously");
  near(clickSamples[0].x, .85, "bridge normalized x");
  near(clickSamples[0].y, .35, "bridge normalized y");
  assert.equal(await frame.evaluate(() => window.HorseScene.getState().headTracking), true);
  await panel.evaluate(owner => owner.dispatchEvent(new Event("pointerleave")));
  assert.deepEqual(await frame.evaluate(() => {
    const last = window.bridgeSamples.at(-1); return [last.inside, last.buttons];
  }), [false, 0]);
  assert.equal(await frame.evaluate(() => window.HorseScene.getState().headTracking), false);
  await panel.evaluate(owner => {
    const rect = owner.querySelector("iframe").getBoundingClientRect();
    owner.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: rect.left + rect.width * .9,
      clientY: rect.top + rect.height * .3, buttons: 1 }));
  });
  await frame.waitForFunction(() => window.bridgeSamples.at(-1)?.buttons === 1);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  assert.deepEqual(await frame.evaluate(() => {
    const last = window.bridgeSamples.at(-1); return [last.inside, last.buttons];
  }), [false, 0], "focus loss clears held buttons");
  // The iframe itself receives actual browser pointer input.
  await page.mouse.click(frameBounds.x + frameBounds.width * .85, frameBounds.y + frameBounds.height * .35);
  assert.equal(await frame.evaluate(() => window.HorseScene.getState().headTracking), true);
  await page.screenshot({ path: `${output}/interactive.png` });
  console.log("PASS 18-second intro, unlimited interaction, short clicks, owner coordinates, iframe input, leave and blur");

  // Keep moving over the projected body as it retreats. The real scene owns
  // all departure/return/dissolve transitions and emits completed itself.
  await frame.evaluate(() => {
    window.retreatDriver = setInterval(() => {
      if (!["interactive", "backing"].includes(window.HorseScene.getState().phase)) {
        clearInterval(window.retreatDriver); return;
      }
      for (let y = .15; y < .96; y += .1) for (let x = .1; x < .96; x += .1) {
        window.HorseScene.pointer({ x, y, inside: true, buttons: 0, eventType: "pointermove" });
      }
    }, 120);
  });
  await frame.waitForFunction(() => window.HorseScene.getState().phase === "turning", null, { timeout: 15000 });
  assert.equal(await frameElement.count(), 1, "departure notification does not remove the scene");
  await page.waitForFunction(() => !document.querySelector(".about-horse-frame"), null, { timeout: 45000 });
  assert.ok(await panel.evaluate(el => el.open), "natural completion leaves About open");
  assert.equal(await content.evaluate(el => el.inert), false);
  assert.ok(await eye.evaluate(el => document.activeElement === el), "focus returns to the eye");
  assert.equal(await page.evaluate(() => window.testHorseAPI.getState().reason), "completed");
  assert.equal(await page.evaluate(() => window.testHorseAPI.getState().renderer), null);
  await sameRect(original, "after completion");
  await noSceneListeners();
  console.log("PASS real retreat, return, dissolution, completed, resource release and restored focus");

  frame = await start();
  assert.ok(await frame.evaluate(() => window.HorseScene.getState().time < 2), "restart begins at zero");
  const closeCountBefore = await panel.evaluate(el => {
    el.dataset.closeCount = "0";
    el.addEventListener("close", () => { el.dataset.closeCount = String(Number(el.dataset.closeCount) + 1); });
    return Number(el.dataset.closeCount);
  });
  await page.keyboard.press("Escape");
  await expectClosed("escape");
  assert.equal(await panel.evaluate(el => Number(el.dataset.closeCount)), closeCountBefore + 1);
  console.log("PASS ESC from iframe closes the panel once and frees the renderer");

  await openPanel();
  await start();
  await panel.evaluate(el => { el.tabIndex = -1; el.focus(); });
  assert.ok(await panel.evaluate(el => document.activeElement === el));
  await page.keyboard.press("Escape");
  await expectClosed("panel-close");
  console.log("PASS native dialog ESC with focus in the parent document");

  await openPanel();
  await start();
  await panel.evaluate(el => el.close());
  await expectClosed("panel-close");
  console.log("PASS external dialog.close() also cleans up the scene");

  await openPanel();
  await start();
  await frameElement.evaluate(el => { window.staleHorseSource = el.contentWindow; });
  await page.keyboard.press("Escape");
  await openPanel();
  await start();
  await page.evaluate(() => window.dispatchEvent(new MessageEvent("message", {
    origin: location.origin, source: window.staleHorseSource,
    data: { channel: "horse-scene", version: 1, type: "ended", reason: "escape" },
  })));
  assert.equal(await frameElement.count(), 1, "old scene cannot close a new instance");
  await page.keyboard.press("Escape");
  console.log("PASS repeated reopening and stale-source filtering");

  // Hold the request so ESC is exercised before the scene API exists.
  let releaseRequest;
  const held = new Promise(resolve => { releaseRequest = resolve; });
  await page.route("**/horse-scene*.html*", async route => { await held; await route.abort().catch(() => {}); });
  await openPanel();
  await eye.click();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".about-dialog").open);
  assert.equal(await frameElement.count(), 0);
  assert.equal(await content.evaluate(el => el.inert), false);
  await noSceneListeners();
  releaseRequest();
  await page.unrouteAll({ behavior: "wait" });
  console.log("PASS immediate close while the iframe is loading");

  // Real renderer failure: throw during renderer initialization, preserving its
  // own catch/error protocol rather than substituting a fabricated ended event.
  await page.route("**/horse-scene*.html*", async route => {
    const source = await readFile(new URL("../src/assets/horse-scene.html", import.meta.url), "utf8");
    await route.fulfill({ contentType: "text/html", body: source.replace("<head>",
      '<head><script>HTMLCanvasElement.prototype.getContext = () => { throw new Error("test render failure"); };</script>') });
  });
  await openPanel();
  await eye.click();
  await page.getByText("Не удалось показать сцену «Лошадь». Попробуйте открыть её снова.", { exact: true }).waitFor();
  assert.equal(await frameElement.count(), 0);
  assert.equal(await content.evaluate(el => el.inert), false);
  await noSceneListeners();
  await page.locator(".modal-window[open]").getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.unrouteAll({ behavior: "wait" });
  console.log("PASS scene initialization error restores content and shows the standard notice");

  // HTTP failures and SPA fallbacks need a finite timeout even if iframe.error
  // is never fired. Let the actual 20-second timeout expire.
  await page.route("**/horse-scene*.html*", route => route.fulfill({ status: 404, contentType: "text/html", body: "Not found" }));
  await eye.click();
  await page.getByText("Не удалось загрузить сцену «Лошадь». Попробуйте открыть её снова.", { exact: true }).waitFor({ timeout: 25000 });
  assert.equal(await frameElement.count(), 0);
  assert.equal(await content.evaluate(el => el.inert), false);
  await noSceneListeners();
  await page.locator(".modal-window[open]").getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.unrouteAll({ behavior: "wait" });
  await start();
  await page.keyboard.press("Escape");
  await expectClosed("escape");
  console.log("PASS missing-ready timeout and successful retry");

  assert.deepEqual(errors, []);
  console.log(`PASS all About/horse scenarios; screenshots: ${output}`);
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` });
  console.error("Dialog state:", await page.locator(".about-dialog, .modal-window").evaluateAll(elements =>
    elements.map(el => ({ class: el.className, open: el.open, text: el.textContent.slice(0,150) }))));
  console.error("Frames:", page.frames().map(frame => frame.url()));
  throw error;
} finally {
  await context.close();
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
