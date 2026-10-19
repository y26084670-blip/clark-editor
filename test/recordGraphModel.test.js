import assert from "node:assert/strict";
import test from "node:test";

import {
    recordGraphConfig,
    recordGraphDatasets,
    recordGraphModeForProperty,
} from "../src/services/graphs/recordGraphModel.js";

const ampsSchema = {
    properties: {
        impuls: { nColumns: 2 },
    },
    views: {
        graph: {
            title: "Графики импульсов",
            recordLabel: "Импульс",
            defaultMode: "amplitude",
            modes: [{
                value: "amplitude",
                property: "impuls",
                x: { column: 0, title: "Время" },
                y: { title: "Амплитуда" },
                series: [{ column: 1, label: "Амплитуда" }],
            }],
        },
    },
};

const movesSchema = {
    properties: {
        position: { nColumns: 4 },
        angle: { nColumns: 4 },
    },
    views: {
        graph: {
            title: "Графики траекторий",
            recordLabel: "Траектория",
            defaultMode: "position",
            modes: [
                {
                    value: "position",
                    property: "position",
                    x: { column: 0, title: "Время" },
                    y: { title: "Смещение" },
                    series: [
                        { column: 1, label: "X" },
                        { column: 2, label: "Y" },
                        { column: 3, label: "Z" },
                    ],
                },
                {
                    value: "angle",
                    property: "angle",
                    x: { column: 0, title: "Время" },
                    y: { title: "Угол" },
                    series: [
                        { column: 1, label: "aX" },
                        { column: 2, label: "aY" },
                        { column: 3, label: "aZ" },
                    ],
                },
            ],
        },
    },
};

test("selected amplitudes become one time-value dataset each", () => {
    const records = [{
        rowLabel: 2,
        impuls: [[0, 10], [1, 20]],
        n: 2,
    }];
    const datasets = recordGraphDatasets(ampsSchema, records);

    assert.equal(datasets.length, 1);
    assert.equal(datasets[0].label, "Импульс 2");
    assert.deepEqual(datasets[0].data, [
        { x: 0, y: 10 },
        { x: 1, y: 20 },
    ]);
    assert.equal(
        recordGraphConfig(ampsSchema, records).options.scales.x.type,
        "linear",
    );
    assert.equal(
        recordGraphModeForProperty(ampsSchema, "impuls").value,
        "amplitude",
    );
});

test("trajectory graph defaults to displacement and exposes three axes", () => {
    const records = [{
        rowLabel: 4,
        position: [[0, 10, 20, 30], [1, 11, 21, 31]],
        angle: [[0, 1, 3, 5], [1, 2, 4, 6]],
        n: 2,
    }];
    const datasets = recordGraphDatasets(movesSchema, records);

    assert.equal(movesSchema.views.graph.defaultMode, "position");
    assert.deepEqual(
        datasets.map(dataset => dataset.label),
        [
            "Траектория 4 — X",
            "Траектория 4 — Y",
            "Траектория 4 — Z",
        ],
    );
    assert.deepEqual(datasets[2].data, [
        { x: 0, y: 30 },
        { x: 1, y: 31 },
    ]);
});

test("trajectory angle mode uses angle values and degree axis", () => {
    const records = [{
        angle: [[0, 1, 3, 5], [1, 2, 4, 6]],
        position: [],
        n: 2,
    }];
    const config = recordGraphConfig(movesSchema, records, "angle");

    assert.equal(config.data.datasets.length, 3);
    assert.deepEqual(config.data.datasets[0].data, [
        { x: 0, y: 1 },
        { x: 1, y: 2 },
    ]);
    assert.equal(config.options.scales.y.title.text, "Угол");
    assert.equal(
        recordGraphModeForProperty(movesSchema, "angle").value,
        "angle",
    );
    assert.equal(recordGraphModeForProperty(movesSchema, "unknown"), null);
});

test("malformed record graph rows fail before Chart creation", () => {
    assert.throws(
        () => recordGraphDatasets(
            ampsSchema,
            [{ impuls: [[0, Number.NaN]], n: 1 }],
        ),
        /некорректна/u,
    );
    assert.throws(
        () => recordGraphDatasets(ampsSchema, [{ impuls: null, n: 0 }]),
        /не содержит таблицу/u,
    );
});
