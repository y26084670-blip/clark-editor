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
  ignoreDefaultArgs: ["--hide-scrollbars"],
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
  title: ".task-info-title",
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
        name: label.textContent, width: bounds.width, height: bounds.height,
        fontSize: parseFloat(getComputedStyle(button).fontSize),
        oneLine: label.getBoundingClientRect().height < parseFloat(getComputedStyle(label).fontSize) * 1.6,
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
    near(tab.height, tabs[0].height, `${tab.name}: equal tab height`);
    assert.equal(tab.fontSize, tabs[0].fontSize, `${tab.name}: common font size`);
    assert.ok(tab.labelFits, `${tab.name}: full label fits`);
    assert.ok(tab.oneLine, `${tab.name}: label stays on one line`);
    if (tab.indicator) {
      near(tab.indicator.width, 9, `${tab.name}: indicator width`);
      near(tab.indicator.height, 9, `${tab.name}: indicator height`);
      assert.ok(tab.indicator.gap >= 6.9, `${tab.name}: indicator does not overlap the label`);
      assert.ok(tab.indicator.inset >= 3.9, `${tab.name}: indicator fits inside the tab`);
    }
  }
  if (width >= 1400) assert.ok(scrollWidth <= width, "all tabs fit without horizontal scrolling from 1400px");
  else {
    assert.ok(scrollWidth > width, "narrow windows enable horizontal tab scrolling");
    near(scrollWidth, 1400, "the tab row stops shrinking below 1400px");
  }
  return tabs[0].fontSize;
}
async function check(label) {
  await page.waitForFunction(() => {
    const docs = document.querySelector(".documentation-button")?.getBoundingClientRect();
    const settings = document.querySelector('[data-tab-id="conrab"]')?.getBoundingClientRect();
    return docs && settings && Math.abs(docs.left - settings.left) < 0.1 && Math.abs(docs.right - settings.right) < 0.1;
  });
  const rects = await page.evaluate(selectors => Object.fromEntries(Object.entries(selectors).map(([name, selector]) => {
    const rect = document.querySelector(selector).getBoundingClientRect();
    return [name, { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width }];
  })), selectors);
  near(rects.docs.left, rects.settings.left, "Documentation/Settings left");
  near(rects.folder.right, rects.tasks.right, "Folder/Task selection right");
  if (rects.title.width > 0) assert.ok(rects.title.right + 3.9 <= rects.folder.left, "task title does not overlap Folder");
  assert.ok(await page.locator(".task-info-leading > .menu-button").evaluate(el => {
    const rect = el.getBoundingClientRect();
    return document.elementFromPoint(rect.right - 1, rect.top + rect.height / 2)?.closest(".menu-button") === el;
  }), "the fixed menu remains accessible when Folder scrolls left");
  near(rects.docs.right, rects.settings.right, "Documentation/Settings right");
  near(rects.news.left, rects.hts.left, "What's new/HTS left");
  near(rects.news.right, rects.hts.right, "What's new/HTS right");
  near(rects.news.width, rects.hts.width, "What's new/HTS width");
  near(rects.about.right, rects.docs.right - 4, "About is inset from Documentation's right edge");
  assert.ok(rects.about.left >= rects.docs.left && rects.about.top >= rects.docs.top && rects.about.bottom <= rects.docs.bottom,
    "About fits entirely inside Documentation's bounds");
  const docsTextRight = await page.locator(selectors.docs).evaluate(el => {
    const range = document.createRange(); range.selectNodeContents(el);
    return range.getBoundingClientRect().right;
  });
  assert.ok(docsTextRight + 2 <= rects.about.left, "Documentation text does not overlap About");
  near(rects.quick.left, rects.fmm.left, "Quick start/FMM left");
  near(rects.save.right, rects.fmm.right, "Save/FMM right");
  near(rects.validate.left, rects.sources.left, "Validate/Sources left");
  near(rects.validate.width, rects.quick.width, "Validate/Quick start width");
  near(rects.circle.left, rects.sources.right - 24, "Diagnostics shifted another 5px left");
  near(rects.geometry.right, rects.trajectory.right, "3D/Trajectory right");
  const order = ["leading", "geometry", "validate", "circle", "quick", "save", "news", "docs"];
  for (let i = 1; i < order.length; i++) assert.ok(rects[order[i - 1]].right <= rects[order[i]].left + 1, `overlap ${order[i - 1]}/${order[i]}: ${JSON.stringify(rects)}`);
  for (const name of ["validate", "quick", "news", "docs"]) {
    assert.ok(await page.locator(selectors[name]).evaluate(el => el.scrollWidth <= el.clientWidth), `${name}: header label fits`);
  }
  const fontSize = await checkTabs();
  console.log("PASS", label);
  return fontSize;
}
async function checkDiagnostics(width) {
  await page.setViewportSize({ width, height: 900 });
  await page.locator(".tabs-header").evaluate(el => { el.scrollLeft = el.scrollWidth; });
  await check(`diagnostics header at ${width}px`);
  await page.locator(".header-validation-indicator .validation-indicator > div[title]").click();
  const popup = page.locator(".diagnostic-popup");
  await popup.waitFor({ state: "visible" });
  const bounds = await popup.boundingBox();
  assert.ok(bounds.x >= 15.9 && bounds.x + bounds.width <= width - 15.9, "diagnostics stay inside the viewport");
  assert.ok(await popup.evaluate(el => {
    const rect = el.getBoundingClientRect();
    const grid = document.querySelector(".tabulator-header").getBoundingClientRect();
    const points = [
      [rect.left + 24, rect.top + 24], [rect.right - 24, rect.top + 24],
      [rect.left + 24, Math.max(rect.top + 60, grid.top + 8)],
    ];
    return points.every(([x, y]) => el.contains(document.elementFromPoint(x, y)));
  }), "diagnostics are in front of tab labels and the table header");
  const list = popup.locator(".diagnostic-list");
  await list.evaluate(el => { el.scrollTop = el.scrollHeight; });
  assert.ok(await list.evaluate(el => el.scrollTop > 0), "a long diagnostic list remains scrollable");
  await popup.locator(".diagnostic-title").click();
  assert.ok(await popup.isVisible(), "clicks inside diagnostics keep the panel open");
  await page.screenshot({ path: `${output}/diagnostics-${width}.png` });
  await page.locator(".task-info-bar").click({ position: { x: 60, y: 18 } });
  await popup.waitFor({ state: "hidden" });
  console.log("PASS", `diagnostics foreground, viewport bounds, scrolling, and dismissal at ${width}px`);
}
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__header`);
  await page.waitForFunction(() => window.headerFixture?.ready);
  await page.evaluate(() => document.fonts.ready);
  const access = page.locator(".task-access-dialog[open]");
  if (await access.count()) await access.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.evaluate(() => headerFixture.setPath("clark.projects / Проект / Задание с длинным названием для проверки строки пути"));
  const fonts = new Map();
  for (const width of [1440, 1401, 1400, 1399, 1280, 1100, 1920, 2560]) {
    await page.setViewportSize({ width, height: 900 });
    fonts.set(width, await check(`tab sizing, scrolling, and header alignment at ${width}px`));
    await page.screenshot({ path: `${output}/header-${width}.png` });
  }
  for (const width of [1399, 1280, 1100]) {
    assert.equal(fonts.get(width), fonts.get(1400), `font stops shrinking below 1400px: ${width}px`);
  }
  assert.ok(fonts.get(1440) < fonts.get(1920), "font shrinks only when needed");
  assert.equal(fonts.get(1920), fonts.get(2560), "wide windows restore the original font size");
  assert.ok(fonts.get(1920) > 13.2, "original tab font size is preserved when it fits");
  await page.setViewportSize({ width: 1100, height: 900 });
  const boldLabels = await page.addStyleTag({ content: ".tabs-header .tab-label { font-weight: 700; }" });
  await page.locator(".tab-change-indicator").evaluateAll(indicators => indicators.forEach(indicator => indicator.classList.add("dirty")));
  assert.equal(await check("all bold labels and unsaved-data indicators fit at 1100px"), fonts.get(1100));
  await page.screenshot({ path: `${output}/header-1100-unsaved.png` });
  await boldLabels.evaluate(style => style.remove());
  await page.locator(".tab-change-indicator").evaluateAll(indicators => indicators.forEach(indicator => indicator.classList.remove("dirty")));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('[data-tab-id="htsLibrary"]').click();
  assert.equal(await check("active tab does not change the fitted font size"), fonts.get(1440));
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.locator(".tabs-header").evaluate(el => { el.scrollLeft = el.scrollWidth; });
  assert.equal(await check("upper controls follow horizontal tab scrolling at 1100px"), fonts.get(1400));
  assert.ok(await page.locator(".tabs-header").evaluate(el => el.scrollLeft > 0), "the tab row scrolls to its end");
  const lastTab = await page.locator('[data-tab-id="conrab"]').boundingBox();
  assert.ok(lastTab.x >= 0 && lastTab.x + lastTab.width <= 1100, "the last tab is reachable by scrolling");
  await page.screenshot({ path: `${output}/header-1100-scrolled.png` });
  await page.setViewportSize({ width: 1920, height: 900 });
  await check("expanding the window restores unscrolled tabs and their original font size");
  assert.equal(await page.locator(".tabs-header").evaluate(el => el.scrollLeft), 0);
  await page.evaluate(() => headerFixture.setDiagnostics(Array.from({ length: 80 }, (_, index) => ({
    level: "error", message: `Замечание для проверки панели диагностики № ${index + 1}`,
    tab: { id: "elements", label: "Элементы" }, row: index + 1,
  }))));
  for (const width of [1920, 1400, 1100]) await checkDiagnostics(width);
  await page.setViewportSize({ width: 1920, height: 900 });
  await check("header returns to its wide layout after diagnostic checks");
  const pagesBeforeAbout = page.context().pages().length;
  await page.locator(".about-button").click();
  await page.locator(".about-dialog[open]").waitFor();
  assert.equal(page.context().pages().length, pagesBeforeAbout, "About opens its dialog without following the documentation link");
  await page.keyboard.press("Escape");
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
