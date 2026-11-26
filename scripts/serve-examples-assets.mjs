import { open, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream";

const EXAMPLES_PATH = "examples/";

function isWithin(root, filePath) {
    const relative = path.relative(root, filePath);
    return relative !== "" && relative !== ".."
        && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function readIndex(assetsRoot, base, manifestName, directory) {
    let manifest;
    try {
        manifest = JSON.parse(await readFile(path.join(assetsRoot, manifestName), "utf8"));
    }
    catch (error) {
        if (error.code === "ENOENT") return new Map();
        throw error;
    }
    if (manifest?.version !== 1 || manifest.baseUrl !== directory
        || !Array.isArray(manifest.entries)) {
        throw new Error("Некорректный список файлов примеров.");
    }
    const prefix = new URL(directory, base).pathname;
    const files = new Map();
    for (const entry of manifest.entries) {
        if (entry?.type === "directory") continue;
        if (entry?.type !== "file" || typeof entry.path !== "string"
            || path.isAbsolute(entry.path) || path.win32.isAbsolute(entry.path)) {
            throw new Error("Некорректный путь в списке файлов примеров.");
        }
        const segments = entry.path.split("/");
        if (segments.some(segment => !segment || segment === "." || segment === ".."
            || /[\\\0]/.test(segment))) {
            throw new Error("Некорректный путь в списке файлов примеров.");
        }
        // Vite/sirv use decodeURI, which preserves %23 and %3D. Match the
        // encoded URL directly; only manifest names become filesystem paths.
        const requestPath = prefix + segments.map(encodeURIComponent).join("/");
        if (files.has(requestPath)) throw new Error("Повторяющийся путь в списке файлов примеров.");
        files.set(requestPath, path.join(assetsRoot, directory, ...segments));
    }
    return files;
}

function respond(req, res, status) {
    if (res.destroyed || res.writableEnded) return;
    if (res.headersSent) return res.destroy();
    res.statusCode = status;
    res.removeHeader("Content-Length");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(req.method === "HEAD" ? undefined : `HTTP ${status}\n`);
}

async function sendFile(req, res, filePath, examplesRoot) {
    let file;
    try {
        const resolvedPath = await realpath(filePath);
        if (!isWithin(examplesRoot, resolvedPath)) return respond(req, res, 404);
        file = await open(resolvedPath, "r");
        const stat = await file.stat();
        if (!stat.isFile()) return respond(req, res, 404);
        if (res.destroyed) return;
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Length", stat.size);
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("X-Content-Type-Options", "nosniff");
        if (req.method === "HEAD") return res.end();

        // The stream owns the open handle; pipeline closes it on completion,
        // read failure or client cancellation and applies network backpressure.
        const stream = file.createReadStream();
        file = undefined;
        pipeline(stream, res, () => {});
    }
    catch (error) {
        const status = error.code === "ENOENT" || error.code === "ENOTDIR" ? 404
            : error.code === "EACCES" || error.code === "EPERM" ? 403 : 500;
        respond(req, res, status);
    }
    finally {
        if (file) await file.close().catch(() => {});
    }
}

async function registerExamples(server, assetsRoot) {
    const base = new URL(server.config.base, "http://vite.local/");
    const prefix = new URL(EXAMPLES_PATH, base).pathname;
    let files = new Map();
    let examplesRoot;
    try {
        const root = await realpath(assetsRoot);
        examplesRoot = path.join(root, EXAMPLES_PATH);
        files = new Map([
            ...await readIndex(root, base, "cloud-examples.json", EXAMPLES_PATH),
            ...await readIndex(root, base, "examples-manifest.json", "examples/clark.projects/"),
        ]);
    }
    catch (error) {
        server.config.logger.warn(`Примеры недоступны: ${error.message} Повторите подготовку ресурсов и перезапустите сервер.`);
    }
    // Vite registers these hooks after host checks but before its static
    // middleware, base-path stripping and SPA fallback.
    server.middlewares.use((req, res, next) => {
        const pathname = (req.url || "").split("?", 1)[0];
        if (!pathname.startsWith(prefix) && pathname !== prefix.slice(0, -1)) return next();
        if (req.method !== "GET" && req.method !== "HEAD") {
            res.setHeader("Allow", "GET, HEAD");
            return respond(req, res, 405);
        }
        const filePath = files.get(pathname);
        if (!filePath) return respond(req, res, 404);
        void sendFile(req, res, filePath, examplesRoot);
    });
}

export function examplesAssetsPlugin() {
    return {
        name: "clark-examples-assets",
        async configureServer(server) {
            if (server.config.publicDir) await registerExamples(server, server.config.publicDir);
        },
        async configurePreviewServer(server) {
            await registerExamples(server, path.resolve(server.config.root, server.config.build.outDir));
        },
    };
}
