import { MATERIAL_LIBRARY_KINDS } from "../../services/defaultLibraryService.js";
import { TABS } from "../../services/schemas/common/constants.js";

function materialKindForModel(model) {
    return Number(model) === 2
        ? MATERIAL_LIBRARY_KINDS.HTS
        : MATERIAL_LIBRARY_KINDS.FMM;
}

export function selectedElementsRequest(table, rows = table?.getSelectedRows?.() ?? []) {
    if (table?._gui?.schema?.id !== TABS.ELEMENTS.id) {
        throw new Error(
            "Групповое действие доступно только для элементов модели.",
        );
    }

    if (rows.length === 0) {
        throw new Error("Выберите хотя бы один элемент модели.");
    }

    return {
        table,
        rows,
        count: rows.length,
    };
}

export function selectedElementMaterialRequest(table, rows) {
    const request = selectedElementsRequest(table, rows);

    return {
        ...request,
        kind: materialKindForModel(request.rows[0].getData()?.model),
    };
}

export async function assignSelectedElementMaterial(request, name) {
    const value = String(name ?? "").trim();
    if (!value) {
        throw new Error("Не выбрана характеристика материала.");
    }
    if (value.toLowerCase().endsWith(".txt")) {
        throw new Error(
            "Имя характеристики задаётся без расширения .txt.",
        );
    }

    const rowData = request.rows.map(row => row.getData());
    const setter = request.table?._gui?.model?.setRecordsValue;
    if (typeof setter !== "function") {
        throw new Error(
            "Активная таблица не поддерживает групповое назначение.",
        );
    }
    await setter(rowData, "xapName", value);
    return rowData.length;
}

export async function clearSelectedElementMaterials(request) {
    const rowData = request.rows.map(row => row.getData());
    const setter = request.table?._gui?.model?.setRecordsValue;
    if (typeof setter !== "function") {
        throw new Error(
            "Активная таблица не поддерживает групповое изменение.",
        );
    }

    await setter(rowData, "xapName", "");
    return rowData.length;
}
