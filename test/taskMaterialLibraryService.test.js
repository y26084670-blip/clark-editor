import test from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";

import {
    createTaskMaterialLibraryService,
    MaterialBatchConflictError,
    MaterialBatchWriteError,
    MaterialFileConflictError,
} from "../src/services/taskMaterialLibraryService.js";

function sha256(bytes) {
    return createHash("sha256").update(bytes).digest("hex");
}

function notFound(name) {
    const error = new Error(`Не найдено: ${name}`);
    error.name = "NotFoundError";
    return error;
}

class MemoryFileHandle {
    constructor(bytes = new Uint8Array(), { failWrite = false } = {}) {
        this.kind = "file";
        this.bytes = new Uint8Array(bytes);
        this.writeCount = 0;
        this.failWrite = failWrite;
    }

    async getFile() {
        const bytes = new Uint8Array(this.bytes);
        return {
            async arrayBuffer() {
                return bytes.buffer.slice(
                    bytes.byteOffset,
                    bytes.byteOffset + bytes.byteLength,
                );
            },
        };
    }

    async createWritable() {
        const handle = this;
        let nextBytes = null;
        return {
            async write(bytes) {
                if (handle.failWrite) {
                    throw new Error("имитация сбоя записи");
                }
                nextBytes = new Uint8Array(bytes);
            },
            async close() {
                handle.bytes = nextBytes ?? new Uint8Array();
                handle.writeCount += 1;
            },
            async abort() {
                nextBytes = null;
            },
        };
    }
}

class MemoryDirectoryHandle {
    constructor() {
        this.kind = "directory";
        this.directories = new Map();
        this.files = new Map();
    }

    async getDirectoryHandle(name, { create = false } = {}) {
        if (!this.directories.has(name)) {
            if (!create) throw notFound(name);
            this.directories.set(name, new MemoryDirectoryHandle());
        }
        return this.directories.get(name);
    }

    async getFileHandle(name, { create = false } = {}) {
        if (!this.files.has(name)) {
            if (!create) throw notFound(name);
            this.files.set(name, new MemoryFileHandle());
        }
        return this.files.get(name);
    }

    async *entries() {
        for (const entry of this.directories) yield entry;
        for (const entry of this.files) yield entry;
    }

    async removeEntry(name) {
        if (!this.files.delete(name) && !this.directories.delete(name)) {
            throw notFound(name);
        }
    }
}

async function taskRoot() {
    const root = new MemoryDirectoryHandle();
    await root.getDirectoryHandle("input3XX", { create: true });
    return root;
}

async function taskInputDirectory(root) {
    return root.getDirectoryHandle("input3XX");
}

async function taskLibraryDirectory(root, name, options = undefined) {
    const inputDirectory = await taskInputDirectory(root);
    return inputDirectory.getDirectoryHandle(name, options);
}

function materialRecord(bytes, kind = "FMM") {
    const fileName = kind === "FMM" ? "Сталь 3.txt" : "ВТСП 1.txt";
    return {
        kind,
        fileName,
        sha256: sha256(bytes),
    };
}

function serviceFor(bytes) {
    let loadCount = 0;
    const service = createTaskMaterialLibraryService({
        libraryService: {
            async loadBytes() {
                loadCount += 1;
                return new Uint8Array(bytes);
            },
        },
        cryptoImpl: webcrypto,
    });
    return { service, getLoadCount: () => loadCount };
}

function importedMaterial(name, text, kind = "FMM") {
    return {
        kind,
        name,
        fileName: `${name}.txt`,
        text,
    };
}

test("a base material is copied byte-for-byte into the task-local library", async () => {
    const bytes = Buffer.from("{\"comment\":\"Сталь\"}\n", "utf8");
    const root = await taskRoot();
    const { service } = serviceFor(bytes);

    const result = await service.copyMaterial({
        taskHandle: root,
        record: materialRecord(bytes),
    });

    assert.deepEqual(result, {
        status: "created",
        path: "input3XX/xapLibFMM/Сталь 3.txt",
        byteSize: bytes.byteLength,
        sha256: sha256(bytes),
    });
    const library = await taskLibraryDirectory(root, "xapLibFMM");
    const file = await library.getFileHandle("Сталь 3.txt");
    assert.deepEqual(Buffer.from(file.bytes), bytes);
});

test("task-local libraries require the mandatory input3XX directory", async () => {
    const bytes = Buffer.from("{}\n", "utf8");
    const root = new MemoryDirectoryHandle();
    const { service } = serviceFor(bytes);

    await assert.rejects(
        service.copyMaterial({
            taskHandle: root,
            record: materialRecord(bytes),
        }),
        /обязательный input3XX/,
    );
    assert.equal(root.directories.has("xapLibFMM"), false);
    assert.equal(root.directories.has("input3XX"), false);
});

