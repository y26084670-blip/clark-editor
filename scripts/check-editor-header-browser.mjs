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
  folder: ".task-info-leading > .validate-button", tasks: '[data-tab-id="tasks"]',
  geometry: ".validation-controls > .geometry-button", validate: ".model-validation-button", save: ".save-button", quick: ".general-information-button",
  circle: ".header-validation-indicator",
  news: ".whats-new-button", about: ".about-button", docs: ".documentation-button", leading: ".task-info-leading",
  trajectory: '[data-tab-id="moves"]', sources: '[data-tab-id="mhj"]', fmm: '[data-tab-id="fmmLibrary"]',
  hts: '[data-tab-id="htsLibrary"]', settings: '[data-tab-id="conrab"]',
};
async function checkTabs() {
  const { tabs, width, scrollWidth } = await page.locator(".tabs-header").evaluate(header => ({
    width: header.clientWidth,
    scrollWidth: header.scrollWidth,
    tabs: Array.from(header.querySelectorAll("button[data-tab-id]"), button => {
      const label = button.querySelector(".tab-label");
      const indicator = button.querySelector(".tab-change-indicator");
      const bounds = button.getBoundingClientRect();
      const labelBounds = label.getBoundingClientRect();
      const indicatorBounds = indicator?.getBoundingClientRect();
      return {
        name: label.textContent, width: bounds.width,
        labelFits: label.scrollWidth <= label.clientWidth,
        indicator: indicatorBounds && {
          width: indicatorBounds.width, height: indicatorBounds.height,
          gap: indicatorBounds.left - labelBounds.right,
          inset: bounds.right - indicatorBounds.right,
        },
      };
    }),
  }));
  assert.equal(tabs.length, 10);
  for (const tab of tabs) {
    near(tab.width, tabs[0].width, `${tab.name}: equal tab width`);
    assert.ok(tab.labelFits, `${tab.name}: full label fits`);
    if (tab.indicator) {
      near(tab.indicator.width, 9, `${tab.name}: indicator width`);
      near(tab.indicator.height, 9, `${tab.name}: indicator height`);
      assert.ok(tab.indicator.gap >= 6.9, `${tab.name}: indicator does not overlap the label`);
      assert.ok(tab.indicator.inset >= 3.9, `${tab.name}: indicator fits inside the tab`);
    }
  }
  if (width >= 1920) assert.ok(scrollWidth <= width, "all tabs fit without horizontal scrolling");
  else assert.ok(scrollWidth > width, "narrow windows retain horizontal tab scrolling");
}
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
  near(rects.folder.right, rects.tasks.right, "Folder/Task selection right");
  near(rects.docs.right, rects.settings.right, "Documentation/Settings right");
  near(rects.about.right, rects.hts.right, "About/HTS right");
  near(rects.quick.left, rects.fmm.left, "Quick start/FMM left");
  near(rects.save.right, rects.fmm.right, "Save/FMM right");
  near(rects.validate.left, rects.sources.left, "Validate/Sources left");
  near(rects.validate.width, rects.quick.width, "Validate/Quick start width");
  near(rects.circle.left, rects.sources.right - 24, "Diagnostics shifted another 5px left");
  near(rects.geometry.right, rects.trajectory.right, "3D/Trajectory right");
  const order = ["leading", "geometry", "validate", "circle", "quick", "save", "news", "about", "docs"];
  for (let i = 1; i < order.length; i++) assert.ok(rects[order[i - 1]].right <= rects[order[i]].left + 1, `overlap ${order[i - 1]}/${order[i]}: ${JSON.stringify(rects)}`);
  assert.ok(await page.locator(".model-validation-button").evaluate(el => el.scrollWidth <= el.clientWidth), "validation label fits its new width");
  await checkTabs();
  console.log("PASS", label);
}
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__header`);
  await page.waitForFunction(() => window.headerFixture?.ready);
  await page.evaluate(() => document.fonts.ready);
  const access = page.locator(".task-access-dialog[open]");
  if (await access.count()) await access.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.evaluate(() => headerFixture.setPath("clark.projects / Проект / Задание с длинным названием для проверки строки пути"));
  for (const width of [1440, 1920, 2560, 1100]) {
    await page.setViewportSize({ width, height: 900 });
    await check(`header alignment and non-overlap at ${width}px`);
    await page.screenshot({ path: `${output}/header-${width}.png` });
  }
  await page.setViewportSize({ width: 1920, height: 900 });
  const boldLabels = await page.addStyleTag({ content: ".tabs-header .tab-label { font-weight: 700; }" });
  await page.locator(".tab-change-indicator").evaluateAll(indicators => indicators.forEach(indicator => indicator.classList.add("dirty")));
  await check("all bold labels and unsaved-data indicators fit at 1920px");
  await page.screenshot({ path: `${output}/header-1920-unsaved.png` });
  await boldLabels.evaluate(style => style.remove());
  await page.locator(".tab-change-indicator").evaluateAll(indicators => indicators.forEach(indicator => indicator.classList.remove("dirty")));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('[data-tab-id="htsLibrary"]').click();
  await check("alignment follows active-tab font changes");
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.locator(".tabs-header").evaluate(el => { el.scrollLeft = el.scrollWidth; });
  await check("alignment follows horizontal tab scrolling");
  await page.setViewportSize({ width: 1920, height: 900 });
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
