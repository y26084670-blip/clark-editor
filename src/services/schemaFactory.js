//==============================================================================
// Создание полной схемы вкладки
//------------------------------------------------------------------------------
// Архитектурный принцип (Design by Contract)
//
// createSchema() является контрактом между разработчиком и системой.
//
// Предполагается, что все обязательные поля схемы заданы корректно.
// Фабрика не валидирует конфигурацию в целом: она проверяет только
// контрактные условия, нарушение которых делает схему нерабочей.
// Перечень таких условий задан в validateSchema().
//
// Пользовательские данные проверяются отдельно:
// constraintValidator (ограничения ячейки) и modelValidator (согласованность).
//==============================================================================
import {
    DEFAULT_SUMMARY_MAX_LENGTH,
    DIRECTORIES,
    FIELD_TYPES,
    STORAGE_TYPES,
    VIEW_TYPES,
} from "../services/schemas/common/constants";
import { isArrayOrder } from "./model/arrayShape";
import {
    isComputedProperty,
    isStoredProperty,
    validateComputationSchema,
} from "./model/modelCompute";
import {
    findNamedEnumOption,
    isNamedEnumOption,
} from "./schemas/common/enumOptions";

export function createSchema({
    // Идентификация
    id,
    title,
    // Источник данных
    directory = DIRECTORIES.INPUT,
    file,
    // тип таблицы
    storage = STORAGE_TYPES.CLUSTER,
    // данный элемент - требуемый
    required = true,
    // RECORDS: строгое число записей в BaseModel и сохраняемом файле.
    recordCount = undefined,
    // При чтении одной записи: независимые копии до recordCount и предупреждение.
    singleRecordFallback = undefined,
    // Устаревшие пути StorageModel: молча принимаются только при чтении.
    obsoleteStoragePaths = [],
    // Оформление
    rowLabelTitle = "Параметр",
    rowLabelDescription = "parameter Description",
    valueTitle = "Значение",
    rowLabelWidth = 250,
    // RECORDS: отображать каждое слово заголовка свойства на отдельной строке.
    columnHeaderWordLines = false,
    // RECORDS: номер исходной записи в подсказках основной таблицы.
    rowNumberTooltip = false,
    // Растянуть последнюю видимую колонку основной таблицы до свободного края.
    stretchLastColumn = false,
    // Описание полей
    properties = {},
    // Проекции вкладки. views.main выводит единственное ARRAY/TABLE
    // свойство RECORDS непосредственно в основной области; views.graph
    // описывает линейный график выделенных RECORDS-записей.
    views = {},
    summaryMaxLength = DEFAULT_SUMMARY_MAX_LENGTH,
}) {
    if (!id) {
        throw new Error("Schema id is required");
    }
    const schema = {

        id,

        title,

        config: {

            directory,
            file,

            storage,

            required,
            recordCount,
            singleRecordFallback,
            obsoleteStoragePaths,

            rowLabelTitle,
            rowLabelDescription,
            valueTitle,
            rowLabelWidth,
            columnHeaderWordLines,
            rowNumberTooltip,
            stretchLastColumn,

            summaryMaxLength,

        },

        properties,
        views,
        /*
        ==============================================================================
        Property descriptor
        ==============================================================================
        
        Каждый элемент schema.properties описывает один параметр модели.
        
        Общие атрибуты
        ------------------------------------------------------------------------------
        type            Тип данных (FIELD_TYPES.*)
        label           Заголовок параметра
        description     Подсказка (tooltip)
        default         Значение по умолчанию
        hidden          Скрыть параметр в редакторе.
        columnWidth     Положительная целая ширина видимой колонки RECORDS в пикселях.
        const           Константное значение. Редактирование запрещено, значение должно совпадать с указанным.

        storageKey      Ключ или точечный путь в StorageModel. По умолчанию используется имя свойства схемы.
        storageAliases  Прежние пути только для чтения; канонический storageKey имеет приоритет.

        Форматирование float параметра
        floatExp        Использовать экспоненциальный формат отображения вещественного числа.
        floatFormat     "fixed" — десятичная запись без экспоненты с точностью digits.
        digits          Количество знаков после десятичной точки (или точность отображения вещественного числа).

        ARRAY
        ------------------------------------------------------------------------------
        columns         Заголовки столбцов вложенной таблицы
        nColumns        Количество столбцов вложенной таблицы.
        order           Ориентация плоского хранения: "column" (по умолчанию) или "row".
        items           Схема одного элемента массива. Описание структуры элементов FIELD_TYPES.ARRAY.
        itemLabels      Заголовки элементов вложенной записи.
        itemLabelTitle  Заголовок колонки с названиями элементов вложенной записи.
        itemLabelWidth  Ширина колонки с названиями элементов вложенной записи.
        rowsMutable     Разрешены ли добавление, удаление и перемещение строк.
        summary         Сводка ARRAY: ({ rowData, value, presentation }) => string.
        variantCodec    Чистый codec BaseModel ARRAY ↔ строки представления.
                        Объявляет dependencies, decode, encode и необязательную
                        реакцию onDependencyChange.
        computedView    Readonly-колонки ViewModel из внешних вкладок:
                        { dependencies, columns, rows }.

        Вычисляемые свойства
        ------------------------------------------------------------------------------
        compute         Нехранимый descriptor { dependencies, evaluate }.
        computeStored   Хранимый descriptor { dependencies, evaluate }.
                        Атрибуты взаимно исключаются; оба вида readonly.
    
        Именованное перечисление
        ------------------------------------------------------------------------------
        enum            Непустой массив { value, label }. value — типизированное
                        скалярное значение, label — пользовательская подпись.
                        Является ограничением и применимо к скалярным типам.

        FIELD_TYPES.ENUM
        ------------------------------------------------------------------------------
        displayLabel    Необязательная чистая функция ({ value, rowData, defaultLabel }) => string.
                        Меняет только подпись ячейки, не enum, editor или сериализацию.
        Тип, для которого зарегистрированы списочный enumEditor и enumFormatter.
        Список берётся только из property.enum и обязателен.
        Значение по умолчанию при отсутствии default — property.enum[0].value.
        
        Числовые ограничения
        ------------------------------------------------------------------------------
        minimum
        maximum
        exclusiveMinimum
        exclusiveMaximum
        multipleOf
        
        Строковые ограничения
        ------------------------------------------------------------------------------
        minLength
        maxLength
        pattern
        
        Ограничения массива
        ------------------------------------------------------------------------------
        minItems
        maxItems
        uniqueItems
        
        Расширение контракта
        ------------------------------------------------------------------------------
        Допускается добавление новых атрибутов без изменения фабрики схем.
        Фабрика не ограничивает состав descriptor'а, а лишь обеспечивает единый
        формат описания схемы.
        ==============================================================================
        */
    };

    validateSchema(schema);

    return schema;
}