test("an identical task-local material is an idempotent copy", async () => {
    const bytes = Buffer.from("одинаковые байты", "utf8");
    const root = await taskRoot();
    const library = await taskLibraryDirectory(
        root,
        "xapLibHTS",
        { create: true },
    );
    library.files.set("ВТСП 1.txt", new MemoryFileHandle(bytes));
    const { service, getLoadCount } = serviceFor(bytes);

    const result = await service.copyMaterial({
        taskHandle: root,
        record: materialRecord(bytes, "HTS"),
    });

    assert.equal(result.status, "unchanged");
    assert.equal(getLoadCount(), 0);
});

test("a changed task-local material is preserved until overwrite is explicit", async () => {
    const baseBytes = Buffer.from("базовая версия", "utf8");
    const localBytes = Buffer.from("пользовательская версия", "utf8");
    const root = await taskRoot();
    const library = await taskLibraryDirectory(
        root,
        "xapLibFMM",
        { create: true },
    );
    const file = new MemoryFileHandle(localBytes);
    library.files.set("Сталь 3.txt", file);
    const { service, getLoadCount } = serviceFor(baseBytes);
    const record = materialRecord(baseBytes);

    await assert.rejects(
        service.copyMaterial({ taskHandle: root, record }),
        error => error instanceof MaterialFileConflictError,
    );
    assert.deepEqual(Buffer.from(file.bytes), localBytes);
    assert.equal(getLoadCount(), 0);

    const result = await service.copyMaterial({
        taskHandle: root,
        record,
        overwrite: true,
    });
    assert.equal(result.status, "replaced");
    assert.deepEqual(Buffer.from(file.bytes), baseBytes);
});

test("copying rejects path separators in a material file name", async () => {
    const bytes = Buffer.from("данные", "utf8");
    const root = await taskRoot();
    const { service } = serviceFor(bytes);

    await assert.rejects(
        service.copyMaterial({
            taskHandle: root,
            record: {
                ...materialRecord(bytes),
                fileName: "../Сталь.txt",
            },
        }),
        /Недопустимое имя характеристики/,
    );
});

test("selected base materials are all preflighted before the first copy", async () => {
    const newBytes = Buffer.from("новая базовая\n", "utf8");
    const baseConflictBytes = Buffer.from("базовый конфликт\n", "utf8");
    const localConflictBytes = Buffer.from("локальный конфликт\n", "utf8");
    const root = await taskRoot();
    const library = await taskLibraryDirectory(
        root,
        "xapLibFMM",
        { create: true },
    );
    const conflictFile = new MemoryFileHandle(localConflictBytes);
    library.files.set("Конфликт.txt", conflictFile);
    let loadCount = 0;
    const service = createTaskMaterialLibraryService({
        libraryService: {
            async loadBytes(record) {
                loadCount += 1;
                return new Uint8Array(record.bytes);
            },
        },
        cryptoImpl: webcrypto,
    });
    const records = [
        {
            kind: "FMM",
            fileName: "Новая.txt",
            sha256: sha256(newBytes),
            bytes: newBytes,
        },
        {
            kind: "FMM",
            fileName: "Конфликт.txt",
            sha256: sha256(baseConflictBytes),
            bytes: baseConflictBytes,
        },
    ];

    await assert.rejects(
        service.copyMaterials({ taskHandle: root, records }),
        error => {
            assert.ok(error instanceof MaterialBatchConflictError);
            assert.equal(error.conflicts.length, 1);
            return true;
        },
    );

    assert.equal(library.files.has("Новая.txt"), false);
    assert.equal(conflictFile.writeCount, 0);
    assert.equal(loadCount, 0);
});

test("an imported batch writes UTF-8 files only after full validation", async () => {
    const root = await taskRoot();
    const { service } = serviceFor(new Uint8Array());
    const materials = [
        importedMaterial("Сталь", "{\"comment\":\"Сталь\"}\n"),
        importedMaterial("Сплав", "{\"comment\":\"Сплав\"}\n"),
    ];

    const result = await service.writeImportedBatch({
        taskHandle: root,
        kind: "FMM",
        materials,
        sourceName: "XAP.lib",
    });

    assert.equal(result.status, "written");
    assert.equal(result.created, 2);
    assert.equal(result.replaced, 0);
    assert.equal(result.unchanged, 0);
    assert.equal(result.sourceName, "XAP.lib");

    const library = await taskLibraryDirectory(root, "xapLibFMM");
    for (const material of materials) {
        const file = await library.getFileHandle(material.fileName);
        assert.equal(
            new TextDecoder().decode(file.bytes),
            material.text,
        );
    }
});

