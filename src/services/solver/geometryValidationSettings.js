// Разрядность геометрической проверки совпадает с выбранным решателем.
export function modelGeometrySettings(model) {
    return { settings: { doubleFloat: model?.general?.doubleFloat === true }, invalid: [] };
}
