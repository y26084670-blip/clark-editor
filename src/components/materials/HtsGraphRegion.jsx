import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, untrack } from "solid-js";
import { electricFieldNumber, graphNumber, HTS_GRAPH_KINDS, htsGraphFormula, htsGraphModel, htsMagneticStep, htsMagneticTrace, panGraphRange, zoomGraphRange } from "../../services/materials/htsGraphModel.js";
import { htsCriticalCurrent } from "../../services/solver/htsMaterialLaw.js";
import { HtsGraphFormula } from "./HtsGraphFormula.jsx";
import "./HtsGraphRegion.css";

const TITLES = { jc: "Jc(b_eff)", ej: "E(J)", mh: "M(H)" };
const LOG_TICKS = new Intl.NumberFormat("ru-RU", { notation: "scientific", maximumSignificantDigits: 3 });

function HtsPlot(props) {
    const [viewport, setViewport] = createSignal(null);
    const [automatic, setAutomatic] = createSignal(true);
    const [renderError, setRenderError] = createSignal("");
    const [logarithmic, setLogarithmic] = createSignal(false);
    const [magneticTrace, setMagneticTrace] = createSignal([{ x: 0, y: 0 }]);
    const [magneticRange, setMagneticRange] = createSignal(null);
    const [magneticError, setMagneticError] = createSignal("");
    let canvas, chart, gesture, lastRecord, lastMagneticSignature, formulaDialog;
    const logAxes = () => props.kind === "ej" && logarithmic();
    const baseModel = createMemo(() => htsGraphModel(props.kind, props.record, props.field, viewport()?.x, { logarithmic: logAxes() }));
    const model = createMemo(() => {
        const value = baseModel();
        return props.kind === "mh" && !value.error
            ? { ...value, datasets: [...value.datasets, htsMagneticTrace(magneticTrace())] } : value;
    });
    const magneticPoint = () => magneticTrace().at(-1);
    const hRange = () => {
        const bound = 1.2 * props.record?.m_HC0;
        return magneticRange() ?? (Number.isFinite(bound) && bound > 0 ? [-bound, bound] : [-1, 1]);
    };
    function setMagneticField(value, limits = hRange()) {
        if (!Number.isFinite(value) || !props.record) return false;
        const H = Math.max(limits[0], Math.min(limits[1], value)), previous = magneticPoint();
        if (H === previous.x) return true;
        try {
            const point = htsMagneticStep(props.record, H, previous);
            setMagneticTrace(points => [...points, point]); setMagneticError("");
            return true;
        } catch (error) { setMagneticError(error.message); return false; }
    }
    function changeMagneticRange(index, event) {
        const limits = [...hRange()], value = event.currentTarget.valueAsNumber;
        limits[index] = value;
        if (!limits.every(Number.isFinite) || !Number.isFinite(limits[1] - limits[0])
            || !(limits[1] > limits[0]) || !setMagneticField(magneticPoint().x, limits)) {
            event.currentTarget.value = String(hRange()[index]); return;
        }
        setMagneticRange(limits); setViewport({ x: limits, y: automatic() ? null : currentView()?.y });
    }
    function clearMagneticTrace() {
        gesture = null;
        setMagneticTrace([{ x: 0, y: 0 }]); setMagneticError("");
        const limits = hRange();
        if (limits[0] > 0 || limits[1] < 0) {
            const next = [Math.min(0, limits[0]), Math.max(0, limits[1])];
            setMagneticRange(next); setViewport({ x: next, y: automatic() ? null : currentView()?.y });
        }
    }
    const formula = createMemo(() => htsGraphFormula(props.kind, props.record));

    function currentView() {
        if (!chart) return null;
        return {
            x: [chart.scales.x.min, chart.scales.x.max],
            y: [chart.scales.y.min, chart.scales.y.max],
        };
    }

    function changeAutomatic(checked) {
        gesture = null;
        const view = currentView();
        setAutomatic(checked);
        setViewport(checked ? (view ? { x: view.x, y: null } : null) : view);
    }

    function zoom(factor, anchor) {
        const view = currentView();
        if (!view) return;
        setAutomatic(false);
        setViewport({
            x: zoomGraphRange(view.x, factor, anchor?.x, props.kind !== "mh", logAxes()),
            y: zoomGraphRange(view.y, factor, anchor?.y, false, logAxes()),
        });
    }

    function coordinates(event) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: (event.clientX - rect.left) * chart.width / rect.width,
            y: (event.clientY - rect.top) * chart.height / rect.height,
        };
    }

    function setCursor(event) {
        if (!chart) return;
        const pixel = coordinates(event).x;
        props.onField(Math.max(0, chart.scales.x.getValueForPixel(
            Math.max(chart.chartArea.left, Math.min(chart.chartArea.right, pixel)),
        )));
    }

    function pointerDown(event) {
        if (!chart || event.button !== 0) return;
        const point = coordinates(event), area = chart.chartArea;
        if (point.x < area.left || point.x > area.right || point.y < area.top || point.y > area.bottom) return;
        event.preventDefault();
        canvas.focus({ preventScroll: true });
        canvas.setPointerCapture(event.pointerId);
        gesture = {
            id: event.pointerId,
            cursor: props.kind === "jc" && !event.shiftKey,
            point, view: currentView(),
            width: area.right - area.left, height: area.bottom - area.top,
        };
        if (gesture.cursor) setCursor(event);
    }

    function pointerMove(event) {
        if (!gesture || event.pointerId !== gesture.id || !chart) return;
        if (gesture.cursor) { setCursor(event); return; }
        const point = coordinates(event), { view } = gesture;
        setAutomatic(false);
        const span = range => logAxes() ? Math.log10(range[1]) - Math.log10(range[0]) : range[1] - range[0];
        setViewport({
            x: panGraphRange(view.x, -(point.x - gesture.point.x) / gesture.width * span(view.x), props.kind !== "mh", logAxes()),
            y: panGraphRange(view.y, (point.y - gesture.point.y) / gesture.height * span(view.y), false, logAxes()),
        });
    }

    function finishGesture(event) {
        if (gesture?.id !== event.pointerId) return;
        gesture = null;
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    }

    function wheel(event) {
        if (!chart || !event.deltaY) return;
        const point = coordinates(event), area = chart.chartArea;
        if (point.x < area.left || point.x > area.right || point.y < area.top || point.y > area.bottom) return;
        event.preventDefault();
        zoom(event.deltaY > 0 ? 1.2 : 1 / 1.2, {
            x: chart.scales.x.getValueForPixel(point.x),
            y: chart.scales.y.getValueForPixel(point.y),
        });
    }

    function keyDown(event) {
        if (props.kind !== "jc" || !chart) return;
        const step = (chart.scales.x.max - chart.scales.x.min) / (event.shiftKey ? 10 : 100);
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        props.onField(event.key === "Home" ? Math.max(0, chart.scales.x.min)
            : event.key === "End" ? chart.scales.x.max
            : Math.max(0, props.field + (event.key === "ArrowLeft" ? -step : step)));
    }

    const cursorPlugin = {
        id: "htsFieldCursor",
        afterDatasetsDraw(instance) {
            if (props.kind !== "jc" || !props.record) return;
            const { ctx, chartArea: area, scales } = instance;
            const field = untrack(() => props.field);
            const x = scales.x.getPixelForValue(field);
            const y = scales.y.getPixelForValue(htsCriticalCurrent(props.record, field));
            if (!Number.isFinite(x) || !Number.isFinite(y) || x < area.left || x > area.right) return;
            ctx.save();
            ctx.beginPath(); ctx.rect(area.left, area.top, area.right - area.left, area.bottom - area.top); ctx.clip();
            ctx.strokeStyle = "#f6e493"; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
            ctx.beginPath(); ctx.moveTo(x, area.top); ctx.lineTo(x, area.bottom); ctx.stroke();
            ctx.setLineDash([]); ctx.fillStyle = "#f6e493";
            ctx.beginPath(); ctx.arc(x, y, 4, 0, 2 * Math.PI); ctx.fill();
            ctx.restore();
        },
    };

    createEffect(() => {
        const record = props.record;
        const changed = record !== lastRecord;
        if (changed) {
            lastRecord = record;
            gesture = null;
            setViewport(null); setMagneticRange(null); setAutomatic(true);
        }
        if (props.kind === "mh") {
            const signature = JSON.stringify([record?.m_type, record?.m_HC0, record?.m1_delta, record?.m3_Mmax, record?.m3_a, record?.m3_b]);
            if (changed || signature !== lastMagneticSignature) {
                lastMagneticSignature = signature;
                untrack(clearMagneticTrace);
            }
        }
    });

    createEffect(() => {
        const value = model(), Chart = props.Chart;
        const view = viewport();
        setRenderError("");
        if (!Chart || value.error || !canvas) {
            chart?.destroy(); chart = null;
            return;
        }
        const scale = (axis, label, limits) => ({
            type: logAxes() ? "logarithmic" : "linear",
            title: { display: true, text: label, color: "#dce4ec", font: { size: 11 } },
            ticks: { color: "#bccbd7", maxTicksLimit: 5, callback: value => logAxes() ? LOG_TICKS.format(value) : props.kind === "ej" && axis === "y" ? electricFieldNumber(value) : graphNumber(value), font: { size: 10 } },
            grid: { color: "rgba(180,195,208,.16)" },
            ...(limits ? { min: limits[0], max: limits[1] } : {}),
        });
        const options = {
            responsive: true, maintainAspectRatio: false, animation: false,
            plugins: {
                legend: { display: props.kind === "mh", labels: { color: "#dce4ec", boxWidth: 16, font: { size: 11 } } },
                tooltip: { callbacks: { label: item => `${item.dataset.label}: ${props.kind === "ej" ? electricFieldNumber(item.parsed.y) : graphNumber(item.parsed.y)}` } },
            },
            scales: {
                x: scale("x", value.xLabel, view?.x ?? value.xRange),
                y: { ...scale("y", value.yLabel, automatic() ? null : view?.y), beginAtZero: !logAxes() },
            },
        };
        try {
            if (chart) {
                chart.data.datasets = value.datasets;
                chart.options = options;
                chart.update("none");
            } else chart = new Chart(canvas, {
                type: "line", data: { datasets: value.datasets }, options, plugins: [cursorPlugin],
            });
        } catch (error) {
            chart?.destroy(); chart = null;
            setRenderError(error.message);
        }
    });

    onMount(() => canvas.addEventListener("wheel", wheel, { passive: false }));
    onCleanup(() => { canvas.removeEventListener("wheel", wheel); gesture = null; chart?.destroy(); chart = null; });

    return <section class="hts-graph" data-hts-graph={props.kind} aria-label={`График ${TITLES[props.kind]}`}>
        <header class="hts-graph-title">
            <span>{TITLES[props.kind]}</span>
            <label class="hts-graph-auto" title="Автоматически подбирать вертикальный масштаб для видимого диапазона">
                <input type="checkbox" checked={automatic()} disabled={Boolean(model().error)}
                    aria-label={`Авто ${TITLES[props.kind]}`}
                    onChange={event => changeAutomatic(event.currentTarget.checked)} /> Авто
            </label>
            <Show when={props.kind === "mh"}>
                <button type="button" disabled={!props.record} title="Очистить траекторию и установить H = M = 0"
                    onClick={clearMagneticTrace}>Очистить</button>
            </Show>
            <Show when={props.kind === "ej"}>
                <label class="hts-graph-logarithm"><input type="checkbox" checked={logarithmic()} disabled={!props.record}
                    aria-label="Логарифмические оси E(J)" onChange={event => {
                        gesture = null; setViewport(null); setAutomatic(true); setLogarithmic(event.currentTarget.checked);
                    }} /> логарифм</label>
            </Show>
            <button type="button" class="hts-graph-formula-help" aria-label={`Формулы ${TITLES[props.kind]}`}
                title="Формулы выбранной модели" aria-haspopup="dialog" disabled={!props.record}
                onClick={() => formulaDialog.showModal()}>?</button>
        </header>
        <Show when={props.kind === "mh"}>
            <div class="hts-magnetic-control">
                <label for="hts-magnetic-field">H, кА/м</label>
                <input type="number" class="hts-magnetic-limit" step="any" aria-label="Минимум H, кА/м"
                    value={hRange()[0]} disabled={Boolean(model().error)} onChange={event => changeMagneticRange(0, event)} />
                <input id="hts-magnetic-field" type="range" min={hRange()[0]} max={hRange()[1]} step={(hRange()[1] - hRange()[0]) / 1000}
                    value={magneticPoint().x} aria-label="Магнитное поле H, кА/м" aria-valuetext={graphNumber(magneticPoint().x)}
                    disabled={Boolean(model().error)} onInput={event => setMagneticField(event.currentTarget.valueAsNumber)} />
                <input type="number" class="hts-magnetic-limit" step="any" aria-label="Максимум H, кА/м"
                    value={hRange()[1]} disabled={Boolean(model().error)} onChange={event => changeMagneticRange(1, event)} />
            </div>
        </Show>
        <div class="hts-graph-host">
            <canvas ref={canvas} tabIndex="0" aria-label={props.kind === "jc" ? "Курсор эффективного поля" : TITLES[props.kind]}
                onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={finishGesture}
                onPointerCancel={finishGesture} onLostPointerCapture={() => { gesture = null; }} onKeyDown={keyDown} />
            <Show when={model().error || renderError() || magneticError() || props.loadError}>
                <div class="hts-graph-message" role={props.record ? "alert" : "status"}>
                    {model().error || renderError() || magneticError() || props.loadError}
                </div>
            </Show>
        </div>
        <div class="hts-graph-note"><Show when={props.kind === "mh"}>
            <output class="hts-magnetic-value" aria-label="Текущее состояние M(H)">H = {graphNumber(magneticPoint().x)} кА/м; M = {graphNumber(magneticPoint().y)} кА/м</output>
        </Show>{model().note || (props.kind === "jc"
            ? "Курсор: щелчок или перетаскивание; ← → с клавиатуры."
            : props.kind === "ej" ? "Поле и Jc заданы курсором первого графика." : "")}</div>
        <dialog ref={formulaDialog} class="hts-graph-formula-dialog" aria-label={`Формулы ${TITLES[props.kind]}`}>
            <h3>{formula().title}</h3>
            <HtsGraphFormula kind={props.kind} record={props.record} />
            <button type="button" onClick={() => formulaDialog.close()}>Закрыть</button>
        </dialog>
    </section>;
}