function validateSchema(schema) {
    validateComputationSchema(schema);
    validateRecordCount(schema);
    validateMainView(schema);
    validateRecordColumnsView(schema);
    validateGraphView(schema);
    validateGeneratorView(schema);
    validateReferenceViews(schema);

    const storagePaths = [];

    for (const [propertyName, property] of Object.entries(schema.properties)) {

        validatePropertyEnum(schema.id, propertyName, property);
        if (property.storageAliases !== undefined &&
            (!isStoredProperty(property) || !Array.isArray(property.storageAliases))) {
            throw new Error(`Schema '${schema.id}', property '${propertyName}': storageAliases requires a stored property and an array.`);
        }
        if (property.displayLabel !== undefined &&
            (property.type !== FIELD_TYPES.ENUM || typeof property.displayLabel !== "function")) {
            throw new Error(`Schema '${schema.id}', property '${propertyName}': displayLabel requires ENUM and a function.`);
        }
        validateColumnWidth(schema, propertyName, property);
        validateVariantCodec(
            schema,
            propertyName,
            property,
        );
        validateComputedView(
            schema,
            propertyName,
            property,
        );

        if (
            property.type === FIELD_TYPES.ARRAY &&
            property.columns?.length !== property.nColumns
        ) {
            throw new Error(
                `Schema '${schema.id}', property '${propertyName}': `
                + `columns.length must equal nColumns.`
            );
        }

        if (
            property.type === FIELD_TYPES.ARRAY &&
            property.order !== undefined &&
            !property.nColumns
        ) {
            throw new Error(
                `Schema '${schema.id}', property '${propertyName}': `
                + `order requires nColumns.`
            );
        }

        if (
            property.type === FIELD_TYPES.ARRAY &&
            !isArrayOrder(property.order)
        ) {
            throw new Error(
                `Schema '${schema.id}', property '${propertyName}': `
                + `unsupported ARRAY order '${property.order}'.`
            );
        }

        if (isStoredProperty(property)) {
            const paths = [property.storageKey ?? propertyName, ...(property.storageAliases ?? [])];
            for (const storagePath of paths) {
                validateStoragePath(schema.id, propertyName, storagePath);

                const conflict = storagePaths.find(item =>
                    item.path === storagePath ||
                    item.path.startsWith(`${storagePath}.`) ||
                    storagePath.startsWith(`${item.path}.`)
                );
                if (conflict) {
                    throw new Error(
                        `Schema '${schema.id}', properties '${conflict.propertyName}' `
                        + `and '${propertyName}': conflicting storage paths `
                        + `'${conflict.path}' and '${storagePath}'.`
                    );
                }

                storagePaths.push({
                    propertyName,
                    path: storagePath,
                });
            }
        }
    }

    validateObsoleteStoragePaths(schema, storagePaths);
}

