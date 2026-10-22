import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = process.env.CHECK_OUTPUT || "/tmp/clark-editor-header-check";
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const server = await createServer({ root, cacheDir: `${output}/vite-cache`, server: { host: "127.0.0.1", port: 0 },
  plugins: [{ name: "editor-header-fixture", configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (req.url !== "/__header") return next();
      res.setHeader("Content-Type", "text/html");
      res.end(await server.transformIndexHtml(req.url, '<html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/test/browser/editorHeader.fixture.jsx"></script></body></html>'));
    });
  } }],
});
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, headless: true,
  args: [...JSON.parse(process.env.CHROMIUM_ARGS || "[]"), "--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const near = (a, b, label) => assert.ok(Math.abs(a - b) < 1, `${label}: ${a} vs ${b}`);
const selectors = {
  geometry: ".geometry-button", validate: ".model-validation-button", save: ".save-button", quick: ".general-information-button",
  news: ".whats-new-button", about: ".about-button", docs: ".documentation-button", leading: ".task-info-leading",
  trajectory: '[data-tab-id="moves"]', sources: '[data-tab-id="mhj"]', fmm: '[data-tab-id="fmmLibrary"]',
  hts: '[data-tab-id="htsLibrary"]', settings: '[data-tab-id="conrab"]',
};
async function check(label) {
  await page.waitForFunction(() => {
    const docs = document.querySelector(".documentation-button")?.getBoundingClientRect();
    const settings = document.querySelector('[data-tab-id="conrab"]')?.getBoundingClientRect();
    return docs && settings && Math.abs(docs.left - settings.left) < 1;
  });
  const rects = await page.evaluate(selectors => Object.fromEntries(Object.entries(selectors).map(([name, selector]) => {
    const rect = document.querySelector(selector).getBoundingClientRect();
    return [name, { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width }];
  })), selectors);
  near(rects.docs.left, rects.settings.left, "Documentation/Settings left");
  near(rects.docs.right, rects.settings.right, "Documentation/Settings right");
  near(rects.about.right, rects.hts.right, "About/HTS right");
  near(rects.save.left, rects.fmm.left, "Save/FMM left");
  near(rects.quick.right, rects.fmm.right, "Quick start/FMM right");
  near(rects.validate.left, rects.sources.left, "Validate/Sources left");
  near(rects.geometry.right, rects.trajectory.right, "3D/Trajectory right");
  const order = ["leading", "geometry", "validate", "save", "quick", "news", "about", "docs"];
  for (let i = 1; i < order.length; i++) assert.ok(rects[order[i - 1]].right <= rects[order[i]].left + 1, `overlap ${order[i - 1]}/${order[i]}: ${JSON.stringify(rects)}`);
  console.log("PASS", label);
}
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__header`);
  await page.waitForFunction(() => window.headerFixture?.ready);
  const access = page.locator(".task-access-dialog[open]");
  if (await access.count()) await access.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.evaluate(() => headerFixture.setPath("clark.projects / Проект / Задание с длинным названием для проверки строки пути"));
  for (const width of [1440, 1920, 1100]) {
    await page.setViewportSize({ width, height: 900 });
    await check(`header alignment and non-overlap at ${width}px`);
    await page.screenshot({ path: `${output}/header-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('[data-tab-id="htsLibrary"]').click();
  await check("alignment follows active-tab font changes");
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.locator(".tabs-header").evaluate(el => { el.scrollLeft = el.scrollWidth; });
  await check("alignment follows horizontal tab scrolling");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator(".tabs-header").evaluate(el => { el.scrollLeft = 0; });
  const buttonBorder = await page.locator(".whats-new-button").evaluate(el => getComputedStyle(el).borderTopWidth);
  assert.equal(buttonBorder, "2px");
  await page.locator(".general-information-button").click();
  const quickTheme = await page.locator(".general-information-dialog").evaluate(el => {
    const style = getComputedStyle(el); return { background: style.backgroundColor, color: style.color, border: style.borderTopWidth };
  });
  await page.keyboard.press("Escape");
  await page.locator(".whats-new-button").click();
  const newsTheme = await page.locator(".whats-new-dialog").evaluate(el => {
    const style = getComputedStyle(el); return { background: style.backgroundColor, color: style.color, border: style.borderTopWidth };
  });
  assert.deepEqual(newsTheme, quickTheme);
  assert.equal(newsTheme.border, "1px");
  await page.screenshot({ path: `${output}/whats-new.png` });
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []);
  console.log(`PASS button border is 2px; notification panel matches Quick start with a 1px border. Screenshots: ${output}`);
} finally { await page.close(); await browser.close(); await server.close(); }