test("batch conflicts are all reported before any file is written", async () => {
    const root = await taskRoot();
    const library = await taskLibraryDirectory(
        root,
        "xapLibFMM",
        { create: true },
    );
    const local = new MemoryFileHandle(Buffer.from("локальная", "utf8"));
    const localSecond = new MemoryFileHandle(Buffer.from("локальная 2", "utf8"));
    library.files.set("Конфликт.txt", local);
    library.files.set("Конфликт 2.txt", localSecond);
    const { service } = serviceFor(new Uint8Array());
    const materials = [
        importedMaterial("Новая", "новая\n"),
        importedMaterial("Конфликт", "импорт\n"),
        importedMaterial("Конфликт 2", "импорт 2\n"),
    ];

    await assert.rejects(
        service.writeImportedBatch({
            taskHandle: root,
            kind: "FMM",
            materials,
        }),
        error => {
            assert.ok(error instanceof MaterialBatchConflictError);
            assert.equal(error.conflicts.length, 2);
            assert.equal(
                error.conflicts[0].path,
                "input3XX/xapLibFMM/Конфликт.txt",
            );
            return true;
        },
    );

    assert.equal(library.files.has("Новая.txt"), false);
    assert.equal(local.writeCount, 0);
    assert.equal(localSecond.writeCount, 0);
    assert.equal(
        new TextDecoder().decode(local.bytes),
        "локальная",
    );
});

test("confirmed imported batch replaces conflicts and skips identical files", async () => {
    const root = await taskRoot();
    const library = await taskLibraryDirectory(
        root,
        "xapLibHTS",
        { create: true },
    );
    const changed = new MemoryFileHandle(Buffer.from("старая\n", "utf8"));
    const same = new MemoryFileHandle(Buffer.from("без изменений\n", "utf8"));
    library.files.set("A.txt", changed);
    library.files.set("B.txt", same);
    const { service } = serviceFor(new Uint8Array());

    const request = {
        taskHandle: root,
        kind: "HTS",
        materials: [
            importedMaterial("A", "новая\n", "HTS"),
            importedMaterial("B", "без изменений\n", "HTS"),
            importedMaterial("C", "создана\n", "HTS"),
        ],
    };
    let expectedConflicts;
    await assert.rejects(
        service.writeImportedBatch(request),
        error => {
            assert.ok(error instanceof MaterialBatchConflictError);
            expectedConflicts = error.conflicts;
            return true;
        },
    );
    await assert.rejects(
        service.writeImportedBatch({
            ...request,
            overwrite: true,
        }),
        error => error instanceof MaterialBatchConflictError,
    );
    const result = await service.writeImportedBatch({
        ...request,
        overwrite: true,
        expectedConflicts,
    });

    assert.deepEqual(
        result.results.map(item => item.status),
        ["replaced", "unchanged", "created"],
    );
    assert.equal(result.replaced, 1);
    assert.equal(result.unchanged, 1);
    assert.equal(result.created, 1);
    assert.equal(changed.writeCount, 1);
    assert.equal(same.writeCount, 0);
    assert.equal(
        new TextDecoder().decode(changed.bytes),
        "новая\n",
    );
});

test("changed conflicts after confirmation require a new confirmation", async () => {
    const root = await taskRoot();
    const library = await taskLibraryDirectory(
        root,
        "xapLibFMM",
        { create: true },
    );
    const file = new MemoryFileHandle(Buffer.from("первая локальная\n", "utf8"));
    library.files.set("A.txt", file);
    const { service } = serviceFor(new Uint8Array());
    const request = {
        taskHandle: root,
        kind: "FMM",
        materials: [importedMaterial("A", "импорт\n")],
    };
    let confirmedConflicts;

    await assert.rejects(
        service.writeImportedBatch(request),
        error => {
            assert.ok(error instanceof MaterialBatchConflictError);
            confirmedConflicts = error.conflicts;
            return true;
        },
    );

    file.bytes = new Uint8Array(Buffer.from("вторая локальная\n", "utf8"));

    await assert.rejects(
        service.writeImportedBatch({
            ...request,
            overwrite: true,
            expectedConflicts: confirmedConflicts,
        }),
        error => {
            assert.ok(error instanceof MaterialBatchConflictError);
            assert.notEqual(
                error.conflicts[0].existingSha256,
                confirmedConflicts[0].existingSha256,
            );
            return true;
        },
    );
    assert.equal(file.writeCount, 0);
    assert.equal(
        new TextDecoder().decode(file.bytes),
        "вторая локальная\n",
    );
});

test("a mid-write failure reports completed, failed, and remaining files", async () => {
    const root = await taskRoot();
    const library = await taskLibraryDirectory(
        root,
        "xapLibFMM",
        { create: true },
    );
    const failing = new MemoryFileHandle(
        Buffer.from("локальная B\n", "utf8"),
        { failWrite: true },
    );
    library.files.set("B.txt", failing);
    const { service } = serviceFor(new Uint8Array());
    const request = {
        taskHandle: root,
        kind: "FMM",
        sourceName: "XAP.lib",
        materials: [
            importedMaterial("A", "создана A\n"),
            importedMaterial("B", "замена B\n"),
            importedMaterial("C", "создана C\n"),
        ],
    };
    let expectedConflicts;
    await assert.rejects(
        service.writeImportedBatch(request),
        error => {
            assert.ok(error instanceof MaterialBatchConflictError);
            expectedConflicts = error.conflicts;
            return true;
        },
    );

    await assert.rejects(
        service.writeImportedBatch({
            ...request,
            overwrite: true,
            expectedConflicts,
        }),
        error => {
            assert.ok(error instanceof MaterialBatchWriteError);
            assert.equal(error.kind, "FMM");
            assert.equal(error.sourceName, "XAP.lib");
            assert.deepEqual(
                error.written.map(item => item.path),
                ["input3XX/xapLibFMM/A.txt"],
            );
            assert.equal(
                error.failed.path,
                "input3XX/xapLibFMM/B.txt",
            );
            assert.match(error.failed.message, /имитация сбоя записи/u);
            assert.deepEqual(
                error.remaining.map(item => item.path),
                ["input3XX/xapLibFMM/C.txt"],
            );
            return true;
        },
    );

    assert.equal(library.files.has("A.txt"), true);
    assert.equal(library.files.has("C.txt"), false);
    assert.equal(failing.writeCount, 0);
    assert.equal(
        new TextDecoder().decode(failing.bytes),
        "локальная B\n",
    );
});