function validateObsoleteStoragePaths(schema, activeStoragePaths) {
    const paths = schema.config.obsoleteStoragePaths;

    if (!Array.isArray(paths)) {
        throw new Error(
            `Schema '${schema.id}': obsoleteStoragePaths must be an array.`,
        );
    }

    const accepted = [];

    paths.forEach((path, index) => {
        if (!isValidStoragePath(path)) {
            throw new Error(
                `Schema '${schema.id}', obsoleteStoragePaths[${index}]: `
                + "expected a non-empty dot path.",
            );
        }

        const conflictingActive = activeStoragePaths.find(item =>
            storagePathsOverlap(item.path, path)
        );
        if (conflictingActive) {
            throw new Error(
                `Schema '${schema.id}', obsolete storage path '${path}' `
                + `conflicts with active path '${conflictingActive.path}'.`,
            );
        }

        const conflictingObsolete = accepted.find(item =>
            storagePathsOverlap(item, path)
        );
        if (conflictingObsolete) {
            throw new Error(
                `Schema '${schema.id}': obsolete storage paths `
                + `'${conflictingObsolete}' and '${path}' conflict.`,
            );
        }

        accepted.push(path);
    });
}

function storagePathsOverlap(left, right) {
    return left === right ||
        left.startsWith(`${right}.`) ||
        right.startsWith(`${left}.`);
}

function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

