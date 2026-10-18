import {
    defaultLibraryService,
    MATERIAL_LIBRARY_KINDS,
} from "./defaultLibraryService.js";
import {
    legacyMaterialFileName,
    validateUniqueLegacyMaterialNames,
} from "./materialImport/legacyMaterialName.js";

const TASK_LIBRARY_DIRECTORIES = Object.freeze({
    [MATERIAL_LIBRARY_KINDS.FMM]: "xapLibFMM",
    [MATERIAL_LIBRARY_KINDS.HTS]: "xapLibHTS",
});
const TASK_INPUT_DIRECTORY = "input3XX";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const JSON_FILE_PATTERN = /\.txt$/i;

function assertSafeFileName(fileName) {
    if (
        typeof fileName !== "string"
        || fileName.length === 0
        || fileName === "."
        || fileName === ".."
        || fileName.includes("/")
        || fileName.includes("\\")
    ) {
        throw new Error(`Недопустимое имя характеристики: '${fileName}'.`);
    }
}

function bytesToHex(bytes) {
    return [...bytes]
        .map(value => value.toString(16).padStart(2, "0"))
        .join("");
}

async function digestBytes(bytes, cryptoImpl) {
    if (typeof cryptoImpl?.subtle?.digest !== "function") {
        throw new Error("В окружении недоступна проверка SHA-256.");
    }
    const digest = await cryptoImpl.subtle.digest("SHA-256", bytes);
    return bytesToHex(new Uint8Array(digest));
}

async function readHandleBytes(fileHandle) {
    const file = await fileHandle.getFile();
    return new Uint8Array(await file.arrayBuffer());
}

async function findFileHandle(directoryHandle, fileName) {
    try {
        return {
            fileHandle: await directoryHandle.getFileHandle(fileName),
            exists: true,
        };
    } catch (error) {
        if (error?.name !== "NotFoundError") throw error;
        return {
            fileHandle: null,
            exists: false,
        };
    }
}

async function findDirectoryHandle(parentHandle, directoryName) {
    try {
        return {
            directoryHandle: await parentHandle.getDirectoryHandle(
                directoryName,
            ),
            exists: true,
        };
    } catch (error) {
        if (error?.name !== "NotFoundError") throw error;
        return {
            directoryHandle: null,
            exists: false,
        };
    }
}

async function writeBytes(fileHandle, bytes) {
    const writable = await fileHandle.createWritable();
    try {
        await writable.write(bytes);
        await writable.close();
    } catch (error) {
        try {
            await writable.abort?.();
        } catch {
            // Исходная ошибка записи важнее ошибки отмены.
        }
        throw error;
    }
}

function decodeJsonMaterial(bytes, path) {
    let text;
    try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
        throw new Error(`Характеристика '${path}' не является UTF-8.`, {
            cause: error,
        });
    }

    let data;
    try {
        data = JSON.parse(text);
    } catch (error) {
        throw new Error(`Характеристика '${path}' не содержит JSON-объект.`, {
            cause: error,
        });
    }

    if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error(`Характеристика '${path}' должна содержать JSON-объект.`);
    }
    return data;
}

function materialNameFromFile(fileName) {
    return fileName.replace(JSON_FILE_PATTERN, "");
}

function materialFileKey(fileName) {
    return materialNameFromFile(fileName).trim().normalize("NFC")
        .toLocaleLowerCase("ru-RU");
}

async function findMaterialFile(directoryHandle, requestedFileName) {
    const key = materialFileKey(requestedFileName);
    let found = null;
    for await (const [fileName, fileHandle] of directoryHandle.entries()) {
        if (fileHandle?.kind !== "file" || !JSON_FILE_PATTERN.test(fileName)
            || materialFileKey(fileName) !== key) continue;
        if (found) {
            throw new Error(
                `Неоднозначные имена характеристик '${found.fileName}' и '${fileName}' `
                + "в одном каталоге: совпадают без учёта регистра и Unicode-записи.",
            );
        }
        found = { fileName, fileHandle, exists: true };
    }
    return found ?? { fileName: requestedFileName, fileHandle: null, exists: false };
}

