export const MATERIAL_LAYOUT_LIMITS = Object.freeze({
    tableHeight: 180,
    lowerHeight: 180,
    detailWidth: 280,
    graphWidth: 280,
    splitterSize: 6,
});

export const HTS_LAYOUT_LIMITS = Object.freeze({
    ...MATERIAL_LAYOUT_LIMITS,
    graphWidth: 630,
});

function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
}

export function resizedLowerHeight({
    startHeight,
    deltaY,
    availableHeight,
    limits = MATERIAL_LAYOUT_LIMITS,
}) {
    const maximum = Math.max(
        limits.lowerHeight,
        availableHeight - limits.tableHeight - limits.splitterSize,
    );
    return clamp(
        startHeight - deltaY,
        limits.lowerHeight,
        maximum,
    );
}

export function resizedDetailRatio({
    pointerX,
    containerLeft,
    containerWidth,
    limits = MATERIAL_LAYOUT_LIMITS,
}) {
    const contentWidth = Math.max(
        1,
        containerWidth - limits.splitterSize,
    );
    const maximum = Math.max(
        limits.detailWidth,
        contentWidth - limits.graphWidth,
    );
    const detailWidth = clamp(
        pointerX - containerLeft,
        limits.detailWidth,
        maximum,
    );
    return detailWidth / contentWidth;
}