test("an unsafe or duplicate batch fails before creating its library", async () => {
    const root = await taskRoot();
    const { service } = serviceFor(new Uint8Array());

    await assert.rejects(
        service.writeImportedBatch({
            taskHandle: root,
            kind: "FMM",
            materials: [
                importedMaterial("Допустимая", "данные\n"),
                importedMaterial("NUL", "данные\n"),
            ],
        }),
        /зарезервировано Windows/,
    );
    assert.equal(
        (await taskInputDirectory(root)).directories.has("xapLibFMM"),
        false,
    );

    await assert.rejects(
        service.writeImportedBatch({
            taskHandle: root,
            kind: "HTS",
            materials: [
                importedMaterial("Материал", "1\n", "HTS"),
                importedMaterial("материал", "2\n", "HTS"),
            ],
        }),
        /конфликтуют в Windows/,
    );
    assert.equal(
        (await taskInputDirectory(root)).directories.has("xapLibHTS"),
        false,
    );
});

test("task-local materials are loaded from directories inside input3XX", async () => {
    const root = await taskRoot();
    const library = await taskLibraryDirectory(
        root,
        "xapLibFMM",
        { create: true },
    );
    const first = Buffer.from('{"tabl":[0,1],"hip":0,"comment":"Б"}\n', "utf8");
    const second = Buffer.from('{"tabl":[0,1],"hip":0,"comment":"А"}\n', "utf8");
    library.files.set("Бета.txt", new MemoryFileHandle(first));
    library.files.set("Альфа.txt", new MemoryFileHandle(second));
    library.files.set("служебный.bin", new MemoryFileHandle(second));
    const { service } = serviceFor(new Uint8Array());

    const records = await service.loadMaterials({
        taskHandle: root,
        kind: "FMM",
    });

    assert.deepEqual(records.map(record => record.name), ["Альфа", "Бета"]);
    assert.equal(records[0].source, "task");
    assert.equal(
        records[0].relativePath,
        "input3XX/xapLibFMM/Альфа.txt",
    );
    assert.equal(records[0].sha256, sha256(second));
});

test("explicit local edit and delete accept changes since loading", async () => {
    const root = await taskRoot();
    const library = await taskLibraryDirectory(
        root,
        "xapLibFMM",
        { create: true },
    );
    const original = Buffer.from('{"comment":"исходная"}\n', "utf8");
    const file = new MemoryFileHandle(original);
    library.files.set("Сталь.txt", file);
    const { service } = serviceFor(new Uint8Array());
    const [loaded] = await service.loadMaterials({
        taskHandle: root,
        kind: "FMM",
    });

    const editedText = '{"comment":"изменённая"}\n';
    const result = await service.saveMaterial({
        taskHandle: root,
        material: importedMaterial("Сталь", editedText),
        expectedSha256: loaded.sha256,
    });
    assert.equal(result.status, "replaced");
    assert.equal(new TextDecoder().decode(file.bytes), editedText);

    const deleted = await service.deleteMaterials({ taskHandle: root, records: [loaded] });
    assert.deepEqual(deleted, [{
        status: "deleted",
        path: "input3XX/xapLibFMM/Сталь.txt",
    }]);
    assert.equal(library.files.has("Сталь.txt"), false);
});

test("saving an edited local name renames its JSON file", async () => {
    const root = await taskRoot();
    const library = await taskLibraryDirectory(
        root,
        "xapLibFMM",
        { create: true },
    );
    const original = Buffer.from('{"comment":"исходная"}\n', "utf8");
    library.files.set("Старое имя.txt", new MemoryFileHandle(original));
    const { service } = serviceFor(new Uint8Array());
    const [loaded] = await service.loadMaterials({
        taskHandle: root,
        kind: "FMM",
    });

    const editedText = '{"comment":"новое имя"}\n';
    const result = await service.saveMaterial({
        taskHandle: root,
        material: importedMaterial("Новое имя", editedText),
        sourceRecord: loaded,
    });

    assert.equal(result.status, "renamed");
    assert.equal(result.renamedFrom, "Старое имя.txt");
    assert.equal(result.fileName, "Новое имя.txt");
    assert.equal(library.files.has("Старое имя.txt"), false);
    const renamed = await library.getFileHandle("Новое имя.txt");
    assert.equal(new TextDecoder().decode(renamed.bytes), editedText);
});

