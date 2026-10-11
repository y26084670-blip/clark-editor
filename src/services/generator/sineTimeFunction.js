import { generateTimeSeries } from "./timeFunctionModel.js";

function parameter(value, label, nonnegative = false) {
    if ((typeof value !== "number" && typeof value !== "string")
        || (typeof value === "string" && value.trim() === "")
        || !Number.isFinite(Number(value))) {
        throw new Error(`${label}: введите конечное число.`);
    }
    const number = Number(value);
    if (nonnegative && number < 0) {
        throw new Error(`${label}: значение должно быть неотрицательным.`);
    }
    return number;
}

export function generateSineTimeSeries({
    frequency, phase, tau1, tau2, countTimeSteps, timeStep,
}) {
    const f = parameter(frequency, "F", true);
    const vi = parameter(phase, "VI");
    const decay = parameter(tau1, "TAU1", true);
    const stabilization = parameter(tau2, "TAU2", true);
    // Zero time constants disable their envelopes; no division by zero.
    const expression = [
        `F=${f}`,
        `VI=${vi}`,
        `TAU1=${decay}`,
        `TAU2=${stabilization}`,
        decay === 0 ? "A=1" : "A=exp(-t/TAU1)",
        stabilization === 0 ? "B=1" : "B=1-exp(-t/TAU2)",
        "A*B*sin(2*pi*F*t+pi/180*VI)",
    ].join("\n");
    const points = generateTimeSeries({
        expression,
        countTimeSteps,
        timeStep,
        minimumTime: 0,
        maximumTime: Number(countTimeSteps) * Number(timeStep),
    });
    return { expression, points };
}