function validateGeneratorView(schema) {
    const descriptor = schema.views.generator;
    if (descriptor === undefined) return;

    const targets = descriptor?.targets;

    if (
        schema.config.storage !== STORAGE_TYPES.RECORDS ||
        schema.views.main !== undefined ||
        schema.views.recordsAsColumns !== undefined ||
        !descriptor ||
        typeof descriptor !== "object" ||
        Array.isArray(descriptor) ||
        !isNonEmptyString(descriptor.title) ||
        !isNonEmptyString(descriptor.historyFile) ||
        descriptor.historyFile.includes("/") ||
        descriptor.historyFile.includes("\\") ||
        !isNonEmptyString(descriptor.defaultTarget) ||
        !Array.isArray(targets) ||
        targets.length === 0 ||
        !Array.isArray(descriptor.synchronizedProperties) ||
        descriptor.synchronizedProperties.length === 0
    ) {
        throw new Error(
            `Schema '${schema.id}': views.generator requires a RECORDS `
            + "main table, title, historyFile, targets, defaultTarget and "
            + "synchronizedProperties."
        );
    }

    const targetValues = new Set();
    for (const target of targets) {
        const property = schema.properties[target?.property];
        if (
            !target ||
            !isNonEmptyString(target.value) ||
            !isNonEmptyString(target.label) ||
            targetValues.has(target.value) ||
            !property ||
            property.type !== FIELD_TYPES.ARRAY ||
            property.view !== VIEW_TYPES.TABLE ||
            !Number.isInteger(property.nColumns) ||
            !Number.isInteger(target.column) ||
            target.column <= 0 ||
            target.column >= property.nColumns
        ) {
            throw new Error(
                `Schema '${schema.id}': invalid views.generator target `
                + `'${target?.value ?? ""}'.`
            );
        }
        targetValues.add(target.value);
    }

    if (!targetValues.has(descriptor.defaultTarget)) {
        throw new Error(
            `Schema '${schema.id}': views.generator.defaultTarget must name a target.`
        );
    }

    const synchronized = new Set(descriptor.synchronizedProperties);
    if (
        synchronized.size !== descriptor.synchronizedProperties.length ||
        [...synchronized].some(propertyName => {
            const property = schema.properties[propertyName];
            return !property ||
                property.type !== FIELD_TYPES.ARRAY ||
                property.view !== VIEW_TYPES.TABLE ||
                !Number.isInteger(property.nColumns) ||
                property.nColumns < 2;
        }) ||
        targets.some(target => !synchronized.has(target.property))
    ) {
        throw new Error(
            `Schema '${schema.id}': views.generator.synchronizedProperties `
            + "must contain unique TABLE properties used by all targets."
        );
    }
}

function validateGraphView(schema) {
    const descriptor = schema.views.graph;
    if (descriptor === undefined) return;

    const modes = descriptor?.modes;
    if (
        schema.config.storage !== STORAGE_TYPES.RECORDS ||
        schema.views.main !== undefined ||
        schema.views.recordsAsColumns !== undefined ||
        !descriptor ||
        typeof descriptor !== "object" ||
        Array.isArray(descriptor) ||
        !isNonEmptyString(descriptor.title) ||
        !isNonEmptyString(descriptor.recordLabel) ||
        !isNonEmptyString(descriptor.defaultMode) ||
        !Array.isArray(modes) ||
        modes.length === 0
    ) {
        throw new Error(
            `Schema '${schema.id}': views.graph requires a RECORDS table, `
            + "title, recordLabel, defaultMode and at least one mode."
        );
    }

    if (
        descriptor.selectorLabel !== undefined &&
        !isNonEmptyString(descriptor.selectorLabel)
    ) {
        throw new Error(
            `Schema '${schema.id}': views.graph.selectorLabel must be non-empty.`
        );
    }

    const modeValues = new Set();
    for (const mode of modes) {
        const property = schema.properties[mode?.property];
        const xColumn = mode?.x?.column;
        const series = mode?.series;
        if (
            !mode ||
            typeof mode !== "object" ||
            Array.isArray(mode) ||
            !isNonEmptyString(mode.value) ||
            !isNonEmptyString(mode.label) ||
            modeValues.has(mode.value) ||
            !property ||
            property.type !== FIELD_TYPES.ARRAY ||
            property.view !== VIEW_TYPES.TABLE ||
            !Number.isInteger(property.nColumns) ||
            !Number.isInteger(xColumn) ||
            xColumn < 0 ||
            xColumn >= property.nColumns ||
            !isNonEmptyString(mode.x.title) ||
            !isNonEmptyString(mode?.y?.title) ||
            !Array.isArray(series) ||
            series.length === 0
        ) {
            throw new Error(
                `Schema '${schema.id}': invalid views.graph mode `
                + `'${mode?.value ?? ""}'.`
            );
        }

        const seriesColumns = new Set();
        for (const item of series) {
            if (
                !item ||
                !Number.isInteger(item.column) ||
                item.column < 0 ||
                item.column >= property.nColumns ||
                item.column === xColumn ||
                seriesColumns.has(item.column) ||
                !isNonEmptyString(item.label)
            ) {
                throw new Error(
                    `Schema '${schema.id}': invalid views.graph series `
                    + `for mode '${mode.value}'.`
                );
            }
            seriesColumns.add(item.column);
        }

        modeValues.add(mode.value);
    }

    if (!modeValues.has(descriptor.defaultMode)) {
        throw new Error(
            `Schema '${schema.id}': views.graph.defaultMode must name a mode.`
        );
    }
}

