import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const guide = fileURLToPath(new URL('../docs/user-guide/', import.meta.url));
const feed = JSON.parse(await readFile(new URL('../data/updates/changes.json', import.meta.url), 'utf8'));
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css', '.js':'text/javascript',
    '.png':'image/png', '.webp':'image/webp', '.svg':'image/svg+xml', '.zip':'application/zip' };
const prefix = '/clark-editor/user-guide/';
const server = createServer(async (req, res) => {
    try {
        const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        if (!pathname.startsWith(prefix)) throw new Error('Unknown URL');
        const file = resolve(guide, pathname.slice(prefix.length) || 'index.html');
        if (!file.startsWith(resolve(guide) + sep)) throw new Error('Invalid path');
        const body = await readFile(file);
        res.writeHead(200, {'Content-Type': types[extname(file)] || 'application/octet-stream'}).end(body);
    } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const base = 'http://127.0.0.1:' + server.address().port + prefix;
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
let browser;
try {
    browser = await chromium.launch({ executablePath:process.env.CHROMIUM_EXECUTABLE, headless:true,
        args:['--no-sandbox', '--disable-dev-shm-usage'] });
    for (const width of [390,800,1440]) {
        const page = await browser.newPage({viewport:{width,height:1000}, reducedMotion:'reduce'});
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('response', response => { if (response.status() >= 400) errors.push(response.url()); });
        await page.goto(base);
        for (const file of ['user.html','developer.html','theory.html']) {
            await page.locator('.home-topics a[href="' + file + '"]').click();
            assert.equal(page.url(),base + file);
            assert.ok(await page.locator('h1').isVisible());
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
            if (width <= 800) await page.locator('#menu-toggle').click();
            const search = page.locator('#guide-search');
            await search.fill('несуществующее-выражение');
            assert.ok(await page.locator('#no-results').isVisible());
            await search.fill('');
            assert.equal(await page.locator('.chapter[hidden]').count(),0);
            await page.emulateMedia({media:'print'});
            assert.equal(await page.locator('.toc').isVisible(),false);
            await page.emulateMedia({media:'screen'});
            await page.locator('.topic-links a[href="index.html"]').click();
        }
        // A cold bookmark can resolve before the larger screenshots finish loading.
        await page.route(/quickstart-(07|13)\.webp$/, async route => {
            await new Promise(done => setTimeout(done,150));
            await route.continue();
        });
        const bookmarks = new Set(feed.entries.filter(x => x.detailsUrl).map(x => x.detailsUrl.split('#')[1]).filter(Boolean));
        bookmarks.add('prescribed-current-contact');
        for (const id of bookmarks) {
            await page.goto(base + 'index.html#' + id, {waitUntil:'commit'});
            await page.waitForURL(url => url.pathname !== prefix + 'index.html' && url.hash === '#' + id);
            const target = page.locator('[id="' + id + '"]');
            await target.waitFor({state:'attached'});
            await page.locator('.quickstart-compact img').evaluateAll(images => Promise.all(images.map(image => {
                image.loading = 'eager'; return image.decode();
            })));
            await page.waitForFunction(id => Math.abs(document.getElementById(id).getBoundingClientRect().top - 30) < 2,id);
        }
        await page.goto(base + 'user.html#lesson-magnet');
        assert.ok(await page.locator('a[download]').count() >= 4);
        assert.equal(await page.locator('.lesson-figure img').evaluateAll(images => images.every(im => im.complete && im.naturalWidth > 0)), true);
        await page.goto(base + 'theory.html#model-integral');
        assert.ok(await page.locator('img[data-equation="2"]').evaluate(im => im.complete && im.naturalWidth > 0));
        assert.deepEqual(errors,[]);
        console.log('PASS direct navigation, search, print, images and legacy bookmarks at',width,'px');
        await page.close();
    }

    const disk = pathToFileURL(resolve(guide,'index.html')).href;
    const offline = await browser.newPage({javaScriptEnabled:false,viewport:{width:390,height:844},reducedMotion:'reduce'});
    await offline.goto(disk);
    await offline.locator('.home-topics a[href="user.html"]').click();
    assert.ok(await offline.locator('#lesson-magnet').isVisible());
    await offline.goto(disk + '#model-newton');
    await offline.locator('a#model-newton').click();
    assert.ok(offline.url().endsWith('/theory.html#model-newton'));
    assert.ok(await offline.locator('h1').isVisible());
    const local = await browser.newPage();
    await local.goto(disk + '#dev-start');
    // New links use the explicit topic URL. Unknown former identifiers stay on the home page.
    assert.equal(local.url(), disk + '#dev-start');
    await local.goto(disk + '#mathematical-model');
    await local.waitForURL(url => url.protocol === 'file:' && url.pathname.endsWith('/theory.html'));
    console.log('PASS offline reading, native links without JavaScript, file:// bookmark routing');
} finally {
    await browser?.close();
    await new Promise(done => server.close(done));
}
