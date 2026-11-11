import { geometryValidationSettings } from "../../../../services/solver/geometryValidationSettings.js";
import { TABS } from "../../../../services/schemas/common/constants.js";
import { createError } from "../../common/createDiagnostic.js";

export function conrabValidator(
    service,
    diagnostics,
) {
    const conrab = service.getModel().conrab;
    if (conrab === null || conrab === undefined) return;

    if (
        !Array.isArray(conrab) ||
        conrab.length !== 2 ||
        conrab.some(record =>
            record === null ||
            typeof record !== "object" ||
            Array.isArray(record)
        )
    ) {
        diagnostics.push(createError({
            tab: TABS.CONRAB,
            message:
                "Файл conrab.txt должен содержать ровно две записи: "
                + "Float32 и Float64.",
        }));
        return;
    }
    for (const [row, record] of conrab.entries()) {
        for (const property of geometryValidationSettings(record).invalid) {
            diagnostics.push(createError({
                tab: TABS.CONRAB, row: row + 1, property,
                message: `${property} (${row === 0 ? "Float32" : "Float64"}): `
                    + "требуется конечный угол больше 0 и меньше 90°",
            }));
        }
        for (const property of ["CF_FMMEPS", "CF_HTSEPS"]) {
            const value = record[property];
            if (!Number.isFinite(value) || value <= 0) {
                diagnostics.push(createError({
                    tab: TABS.CONRAB,
                    row: row + 1,
                    property,
                    message: `${property} (${row === 0 ? "Float32" : "Float64"}): `
                        + "требуется конечный положительный допуск в кА/м.",
                }));
            }
        }
        if (!Number.isFinite(record.POLAR_EPS_PERCENT) || record.POLAR_EPS_PERCENT <= 0 || record.POLAR_EPS_PERCENT >= 100) {
            diagnostics.push(createError({
                tab: TABS.CONRAB,
                row: row + 1,
                property: "POLAR_EPS_PERCENT",
                message: `POLAR_EPS_PERCENT (${row === 0 ? "Float32" : "Float64"}): `
                    + "требуется конечное число 0 < POLAR_EPS_PERCENT < 100 (%).",
            }));
        }
        if (!Number.isFinite(record.DIPOLE_RTOL) || record.DIPOLE_RTOL < 0 || record.DIPOLE_RTOL >= 1) {
            diagnostics.push(createError({
                tab: TABS.CONRAB,
                row: row + 1,
                property: "DIPOLE_RTOL",
                message: `DIPOLE_RTOL (${row === 0 ? "Float32" : "Float64"}): `
                    + "требуется конечное число 0 <= DIPOLE_RTOL < 1; 0 отключает приближение.",
            }));
        }
    }
}