function validateReferenceViews(schema) {
    const references = schema.views.references;
    if (references === undefined) return;

    if (
        !references ||
        typeof references !== "object" ||
        Array.isArray(references)
    ) {
        throw new Error(`Schema '${schema.id}': views.references must be an object.`);
    }

    for (const [propertyName, descriptor] of Object.entries(references)) {
        if (
            !isNonEmptyString(propertyName) ||
            schema.properties[propertyName] !== undefined ||
            !descriptor ||
            typeof descriptor !== "object" ||
            Array.isArray(descriptor) ||
            descriptor.type !== FIELD_TYPES.ARRAY ||
            descriptor.view !== VIEW_TYPES.TABLE ||
            descriptor.readonly !== true ||
            descriptor.rowsMutable !== false ||
            !isNonEmptyString(descriptor.label) ||
            !Number.isInteger(descriptor.nColumns) ||
            descriptor.nColumns <= 0 ||
            !Array.isArray(descriptor.columns) ||
            descriptor.columns.length !== descriptor.nColumns ||
            !descriptor.items ||
            !Array.isArray(descriptor.dependencies) ||
            descriptor.dependencies.length === 0 ||
            descriptor.dependencies.some(dependency =>
                !isNonEmptyString(dependency) || dependency === schema.id
            ) ||
            new Set(descriptor.dependencies).size !== descriptor.dependencies.length ||
            typeof descriptor.rows !== "function"
        ) {
            throw new Error(
                `Schema '${schema.id}', view-only property '${propertyName}': `
                + "invalid views.references descriptor."
            );
        }
    }
}

function validateRecordCount(schema) {
    const recordCount = schema.config.recordCount;
    const fallback = schema.config.singleRecordFallback;
    if (recordCount === undefined && fallback === undefined) return;

    if (
        schema.config.storage !== STORAGE_TYPES.RECORDS ||
        !Number.isInteger(recordCount) ||
        recordCount <= 0
    ) {
        throw new Error(
            `Schema '${schema.id}': recordCount requires a positive integer `
            + "for RECORDS."
        );
    }

    if (
        fallback !== undefined && (
            recordCount < 2 ||
            !fallback ||
            typeof fallback !== "object" ||
            Array.isArray(fallback) ||
            typeof fallback.message !== "string" ||
            fallback.message.trim().length === 0
        )
    ) {
        throw new Error(
            `Schema '${schema.id}': singleRecordFallback requires `
            + "recordCount >= 2 and a non-empty warning message."
        );
    }
}

