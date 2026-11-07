import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareUserGuideAssets, verifyUserGuideAssets, USER_GUIDE_SOURCE } from '../scripts/user-guide-assets.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const filenames = ['index.html', 'user.html', 'developer.html', 'theory.html'];
const pages = new Map(await Promise.all(filenames.map(async name =>
    [name, await readFile(path.join(USER_GUIDE_SOURCE, name), 'utf8')])));
function attributes(html, name) {
    return [...html.matchAll(new RegExp('\\b' + name + '="([^"]*)"', 'gu'))].map(match => match[1]);
}
const fragmentIds = new Map([...pages].map(([name, html]) => [name, new Set(attributes(html, 'id'))]));
const user = pages.get('user.html');
const theory = pages.get('theory.html');
const sha256 = text => createHash('sha256').update(text).digest('hex');

test('the home page leads directly to three separately readable guides', () => {
    for (const [name, html] of pages) {
        assert.match(html, /<html[^>]*lang="ru"/u);
        assert.equal((html.match(/<h1\b/gu) ?? []).length, 1, name);
        assert.equal(fragmentIds.get(name).size, attributes(html, 'id').length, name);
        for (const topic of filenames.slice(1)) assert.ok(attributes(html, 'href').includes(topic), name + ' → ' + topic);
        if (name !== 'index.html') assert.ok(attributes(html, 'href').includes('index.html'));
    }
    assert.ok(user.includes('E3D Editor 4.51.0'));
    for (const id of ['med', 'med-apply', 'task-create', 'task-copy', 'task-rename', 'task-move', 'task-delete', 'material-source', 'test-team7', 'test-cube', 'test-bar', 'examples-external', 'examples-lessons', 'team13', 'case-catalog'])
        assert.ok(fragmentIds.get('user.html').has(id), id);
    for (const id of ['dev-start', 'dev-projects', 'dev-fmm', 'dev-handoff']) assert.ok(fragmentIds.get('developer.html').has(id));
    assert.doesNotMatch(user, /Lubin/u);
    const prose = user.replace(/<[^>]*>/gu, ' ').replace(/\s+/gu, ' ');
    for (const phrase of ['Начальный источник', 'пустой локальный список']) assert.ok(prose.includes(phrase), phrase);
});

