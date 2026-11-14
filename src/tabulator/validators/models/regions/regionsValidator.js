import { validatePanel } from "../../../../services/solver/geometryShape.js";
import { validateRegionReferences } from "../../../../services/modelReferenceValidation.js";
import { forceSurfaceMotionWarning } from "../../../../services/generator/forceSurfaceMotion.js";
import {
    createError,
    createWarning,
} from "../../common/createDiagnostic.js";
import { TABS } from "../../../../services/schemas/common/constants.js";

const FIXED_ARRAY_SHAPES = Object.freeze([
    { property: "symVi", storagePath: "sym.vi", rows: 3, columns: 1 },
    { property: "symR0", storagePath: "sym.r0", rows: 3, columns: 1 },
    { property: "geo", storagePath: "geo", rows: 4, columns: 3 },
    { property: "dr", storagePath: "dr", rows: 3, columns: 1 },
    { property: "dp", storagePath: "dp", rows: 2, columns: 1 },
]);

export function regionsValidator(
    service,
    diagnostics,
) {
    const model = service.getModel();
    const regions = model[TABS.REGIONS.id];
    if (!Array.isArray(regions)) return;
    validateRegionReferences(model, diagnostics);
    const motionWarning = forceSurfaceMotionWarning({regions});
    if (motionWarning) {
        diagnostics.push(createWarning({ tab: TABS.REGIONS, property: "indMove", message: motionWarning }));
    }

    regions.forEach((record, index) => {
        for (const shape of FIXED_ARRAY_SHAPES) {
            if (hasCompleteShape(record?.[shape.property], shape)) {
                continue;
            }

            diagnostics.push(
                createError({
                    tab: TABS.REGIONS,
                    row: index + 1,
                    property: shape.property,
                    message:
                        "Массив '" + shape.storagePath + "' должен содержать "
                        + shape.rows + " × " + shape.columns
                        + " заполненных значений",
                })
            );
        }

        validateRecordRules(record, index, diagnostics);
        if (record?.geoType === 0 && hasCompleteShape(record.geo,FIXED_ARRAY_SHAPES[2])) {
            const general = model.general;
            const force = general?.evalForce === true && (record.indCoil ?? 0) === 0;
            for (const issue of validatePanel(record.geo,{force,doubleFloat:general?.doubleFloat === true})) {
                const diagnostic = issue.level === "error" ? createError : createWarning;
                diagnostics.push(diagnostic({tab:TABS.REGIONS,row:index+1,property:"geo",message:issue.message}));
            }
        }
    });
}

function validateRecordRules(record, index, diagnostics) {
    const step = record?.symYl;
    const count = record?.symLs;
    if (Number.isFinite(step) && Number.isInteger(count)) {
        if (step === 0 && count > 1) {
            diagnostics.push(createError({
                tab: TABS.REGIONS,
                row: index + 1,
                property: "symYl",
                message:
                    "при наличии локальных образов следует "
                    + "задать ненулевой угол симметрии (шаг по углу)",
            }));
        } else if (step !== 0 && count === 1) {
            diagnostics.push(createWarning({
                tab: TABS.REGIONS,
                row: index + 1,
                property: "symYl",
                message:
                    "при отсутствии локальных образов задавать "
                    + "угол симметрии (шаг по углу) излишне",
            }));
        }
    }

    if (!hasCompleteShape(record?.dp, { rows: 2, columns: 1 })) return;
    record.dp.forEach((row, directionIndex) => {
        const value = row[0];
        if (Number.isInteger(value) && value >= 1) return;

        diagnostics.push(createError({
            tab: TABS.REGIONS,
            row: index + 1,
            property: "dp",
            message:
                `разбиение D${directionIndex + 1} должно быть задано `
                + "положительным целым числом",
        }));
    });
}

function hasCompleteShape(value, { rows, columns }) {
    return Array.isArray(value) &&
        value.length === rows &&
        value.every(row =>
            Array.isArray(row) &&
            row.length === columns &&
            row.every(cell =>
                cell !== null &&
                cell !== undefined
            )
        );
}