function validateRecordColumnsView(schema) {
    const descriptor = schema.views.recordsAsColumns;
    if (descriptor === undefined) return;

    const labels = descriptor?.labels;
    const unsupportedProperties = Object.entries(schema.properties)
        .filter(([, property]) =>
            property.type === FIELD_TYPES.ARRAY ||
            property.type === FIELD_TYPES.OBJECT ||
            isComputedProperty(property)
        )
        .map(([name]) => name);

    if (
        schema.config.storage !== STORAGE_TYPES.RECORDS ||
        schema.config.recordCount === undefined ||
        schema.views.main !== undefined ||
        !descriptor ||
        typeof descriptor !== "object" ||
        Array.isArray(descriptor) ||
        !Array.isArray(labels) ||
        labels.length !== schema.config.recordCount ||
        labels.some(label =>
            typeof label !== "string" || label.trim().length === 0
        )
    ) {
        throw new Error(
            `Schema '${schema.id}': views.recordsAsColumns requires `
            + "fixed RECORDS with one non-empty label per record and cannot "
            + "be combined with views.main."
        );
    }

    if (unsupportedProperties.length > 0) {
        throw new Error(
            `Schema '${schema.id}': views.recordsAsColumns supports only `
            + "stored scalar properties; unsupported: "
            + unsupportedProperties.join(", ")
            + "."
        );
    }

    const activeRecord = descriptor.activeRecord;
    if (
        activeRecord !== undefined && (
            !activeRecord ||
            typeof activeRecord !== "object" ||
            Array.isArray(activeRecord) ||
            typeof activeRecord.index !== "function" ||
            !Array.isArray(activeRecord.dependencies) ||
            activeRecord.dependencies.length === 0 ||
            activeRecord.dependencies.some(dependency =>
                typeof dependency !== "string" ||
                dependency.trim().length === 0 ||
                dependency === schema.id
            ) ||
            new Set(activeRecord.dependencies).size !==
                activeRecord.dependencies.length
        )
    ) {
        throw new Error(
            `Schema '${schema.id}': recordsAsColumns.activeRecord requires `
            + "an index function and unique external tab dependencies."
        );
    }
}

function validateColumnWidth(schema, propertyName, property) {
    if (property.columnWidth === undefined) return;

    if (
        schema.config.storage !== STORAGE_TYPES.RECORDS ||
        !Number.isInteger(property.columnWidth) ||
        property.columnWidth <= 0
    ) {
        throw new Error(
            `Schema '${schema.id}', property '${propertyName}': `
            + "columnWidth requires a positive integer for RECORDS."
        );
    }
}

function validateMainView(schema) {
    if (
        !schema.views ||
        typeof schema.views !== "object" ||
        Array.isArray(schema.views)
    ) {
        throw new Error(
            `Schema '${schema.id}': views must be an object.`
        );
    }

    const descriptor = schema.views.main;
    if (descriptor === undefined) return;

    if (
        !descriptor ||
        typeof descriptor !== "object" ||
        Array.isArray(descriptor) ||
        typeof descriptor.property !== "string" ||
        descriptor.property.length === 0
    ) {
        throw new Error(
            `Schema '${schema.id}': views.main requires a property name.`
        );
    }

    const propertyNames = Object.keys(schema.properties);
    const property = schema.properties[descriptor.property];

    if (
        schema.config.storage !== STORAGE_TYPES.RECORDS ||
        propertyNames.length !== 1 ||
        !property ||
        property.type !== FIELD_TYPES.ARRAY ||
        property.view !== VIEW_TYPES.TABLE ||
        property.hidden
    ) {
        throw new Error(
            `Schema '${schema.id}': views.main requires RECORDS with `
            + "one visible ARRAY property using TABLE view."
        );
    }

    const parentConstraints = [
        "minItems",
        "maxItems",
        "uniqueItems",
    ].filter(name => property[name] !== undefined);

    if (parentConstraints.length > 0) {
        throw new Error(
            `Schema '${schema.id}', property '${descriptor.property}': `
            + "views.main does not support ARRAY-level constraints: "
            + parentConstraints.join(", ")
            + "."
        );
    }
}

