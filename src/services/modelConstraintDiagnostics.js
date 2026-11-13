import {
    FIELD_TYPES,
    STORAGE_TYPES,
    TABS,
} from "./schemas/common/constants.js";
import { createError } from "../tabulator/validators/common/createDiagnostic.js";
import { validateConstraintValue } from "../tabulator/validators/types/constraintValidator.js";

function modelItems(schema, modelPart) {
    if (modelPart === null || modelPart === undefined) return [];

    if (schema.config.storage === STORAGE_TYPES.RECORDS) {
        return Array.isArray(modelPart) ? modelPart : [];
    }

    return [modelPart];
}

function nestedValues(value) {
    if (!Array.isArray(value)) return [];

    return value.flatMap(row =>
        Array.isArray(row) ? row : [row]
    );
}

// Вложенные таблицы участвуют в сводной проверке только тогда, когда
// их значения целочисленные. Сейчас ограничения таких значений объявлены
// только у таблиц "Разбиение" elements.dp и regions.dp.
function constraintViolations(schema, modelPart, onInvalidField) {
    let count = 0;
    const properties = Object.entries(schema.properties);
    for (const [index, item] of modelItems(schema, modelPart).entries()) {
        if (!item || typeof item !== "object") continue;

        for (const [name, property] of properties) {
            const value = item[name];
            const previousCount = count;
            if (property.type === FIELD_TYPES.ARRAY) {
                if (property.items?.type !== FIELD_TYPES.INTEGER) continue;
                for (const nestedValue of nestedValues(value)) {
                    if (!validateConstraintValue(nestedValue, property.items)) count++;
                }
            } else if (!validateConstraintValue(value, property)) {
                count++;
            }

            // The table shows one source row for the entire record, including
            // fields containing several invalid array entries.
            if (count > previousCount) onInvalidField?.(name, index + 1);
        }
    }
    return count;
}

export function countSchemaConstraintViolations(schema, modelPart) {
    return constraintViolations(schema, modelPart);
}

export function schemaConstraintDiagnostics(schema, modelPart) {
    const showRows = schema.id === TABS.ELEMENTS.id || schema.id === TABS.REGIONS.id;
    const rowsByField = new Map();
    function addRow(field, row) {
        if (!rowsByField.has(field)) rowsByField.set(field, []);
        rowsByField.get(field).push(row);
    }
    const count = constraintViolations(schema, modelPart, showRows ? addRow : undefined);
    if (count === 0) return [];

    const summary = {
        ...createError({
            message: `Вкладка: ${schema.title} - нарушений ограничений: ${count}`,
        }),
        presentation: "constraint-summary",
    };
    if (showRows) {
        summary.fieldRows = Array.from(rowsByField, ([field, rows]) => ({
            label: schema.properties[field].label ?? field,
            rows,
        }));
    }
    return [summary];
}

export function collectModelConstraintDiagnostics(registry, model) {
    return Object.fromEntries(
        registry.map(schema => [
            schema.id,
            schemaConstraintDiagnostics(schema, model?.[schema.id]),
        ]),
    );
}