test("renaming refuses to replace another local material", async () => {
    const root = await taskRoot();
    const library = await taskLibraryDirectory(
        root,
        "xapLibFMM",
        { create: true },
    );
    const original = Buffer.from('{"comment":"A"}\n', "utf8");
    const occupied = Buffer.from('{"comment":"B"}\n', "utf8");
    library.files.set("A.txt", new MemoryFileHandle(original));
    library.files.set("B.txt", new MemoryFileHandle(occupied));
    const { service } = serviceFor(new Uint8Array());
    const records = await service.loadMaterials({
        taskHandle: root,
        kind: "FMM",
    });
    const source = records.find(record => record.name === "A");

    await assert.rejects(
        service.saveMaterial({
            taskHandle: root,
            material: importedMaterial("B", '{"comment":"замена"}\n'),
            sourceRecord: source,
        }),
        error => error instanceof MaterialFileConflictError,
    );

    assert.equal(
        new TextDecoder().decode((await library.getFileHandle("A.txt")).bytes),
        new TextDecoder().decode(original),
    );
    assert.equal(
        new TextDecoder().decode((await library.getFileHandle("B.txt")).bytes),
        new TextDecoder().decode(occupied),
    );
});

async function putMaterial(root, directoryName, fileName, text) {
    const directory = await taskLibraryDirectory(root, directoryName, { create: true });
    const file = new MemoryFileHandle(Buffer.from(text, "utf8"));
    directory.files.set(fileName, file);
    return { directory, file };
}

test("HTS loading merges legacy files per name and records canonical precedence", async () => {
    const root = await taskRoot();
    const { service } = serviceFor(new Uint8Array());
    const oldText = '{"comment":"старая"}\n';
    const newText = '{"comment":"новая"}\n';
    await putMaterial(root, "xapLibHTC", "A.txt", oldText);
    await putMaterial(root, "xapLibHTC", "B.txt", oldText);
    await putMaterial(root, "xapLibHTS", "A.txt", newText);
    const records = await service.loadMaterials({ taskHandle: root, kind: "HTS" });

    assert.deepEqual(records.map(record => record.name), ["A", "B"]);
    assert.ok(records.every(record => record.kind === "HTS"));
    assert.equal(records[0].relativePath, "input3XX/xapLibHTS/A.txt");
    assert.equal(records[0].data.comment, "новая");
    assert.equal(records[0].sha256, sha256(Buffer.from(newText)));
    assert.deepEqual(records[0].shadowedRecords, [{
        fileName: "A.txt",
        relativePath: "input3XX/xapLibHTC/A.txt",
        sha256: sha256(Buffer.from(oldText)),
    }]);
    assert.equal(records[1].relativePath, "input3XX/xapLibHTC/B.txt");
    assert.equal(records[1].sha256, sha256(Buffer.from(oldText)));
});

for (const rename of [false, true]) {
    test(`saving a legacy HTS material migrates to canonical${rename ? " with rename" : ""}`, async () => {
        const root = await taskRoot();
        const { service } = serviceFor(new Uint8Array());
        const { directory: legacy } = await putMaterial(root, "xapLibHTC", "A.txt", '{"comment":"old"}\n');
        // Наличие нового каталога не мешает чтению старого материала.
        await putMaterial(root, "xapLibHTS", "Other.txt", '{}\n');
        const [sourceRecord] = await service.loadMaterials({ taskHandle: root, kind: "HTS" });
        const name = rename ? "B" : "A";
        const result = await service.saveMaterial({
            taskHandle: root,
            material: importedMaterial(name, '{"comment":"edited"}\n', "HTS"),
            sourceRecord,
        });
        assert.equal(result.status, rename ? "renamed" : "replaced");
        assert.equal(result.path, `input3XX/xapLibHTS/${name}.txt`);
        assert.deepEqual(result.shadowedRecords, []);
        assert.equal(legacy.files.has("A.txt"), false);
        const canonical = await taskLibraryDirectory(root, "xapLibHTS");
        assert.equal(new TextDecoder().decode(canonical.files.get(`${name}.txt`).bytes), '{"comment":"edited"}\n');
        assert.equal(canonical.files.has("Other.txt"), true);
    });
}

test("save and delete accept externally changed legacy materials", async () => {
    const root = await taskRoot();
    const { service } = serviceFor(new Uint8Array());
    const { file } = await putMaterial(root, "xapLibHTC", "A.txt", '{}\n');
    const [record] = await service.loadMaterials({ taskHandle: root, kind: "HTS" });
    file.bytes = Buffer.from('{"comment":"external"}\n');
    await service.saveMaterial({ taskHandle: root,
        material: importedMaterial("A", '{"comment":"edited"}\n', "HTS"), sourceRecord: record });
    const canonical = await taskLibraryDirectory(root, "xapLibHTS");
    assert.equal(new TextDecoder().decode(canonical.files.get("A.txt").bytes), '{"comment":"edited"}\n');
    await service.deleteMaterials({ taskHandle: root, records: [record] });
    assert.equal(canonical.files.has("A.txt"), false);
});