function validateVariantCodec(schema, propertyName, property) {
    if (property.rowsMutable !== undefined) {
        if (
            property.type !== FIELD_TYPES.ARRAY ||
            typeof property.rowsMutable !== "boolean"
        ) {
            throw new Error(
                `Schema '${schema.id}', property '${propertyName}': `
                + "rowsMutable is supported only as boolean for ARRAY."
            );
        }
    }

    const codec = property.variantCodec;
    if (codec === undefined) return;

    if (property.type !== FIELD_TYPES.ARRAY) {
        throw new Error(
            `Schema '${schema.id}', property '${propertyName}': `
            + "variantCodec is supported only for ARRAY."
        );
    }

    if (
        !Array.isArray(codec.dependencies) ||
        codec.dependencies.length === 0 ||
        codec.dependencies.some(
            dependency =>
                typeof dependency !== "string" ||
                dependency.length === 0
        ) ||
        new Set(codec.dependencies).size !== codec.dependencies.length
    ) {
        throw new Error(
            `Schema '${schema.id}', property '${propertyName}': `
            + "variantCodec.dependencies must be a non-empty array "
            + "of unique property names."
        );
    }

    for (const dependency of codec.dependencies) {
        const dependencyProperty = schema.properties[dependency];

        if (
            dependency === propertyName ||
            !dependencyProperty
        ) {
            throw new Error(
                `Schema '${schema.id}', property '${propertyName}': `
                + `unknown variant dependency '${dependency}'.`
            );
        }

        if (dependencyProperty.type === FIELD_TYPES.ARRAY) {
            throw new Error(
                `Schema '${schema.id}', property '${propertyName}': `
                + `variant dependency '${dependency}' must be scalar.`
            );
        }

        if (isComputedProperty(dependencyProperty)) {
            throw new Error(
                `Schema '${schema.id}', property '${propertyName}': `
                + `variant dependency '${dependency}' cannot be computed.`
            );
        }
    }

    if (
        typeof codec.decode !== "function" ||
        typeof codec.encode !== "function"
    ) {
        throw new Error(
            `Schema '${schema.id}', property '${propertyName}': `
            + "variantCodec requires decode and encode functions."
        );
    }

    if (
        codec.onDependencyChange !== undefined &&
        typeof codec.onDependencyChange !== "function"
    ) {
        throw new Error(
            `Schema '${schema.id}', property '${propertyName}': `
            + "variantCodec.onDependencyChange must be a function."
        );
    }
}


function validateComputedView(schema, propertyName, property) {
    const descriptor = property.computedView;
    if (descriptor === undefined) return;

    if (
        property.type !== FIELD_TYPES.ARRAY ||
        property.view !== VIEW_TYPES.TABLE
    ) {
        throw new Error(
            `Schema '${schema.id}', property '${propertyName}': `
            + "computedView requires ARRAY with TABLE view."
        );
    }

    if (
        !Array.isArray(descriptor.dependencies) ||
        descriptor.dependencies.length === 0 ||
        descriptor.dependencies.some(dependency =>
            typeof dependency !== "string" ||
            dependency.length === 0 ||
            dependency === schema.id
        ) ||
        new Set(descriptor.dependencies).size !==
            descriptor.dependencies.length
    ) {
        throw new Error(
            `Schema '${schema.id}', property '${propertyName}': `
            + "computedView.dependencies must contain unique external tab ids."
        );
    }

    if (typeof descriptor.rows !== "function") {
        throw new Error(
            `Schema '${schema.id}', property '${propertyName}': `
            + "computedView.rows must be a function."
        );
    }

    if (
        !Array.isArray(descriptor.columns) ||
        descriptor.columns.length === 0
    ) {
        throw new Error(
            `Schema '${schema.id}', property '${propertyName}': `
            + "computedView.columns must be a non-empty array."
        );
    }

    const keys = new Set();

    for (const column of descriptor.columns) {
        if (
            !column ||
            typeof column.key !== "string" ||
            column.key.length === 0 ||
            typeof column.label !== "string" ||
            column.label.length === 0 ||
            keys.has(column.key)
        ) {
            throw new Error(
                `Schema '${schema.id}', property '${propertyName}': `
                + "computedView columns require unique non-empty keys and labels."
            );
        }

        keys.add(column.key);
    }
}