test('each local link and resource resolves in the same offline bundle', async () => {
    for (const [page, html] of pages) {
        assert.doesNotMatch(html, /<(?:script|img)\b[^>]+src="https?:/u);
        assert.doesNotMatch(html, /\b(?:src|href)="(?:file:|javascript:|#")/u);
        for (const url of [...attributes(html,'href'), ...attributes(html,'src')]) {
            if (/^https?:\/\//u.test(url) || url === 'data:,') continue;
            if (url.startsWith('data:image/')) {
                assert.match(url, /^data:image\/(?:png|gif|jpeg|webp);base64,[A-Za-z0-9+/=]+$/u);
                continue;
            }
            const [relative, fragment] = url.split('#');
            assert.ok(!relative.startsWith('/') && !relative.includes('..'), url);
            const file = decodeURIComponent(relative || page);
            if (!pages.has(file)) assert.ok((await readFile(path.join(USER_GUIDE_SOURCE,file))).length, file);
            if (fragment) assert.ok(fragmentIds.get(file)?.has(decodeURIComponent(fragment)), page + ' → ' + url);
        }
    }
});

test('bookmarks from the one-page edition keep their destinations, including the no-script links', () => {
    const aliases = [...pages.get('index.html').matchAll(/<a id="([^"]+)" href="([^"]+)">/gu)];
    // 307 content IDs and 7 former controls. top, content and main-content remain native on the home page.
    assert.equal(aliases.length, 314);
    const originalDestinations = aliases.map(([,id,href]) => id + '\t' + href).sort();
    assert.equal(sha256(originalDestinations.join('\n')), '6cfacfebfce89be8fcd5b1c95fa975ee057fbe3ffeeaa971b369b0e39125df9d');
    for (const id of ['top','content','main-content']) assert.ok(fragmentIds.get('index.html').has(id));
});

test('all 175 equation images keep their bytes, numbers, dimensions and alternative text', () => {
    const tags = [...pages.values()].flatMap(html => [...html.matchAll(/<img\b[^>]*\bdata-equation="(\d+)"[^>]*>/gu)]);
    tags.sort((a,b) => Number(a[1]) - Number(b[1]));
    assert.deepEqual(tags.map(m => Number(m[1])), Array.from({length:175}, (_,i) => i+1));
    // Computed from the sorted original <img> tags of Editor 1a50281, before separation.
    assert.equal(sha256(tags.map(m => m[0]).join('\n')), '5fc948b9bc8a0c4062e98b9328e50f5e0a246775d994e781390e20d99fb3208e');
    assert.equal((theory.match(/data-equation=/gu) ?? []).length, 169);
    assert.equal((user.match(/data-equation=/gu) ?? []).length, 6);
    assert.doesNotMatch(theory, /<math\b|MathJax|katex|HT[CS]_JC_OFFSET/iu);
    for (const id of ['model-integral','model-discretization','model-weak','model-newton','model-hts','model-symmetries','model-scope','jweak1','model-hts-power','model-hts-tanh','prescribed-current-contact'])
        assert.ok(fragmentIds.get('theory.html').has(id), id);
    assert.match(theory, /j2_n=24/u);
    assert.match(theory, /j_gmin=25000/u);
});

test('four worked lessons have direct local downloads and control values', async () => {
    for (const name of ['magnet-1-1','rotor-axial','magnetic-screen','radial-rings']) {
        const link = 'examples/' + name + '.zip';
        assert.ok(attributes(user,'href').includes(link), link);
        assert.equal((await readFile(path.join(USER_GUIDE_SOURCE, link))).readUInt32LE(0), 0x04034b50);
    }
    for (const value of ['0,051689744','0,293799','0,057303','2,770620']) assert.ok(user.includes(value));
});

test('guide retains the prepared images and recorded benchmark evidence', async () => {
    const webp = await readFile(path.join(USER_GUIDE_SOURCE, 'images/med-parents.webp'));
    assert.equal(webp.subarray(0, 4).toString(), 'RIFF');
    assert.equal(webp.subarray(8, 12).toString(), 'WEBP');
    for (const file of ['cube-20260923.json', 'team7-200hz-20260923.json']) {
        const evidence = JSON.parse(await readFile(path.join(USER_GUIDE_SOURCE, 'evidence', file)));
        assert.ok(evidence && typeof evidence === 'object');
    }
});

test('prepare copies all guide bytes deterministically and removes obsolete generated assets only', async () => {
    const temporary = await mkdtemp(path.join(tmpdir(), 'clark-guide-'));
    try {
        const outputRoot = path.join(temporary, 'guide');
        const sentinel = path.join(temporary, 'other-resource.txt');
        await writeFile(sentinel, 'keep');
        const first = await prepareUserGuideAssets({ outputRoot });
        assert.ok(filenames.every(name => first.some(file => file.path === name)));
        await writeFile(path.join(outputRoot, 'obsolete.html'), 'obsolete');
        assert.deepEqual(await prepareUserGuideAssets({ outputRoot }), first);
        assert.deepEqual(await verifyUserGuideAssets({ assetRoot: outputRoot }), first);
        assert.equal(await readFile(sentinel, 'utf8'), 'keep');
        assert.ok(!(await readdir(outputRoot)).includes('obsolete.html'));
    } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('verify rejects changed, missing and unexpected published files', async () => {
    const temporary = await mkdtemp(path.join(tmpdir(), 'clark-guide-verify-'));
    try {
        for (const mode of ['change', 'remove', 'extra']) {
            await prepareUserGuideAssets({ outputRoot: temporary });
            const filename = path.join(temporary, 'index.html');
            if (mode === 'change') await writeFile(filename, 'tampered');
            if (mode === 'remove') await rm(filename);
            if (mode === 'extra') await writeFile(path.join(temporary, 'stale.js'), 'extra');
            await assert.rejects(verifyUserGuideAssets({ assetRoot: temporary }), /differ/u);
        }
    } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('invalid guide input cannot erase a previously prepared output', async () => {
    const temporary = await mkdtemp(path.join(tmpdir(), 'clark-guide-invalid-'));
    try {
        const sourceRoot = path.join(temporary, 'source'), outputRoot = path.join(temporary, 'guide');
        await mkdir(sourceRoot); await mkdir(outputRoot);
        await writeFile(path.join(outputRoot, 'sentinel.txt'), 'old');
        await assert.rejects(prepareUserGuideAssets({ sourceRoot, outputRoot }), /Missing required/u);
        assert.equal(await readFile(path.join(outputRoot, 'sentinel.txt'), 'utf8'), 'old');
        await assert.rejects(prepareUserGuideAssets({ sourceRoot, outputRoot: sourceRoot }), /overlap/u);
        await assert.rejects(prepareUserGuideAssets({ sourceRoot, outputRoot: temporary }), /overlap/u);
    } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('source and destination symlinks cannot redirect guide copying', async () => {
    const temporary = await mkdtemp(path.join(tmpdir(), 'clark-guide-links-'));
    try {
        const sourceRoot = path.join(temporary, 'source'), outputRoot = path.join(temporary, 'out');
        await mkdir(sourceRoot);
        for (const name of [...filenames, 'guide.css', 'guide.js']) await writeFile(path.join(sourceRoot, name), 'ok');
        await symlink(sourceRoot, outputRoot, process.platform === 'win32' ? 'junction' : 'dir');
        await assert.rejects(prepareUserGuideAssets({ sourceRoot, outputRoot }), /symlink/u);
        await symlink(sourceRoot, path.join(sourceRoot, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
        await assert.rejects(prepareUserGuideAssets({ sourceRoot, outputRoot: path.join(temporary, 'safe') }), /Unsupported/u);
    } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('all npm build entrypoints prepare and verify the same guide', async () => {
    const pkg = JSON.parse(await readFile(path.join(root, 'package.json')));
    const build = await readFile(path.join(root, 'scripts/build.mjs'), 'utf8');
    assert.match(pkg.scripts['assets:prepare'], /user-guide-assets\.mjs prepare/u);
    assert.match(pkg.scripts['assets:verify'], /user-guide-assets\.mjs verify/u);
    assert.ok(build.indexOf("'user-guide-assets.mjs'") === -1); // Full script path, not cwd-dependent.
    assert.ok(build.indexOf("['scripts/user-guide-assets.mjs', 'prepare']") < build.indexOf("'build', ...process.argv"));
    assert.ok(build.indexOf("['scripts/user-guide-assets.mjs', 'verify']") > build.indexOf("'build', ...process.argv"));
    for (const name of ['build', 'build:release', 'build:pages']) assert.match(pkg.scripts[name], /scripts\/build\.mjs/u);
});

test('help link is base-aware, separate from the SPA and opens without replacing the task', async () => {
    const source = await readFile(path.join(root, 'src/TaskInfoBar.jsx'), 'utf8');
    assert.match(source, /href=\{`\$\{import\.meta\.env\.BASE_URL\}user-guide\/index\.html`\}/u);
    assert.match(source, /target="_blank" rel="noopener noreferrer"/u);
    assert.match(source, /Документация/u);
    assert.doesNotMatch(source, /^import\s[^;]+user-guide\/(?:index|guide)/mu);
    for (const base of ['/', '/web-gui/', '/local/editor/']) {
        const resolved = new URL(`${base}user-guide/index.html`, 'https://host.invalid/editor');
        assert.equal(resolved.pathname, `${base}user-guide/index.html`);
    }
});

test('Caddy serves guide assets without the SPA fallback', async () => {
    const source = await readFile(path.join(root, 'deploy/caddy/Caddyfile'), 'utf8');
    assert.match(source, /@user_guide path \/user-guide\/\*/u);
    assert.match(source, /handle @user_guide\s*\{\s*file_server\s*\}/u);
    assert.ok(source.indexOf('handle @user_guide') < source.indexOf('try_files'));
});
