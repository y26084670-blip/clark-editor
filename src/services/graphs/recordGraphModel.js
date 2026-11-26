import { formatGraphNumber } from "./graphNumbers.js";
import { geometryTimeState } from "../visualization/geometryTimeModel.js";
const COLORS = Object.freeze([
    "#4e9af1",
    "#e36d67",
    "#5dbb75",
    "#d49b34",
    "#a27bd6",
    "#4fb8b3",
    "#df79b0",
    "#9aa347",
    "#e58c47",
    "#7b9ee8",
    "#76b15a",
    "#c876d3",
]);

export function recordGraphMode(schema, modeValue) {
    const descriptor = schema?.views?.graph;
    const value = modeValue ?? descriptor?.defaultMode;
    const mode = descriptor?.modes?.find(item => item.value === value);
    if (!mode) {
        throw new Error(`Неизвестный режим графика '${value ?? ""}'.`);
    }
    return mode;
}

export function recordGraphModeForProperty(schema, propertyName) {
    return schema?.views?.graph?.modes?.find(
        item => item.property === propertyName,
    ) ?? null;
}

function recordCaption(descriptor, record, recordIndex) {
    const index = record?.rowLabel ?? recordIndex + 1;
    return `${descriptor.recordLabel} ${index}`;
}

export function recordGraphDatasets(schema, records, modeValue) {
    if (!Array.isArray(records)) return [];

    const descriptor = schema?.views?.graph;
    const mode = recordGraphMode(schema, modeValue);
    const property = schema.properties[mode.property];
    const datasets = [];

    records.forEach((record, recordIndex) => {
        const caption = recordCaption(descriptor, record, recordIndex);
        const rows = record?.[mode.property];
        if (!Array.isArray(rows)) {
            throw new Error(`Запись '${caption}' не содержит таблицу.`);
        }

        mode.series.forEach((series) => {
            const datasetIndex = datasets.length;
            const color = COLORS[datasetIndex % COLORS.length];
            const label = mode.series.length === 1
                ? caption
                : `${caption} — ${series.label}`;
            const data = rows.map((row, rowIndex) => {
                const x = row?.[mode.x.column];
                const y = row?.[series.column];
                if (!Number.isFinite(x) || !Number.isFinite(y)) {
                    throw new Error(
                        `Строка ${rowIndex + 1} записи `
                        + `'${caption}' некорректна.`,
                    );
                }
                return { x, y };
            });

            datasets.push({
                label,
                data,
                borderColor: color,
                backgroundColor: color,
                pointRadius: 2,
                pointHoverRadius: 4,
                borderWidth: 2,
                fill: false,
                parsing: false,
            });
        });
    });

    return datasets;
}

export function calculationEndTime(general) {
    if (general?.countTimeSteps == null || general.timeStep == null) return null;
    const { time, diagnostics } = geometryTimeState(general, general.countTimeSteps);
    return diagnostics.length ? null : time;
}

function drawCalculationEnd({ ctx, chartArea: area, scales }, endTime) {
    if (area.width <= 12 || area.height <= 0) return;
    const x = scales.x.getPixelForValue(endTime);
    const label = `Конец расчёта · ${formatGraphNumber(endTime)} с`;
    ctx.save();
    ctx.strokeStyle = scales.x.options.title.color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(x, area.top);
    ctx.lineTo(x, area.bottom);
    ctx.stroke();

    ctx.font = "600 12px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const width = Math.min(ctx.measureText(label).width, area.width - 12);
    const left = x + 6 + width <= area.right ? x + 6 : Math.max(area.left + 6, x - 6 - width);
    ctx.fillStyle = "#28343f";
    ctx.fillRect(left - 3, area.top + 2, width + 6, 17);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, left, area.top + 4, width);
    ctx.restore();
}

export function withCalculationEnd(config, endTime) {
    if (!Number.isFinite(endTime)) return config;
    const x = config.options.scales.x;
    x.bounds = "data";
    x.afterDataLimits = scale => {
        const { min, max } = scale.getMinMax(false);
        const first = Math.min(0, min);
        scale.max = Math.max(endTime, max);
        // A stationary task with just t = 0 still needs a nonzero axis span.
        scale.min = first < scale.max ? first : first - 1;
    };
    config.plugins = [...(config.plugins ?? []), {
        id: "calculationEnd",
        afterDatasetsDraw: chart => drawCalculationEnd(chart, endTime),
    }];
    return config;
}

export function recordGraphConfig(schema, records, modeValue, endTime) {
    const mode = recordGraphMode(schema, modeValue);
    return withCalculationEnd({
        type: "line",
        data: {
            datasets: recordGraphDatasets(schema, records, mode.value),
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            normalized: true,
            locale: "ru-RU",
            plugins: {
                legend: {
                    display: true,
                    labels: { color: "#dce4ec" },
                },
            },
            scales: {
                x: {
                    type: "linear",
                    title: {
                        display: true,
                        text: mode.x.title,
                        color: "#dce4ec",
                    },
                    ticks: { color: "#b8c3cd", callback: formatGraphNumber },
                    grid: { color: "rgba(180, 195, 208, .16)" },
                },
                y: {
                    type: "linear",
                    title: {
                        display: true,
                        text: mode.y.title,
                        color: "#dce4ec",
                    },
                    ticks: { color: "#b8c3cd", callback: formatGraphNumber },
                    grid: { color: "rgba(180, 195, 208, .16)" },
                },
            },
        },
    }, endTime);
}