test("explicit save replaces a canonical file that appeared after legacy load", async () => {
    const root = await taskRoot();
    const { service } = serviceFor(new Uint8Array());
    await putMaterial(root, "xapLibHTC", "A.txt", '{}\n');
    const [record] = await service.loadMaterials({ taskHandle: root, kind: "HTS" });
    const { file } = await putMaterial(root, "xapLibHTS", "A.txt", '{"comment":"external"}\n');
    await service.saveMaterial({ taskHandle: root,
        material: importedMaterial("A", '{"comment":"edited"}\n', "HTS"), sourceRecord: record });
    assert.equal(new TextDecoder().decode(file.bytes), '{"comment":"edited"}\n');
});

test("editing canonical HTS removes its validated legacy duplicate", async () => {
    const root = await taskRoot();
    const { service } = serviceFor(new Uint8Array());
    const { directory: legacy } = await putMaterial(root, "xapLibHTC", "A.txt", '{"comment":"legacy"}\n');
    await putMaterial(root, "xapLibHTS", "A.txt", '{"comment":"canonical"}\n');
    const [record] = await service.loadMaterials({ taskHandle: root, kind: "HTS" });
    await service.saveMaterial({
        taskHandle: root,
        material: importedMaterial("A", '{"comment":"edited"}\n', "HTS"),
        sourceRecord: record,
    });
    assert.equal(legacy.files.has("A.txt"), false);
    const [reloaded] = await service.loadMaterials({ taskHandle: root, kind: "HTS" });
    assert.equal(reloaded.data.comment, "edited");
    assert.deepEqual(reloaded.shadowedRecords, []);
});

test("deleting canonical HTS also removes its legacy duplicate without revealing it", async () => {
    const root = await taskRoot();
    const { service } = serviceFor(new Uint8Array());
    const { directory: legacy } = await putMaterial(root, "xapLibHTC", "A.txt", '{"comment":"legacy"}\n');
    const { directory: canonical } = await putMaterial(root, "xapLibHTS", "A.txt", '{"comment":"canonical"}\n');
    const records = await service.loadMaterials({ taskHandle: root, kind: "HTS" });
    const result = await service.deleteMaterials({ taskHandle: root, records });
    assert.deepEqual(result, [{ status: "deleted", path: "input3XX/xapLibHTS/A.txt" }]);
    assert.equal(legacy.files.has("A.txt"), false);
    assert.equal(canonical.files.has("A.txt"), false);
    assert.deepEqual(await service.loadMaterials({ taskHandle: root, kind: "HTS" }), []);
});

test("deleting a legacy-only HTS material uses its original path", async () => {
    const root = await taskRoot();
    const { service } = serviceFor(new Uint8Array());
    const { directory: legacy } = await putMaterial(root, "xapLibHTC", "A.txt", '{}\n');
    const records = await service.loadMaterials({ taskHandle: root, kind: "HTS" });
    assert.deepEqual(await service.deleteMaterials({ taskHandle: root, records }), [
        { status: "deleted", path: "input3XX/xapLibHTC/A.txt" },
    ]);
    assert.equal(legacy.files.has("A.txt"), false);
});

for (const action of ["save", "delete"]) {
    test(`${action} accepts a shadowed legacy duplicate changed before the operation`, async () => {
        const root = await taskRoot();
        const { service } = serviceFor(new Uint8Array());
        const { file: legacy } = await putMaterial(root, "xapLibHTC", "A.txt", '{"comment":"legacy"}\n');
        const { file: canonical } = await putMaterial(root, "xapLibHTS", "A.txt", '{"comment":"canonical"}\n');
        const records = await service.loadMaterials({ taskHandle: root, kind: "HTS" });
        legacy.bytes = Buffer.from('{"comment":"external"}\n');
        const promise = action === "save"
            ? service.saveMaterial({
                taskHandle: root,
                material: importedMaterial("A", '{"comment":"edited"}\n', "HTS"),
                sourceRecord: records[0],
            })
            : service.deleteMaterials({ taskHandle: root, records });
        await promise;
        const directory = await taskLibraryDirectory(root, "xapLibHTS");
        assert.equal(directory.files.has("A.txt"), action === "save");
        if (action === "save") assert.equal(new TextDecoder().decode(canonical.bytes), '{"comment":"edited"}\n');
    });
}

