import test from "node:test";
import assert from "node:assert/strict";
import {
    mkdtemp,
    mkdir,
    readFile,
    readdir,
    rm,
    writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
    DEFAULT_LIBRARY_INDEX_FILE,
    DEFAULT_LIBRARY_SHA_FILE,
    prepareDefaultLibraryAssets,
    verifyDefaultLibraryAssets,
} from "../scripts/default-library-assets.mjs";

async function createFixture(root) {
    await mkdir(path.join(root, "xapLibFMM"), { recursive: true });
    await mkdir(path.join(root, "xapLibHTS"), { recursive: true });
    await writeFile(
        path.join(root, "xapLibFMM", "Сталь 3.txt"),
        Buffer.from(
            '{"tabl":[0.0,1.0,0.0,2.0],"hip":0.0,"comment":"ФММ"}\n',
            "utf8",
        ),
    );
    await writeFile(
        path.join(root, "xapLibHTS", "ВТСП — 1.txt"),
        Buffer.from(
            '{"j_type":1,"m_type":3,"comment":"ВТСП"}\n',
            "utf8",
        ),
    );
    await writeFile(
        path.join(root, "инфо.txt"),
        Buffer.from("служебная строка\n", "utf8"),
    );
}

test("default-library assets preserve source bytes and build a deterministic index", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "clark-default-library-"),
    );
    const sourceRoot = path.join(temporaryRoot, "source");
    const firstOutput = path.join(temporaryRoot, "first");
    const secondOutput = path.join(temporaryRoot, "second");

    try {
        await createFixture(sourceRoot);
        const first = await prepareDefaultLibraryAssets({
            sourceRoot,
            outputRoot: firstOutput,
        });
        await prepareDefaultLibraryAssets({
            sourceRoot,
            outputRoot: secondOutput,
        });

        assert.equal(first.index.schemaVersion, 1);
        assert.equal(first.index.source.fileCount, 3);
        assert.equal(first.index.libraries.FMM.records.length, 1);
        assert.equal(first.index.libraries.HTS.records.length, 1);

        const fmm = first.index.libraries.FMM.records[0];
        assert.equal(fmm.name, "Сталь 3");
        assert.deepEqual(fmm.summary, {
            comment: "ФММ",
            detailCount: 2,
        });
        assert.deepEqual(fmm.data.tabl, [0, 1, 0, 2]);

        for (const relativePath of [
            "xapLibFMM/Сталь 3.txt",
            "xapLibHTS/ВТСП — 1.txt",
            "инфо.txt",
        ]) {
            assert.deepEqual(
                await readFile(path.join(firstOutput, ...relativePath.split("/"))),
                await readFile(path.join(sourceRoot, ...relativePath.split("/"))),
            );
        }

        assert.deepEqual(
            await readFile(path.join(firstOutput, DEFAULT_LIBRARY_INDEX_FILE)),
            await readFile(path.join(secondOutput, DEFAULT_LIBRARY_INDEX_FILE)),
        );
        assert.deepEqual(
            await readFile(path.join(firstOutput, DEFAULT_LIBRARY_SHA_FILE)),
            await readFile(path.join(secondOutput, DEFAULT_LIBRARY_SHA_FILE)),
        );

        const verification = await verifyDefaultLibraryAssets({
            assetRoot: firstOutput,
        });
        assert.equal(verification.verifiedCount, 4);
        assert.equal(verification.fileCount, 5);
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("default-library verification rejects a modified copied material", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "clark-default-library-tamper-"),
    );
    const sourceRoot = path.join(temporaryRoot, "source");
    const outputRoot = path.join(temporaryRoot, "output");

    try {
        await createFixture(sourceRoot);
        await prepareDefaultLibraryAssets({ sourceRoot, outputRoot });
        await writeFile(
            path.join(outputRoot, "xapLibFMM", "Сталь 3.txt"),
            "изменено\n",
            "utf8",
        );

        await assert.rejects(
            verifyDefaultLibraryAssets({ assetRoot: outputRoot }),
            /SHA-256 собранного файла не совпадает/,
        );
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("canonical web-gui default library contains the transferred solver snapshot", async () => {
    const root = path.resolve("data", "default");
    const htsRoot = path.join(root, "xapLibHTS");
    const expectedHtsFiles = [
        "ВТСП Jc(H) базовая.txt",
        "BSCCO пресет.txt",
        "Fe pnictides пресет.txt",
        "Hg-Tl cuprates пресет.txt",
        "YBCO пресет.txt",
    ].sort();
    const fmm = JSON.parse(
        await readFile(path.join(root, "xapLibFMM", "STAL3.txt"), "utf8"),
    );
    const htsFiles = (await readdir(htsRoot))
        .filter(fileName => path.extname(fileName).toLowerCase() === ".txt")
        .sort();
    const htsMaterials = await Promise.all(
        expectedHtsFiles.map(async fileName => JSON.parse(
            await readFile(path.join(htsRoot, fileName), "utf8"),
        )),
    );

    assert.equal(Array.isArray(fmm.tabl), true);
    assert.equal(fmm.tabl.length, 24);
    assert.deepEqual(htsFiles, expectedHtsFiles);
    assert.equal(
        htsMaterials.every(material => typeof material.comment === "string"),
        true,
    );
});
