import { createError } from "../tabulator/validators/common/createDiagnostic.js";
import { TABS } from "./schemas/common/constants.js";

// Validate the editable snapshot, not the filesystem. A missing/empty table has
// no referenced records; zero means the object does not use that dependency.
function timeReference(value, records, tab, row, property, noun, diagnostics) {
    const index = value === undefined ? 0 : value;
    const error = message => diagnostics.push(createError({ tab, row, property, message }));
    if (property === "indMove" && Number.isFinite(index) && index < 0) {
        error("индекс движения не может быть отрицательным");
    } else if (!Number.isSafeInteger(index) || index < 0) {
        error(`индекс ${noun} должен быть неотрицательным целым числом`);
    } else if (index > 0 && (!Array.isArray(records) || !records[index - 1])) {
        error(`указан индекс ${noun} ${index}, но соответствующая запись отсутствует`);
    }
}

export function validateElementReferences(model, diagnostics) {
    if (!Array.isArray(model.elements)) return;
    model.elements.forEach((record, index) => {
        const row = index + 1;
        timeReference(record?.indMove, model.moves, TABS.ELEMENTS, row,
            "indMove", "траектории", diagnostics);
        if (record?.targ === 3) {
            const direction = record.indAmp === undefined ? 0 : record.indAmp;
            if (!Number.isSafeInteger(direction) || direction < 0 || direction > 3) {
                diagnostics.push(createError({ tab: TABS.ELEMENTS, row, property: "indAmp",
                    message: "для виртуального элемента indAmp должен быть целым числом от 0 до 3" }));
            }
        } else if (record?.targ === 1 || record?.targ === 2) {
            timeReference(record.indAmp, model.amps, TABS.ELEMENTS, row,
                "indAmp", "импульса", diagnostics);
        }
    });
}

export function validateRegionReferences(model, diagnostics) {
    if (!Array.isArray(model.regions)) return;
    model.regions.forEach((record, index) => timeReference(record?.indMove, model.moves,
        TABS.REGIONS, index + 1, "indMove", "траектории", diagnostics));
}