export class MaterialFileConflictError extends Error {
    constructor({ path, existingSha256, expectedSha256 }) {
        super(
            `Локальная характеристика '${path}' изменилась или конфликтует `
            + "с выбранным именем. Повторите загрузку библиотеки.",
        );
        this.name = "MaterialFileConflictError";
        this.path = path;
        this.existingSha256 = existingSha256;
        this.expectedSha256 = expectedSha256;
    }
}

export class MaterialBatchConflictError extends Error {
    constructor(conflicts) {
        const count = Array.isArray(conflicts) ? conflicts.length : 0;
        super(
            `Обнаружены отличающиеся локальные характеристики: ${count}. `
            + "Для их замены требуется единое подтверждение.",
        );
        this.name = "MaterialBatchConflictError";
        this.conflicts = Object.freeze(
            (conflicts ?? []).map(conflict =>
                Object.freeze({ ...conflict })),
        );
    }
}

export class MaterialBatchWriteError extends Error {
    constructor({
        kind,
        sourceName,
        written,
        failed,
        remaining,
        cause,
    }) {
        super(
            `Запись пакета характеристик выполнена частично: обработано `
            + `${written.length}; ошибка файла '${failed.path}'; `
            + `осталось ${remaining.length}.`,
            { cause },
        );
        this.name = "MaterialBatchWriteError";
        this.kind = kind;
        this.sourceName = sourceName;
        this.written = Object.freeze(written.map(item =>
            Object.freeze({ ...item })));
        this.failed = Object.freeze({ ...failed });
        this.remaining = Object.freeze(remaining.map(item =>
            Object.freeze({ ...item })));
    }
}

function conflictSignature(conflict) {
    return [
        conflict.path,
        conflict.existingSha256,
        conflict.expectedSha256,
    ].join("\u0000");
}

function conflictsMatchConfirmation(conflicts, expectedConflicts) {
    if (
        !Array.isArray(expectedConflicts)
        || conflicts.length !== expectedConflicts.length
    ) {
        return false;
    }

    const expected = new Set(expectedConflicts.map(conflictSignature));
    return conflicts.every(conflict =>
        expected.has(conflictSignature(conflict)));
}

function batchResult(kind, sourceName, results) {
    return {
        status: "written",
        kind,
        sourceName: String(sourceName ?? ""),
        results,
        created: results.filter(item => item.status === "created").length,
        replaced: results.filter(item => item.status === "replaced").length,
        unchanged: results.filter(item => item.status === "unchanged").length,
    };
}

function batchWriteError({
    kind,
    sourceName,
    results,
    item,
    remaining,
    cause,
}) {
    return new MaterialBatchWriteError({
        kind,
        sourceName: String(sourceName ?? ""),
        written: results,
        failed: {
            path: item.path,
            fileName: item.fileName,
            message: cause instanceof Error ? cause.message : String(cause),
        },
        remaining: remaining.map(next => ({
            path: next.path,
            fileName: next.fileName,
        })),
        cause,
    });
}

function requireTaskHandle(taskHandle) {
    if (!taskHandle || typeof taskHandle.getDirectoryHandle !== "function") {
        throw new Error("Каталог задания для записи не выбран.");
    }
}

function libraryDirectoryFor(kind) {
    const libraryDirectory = TASK_LIBRARY_DIRECTORIES[kind];
    if (!libraryDirectory) {
        throw new Error(`Неизвестный вид библиотеки: '${kind}'.`);
    }
    return libraryDirectory;
}

function libraryDirectoriesFor(kind) {
    const canonical = libraryDirectoryFor(kind);
    return kind === MATERIAL_LIBRARY_KINDS.HTS
        ? [canonical, "xapLibHTC"]
        : [canonical];
}

function sourcePathFor(kind, record) {
    assertSafeFileName(record.fileName);
    const path = record.relativePath
        ?? `${libraryPathFor(kind)}/${record.fileName}`;
    if (!libraryDirectoriesFor(kind).some(directory =>
        path === `${TASK_INPUT_DIRECTORY}/${directory}/${record.fileName}`)) {
        throw new Error(`Недопустимый путь характеристики: '${path}'.`);
    }
    return path;
}

function libraryPathFor(kind) {
    return `${TASK_INPUT_DIRECTORY}/${libraryDirectoryFor(kind)}`;
}