test("a failed migration write preserves the legacy source and removes an empty target", async () => {
    const root = await taskRoot();
    const { service } = serviceFor(new Uint8Array());
    const { file: original } = await putMaterial(root, "xapLibHTC", "A.txt", '{"comment":"legacy"}\n');
    const records = await service.loadMaterials({ taskHandle: root, kind: "HTS" });
    const canonical = await taskLibraryDirectory(root, "xapLibHTS", { create: true });
    const getFileHandle = canonical.getFileHandle.bind(canonical);
    canonical.getFileHandle = async (name, options) => {
        const handle = await getFileHandle(name, options);
        if (options?.create) handle.failWrite = true;
        return handle;
    };
    await assert.rejects(service.saveMaterial({
        taskHandle: root,
        material: importedMaterial("A", '{"comment":"edited"}\n', "HTS"),
        sourceRecord: records[0],
    }), /имитация сбоя записи/);
    assert.equal(canonical.files.has("A.txt"), false);
    assert.equal(new TextDecoder().decode(original.bytes), '{"comment":"legacy"}\n');
});

test("copying a base HTS material checks legacy conflicts and writes only canonical", async () => {
    const root = await taskRoot();
    const bytes = Buffer.from('{"comment":"base"}\n');
    const { service } = serviceFor(bytes);
    const { file: legacy } = await putMaterial(root, "xapLibHTC", "ВТСП 1.txt", '{"comment":"legacy"}\n');
    const record = materialRecord(bytes, "HTS");
    await assert.rejects(service.copyMaterial({ taskHandle: root, record }), error => {
        assert.ok(error instanceof MaterialFileConflictError);
        assert.equal(error.path, "input3XX/xapLibHTC/ВТСП 1.txt");
        return true;
    });
    const result = await service.copyMaterial({ taskHandle: root, record, overwrite: true });
    assert.equal(result.path, "input3XX/xapLibHTS/ВТСП 1.txt");
    assert.equal(legacy.writeCount, 0);
    const canonical = await taskLibraryDirectory(root, "xapLibHTS");
    assert.deepEqual(Buffer.from(canonical.files.get("ВТСП 1.txt").bytes), bytes);
});

for (const method of ["copyMaterials", "writeImportedBatch"]) {
    test(`${method} checks legacy conflicts before creating canonical files`, async () => {
        const root = await taskRoot();
        const bytes = Buffer.from('{"comment":"new"}\n');
        const { service } = serviceFor(bytes);
        const { file: legacy } = await putMaterial(root, "xapLibHTC", "ВТСП 1.txt", '{"comment":"legacy"}\n');
        const request = method === "copyMaterials"
            ? { taskHandle: root, records: [materialRecord(bytes, "HTS")] }
            : { taskHandle: root, kind: "HTS", materials: [importedMaterial("ВТСП 1", bytes.toString(), "HTS")] };
        let expectedConflicts;
        await assert.rejects(service[method](request), error => {
            assert.ok(error instanceof MaterialBatchConflictError);
            expectedConflicts = error.conflicts;
            assert.equal(expectedConflicts[0].path, "input3XX/xapLibHTC/ВТСП 1.txt");
            return true;
        });
        assert.equal((await taskInputDirectory(root)).directories.has("xapLibHTS"), false);
        const result = await service[method]({ ...request, overwrite: true, expectedConflicts });
        assert.equal(result.results[0].path, "input3XX/xapLibHTS/ВТСП 1.txt");
        assert.equal(legacy.writeCount, 0);
        assert.deepEqual(Buffer.from((await taskLibraryDirectory(root, "xapLibHTS")).files.get("ВТСП 1.txt").bytes), bytes);
    });
}

test("a source record cannot redirect a save outside its material directories", async () => {
    const root = await taskRoot();
    const { service } = serviceFor(new Uint8Array());
    await assert.rejects(service.saveMaterial({
        taskHandle: root,
        material: importedMaterial("A", '{}\n', "HTS"),
        sourceRecord: {
            kind: "HTS", fileName: "A.txt", sha256: sha256(Buffer.from('{}\n')),
            relativePath: "input3XX/../A.txt",
        },
    }), /Недопустимый путь характеристики/);
});

test("renaming canonical HTS cannot hide another material in the legacy directory", async () => {
    const root = await taskRoot();
    const { service } = serviceFor(new Uint8Array());
    const { directory: canonical } = await putMaterial(root, "xapLibHTS", "A.txt", '{}\n');
    await putMaterial(root, "xapLibHTC", "B.txt", '{}\n');
    const records = await service.loadMaterials({ taskHandle: root, kind: "HTS" });
    await assert.rejects(service.saveMaterial({
        taskHandle: root,
        material: importedMaterial("B", '{}\n', "HTS"),
        sourceRecord: records.find(record => record.name === "A"),
    }), MaterialFileConflictError);
    assert.equal(canonical.files.has("A.txt"), true);
    assert.equal(canonical.files.has("B.txt"), false);
});

