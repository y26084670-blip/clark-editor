import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceRoot = join(projectRoot, "data", "demo");
const outputRoot = join(projectRoot, ".generated");
const bundle = { schemaVersion: 1, directories: [], files: [] };

async function collect(directory, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) =>
        left.name < right.name ? -1 : left.name > right.name ? 1 : 0);

    for (const entry of entries) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        const sourcePath = join(directory, entry.name);
        if (entry.isDirectory()) {
            // Include empty directories as well as directories containing files.
            bundle.directories.push(path);
            await collect(sourcePath, path);
        } else if (entry.isFile()) {
            const bytes = await readFile(sourcePath);
            bundle.files.push({ path, base64: bytes.toString("base64") });
        } else {
            throw new Error(`Неподдерживаемый объект в data/demo: ${path}`);
        }
    }
}

await collect(sourceRoot);
await mkdir(outputRoot, { recursive: true });
await cp(join(projectRoot, "public", "geometry"), join(outputRoot, "geometry"), { recursive: true });
await writeFile(
    join(outputRoot, "demo-task.json"),
    `${JSON.stringify(bundle)}\n`,
    "utf8",
);
console.log(`Демонстрационная задача подготовлена: ${bundle.files.length} файлов.`);