async function taskInputDirectory(taskHandle) {
    const lookup = await findDirectoryHandle(
        taskHandle,
        TASK_INPUT_DIRECTORY,
    );
    if (!lookup.exists) {
        throw new Error(
            `Каталог задания не содержит обязательный ${TASK_INPUT_DIRECTORY}.`,
        );
    }
    return lookup.directoryHandle;
}

async function prepareImportedMaterials({
    kind,
    materials,
    cryptoImpl,
}) {
    libraryDirectoryFor(kind);
    if (!Array.isArray(materials) || materials.length === 0) {
        throw new Error("Пакет импорта не содержит характеристик.");
    }

    const names = validateUniqueLegacyMaterialNames(
        materials.map(material => material?.name),
    );
    const fileKeys = new Set();
    for (const name of names) {
        const key = materialFileKey(legacyMaterialFileName(name));
        if (fileKeys.has(key)) {
            throw new Error(`Имена характеристик конфликтуют после нормализации Unicode: '${name}'.`);
        }
        fileKeys.add(key);
    }
    const encoder = new TextEncoder();
    const prepared = [];

    for (let index = 0; index < materials.length; index += 1) {
        const material = materials[index];
        if (!material || typeof material !== "object" || Array.isArray(material)) {
            throw new TypeError(
                `Характеристика импорта ${index + 1} должна быть объектом.`,
            );
        }
        if (material.name !== names[index]) {
            throw new Error(
                `Имя характеристики должно быть записано без начальных `
                + `и конечных пробелов: '${names[index]}'.`,
            );
        }
        if (material.kind !== kind) {
            throw new Error(
                `Характеристика '${names[index]}' имеет вид '${material.kind}', `
                + `ожидался '${kind}'.`,
            );
        }

        const expectedFileName = legacyMaterialFileName(names[index]);
        if (material.fileName !== expectedFileName) {
            throw new Error(
                `Имя файла характеристики '${names[index]}' должно быть `
                + `'${expectedFileName}'.`,
            );
        }
        assertSafeFileName(material.fileName);
        if (typeof material.text !== "string") {
            throw new TypeError(
                `Характеристика '${names[index]}' не содержит текст UTF-8.`,
            );
        }

        const bytes = encoder.encode(material.text);
        prepared.push({
            material,
            fileName: material.fileName,
            bytes,
            sha256: await digestBytes(bytes, cryptoImpl),
        });
    }

    return prepared;
}