test("a legacy change during migration rolls back the new canonical file", async () => {
    const root = await taskRoot();
    const { service } = serviceFor(new Uint8Array());
    const { file: legacy } = await putMaterial(root, "xapLibHTC", "A.txt", '{"comment":"old"}\n');
    const [sourceRecord] = await service.loadMaterials({ taskHandle: root, kind: "HTS" });
    const canonical = await taskLibraryDirectory(root, "xapLibHTS", { create: true });
    const getFileHandle = canonical.getFileHandle.bind(canonical);
    canonical.getFileHandle = async (name, options) => {
        const handle = await getFileHandle(name, options);
        if (options?.create) {
            const createWritable = handle.createWritable.bind(handle);
            handle.createWritable = async () => {
                const writable = await createWritable();
                const close = writable.close;
                writable.close = async () => {
                    await close();
                    legacy.bytes = Buffer.from('{"comment":"external"}\n');
                };
                return writable;
            };
        }
        return handle;
    };
    await assert.rejects(service.saveMaterial({
        taskHandle: root,
        material: importedMaterial("A", '{"comment":"edited"}\n', "HTS"),
        sourceRecord,
    }), MaterialFileConflictError);
    assert.equal(canonical.files.has("A.txt"), false);
    assert.equal(new TextDecoder().decode(legacy.bytes), '{"comment":"external"}\n');
});

for (const legacyName of ["a.txt", "a\u0301.txt"]) {
    const canonicalName = legacyName === "a.txt" ? "A.txt" : "Á.txt";
    for (const action of ["save", "delete"]) {
        test(`${action} merges case/Unicode variants ${canonicalName}/${legacyName} without reviving legacy`, async () => {
            const root = await taskRoot();
            const { service } = serviceFor(new Uint8Array());
            const { directory: legacy } = await putMaterial(root, "xapLibHTC", legacyName, '{"comment":"old"}\n');
            const { directory: canonical } = await putMaterial(root, "xapLibHTS", canonicalName, '{"comment":"current"}\n');
            const records = await service.loadMaterials({ taskHandle: root, kind: "HTS" });
            assert.equal(records.length, 1);
            assert.equal(records[0].fileName, canonicalName);
            assert.equal(records[0].data.comment, "current");
            assert.equal(records[0].shadowedRecords[0].fileName, legacyName);
            assert.equal(records[0].shadowedRecords[0].relativePath, `input3XX/xapLibHTC/${legacyName}`);
            if (action === "save") {
                const result = await service.saveMaterial({
                    taskHandle: root,
                    material: importedMaterial(canonicalName.slice(0, -4), '{"comment":"edited"}\n', "HTS"),
                    sourceRecord: records[0],
                });
                assert.equal(result.path, `input3XX/xapLibHTS/${canonicalName}`);
                assert.equal(result.fileName, canonicalName);
                assert.equal(canonical.files.size, 1);
            } else {
                await service.deleteMaterials({ taskHandle: root, records });
                assert.equal(canonical.files.size, 0);
            }
            assert.equal(legacy.files.size, 0);
            const reloaded = await service.loadMaterials({ taskHandle: root, kind: "HTS" });
            assert.equal(reloaded.length, action === "save" ? 1 : 0);
        });
    }
}

test("ambiguous normalized filenames within one library are rejected before changes", async () => {
    const root = await taskRoot();
    const bytes = Buffer.from('{}\n');
    const { service } = serviceFor(bytes);
    const { directory } = await putMaterial(root, "xapLibHTS", "ВТСП 1.txt", '{}\n');
    await putMaterial(root, "xapLibHTS", "втсп 1.txt", '{}\n');
    await assert.rejects(service.loadMaterials({ taskHandle: root, kind: "HTS" }), /Неоднозначные имена/);
    await assert.rejects(service.copyMaterial({ taskHandle: root, record: materialRecord(bytes, "HTS") }), /Неоднозначные имена/);
    assert.equal(directory.files.size, 2);
    assert.ok([...directory.files.values()].every(file => file.writeCount === 0));
});

test("deleting a material tolerates an already removed legacy shadow", async () => {
    const root = await taskRoot();
    const { service } = serviceFor(new Uint8Array());
    const { directory: legacy } = await putMaterial(root, "xapLibHTC", "a.txt", '{}\n');
    const { directory: canonical } = await putMaterial(root, "xapLibHTS", "A.txt", '{}\n');
    const records = await service.loadMaterials({ taskHandle: root, kind: "HTS" });
    legacy.files.delete("a.txt");
    await service.deleteMaterials({ taskHandle: root, records });
    assert.equal(canonical.files.has("A.txt"), false);
});

test("canonical copy overwrites an existing normalized filename without creating an alias", async () => {
    const root = await taskRoot();
    const bytes = Buffer.from('{"comment":"base"}\n');
    const { service } = serviceFor(bytes);
    const { directory } = await putMaterial(root, "xapLibHTS", "втсп 1.txt", '{}\n');
    const result = await service.copyMaterial({ taskHandle: root, record: materialRecord(bytes, "HTS"), overwrite: true });
    assert.equal(result.path, "input3XX/xapLibHTS/втсп 1.txt");
    assert.equal(directory.files.size, 1);
    assert.deepEqual(Buffer.from(directory.files.get("втсп 1.txt").bytes), bytes);
});
