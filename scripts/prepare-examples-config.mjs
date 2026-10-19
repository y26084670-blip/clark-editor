import { copyFile, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readOMExamplesBundle } from "./om-examples-bundle.mjs";
import { validateInstallerMetadata } from "../src/services/installerDownloadService.js";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const defaultSourceRoot = path.join(projectRoot, "public", "examples", "clark.projects");
const defaultOutputRoot = path.join(projectRoot, ".generated");
const defaultConfigPath = path.join(projectRoot, "public", "examples-config.json");
const INVALID_WINDOWS_CHARACTERS = /[\x00-\x1f\x7f<>:"|?*\\]/;
const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i;
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function containsPath(parent, child) {
    const relative = path.relative(parent, child);
    return relative === "" || (!relative.startsWith(`..${path.sep}`)
        && relative !== ".." && !path.isAbsolute(relative));
}

async function resolveLocation(value) {
    try { return await realpath(value); }
    catch (error) {
        if (error.code !== "ENOENT") throw error;
        // Resolve existing ancestors too, so a directory alias cannot bypass
        // the overlap check when the final output directory does not yet exist.
        return path.join(await resolveLocation(path.dirname(value)), path.basename(value));
    }
}

function validateName(name, relativePath) {
    if (!name || name === "." || name === ".." || name.includes("/")
        || INVALID_WINDOWS_CHARACTERS.test(name) || WINDOWS_DEVICE_NAME.test(name)
        || /[. ]$/.test(name) || name.includes("\ufffd")) {
        throw new Error(`Недопустимое или неоднозначное имя примера «${relativePath}».`);
    }
    try { encodeURIComponent(name); }
    catch { throw new Error(`Имя «${relativePath}» содержит некорректные символы Unicode.`); }
}

/** Prepare ordinary example files and their static index without parsing content. */
export async function prepareExamplesAssets({
    sourceRoot = defaultSourceRoot,
    outputRoot = defaultOutputRoot,
    configPath = defaultConfigPath,
    allowMissingSource = path.resolve(sourceRoot) === path.resolve(defaultSourceRoot),
    omBundle = path.resolve(sourceRoot) === path.resolve(defaultSourceRoot) ? path.join(projectRoot, "data", "om-examples.json") : null,
} = {}) {
    const source = path.resolve(sourceRoot);
    const output = path.resolve(outputRoot);
    const destination = path.join(output, "examples", "clark.projects");
    const sourceLocation = await resolveLocation(source);
    const destinationLocation = await resolveLocation(destination);
    const inPlace = sourceLocation === destinationLocation;
    if (!inPlace && (containsPath(sourceLocation, destinationLocation)
        || containsPath(destinationLocation, sourceLocation))) {
        throw new Error("Исходный каталог примеров и его выходная копия не должны находиться друг внутри друга.");
    }
    const configText = await readFile(path.resolve(configPath), "utf8");
    const config = JSON.parse(configText);
    if (config?.solverInstallerSize !== undefined || config?.solverInstallerSha256 !== undefined) {
        validateInstallerMetadata(config);
    }
    if (!config || typeof config !== "object" || Array.isArray(config)
        || typeof config.manifestUrl !== "string" || !config.manifestUrl.trim()
        || typeof config.solverInstallerUrl !== "string") {
        throw new Error("Настройка примеров должна содержать manifestUrl и solverInstallerUrl.");
    }

    let sourceAvailable = true;
    try {
        const sourceStat = await lstat(source);
        if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) {
            throw new Error("Источник примеров должен быть обычным каталогом, а не символической ссылкой.");
        }
    }
    catch (error) {
        if (error.code !== "ENOENT" || !allowMissingSource) throw error;
        sourceAvailable = false;
    }
    const entries = [];
    const names = new Map();
    let totalBytes = 0;
    let fileCount = 0;
    let directoryCount = 0;
    async function visit(directory, relativeDirectory = "") {
        const children = await readdir(directory, { withFileTypes: true });
        children.sort((left, right) => compareText(left.name, right.name));
        for (const child of children) {
            const relativePath = relativeDirectory ? `${relativeDirectory}/${child.name}` : child.name;
            validateName(child.name, relativePath);
            const key = relativePath.normalize("NFC").toUpperCase();
            if (names.has(key)) {
                throw new Error(`Конфликтующие имена примеров «${names.get(key)}» и «${relativePath}».`);
            }
            names.set(key, relativePath);
            const absolutePath = path.join(directory, child.name);
            const stat = await lstat(absolutePath);
            if (stat.isSymbolicLink()) {
                throw new Error(`Символическая ссылка «${relativePath}» не допускается в комплекте примеров.`);
            }
            if (stat.isDirectory()) {
                entries.push({ path: relativePath, type: "directory" });
                directoryCount += 1;
                await visit(absolutePath, relativePath);
            }
            else if (stat.isFile()) {
                if (!Number.isSafeInteger(stat.size) || stat.size < 0
                    || !Number.isSafeInteger(totalBytes + stat.size)) {
                    throw new Error(`Размер примеров превышает поддерживаемую точность: «${relativePath}».`);
                }
                entries.push({ path: relativePath, type: "file", size: stat.size });
                totalBytes += stat.size;
                fileCount += 1;
            }
            else {
                throw new Error(`Специальный файл «${relativePath}» не допускается в комплекте примеров.`);
            }
        }
    }
    if (sourceAvailable) await visit(source);
    const bundledFiles = omBundle ? await readOMExamplesBundle(omBundle) : new Map();
    for (const [relativePath, data] of bundledFiles) {
        const segments = relativePath.split('/');
        for (let i = 1; i < segments.length; i++) {
            const directory = segments.slice(0, i).join('/');
            const key = directory.normalize('NFC').toUpperCase();
            if (!names.has(key)) { names.set(key, directory); entries.push({path:directory,type:'directory'}); directoryCount++; }
            else if (!entries.some(e => e.path === directory && e.type === 'directory')) throw new Error(`Конфликт каталога ${directory}`);
        }
        const key = relativePath.normalize('NFC').toUpperCase();
        if (names.has(key)) throw new Error(`Внешний пример дублирует локальный файл: ${relativePath}`);
        names.set(key, relativePath); entries.push({path:relativePath,type:'file',size:data.length});
        totalBytes += data.length; fileCount++;
    }

    // Validation completes before replacing only the assets owned by this script.
    await mkdir(output, { recursive: true });
    if (!inPlace) {
        await rm(destination, { recursive: true, force: true });
        if (sourceAvailable) await mkdir(destination, { recursive: true });
    }
    // A deployed examples/clark.projects can be indexed without rewriting files.
    for (const entry of inPlace ? [] : entries) {
        const segments = entry.path.split("/");
        const outputPath = path.join(destination, ...segments);
        if (entry.type === "directory") {
            await mkdir(outputPath, { recursive: true });
        }
        else {
            if (bundledFiles.has(entry.path)) {
                await writeFile(outputPath, bundledFiles.get(entry.path));
                continue;
            }
            const sourcePath = path.join(source, ...segments);
            const stat = await lstat(sourcePath);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== entry.size) {
                throw new Error(`Файл «${entry.path}» изменился во время подготовки примеров. Повторите подготовку.`);
            }
            await copyFile(sourcePath, outputPath);
            if ((await lstat(outputPath)).size !== entry.size) {
                throw new Error(`Размер копии «${entry.path}» не совпадает с исходным размером. Повторите подготовку.`);
            }
        }
    }
    await writeFile(path.join(output, "examples-config.json"), configText, "utf8");
    const manifestPath = path.join(output, "examples-manifest.json");
    const manifest = { version: 1, baseUrl: "examples/clark.projects/", entries };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    return {
        sourceRoot: source, outputRoot: output, manifestPath, sourceAvailable, inPlace,
        fileCount, directoryCount, totalBytes,
    };
}

function parseArguments(args) {
    const options = {};
    for (let index = 0; index < args.length; index += 1) {
        const name = args[index];
        if (name !== "--source" && name !== "--output") {
            throw new Error(`Неизвестный параметр ${name}. Используйте --source <каталог clark.projects> --output <каталог ресурсов сайта>.`);
        }
        const value = args[++index];
        if (!value || value.startsWith("--")) throw new Error(`После ${name} требуется путь.`);
        options[name === "--source" ? "sourceRoot" : "outputRoot"] = value;
        if (name === "--source") options.allowMissingSource = false;
    }
    return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const result = await prepareExamplesAssets(parseArguments(process.argv.slice(2)));
        console.log(result.sourceAvailable
            ? `Подготовлены примеры: ${result.fileCount} файлов, ${result.directoryCount} каталогов, ${result.totalBytes} байт.`
            : "Каталог примеров пока отсутствует; подготовлен пустой список файлов.");
    }
    catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