export function createTaskMaterialLibraryService({
    libraryService = defaultLibraryService,
    cryptoImpl = globalThis.crypto,
} = {}) {
    if (typeof libraryService?.loadBytes !== "function") {
        throw new Error("Не задан сервис базовой библиотеки характеристик.");
    }

    async function materialCopies(inputDirectory, kind, fileName) {
        const copies = [];
        for (const directoryName of libraryDirectoriesFor(kind)) {
            const directory = await findDirectoryHandle(inputDirectory, directoryName);
            const existing = directory.exists
                ? await findMaterialFile(directory.directoryHandle, fileName)
                : { fileName, fileHandle: null, exists: false };
            const bytes = existing.exists
                ? await readHandleBytes(existing.fileHandle) : null;
            copies.push({
                ...existing,
                directoryName,
                directoryHandle: directory.directoryHandle,
                fileName: existing.fileName,
                path: `${TASK_INPUT_DIRECTORY}/${directoryName}/${existing.fileName}`,
                bytes,
                sha256: bytes ? await digestBytes(bytes, cryptoImpl) : null,
            });
        }
        return copies;
    }

    async function effectiveFile(inputDirectory, kind, fileName) {
        for (const directoryName of libraryDirectoriesFor(kind)) {
            const directory = await findDirectoryHandle(inputDirectory, directoryName);
            if (!directory.exists) continue;
            const existing = await findMaterialFile(directory.directoryHandle, fileName);
            if (existing.exists) return {
                ...existing,
                path: `${TASK_INPUT_DIRECTORY}/${directoryName}/${existing.fileName}`,
            };
        }
        return { exists: false, fileHandle: null };
    }

    async function removeVerifiedCopy(copy) {
        const existing = await findFileHandle(copy.directoryHandle, copy.fileName);
        const actualSha256 = existing.exists
            ? await digestBytes(await readHandleBytes(existing.fileHandle), cryptoImpl)
            : null;
        if (actualSha256 !== copy.sha256) {
            throw new MaterialFileConflictError({
                path: copy.path,
                existingSha256: actualSha256,
                expectedSha256: copy.sha256,
            });
        }
        await copy.directoryHandle.removeEntry(copy.fileName);
    }

    async function loadMaterials({ taskHandle, kind } = {}) {
        requireTaskHandle(taskHandle);
        const inputDirectory = await taskInputDirectory(taskHandle);
        const records = new Map();
        for (const libraryDirectory of libraryDirectoriesFor(kind)) {
            const lookup = await findDirectoryHandle(inputDirectory, libraryDirectory);
            if (!lookup.exists) continue;
            const directoryKeys = new Map();
            for await (const [fileName, handle] of lookup.directoryHandle.entries()) {
                if (handle?.kind !== "file" || !JSON_FILE_PATTERN.test(fileName)) continue;
                assertSafeFileName(fileName);
                const key = materialFileKey(fileName);
                if (directoryKeys.has(key)) {
                    throw new Error(
                        `Неоднозначные имена характеристик '${directoryKeys.get(key)}' и '${fileName}' `
                        + `в каталоге '${libraryDirectory}'.`,
                    );
                }
                directoryKeys.set(key, fileName);
                const relativePath = `${TASK_INPUT_DIRECTORY}/${libraryDirectory}/${fileName}`;
                const bytes = await readHandleBytes(handle);
                const snapshot = {
                    fileName,
                    relativePath,
                    sha256: await digestBytes(bytes, cryptoImpl),
                };
                const preferred = records.get(key);
                if (preferred) {
                    preferred.shadowedRecords.push(snapshot);
                    continue;
                }
                records.set(key, {
                    source: "task",
                    kind,
                    name: materialNameFromFile(fileName),
                    ...snapshot,
                    byteSize: bytes.byteLength,
                    data: decodeJsonMaterial(bytes, relativePath),
                    shadowedRecords: [],
                });
            }
        }
        return [...records.values()].sort((left, right) =>
            left.name.localeCompare(right.name, "ru-RU"));
    }

    async function copyMaterial({
        taskHandle,
        record,
        overwrite = false,
    } = {}) {
        requireTaskHandle(taskHandle);

        const libraryDirectory = libraryDirectoryFor(record?.kind);
        assertSafeFileName(record.fileName);
        if (
            typeof record.sha256 !== "string"
            || !SHA256_PATTERN.test(record.sha256)
        ) {
            throw new Error("Характеристика не содержит корректный SHA-256.");
        }

        const inputDirectory = await taskInputDirectory(taskHandle);
        const targetDirectory = await inputDirectory.getDirectoryHandle(
            libraryDirectory,
            { create: true },
        );
        const existing = await findMaterialFile(targetDirectory, record.fileName);
        const targetPath = `${libraryPathFor(record.kind)}/${existing.fileName}`;

        const effective = await effectiveFile(inputDirectory, record.kind, record.fileName);
        if (effective.exists) {
            const existingBytes = await readHandleBytes(effective.fileHandle);
            const existingSha256 = await digestBytes(existingBytes, cryptoImpl);
            if (existing.exists && existingSha256 === record.sha256) {
                return {
                    status: "unchanged",
                    path: targetPath,
                    byteSize: existingBytes.byteLength,
                    sha256: existingSha256,
                };
            }
            if (!overwrite && existingSha256 !== record.sha256) {
                throw new MaterialFileConflictError({
                    path: effective.path,
                    existingSha256,
                    expectedSha256: record.sha256,
                });
            }
        }

        const bytes = await libraryService.loadBytes(record);
        const fileHandle = existing.fileHandle
            ?? await targetDirectory.getFileHandle(
                record.fileName,
                { create: true },
            );
        await writeBytes(fileHandle, bytes);

        return {
            status: existing.exists ? "replaced" : "created",
            path: targetPath,
            byteSize: bytes.byteLength,
            sha256: record.sha256,
        };
    }

    async function copyMaterials({
        taskHandle,
        records,
        overwrite = false,
        expectedConflicts = undefined,
    } = {}) {
        requireTaskHandle(taskHandle);
        if (!Array.isArray(records) || records.length === 0) {
            throw new Error("Не выбраны базовые характеристики для копирования.");
        }

        const kind = records[0]?.kind;
        const libraryDirectory = libraryDirectoryFor(kind);
        const fileNames = new Set();
        for (const record of records) {
            if (record?.kind !== kind) {
                throw new Error(
                    "Один пакет копирования не может содержать характеристики разных видов.",
                );
            }
            assertSafeFileName(record.fileName);
            const fileKey = materialFileKey(record.fileName);
            if (fileNames.has(fileKey)) {
                throw new Error(
                    `Пакет копирования содержит повторное имя '${record.fileName}'.`,
                );
            }
            fileNames.add(fileKey);
            if (
                typeof record.sha256 !== "string"
                || !SHA256_PATTERN.test(record.sha256)
            ) {
                throw new Error(
                    `Характеристика '${record.fileName}' не содержит корректный SHA-256.`,
                );
            }
        }

        const inputDirectory = await taskInputDirectory(taskHandle);
        const targetLookup = await findDirectoryHandle(
            inputDirectory,
            libraryDirectory,
        );
        const targetPathPrefix = libraryPathFor(kind);
        const preflight = [];
        const conflicts = [];

        for (const record of records) {
            const existing = targetLookup.exists
                ? await findMaterialFile(
                    targetLookup.directoryHandle,
                    record.fileName,
                )
                : { fileName: record.fileName, fileHandle: null, exists: false };
            let existingSha256 = null;
            let existingByteSize = 0;

            const effective = await effectiveFile(inputDirectory, kind, record.fileName);
            if (effective.exists) {
                const existingBytes = await readHandleBytes(effective.fileHandle);
                existingByteSize = existingBytes.byteLength;
                existingSha256 = await digestBytes(existingBytes, cryptoImpl);
            }

            const path = `${targetPathPrefix}/${existing.fileName}`;
            const unchanged = existing.exists && existingSha256 === record.sha256;
            const item = {
                record,
                fileName: record.fileName,
                path,
                ...existing,
                existingSha256,
                existingByteSize,
                unchanged,
            };
            preflight.push(item);

            if (effective.exists && existingSha256 !== record.sha256) {
                conflicts.push({
                    path: effective.path,
                    fileName: record.fileName,
                    existingSha256,
                    expectedSha256: record.sha256,
                });
            }
        }

        if (
            conflicts.length > 0
            && (
                !overwrite
                || !conflictsMatchConfirmation(conflicts, expectedConflicts)
            )
        ) {
            throw new MaterialBatchConflictError(conflicts);
        }

        // Получение и SHA-проверка всех требуемых базовых файлов завершаются
        // до первой записи в задание.
        for (const item of preflight) {
            if (!item.unchanged) {
                item.bytes = await libraryService.loadBytes(item.record);
            }
        }

        const needsWrite = preflight.some(item => !item.unchanged);
        const targetDirectory = needsWrite
            ? targetLookup.directoryHandle
                ?? await inputDirectory.getDirectoryHandle(
                    libraryDirectory,
                    { create: true },
                )
            : targetLookup.directoryHandle;
        const results = [];

        for (let index = 0; index < preflight.length; index += 1) {
            const item = preflight[index];
            if (item.unchanged) {
                results.push({
                    status: "unchanged",
                    path: item.path,
                    byteSize: item.existingByteSize,
                    sha256: item.record.sha256,
                });
                continue;
            }

            try {
                const fileHandle = item.fileHandle
                    ?? await targetDirectory.getFileHandle(
                        item.fileName,
                        { create: true },
                    );
                await writeBytes(fileHandle, item.bytes);
                results.push({
                    status: item.exists ? "replaced" : "created",
                    path: item.path,
                    byteSize: item.bytes.byteLength,
                    sha256: item.record.sha256,
                });
            } catch (cause) {
                throw batchWriteError({
                    kind,
                    sourceName: "базовая библиотека",
                    results,
                    item,
                    remaining: preflight.slice(index + 1),
                    cause,
                });
            }
        }

        return batchResult(kind, "базовая библиотека", results);
    }

    async function writeImportedBatch({
        taskHandle,
        kind,
        materials,
        sourceName = "",
        overwrite = false,
        expectedConflicts = undefined,
    } = {}) {
        requireTaskHandle(taskHandle);
        const libraryDirectory = libraryDirectoryFor(kind);

        // Валидация всего пакета и расчёт ожидаемых SHA завершаются до
        // обращения к целевому каталогу и тем более до первой записи.
        const prepared = await prepareImportedMaterials({
            kind,
            materials,
            cryptoImpl,
        });
        const inputDirectory = await taskInputDirectory(taskHandle);
        const targetLookup = await findDirectoryHandle(
            inputDirectory,
            libraryDirectory,
        );
        const targetPathPrefix = libraryPathFor(kind);
        const preflight = [];
        const conflicts = [];

        for (const item of prepared) {
            const existing = targetLookup.exists
                ? await findMaterialFile(
                    targetLookup.directoryHandle,
                    item.fileName,
                )
                : { fileName: item.fileName, fileHandle: null, exists: false };
            let existingSha256 = null;

            const effective = await effectiveFile(inputDirectory, kind, item.fileName);
            if (effective.exists) {
                const existingBytes = await readHandleBytes(effective.fileHandle);
                existingSha256 = await digestBytes(existingBytes, cryptoImpl);
            }

            const path = `${targetPathPrefix}/${existing.fileName}`;
            const unchanged = existing.exists && existingSha256 === item.sha256;
            const state = {
                ...item,
                ...existing,
                existingSha256,
                path,
                unchanged,
            };
            preflight.push(state);

            if (effective.exists && existingSha256 !== item.sha256) {
                conflicts.push({
                    path: effective.path,
                    fileName: item.fileName,
                    existingSha256,
                    expectedSha256: item.sha256,
                });
            }
        }

        // Ни новый файл, ни даже отсутствующий каталог библиотеки до этой
        // точки не создаются.
        if (
            conflicts.length > 0
            && (
                !overwrite
                || !conflictsMatchConfirmation(conflicts, expectedConflicts)
            )
        ) {
            throw new MaterialBatchConflictError(conflicts);
        }

        const needsWrite = preflight.some(item => !item.unchanged);
        const targetDirectory = needsWrite
            ? targetLookup.directoryHandle
                ?? await inputDirectory.getDirectoryHandle(
                    libraryDirectory,
                    { create: true },
                )
            : targetLookup.directoryHandle;
        const results = [];

        for (let index = 0; index < preflight.length; index += 1) {
            const item = preflight[index];
            if (item.unchanged) {
                results.push({
                    status: "unchanged",
                    path: item.path,
                    byteSize: item.bytes.byteLength,
                    sha256: item.sha256,
                });
                continue;
            }

            try {
                const fileHandle = item.fileHandle
                    ?? await targetDirectory.getFileHandle(
                        item.fileName,
                        { create: true },
                    );
                await writeBytes(fileHandle, item.bytes);
                results.push({
                    status: item.exists ? "replaced" : "created",
                    path: item.path,
                    byteSize: item.bytes.byteLength,
                    sha256: item.sha256,
                });
            } catch (cause) {
                throw batchWriteError({
                    kind,
                    sourceName,
                    results,
                    item,
                    remaining: preflight.slice(index + 1),
                    cause,
                });
            }
        }

        return batchResult(kind, sourceName, results);
    }

    async function saveMaterial({
        taskHandle,
        material,
        sourceRecord,
    } = {}) {
        requireTaskHandle(taskHandle);
        const [prepared] = await prepareImportedMaterials({
            kind: material?.kind,
            materials: [material],
            cryptoImpl,
        });
        const kind = material.kind;
        if (sourceRecord?.kind !== undefined && sourceRecord.kind !== kind) {
            throw new Error("Исходная и сохраняемая характеристики имеют разные виды.");
        }
        const inputDirectory = await taskInputDirectory(taskHandle);
        const sourceFileName = sourceRecord?.fileName ?? prepared.fileName;
        assertSafeFileName(sourceFileName);
        const sourcePath = sourcePathFor(kind, sourceRecord ?? { fileName: sourceFileName });
        const copies = await materialCopies(inputDirectory, kind, sourceFileName);
        // Explicit Save replaces the current file, including edits made in a
        // text editor since loading. Only changes during this operation are
        // guarded while removing legacy copies or rolling back a failed write.
        const source = copies.find(copy => copy.path === sourcePath) ?? copies[0];

        const renamed = sourceFileName !== prepared.fileName;
        if (renamed && materialFileKey(sourceFileName) === materialFileKey(prepared.fileName)) {
            throw new Error("Изменение только регистра или Unicode-записи имени характеристики не поддерживается.");
        }
        const targetCopies = renamed
            ? await materialCopies(inputDirectory, kind, prepared.fileName) : copies;
        if (renamed) {
            const occupied = targetCopies.find(copy => copy.exists);
            if (occupied) throw new MaterialFileConflictError({
                path: occupied.path,
                existingSha256: occupied.sha256,
                expectedSha256: null,
            });
        }
        const target = targetCopies[0];
        const targetDirectory = target.directoryHandle
            ?? await inputDirectory.getDirectoryHandle(libraryDirectoryFor(kind), { create: true });
        const targetHandle = target.fileHandle
            ?? await targetDirectory.getFileHandle(prepared.fileName, { create: true });
        const removed = [];
        let writeCompleted = false;
        try {
            await writeBytes(targetHandle, prepared.bytes);
            writeCompleted = true;
            // Сначала удаляем legacy-дубликат; каноническая исходная копия
            // при переименовании остаётся доступной до последнего удаления.
            for (const copy of [...copies].reverse()) {
                if (!copy.exists || copy.path === target.path) continue;
                await removeVerifiedCopy(copy);
                removed.push(copy);
            }
        } catch (error) {
            // File System Access не предоставляет транзакцию между файлами.
            // Восстанавливаем уже удалённые исходники, не затирая новые данные.
            for (const copy of removed) {
                try {
                    const current = await findFileHandle(copy.directoryHandle, copy.fileName);
                    if (!current.exists) {
                        const restored = await copy.directoryHandle.getFileHandle(copy.fileName, { create: true });
                        await writeBytes(restored, copy.bytes);
                    }
                } catch { /* Сохраняем первичную ошибку. */ }
            }
            try {
                const actualSha256 = await digestBytes(await readHandleBytes(targetHandle), cryptoImpl);
                if (writeCompleted && actualSha256 === prepared.sha256) {
                    if (target.exists) await writeBytes(targetHandle, target.bytes);
                    else await targetDirectory.removeEntry(prepared.fileName);
                } else if (!writeCompleted && !target.exists && (await readHandleBytes(targetHandle)).byteLength === 0) {
                    await targetDirectory.removeEntry(prepared.fileName);
                }
            } catch { /* Сохраняем первичную ошибку. */ }
            throw error;
        }

        return {
            status: renamed ? "renamed" : source.exists ? "replaced" : "created",
            path: target.path,
            fileName: target.fileName,
            renamedFrom: renamed ? sourceFileName : null,
            byteSize: prepared.bytes.byteLength,
            sha256: prepared.sha256,
            shadowedRecords: [],
        };
    }

    async function deleteMaterials({ taskHandle, records } = {}) {
        requireTaskHandle(taskHandle);
        if (!Array.isArray(records) || records.length === 0) {
            throw new Error("Не выбраны локальные характеристики для удаления.");
        }
        const kind = records[0]?.kind;
        libraryDirectoryFor(kind);
        const inputDirectory = await taskInputDirectory(taskHandle);
        const prepared = [];
        for (const record of records) {
            if (record?.kind !== kind) {
                throw new Error("Один пакет удаления не может содержать характеристики разных видов.");
            }
            assertSafeFileName(record.fileName);
            sourcePathFor(kind, record);
            const copies = await materialCopies(inputDirectory, kind, record.fileName);
            prepared.push({ record, copies });
        }
        for (const { copies } of prepared) {
            // Удаление канонического файла не должно снова показать старый.
            for (const copy of [...copies].reverse()) {
                if (copy.exists) await removeVerifiedCopy(copy);
            }
        }
        return prepared.map(({ record }) => ({
            status: "deleted",
            path: sourcePathFor(kind, record),
        }));
    }

    return Object.freeze({
        loadMaterials,
        copyMaterial,
        copyMaterials,
        writeImportedBatch,
        saveMaterial,
        deleteMaterials,
    });
}

export const taskMaterialLibraryService = createTaskMaterialLibraryService();
