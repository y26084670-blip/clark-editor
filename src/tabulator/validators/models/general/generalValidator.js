import { createWarning, createError }
    from "../../common/createDiagnostic";
import { TABS } from "../../../../services/schemas/common/constants";
import { buildGeometryScene } from "../../../../services/visualization/geometrySceneModel.js";

export function generalValidator(
    service,
    diagnostics,
) {
    const {general, elements} = service.getModel();
    if (!general) return;

    if (general.forceFaceOffset !== undefined && !Number.isFinite(general.forceFaceOffset)) {
        diagnostics.push(createError({tab:TABS.GENERAL, property:"forceFaceOffset",
            message:"Укажите конечный неотрицательный отступ в миллиметрах."}));
    } else if (general.evalForce && general.forceFaceOffset > 0) {
        if (general.fullAxialSymmetry || buildGeometryScene({general, elements}, {originalOnly:true}).planar2D) {
            diagnostics.push(createError({tab:TABS.GENERAL, property:"forceFaceOffset",
                message:"Расчёт по внешним ЭП доступен в конечной 3D-модели без полной осевой симметрии. Для расчёта по заданным площадкам установите отступ 0."}));
        }
        if (!elements?.some(row => row.targ !== 3 && row.take > 0)) {
            diagnostics.push(createError({tab:TABS.GENERAL, property:"forceFaceOffset",
                message:"Для расчёта по внешним ЭП назначьте хотя бы одному физическому элементу положительную силовую группу."}));
        }
    }

    if (general.fullAxialSymmetry === true && general.useMED !== false) {
        diagnostics.push(createError({
            tab: TABS.GENERAL,
            property: "useMED",
            message: "Включена «Осесимметричная (AC)». В этой постановке потенциальная "
                + "составляющая электрического поля не рассчитывается. "
                + "Отключите «Учёт зарядов» (useMED=false).",
        }));
    }

    if (general.fullAxialSymmetry !== true
        && general.useMED === false && service.getModel().elements?.some(
        row => row?.targ === 0 && Number.isFinite(row.rv) && row.rv > 0,
    )) {
        diagnostics.push(createWarning({
            tab: TABS.GENERAL,
            property: "useMED",
            message: "Учёт зарядов отключён. Используйте этот режим, только если отсутствие "
                + "потенциальной составляющей известно из постановки задачи, например для длинных проводников с продольными токами.",
        }));
    }

    if (
        general.countTimeSteps > 0 &&
        general.timeStep <= 0.0
    ) {
        diagnostics.push(
            createError({
                tab: TABS.GENERAL,
                property: "timeStep",
                row: undefined,
                message:
                    "Для динамической задачи шаг по времени должен быть отличный от нуля и положительный",
            })
        );
    }

    if (
        general.countTimeSteps == 0 &&
        general.timeStep > 0.0
    ) {
        diagnostics.push(
            createWarning({
                tab: TABS.GENERAL,
                property: "timeStep",
                row: undefined,
                message:
                    "Для статической задачи задавать ненулевой шаг по времени не требуется",
            })
        );
    }
}
