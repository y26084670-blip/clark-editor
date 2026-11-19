// Actual Solid/Tabulator/Chart.js components and file service; controlled task handles.
import { createServer } from "vite";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = process.env.CHECK_OUTPUT || "/tmp/editor-hts-graphs";
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const checks = [], errors = [];
let server, browser, page;
const check = name => { checks.push(name); console.log(`PASS ${checks.length}: ${name}`); };
const plot = kind => page.locator(`[data-hts-graph="${kind}"]`);
const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const ranges = kind => page.evaluate(kind => {
    const c = htsGraphs.chart(kind);
    return { x: [c.scales.x.min, c.scales.x.max], y: [c.scales.y.min, c.scales.y.max] };
}, kind);
async function select() {
    await page.evaluate(() => guideMaterials.table().getRows()[0].select());
    await page.waitForFunction(() => htsGraphs.charts().length === 3);
}
async function edit(name, value) {
    await page.evaluate(async name => {
        const table = htsGraphs.detail();
        const row = table.getRows().find(row => row.getData()._property === name);
        await table.scrollToRow(row, "center", true);
        row.getCells()[1].edit();
    }, name);
    const input = page.locator(".material-library-detail .tabulator-editing input");
    await input.fill(String(value));
    await input.press("Enter");
    await page.waitForFunction(({ name, value }) => guideMaterials.table().getData()[0][name] === value, { name, value });
}
async function field(value) {
    await page.getByRole("spinbutton", { name: "Текущее эффективное поле" }).fill(String(value));
    await page.waitForFunction(value => Math.abs(Number(document.querySelector('.hts-graph-selection input').value) - value) < 1e-10, value);
}
async function canvasPoint(kind, x, fractionY = .5) {
    return page.evaluate(({ kind, x, fractionY }) => {
        const c = htsGraphs.chart(kind), rect = c.canvas.getBoundingClientRect();
        return { x: rect.left + c.scales.x.getPixelForValue(x),
            y: rect.top + c.chartArea.top + (c.chartArea.bottom - c.chartArea.top) * fractionY };
    }, { kind, x, fractionY });
}

