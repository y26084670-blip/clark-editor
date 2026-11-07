/** Ship the standalone user guide without importing it into the SPA. */
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
export const USER_GUIDE_SOURCE = path.join(root, 'docs', 'user-guide');
const generated = path.join(root, '.generated', 'user-guide');
const published = path.join(root, 'dist', 'user-guide');
const requiredFiles = ['index.html', 'user.html', 'developer.html', 'theory.html', 'guide.css', 'guide.js'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function collect(directory, prefix = '') {
    const files = [];
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...await collect(full, relative));
        else if (entry.isFile()) {
            const bytes = await readFile(full);
            files.push({ path: relative, size: bytes.length, sha256: sha256(bytes) });
        } else throw new Error(`Unsupported user guide entry: ${relative}`);
    }
    return files;
}

function separatePaths(source, output) {
    const inside = (parent, child) => {
        const relative = path.relative(parent, child);
        return !relative || (!relative.startsWith(`..${path.sep}`)
            && relative !== '..' && !path.isAbsolute(relative));
    };
    if (inside(source, output) || inside(output, source)) {
        throw new Error('User guide source and destination must not overlap.');
    }
}

export async function prepareUserGuideAssets({
    sourceRoot = USER_GUIDE_SOURCE, outputRoot = generated,
} = {}) {
    const source = await realpath(sourceRoot);
    const output = path.resolve(outputRoot);
    separatePaths(source, output);
    const files = await collect(source); // Fail before touching a previous bundle.
    for (const file of requiredFiles) {
        if (!files.some(entry => entry.path === file && entry.size > 0)) {
            throw new Error(`Missing required user guide asset: ${file}`);
        }
    }
    // The output belongs exclusively to the guide. Do not follow an output symlink.
    try {
        if ((await lstat(output)).isSymbolicLink()) throw new Error('User guide output is a symlink.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await mkdir(path.dirname(output), { recursive: true });
    separatePaths(source, path.join(await realpath(path.dirname(output)), path.basename(output)));
    await rm(output, { recursive: true, force: true });
    await mkdir(output, { recursive: true });
    for (const file of files) {
        const destination = path.join(output, ...file.path.split('/'));
        await mkdir(path.dirname(destination), { recursive: true });
        await copyFile(path.join(source, ...file.path.split('/')), destination);
    }
    // Catch concurrent source changes or incomplete writes rather than publishing silently.
    const copied = await collect(output);
    if (JSON.stringify(copied) !== JSON.stringify(files)) throw new Error('User guide copy verification failed.');
    return files;
}

export async function verifyUserGuideAssets({
    sourceRoot = USER_GUIDE_SOURCE, assetRoot = published,
} = {}) {
    const expected = await collect(sourceRoot);
    const actual = await collect(assetRoot);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error('Published user guide files differ from the canonical source (paths/size/SHA-256).');
    }
    return expected;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const command = process.argv[2];
        if (!['prepare', 'verify'].includes(command)) throw new Error('Usage: node scripts/user-guide-assets.mjs prepare|verify');
        const files = await (command === 'prepare' ? prepareUserGuideAssets() : verifyUserGuideAssets());
        console.log(`Руководство пользователя: ${command}; файлов ${files.length}; SHA-256 проверены.`);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
