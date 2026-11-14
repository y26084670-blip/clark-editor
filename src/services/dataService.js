import { FIELD_TYPES, STORAGE_TYPES } from "../services/schemas/common/constants";
import { selectionService } from "./selectionService";
import {
    deserialize,
    findUnknownStoragePaths,
    getStorageValue,
    hasStorageValue,
    propertyStoragePath,
    propertyStorageReadPaths,
    serialize,
} from "./model/modelSerializer";
import {
    columnCount,
    fromStorage,
    hasMatrixShape,
    valuesToCells,
} from "./model/arrayShape";
import { createWarning, createError } from "../tabulator/validators/common/createDiagnostic";
import { firstNamedEnumValue } from "./schemas/common/enumOptions";
import {
    isStoredProperty,
    recomputeModel,
} from "./model/modelCompute";
import {
    assertFixedRecordCount,
    parseFixedRecordLines,
} from "../tabulator/converters/recordColumns";

// используется след принцип (а)синхронности:
// всё, что связано с файловой системой (File System Access API) — async;
// всё, что работает только с данными в памяти — обычные функции.

export const dataService = {

    // Загрузка данных.
    // diagnostics — необязательный коллектор диагностики загрузки.
    // loadState.requiresSave — данные дополнены и требуют записи в файл.
    async load(dirHandle, schema, diagnostics = [], loadState = {}) {
        loadState.requiresSave = false;
        if (!dirHandle) {
            throw new Error("Task directory not selected.");
        }

        const tab = { id: schema.id, title: schema.title };

        let inputHandle;
        try {
            inputHandle = await dirHandle.getDirectoryHandle(
                schema.config.directory
            );
        }
        catch (err) {
            if (err.name === "NotFoundError") {
                // Штатная предварительная проверка выполняется в Tasks.
                // Это защитная диагностика на случай удаления каталога
                // после выбора задания.
                diagnostics.push(createError({
                    tab,
                    message: `Каталог '${schema.config.directory}' не найден`,
                }));
                return null;
            }
            throw err;
        }

        let fileHandle;

        // Отсутствие файла диагностируется по обязательности схемы.
        try {
            fileHandle = await inputHandle.getFileHandle(
                schema.config.file
            );
        }
        catch (err) {
            if (err.name === "NotFoundError") {
                const createMissingDiagnostic = schema.config.required
                    ? createError
                    : createWarning;
                diagnostics.push(createMissingDiagnostic({
                    tab,
                    message: `Файл '${schema.config.file}' отсутствует`,
                }));
                return null;
            }
            throw err;
        }

        // Файл существует.
        const file = await fileHandle.getFile();
        const text = await file.text();

        let storageModel;
        let requiresSave = false;
        try {
            switch (schema.config.storage) {
                case STORAGE_TYPES.CLUSTER:
                    storageModel = this.readCluster(text);
                    break;
                case STORAGE_TYPES.RECORDS:
                    storageModel = this.readRecords(
                        text,
                        schema.config.recordCount,
                    );
                    if (
                        schema.config.singleRecordFallback &&
                        storageModel.length === 1
                    ) {
                        assertFixedRecordCount(storageModel, 1);
                        storageModel = Array.from(
                            { length: schema.config.recordCount },
                            () => structuredClone(storageModel[0]),
                        );
                        requiresSave = true;
                        diagnostics.push(createWarning({
                            tab,
                            message: schema.config.singleRecordFallback.message,
                        }));
                    }
                    assertFixedRecordCount(
                        storageModel,
                        schema.config.recordCount,
                    );
                    break;
                default:
                    throw new Error(
                        `Unsupported storage type: ${schema.config.storage}`
                    );
            }
        }
        catch (err) {
            diagnostics.push(createError({
                tab,
                message: `Файл '${schema.config.file}' не разобран: ${err.message}`,
            }));
            return null;
        }

        if (schema.id === "elements" && Array.isArray(storageModel)) {
            for (const record of storageModel) {
                if (typeof record.take === "boolean") {
                    record.take = 0;
                    requiresSave = true;
                }
            }
        }
        this.checkStorageKeys(storageModel, schema, diagnostics, tab);
        this.checkArrayShape(storageModel, schema, diagnostics, tab);

        const baseModel = deserialize(storageModel, schema);
        const model = recomputeModel(schema, baseModel).model;
        loadState.requiresSave = requiresSave;
        return model;
    },

    // Состав ключей файла относительно схемы.
    checkStorageKeys(storageModel, schema, diagnostics, tab) {
        const declared = Object.entries(schema.properties)
            .filter(([, property]) => isStoredProperty(property))
            .map(([key, property]) =>
                propertyStorageReadPaths(key, property)
            );
        if (Object.keys(schema.properties).length === 0) return;

        const items = Array.isArray(storageModel)
            ? storageModel
            : [storageModel];

        const unknown = new Set();
        const missing = new Set();

        for (const item of items) {
            if (!item || typeof item !== "object") continue;

            findUnknownStoragePaths(
                item,
                declared.flat(),
                schema.config.obsoleteStoragePaths,
            )
                .forEach(path => unknown.add(path));

            for (const paths of declared) {
                if (!paths.some(path => hasStorageValue(item, path))) missing.add(paths[0]);
            }
        }

        if (unknown.size) {
            diagnostics.push(createWarning({
                tab,
                message:
                    `В файле '${schema.config.file}' есть ключи, не объявленные схемой: `
                    + [...unknown].join(", "),
            }));
        }
        if (missing.size) {
            diagnostics.push(createWarning({
                tab,
                message:
                    `В файле '${schema.config.file}' отсутствуют свойства схемы: `
                    + [...missing].join(", "),
            }));
        }
    },

    // Форма плоского массива: кратность nColumns и согласие с n.
    checkArrayShape(storageModel, schema, diagnostics, tab) {
        const items = Array.isArray(storageModel)
            ? storageModel
            : [storageModel];

        items.forEach((item, index) => {
            if (!item || typeof item !== "object") return;

            for (const [key, property] of Object.entries(schema.properties)) {
                if (!isStoredProperty(property)) continue;
                if (property.type !== FIELD_TYPES.ARRAY) continue;

                const nColumns = property.nColumns;
                if (!nColumns) continue;

                const value = getStorageValue(
                    item,
                    propertyStoragePath(key, property),
                );
                if (!Array.isArray(value)) continue;

                const where = Array.isArray(storageModel)
                    ? ` (запись ${index + 1})`
                    : "";

                if (value.length % nColumns !== 0) {
                    diagnostics.push(createWarning({
                        tab,
                        row: Array.isArray(storageModel) ? index + 1 : undefined,
                        property: key,
                        message:
                            `Длина '${key}' (${value.length}) не кратна числу колонок `
                            + `${nColumns}${where}`,
                    }));
                    continue;
                }

                if (typeof item.n === "number" &&
                    value.length !== item.n * nColumns) {
                    diagnostics.push(createWarning({
                        tab,
                        row: Array.isArray(storageModel) ? index + 1 : undefined,
                        property: key,
                        message:
                            `Длина '${key}' (${value.length}) не соответствует `
                            + `n = ${item.n} при ${nColumns} колонках${where}`,
                    }));
                }
            }
        });
    },

    // Сохранение данных
    async save(dirHandle, schema, baseModel) {
        if (!dirHandle) {
            throw new Error("Task directory not selected.");
        }

        // Вкладка без объявленных хранимых свойств не записывается:
        // иначе файл был бы затёрт пустым содержимым.
        if (
            !Object.values(schema.properties).some(isStoredProperty)
        ) {
            return false;
        }

        if (baseModel === null || baseModel === undefined) return false;

        const normalized = recomputeModel(schema, baseModel).model;
        const storageModel = serialize(normalized, schema);

        if (schema.config.storage === STORAGE_TYPES.RECORDS) {
            assertFixedRecordCount(
                storageModel,
                schema.config.recordCount,
            );
        }

        const inputHandle = await dirHandle.getDirectoryHandle(
            schema.config.directory,
            { create: true }
        );

        const fileHandle = await inputHandle.getFileHandle(
            schema.config.file,
            { create: true }
        );

        const writable = await fileHandle.createWritable();
        let text;

        switch (schema.config.storage) {
            case STORAGE_TYPES.CLUSTER:
                text = this.writeCluster(storageModel);
                break;
            case STORAGE_TYPES.RECORDS:
                text = this.writeRecords(storageModel);
                break;
            default:
                throw new Error(
                    `Unsupported storage: ${schema.config.storage}`
                );
        }
        await writable.write(text);
        await writable.close();
        return true;
    },

    // Один JSON-объект
    readCluster(text) {
        return JSON.parse(text);
    },

    writeCluster(cluster) {
        return JSON.stringify(cluster);
    },

    // JSON Lines (по одному объекту в строке)
    readRecords(text, recordCount = undefined) {
        if (recordCount !== undefined) {
            return parseFixedRecordLines(text);
        }

        return text
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line.length)
            .map(line => JSON.parse(line));
    },

    writeRecords(records) {
        return records
            .map(record => JSON.stringify(record))
            .join("\n");
    },

    // Формирует данные по умолчанию на основании схемы.
    // Рабочий UI эту функцию сейчас не вызывает.
    // Для storage = "cluster" возвращает объект.
    // Для storage = "records" возвращает recordCount записей, если число
    // зафиксировано схемой, иначе одну запись по умолчанию.
    createDefaultData(schema) {
        switch (schema.config.storage) {
            case STORAGE_TYPES.CLUSTER: {
                const cluster = {};
                for (const [key, property] of Object.entries(schema.properties)) {
                    cluster[key] = this.createDefaultClusterValue(property);
                }
                return recomputeModel(schema, cluster).model;
            }
            case STORAGE_TYPES.RECORDS: {
                const count = schema.config.recordCount ?? 1;
                return Array.from(
                    { length: count },
                    () => this.createDefaultRecord(schema),
                );
            }
            default:
                throw new Error(
                    `Unknown storage type "${schema.config.storage}".`
                );
        }
    },

    // Default CLUSTER сразу приводится из StorageModel-формы в BaseModel.
    // Нематричный ARRAY остаётся одномерным, как при deserialize.
    createDefaultClusterValue(property) {
        const value = this.createDefaultScalar(property);

        if (
            property.type === FIELD_TYPES.ARRAY &&
            hasMatrixShape(property) &&
            Array.isArray(value)
        ) {
            return fromStorage(value, property);
        }

        return value;
    },

    createDefaultScalar(property) {
        if (property.default !== undefined)
            return structuredClone(property.default);
        switch (property.type) {
            case FIELD_TYPES.STRING:
            case FIELD_TYPES.PATH:
            case FIELD_TYPES.DATE:
                return "";
            case FIELD_TYPES.INTEGER:
            case FIELD_TYPES.FLOAT:
                return 0;
            case FIELD_TYPES.BOOLEAN:
                return false;
            case FIELD_TYPES.ENUM: {
                const value = firstNamedEnumValue(property.enum);
                return value === undefined ? "" : value;
            }
            default:
                return null;
        }
    },

    // Формирует одну запись обычной таблицы.
    createDefaultRecord(schema) {
        const record = {};
        for (const [key, property] of Object.entries(schema.properties)) {
            if (property.type === FIELD_TYPES.ARRAY) {
                record[key] = this.createDefaultNestedValue(property);
            }
            else {
                record[key] = this.createDefaultScalar(property);
            }
        }
        return recomputeModel(schema, [record]).model[0];
    },

    // строит значение массива
    createDefaultNestedValue(property) {
        // Фиксированные именованные строки получают полную форму из
        // плоского StorageModel-default. Для изменяемых массивов сохраняется
        // существующее поведение: одна новая строка.
        if (
            property.rowsMutable === false &&
            hasMatrixShape(property) &&
            Array.isArray(property.default)
        ) {
            return fromStorage(
                structuredClone(property.default),
                property,
            );
        }

        const values = [];
        const nColumns = columnCount(property);
        for (let i = 0; i < nColumns; i++) {
            values.push(this.createDefaultScalar(property.items));
        }
        return [values];
    },

    createDefaultNestedRow(property) {
        return valuesToCells(
            this.createDefaultNestedValue(property)[0]
        );
    }

};