try {
    server = await createServer({ root, cacheDir: path.join(output, "vite-cache"),
        optimizeDeps: { entries: ["test/browser/htsGraphs.fixture.jsx"] },
        server: { host: "127.0.0.1", port: 0 }, plugins: [{
            name: "hts-graphs-fixture", configureServer(server) {
                server.middlewares.use(async (req, res, next) => {
                    if (req.url?.split("?")[0] !== "/__hts-graphs") return next();
                    res.setHeader("Content-Type", "text/html");
                    res.end(await server.transformIndexHtml(req.url,
                        '<html><body><div id="root"></div><script type="module" src="/test/browser/htsGraphs.fixture.jsx"></script></body></html>'));
                });
            },
        }] });
    await server.listen();
    browser = await chromium.launch({ headless: true,
        executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
        args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
    page.setDefaultTimeout(15000);
    page.on("pageerror", error => { errors.push(error.stack ?? error.message); console.error(error.stack ?? error.message); });
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__hts-graphs`);
    await page.waitForFunction(() => window.htsGraphs && window.guideMaterials);
    await page.evaluate(() => { guideMaterials.mount("HTS", "A"); guideMaterials.setActive(true); });
    await page.waitForFunction(() => guideMaterials.snapshot().rows?.[0]?.source === "task");
    assert.equal(await plot("jc").getByRole("status").count(), 1);
    await select();
    assert.deepEqual((await ranges("jc")).x, [0, 1.5]);
    assert.deepEqual((await ranges("ej")).x, [0, 5]);
    assert.deepEqual((await ranges("mh")).x, [-1.2, 1.2]);
    const ratio = await page.evaluate(() => {
        const detail = document.querySelector(".material-library-detail").getBoundingClientRect();
        const lower = document.querySelector(".material-library-lower").getBoundingClientRect();
        return detail.width / lower.width;
    });
    close(ratio, 1 / 3, .005);
    check("three adjacent real charts, requested initial ranges, one-third/two-thirds layout");
    for (const kind of ["jc", "ej", "mh"]) {
        assert.equal(await plot(kind).locator(".hts-graph-controls").count(), 0);
        const header = plot(kind).locator(".hts-graph-title");
        assert.deepEqual(await header.getByRole("button").allTextContents(), ["Авто", "?"]);
        await header.getByRole("button", { name: `Формулы ${{jc:"Jc(b_eff)",ej:"E(J)",mh:"M(H)"}[kind]}`, exact: true }).click();
        const dialog = plot(kind).getByRole("dialog");
        await dialog.waitFor();
        assert.match(await dialog.innerText(), kind === "jc" ? /JCa/ : kind === "ej" ? /j2_n/ : /m3_Mmax/);
        await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
    }
    assert.equal(await plot("jc").getByRole("checkbox").count(), 0);
    assert.equal(await plot("mh").getByRole("checkbox").count(), 0);
    check("each compact title contains only Auto and help; formulas match selected models and log checkbox exists only for E(J)");


    await edit("m3_Mmax", .6);
    await page.waitForFunction(() => Math.abs(htsGraphs.chart("mh").data.datasets[1].data[1].x - .375) < 1e-10);
    const magnetic = await page.evaluate(() => htsGraphs.chart("mh").data.datasets.map(d => d.data));
    assert.deepEqual(magnetic[1], [{ x: 0, y: 0 }, { x: .375, y: -.375 }]);
    assert.ok(magnetic[0].some(point => point.x === 0 && point.y === .6));
    assert.ok(magnetic[0].some(point => point.x === 0 && point.y === -.6));
    assert.equal(await page.evaluate(() => htsGraphs.chart("mh").getDatasetMeta(0)._sorted), false);
    check("editing magnetic parameters redraws both limiting branches and the exact virgin-line endpoint");

    const beforeCursor = await page.evaluate(() => JSON.stringify(guideMaterials.table().getData()));
    let point = await canvasPoint("jc", .5);
    await page.mouse.click(point.x, point.y);
    const selectedField = await page.getByRole("spinbutton", { name: "Текущее эффективное поле" }).inputValue();
    close(Number(selectedField), .5, .005);
    await page.waitForFunction(() => htsGraphs.chart("ej").data.datasets[0].data.at(-1).y > 1e6);
    point = await canvasPoint("jc", .25);
    const destination = await canvasPoint("jc", .75);
    await page.mouse.move(point.x, point.y); await page.mouse.down();
    await page.mouse.move(destination.x, destination.y, { steps: 8 }); await page.mouse.up();
    close(Number(await page.getByRole("spinbutton", { name: "Текущее эффективное поле" }).inputValue()), .75, .005);
    await plot("jc").locator("canvas").press("ArrowRight");
    assert.ok(Number(await page.getByRole("spinbutton", { name: "Текущее эффективное поле" }).inputValue()) > .75);
    assert.equal(await page.evaluate(() => JSON.stringify(guideMaterials.table().getData())), beforeCursor);
    check("mouse click, cursor drag and keyboard change E(J) without changing material data");

    await field(.5);
    point = await canvasPoint("ej", 2.5);
    await page.mouse.move(point.x, point.y); await page.mouse.wheel(0, -200);
    await page.waitForFunction(() => htsGraphs.chart("ej").scales.x.max - htsGraphs.chart("ej").scales.x.min < 5);
    const zoomed = await ranges("ej");
    assert.ok(zoomed.x[1] - zoomed.x[0] < 5);
    await edit("j_type", 1);
    await edit("j1_delta", .2);
    assert.deepEqual(await ranges("ej"), zoomed);
    await plot("ej").getByRole("button", { name: "Авто", exact: true }).click();
    assert.deepEqual((await ranges("ej")).x, zoomed.x);
    assert.notDeepEqual((await ranges("ej")).y, zoomed.y);

    const tanhY = await page.evaluate(() => htsGraphs.chart("ej").data.datasets[0].data.find(p => p.x === 1.25).y);
    close(tanhY, 1.25 / 25000);
    check("tanh model, linked Jc, independent zoom, retained manual ranges and Y autoscaling");
    await plot("ej").getByRole("button", { name: "Формулы E(J)", exact: true }).click();
    const electricHelp = plot("ej").getByRole("dialog");
    assert.match(await electricHelp.innerText(), /j1_delta/);
    assert.doesNotMatch(await electricHelp.innerText(), /j2_n/);
    await electricHelp.getByRole("button", { name: "Закрыть", exact: true }).click();
    const logarithm = plot("ej").getByRole("checkbox", { name: "Логарифмические оси E(J)", exact: true });
    await logarithm.check();
    await page.waitForFunction(() => ["x","y"].every(axis => htsGraphs.chart("ej").scales[axis].type === "logarithmic"));
    assert.ok(await page.evaluate(() => htsGraphs.chart("ej").data.datasets[0].data.every(p => p.x > 0 && p.y > 0)));
    assert.ok(await page.evaluate(() => ["x","y"].every(axis => htsGraphs.chart("ej").scales[axis].ticks.every(tick => String(tick.label ?? "").length < 18))));
    await page.screenshot({ path: path.join(output, "hts-ej-logarithm.png") });
    const logBefore = await ranges("ej");
    point = await canvasPoint("ej", 1.25);
    await page.mouse.move(point.x, point.y); await page.mouse.wheel(0, -200);
    await page.waitForFunction(span => Math.log10(htsGraphs.chart("ej").scales.x.max / htsGraphs.chart("ej").scales.x.min) < span,
        Math.log10(logBefore.x[1] / logBefore.x[0]));
    const logZoom = await ranges("ej");
    await page.mouse.move(point.x, point.y); await page.mouse.down();
    await page.mouse.move(point.x+20, point.y+10, {steps:5}); await page.mouse.up();
    const logPan = await ranges("ej");
    assert.notDeepEqual(logPan.x, logZoom.x);
    assert.ok([...logPan.x, ...logPan.y].every(v => Number.isFinite(v) && v > 0));
    await plot("ej").getByRole("button", { name: "Авто", exact: true }).click();
    assert.deepEqual((await ranges("ej")).x, logPan.x);
    await logarithm.uncheck();
    await page.waitForFunction(() => htsGraphs.chart("ej").scales.x.type === "linear" && htsGraphs.chart("ej").scales.y.type === "linear");
    assert.deepEqual((await ranges("ej")).x, [0,5]);
    await edit("j_type", 2);
    await logarithm.check();
    await page.waitForFunction(() => htsGraphs.chart("ej")?.scales.x.type === "logarithmic");
    assert.ok(await page.evaluate(() => htsGraphs.chart("ej").data.datasets[0].data.every(p => p.x > 0 && p.y > 0)));
    await logarithm.uncheck();
    check("E(J) uses two real logarithmic axes; wheel, pan, Auto and return to linear work for both electrical models");


    point = await canvasPoint("mh", 0);
    await page.mouse.move(point.x, point.y); await page.mouse.wheel(0, -200);
    await page.waitForFunction(() => htsGraphs.chart("mh").scales.x.max - htsGraphs.chart("mh").scales.x.min < 2.4);
    const wheelRange = await ranges("mh");
    await page.mouse.move(point.x, point.y); await page.mouse.down();
    await page.mouse.move(point.x + 25, point.y + 10, { steps: 5 }); await page.mouse.up();
    assert.notDeepEqual((await ranges("mh")).x, wheelRange.x);
    const contactAfterZoom = await page.evaluate(() => htsGraphs.chart("mh").data.datasets[1].data[1].x);
    close(contactAfterZoom, .375);
    const magneticPan = (await ranges("mh")).x;
    await plot("mh").getByRole("button", { name: "Авто", exact: true }).click();
    assert.deepEqual((await ranges("mh")).x, magneticPan);
    check("wheel zoom and pan resample magnetic curves without moving the virgin-line endpoint");

    await edit("m_type", 2);
    await plot("mh").getByRole("alert").filter({ hasText: "зарезервирована" }).waitFor();
    assert.equal(await page.evaluate(() => htsGraphs.charts().length), 2);
    await edit("m_type", 1);
    await page.waitForFunction(() => htsGraphs.chart("mh")?.data.datasets.length === 1);
    await edit("m_type", 3);
    await page.waitForFunction(() => htsGraphs.chart("mh")?.data.datasets.length === 2);
    await edit("j_gmin", 0);
    await plot("ej").getByRole("alert").filter({ hasText: "j_gmin" }).waitFor();
    assert.ok(await page.evaluate(() => Boolean(htsGraphs.chart("jc") && htsGraphs.chart("mh"))));
    await edit("j_gmin", 25000);
    await field(1);
    await page.waitForFunction(() => htsGraphs.chart("ej")?.data.datasets[0].data.every(point => point.y === 0));
    await logarithm.check();
    await plot("ej").getByRole("alert").filter({ hasText: "Jc = 0" }).waitFor();
    assert.ok(await page.evaluate(() => Boolean(htsGraphs.chart("jc") && htsGraphs.chart("mh"))));
    await logarithm.uncheck();
    await page.waitForFunction(() => htsGraphs.chart("ej")?.data.datasets[0].data.every(point => point.y === 0));

    check("reserved magnetic mode, memoryless tanh, invalid conductivity and zero-Jc diagnostics remain local to each plot");

    await field(.2);
    await edit("JC0", 4);
    await page.waitForFunction(() => htsGraphs.chart("ej").scales.x.max === 8);
    await page.evaluate(() => guideMaterials.history("undo"));
    await page.waitForFunction(() => guideMaterials.table().getData()[0].JC0 === 2.5);
    await select();
    assert.deepEqual((await ranges("ej")).x, [0, 5]);
    await page.evaluate(() => guideMaterials.history("redo"));
    await page.waitForFunction(() => guideMaterials.table().getData()[0].JC0 === 4);
    await select();
    assert.deepEqual((await ranges("ej")).x, [0, 8]);
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await page.waitForFunction(async () => (await htsGraphs.saved()).JC0 === 4);
    const stored = await page.evaluate(() => htsGraphs.saved());
    for (const name of ["field", "viewport", "cursor", "currentJc", "datasets", "logarithmic"]) assert.ok(!(name in stored));
    check("Undo/Redo restore chart data and saving keeps cursor, scale and computed curves out of the material file");

    for (const width of [1100, 1920]) {
        await page.setViewportSize({ width, height: 980 });
        await page.waitForFunction(() => htsGraphs.charts().every(c => c.width > 150 && c.height > 150));
        const boxes = await page.locator(".hts-graph").evaluateAll(nodes => nodes.map(node => {
            const r = node.getBoundingClientRect(); return { x: r.x, width: r.width, height: r.height };
        }));
        assert.equal(boxes.length, 3);
        const titles = await page.locator(".hts-graph-title").evaluateAll(nodes => nodes.map(node => {
            const r = node.getBoundingClientRect(), children = [...node.children].map(c => c.getBoundingClientRect());
            return { right:r.right, left:r.left, children:children.map(c=>({left:c.left,right:c.right,top:c.top,bottom:c.bottom})) };
        }));
        assert.ok(titles.every(t=>t.children.every(c=>c.left>=t.left-1 && c.right<=t.right+1)));
        assert.ok(titles.every(t=>t.children.every(c=>Math.abs((c.top+c.bottom)/2-(t.children[0].top+t.children[0].bottom)/2)<2)));

        assert.ok(boxes.every((box, i) => i === 0 || box.x >= boxes[i - 1].x + boxes[i - 1].width - 1));
        await page.screenshot({ path: path.join(output, `hts-${width}.png`) });
    }
    check("three graphs stay side by side at 1100 and 1920 pixels with usable canvases");

    await page.locator(".material-library-source select").selectOption("default");
    await page.waitForFunction(() => guideMaterials.snapshot().rows?.[0]?.source === "default");
    await select();
    assert.equal(await page.evaluate(() => guideMaterials.snapshot().editable), false);
    await field(.4);
    assert.equal(await page.evaluate(() => guideMaterials.table().getData()[0].JC0), 2.5);
    check("read-only base materials support interactive previews without edits");

    await page.evaluate(() => { guideMaterials.mount("FMM", "A"); guideMaterials.setActive(true); });
    await page.waitForFunction(() => guideMaterials.snapshot().rows?.[0]?.name === "TaskA_FMM");
    await page.evaluate(() => guideMaterials.table().getRows()[0].select());
    await page.waitForFunction(() => document.querySelector(".fmm-graph-region canvas") && htsGraphs.charts().length === 1);
    assert.equal(await page.locator(".hts-graph-region").count(), 0);
    assert.deepEqual(errors, []);
    check("HTS chart cleanup and unchanged FMM chart on tab switch; no browser exceptions");
} catch (error) {
    if (page) await page.screenshot({ path: path.join(output, "failure.png") });
    throw error;
} finally {
    await writeFile(path.join(output, "result.json"), JSON.stringify({ checks, errors }, null, 2));
    await browser?.close(); await server?.close();
}