// Межсхемная часть контракта проверяется после сборки tabRegistry,
// чтобы schemaFactory не импортировала registry и не создавала цикл.
export function validateSchemaRegistry(schemas) {
    const ids = new Set(schemas.map(schema => schema.id));

    if (ids.size !== schemas.length) {
        throw new Error("tabRegistry contains duplicate schema ids.");
    }

    for (const schema of schemas) {
        for (const [propertyName, property] of
            Object.entries(schema.properties)) {
            const descriptor = property.computedView;
            if (!descriptor) continue;

            for (const dependency of descriptor.dependencies) {
                if (ids.has(dependency)) continue;

                throw new Error(
                    `Schema '${schema.id}', property '${propertyName}': `
                    + `unknown computedView dependency '${dependency}'.`
                );
            }
        }

        const activeRecord = schema.views.recordsAsColumns?.activeRecord;
        for (const dependency of activeRecord?.dependencies ?? []) {
            if (ids.has(dependency)) continue;

            throw new Error(
                `Schema '${schema.id}': unknown activeRecord dependency `
                + `'${dependency}'.`
            );
        }

        for (const [propertyName, descriptor] of
            Object.entries(schema.views.references ?? {})) {
            for (const dependency of descriptor.dependencies) {
                if (ids.has(dependency)) continue;

                throw new Error(
                    `Schema '${schema.id}', view-only property '${propertyName}': `
                    + `unknown reference dependency '${dependency}'.`
                );
            }
        }
    }
}

function validateStoragePath(schemaId, propertyName, path) {
    if (!isValidStoragePath(path)) {
        throw new Error(
            `Schema '${schemaId}', property '${propertyName}': `
            + `storageKey must be a non-empty dot path.`
        );
    }
}

function isValidStoragePath(path) {
    return typeof path === "string" &&
        path.length > 0 &&
        !path.split(".").some(segment => segment.length === 0);
}

function validatePropertyEnum(schemaId, propertyName, property) {
    const options = property.enum;

    if (options === undefined) {
        if (property.type === FIELD_TYPES.ENUM) {
            throw new Error(
                `Schema '${schemaId}', property '${propertyName}': `
                + "FIELD_TYPES.ENUM requires a non-empty enum."
            );
        }
    }
    else {
        if (!Array.isArray(options) || options.length === 0) {
            throw new Error(
                `Schema '${schemaId}', property '${propertyName}': `
                + "enum must be a non-empty array of { value, label }."
            );
        }

        options.forEach((option, index) => {
            if (!isNamedEnumOption(option)) {
                throw new Error(
                    `Schema '${schemaId}', property '${propertyName}', `
                    + `enum[${index}]: expected a JSON scalar value and `
                    + "a non-empty string label."
                );
            }

            if (!isEnumValueCompatible(property.type, option.value)) {
                throw new Error(
                    `Schema '${schemaId}', property '${propertyName}', `
                    + `enum[${index}]: value type is incompatible with `
                    + `'${property.type}'.`
                );
            }

            const duplicate = findNamedEnumOption(
                options.slice(0, index),
                option.value,
            );

            if (duplicate) {
                throw new Error(
                    `Schema '${schemaId}', property '${propertyName}': `
                    + `duplicate enum value '${option.value}'.`
                );
            }
        });

        if (
            property.default !== undefined &&
            !findNamedEnumOption(options, property.default)
        ) {
            throw new Error(
                `Schema '${schemaId}', property '${propertyName}': `
                + "default must match an enum value."
            );
        }
    }

    if (property.items) {
        validatePropertyEnum(
            schemaId,
            `${propertyName}.items`,
            property.items,
        );
    }
}

function isEnumValueCompatible(type, value) {
    switch (type) {
        case FIELD_TYPES.INTEGER:
            return Number.isInteger(value);
        case FIELD_TYPES.FLOAT:
            return typeof value === "number";
        case FIELD_TYPES.BOOLEAN:
            return typeof value === "boolean";
        case FIELD_TYPES.STRING:
        case FIELD_TYPES.DATE:
        case FIELD_TYPES.PATH:
            return typeof value === "string";
        case FIELD_TYPES.ENUM:
            return true;
        default:
            return false;
    }
}
