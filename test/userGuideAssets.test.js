import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareUserGuideAssets, verifyUserGuideAssets, USER_GUIDE_SOURCE } from '../scripts/user-guide-assets.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const html = await readFile(path.join(USER_GUIDE_SOURCE, 'index.html'), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/gu)].map(match => match[1]);
const attributes = name => [...html.matchAll(new RegExp(`\\b${name}="([^"]*)"`, 'gu'))].map(match => match[1]);

test('guide is standalone Russian HTML with document chapters and stable unique anchors', () => {
    assert.match(html, /<html[^>]*lang="ru"/u);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal((html.match(/<h1\b/gu) ?? []).length, 1);
    assert.equal((html.match(/class="chapter"/gu) ?? []).length, 24);
    for (const id of ['med', 'med-apply', 'task-create', 'task-copy', 'task-rename', 'task-move', 'task-delete', 'material-source', 'test-team7', 'test-cube', 'test-bar', 'examples-external', 'examples-lessons', 'team13']) assert.ok(ids.includes(id), id);
});

test('every internal link resolves and images are embedded for offline reading', async () => {
    for (const value of [...attributes('href'), ...attributes('src')]) {
        if (/^https?:/u.test(value) || value === 'data:,') continue;
        if (value.startsWith('data:image/')) {
            const match = value.match(/^data:image\/(png|gif|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/u);
            assert.ok(match, 'valid embedded image data URI');
            assert.ok(Buffer.from(match[2], 'base64').length > 0);
            continue;
        }
        const [relative, fragment] = value.split('#');
        if (!relative) assert.ok(fragment && ids.includes(decodeURIComponent(fragment)), value);
        else {
            assert.ok(!relative.startsWith('/') && !relative.includes('..'), value);
            assert.ok((await readFile(path.join(USER_GUIDE_SOURCE, decodeURIComponent(relative)))).length > 0, value);
        }
    }
    assert.doesNotMatch(html, /<(?:script|img)\b[^>]+src="https?:/u);
    assert.doesNotMatch(html, /<link\b[^>]+rel="stylesheet"/u);
    assert.doesNotMatch(html, /\b(?:src|href)="(?:file:|javascript:|#")/u);
});

test('mathematical model uses 175 embedded native-equation images with reachable subsections', async () => {
    assert.ok(!(await readdir(USER_GUIDE_SOURCE)).includes('model.html'));
    assert.doesNotMatch(html, /model\.html|HT[CS]_JC_OFFSET|AI_HT[CS]_JC_OFFSET/u);
    assert.doesNotMatch(html, /<math\b|MathJax|katex/iu);
    assert.equal((html.match(/data-equation="\d+"/gu) ?? []).length, 175);
    for (const id of ['integral', 'discretization', 'weak', 'newton', 'hts', 'symmetries', 'scope']) {
        assert.ok(ids.includes(`model-${id}`), id);
        assert.ok(attributes('href').includes(`#model-${id}`), id);
    }
    for (const id of ['jweak1', 'model-hts-power', 'model-hts-tanh']) assert.ok(ids.includes(id), id);
    assert.match(html, /j2_n=24/u);
    assert.match(html, /j_gmin=25000/u);
    assert.match(html, /аналитическ/u);
});

test('guide identifies its GUI snapshot and retains all five task procedures', () => {
    const prose = html.replace(/<[^>]*>/gu, ' ').replace(/\s+/gu, ' ');
    assert.ok(/E3D Editor 4\.51\.0/u.test(prose), 'document GUI snapshot retained');
    assert.doesNotMatch(html, /Lubin/u);
    for (const id of ['task-create', 'task-copy', 'task-rename', 'task-move', 'task-delete']) assert.ok(ids.includes(id), id);
    assert.ok(prose.includes('Начальный источник'));
    assert.ok(prose.includes('пустой локальный список'));
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
        assert.equal(first.length, 9);
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
        for (const name of ['index.html', 'guide.css', 'guide.js']) await writeFile(path.join(sourceRoot, name), 'ok');
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