export function HtsGraphRegion(props) {
    const [Chart, setChart] = createSignal(null);
    const [loadError, setLoadError] = createSignal("");
    const [field, setField] = createSignal(0);
    let alive = true, lastRecord;
    const currentJc = createMemo(() => {
        try { return props.record ? htsCriticalCurrent(props.record, field()) : NaN; }
        catch { return NaN; }
    });
    function selectField(value) { if (Number.isFinite(value)) setField(Math.max(0, value)); }

    createEffect(() => {
        const record = props.record;
        if (record !== lastRecord) { lastRecord = record; setField(0); }
    });
    onMount(() => {
        void import("chart.js/auto").then(module => {
            if (alive) setChart(() => module.default);
        }).catch(error => { if (alive) setLoadError(`Графики не загружены: ${error.message}`); });
    });
    onCleanup(() => { alive = false; });

    return <section class="hts-graph-region" aria-label="Графики характеристик ВТСП">
        <div class="hts-graph-selection">
            <span class="hts-graph-material">{props.record?.name || "Материал не выбран"}</span>
            <label>b_eff, кА/м
                <input type="number" min="0" step="any" aria-label="Текущее эффективное поле"
                    disabled={!props.record} value={field()} onInput={event => selectField(event.currentTarget.valueAsNumber)} />
            </label>
            <output aria-label="Текущая критическая плотность тока">Jc = {graphNumber(currentJc())} А/мм²</output>
        </div>
        <div class="hts-graph-grid">
            <For each={HTS_GRAPH_KINDS}>{kind => <HtsPlot kind={kind} record={props.record} field={field()}
                onField={selectField} Chart={Chart()} loadError={loadError()} />}</For>
        </div>
        <div class="hts-graph-gestures">Масштаб: колесо мыши. Перемещение: перетаскивание, на Jc — с Shift.</div>
    </section>;
}
