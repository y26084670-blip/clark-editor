import { createUniqueId, onCleanup, onMount, Show } from "solid-js";

// Presentation of the laws used by htsGraphModel / htsMaterialLaw, not a
// second numerical implementation. Parameter names match the material card.
export function HtsGraphHelp(props) {
    let dialog;
    const titleId = createUniqueId();
    const title = () => ({ jc: "Jc(b_eff)", ej: "E(J)", mh: "M(H)" })[props.kind];
    onMount(() => dialog.showModal());
    onCleanup(() => { if (dialog?.open) dialog.close(); });
    return <dialog ref={dialog} class="hts-graph-help" aria-labelledby={titleId}
        onCancel={event => { event.preventDefault(); props.onClose(); }}>
        <header><h3 id={titleId}>Формулы {title()}</h3>
            <button type="button" onClick={props.onClose} autofocus>Закрыть</button></header>
        <div class="hts-graph-help-content">
            <p>Имена параметров соответствуют карточке материала. Графики показывают
                характеристику материала, а не результат полевого расчёта.</p>
            <p class="hts-formula">K₀(x) = max(0, 1 − |x|)</p>
            <p class="hts-formula">K(x; a, b) = K₀(|x|<sup>a</sup>)<sup>b</sup> при b ≥ 0;<br />
                K(x; a, b) = (1 + |x|<sup>a</sup>)<sup>b</sup> при b &lt; 0.</p>
            <Show when={props.kind === "jc" || props.kind === "ej"}>
                <p class="hts-formula">Jc(b_eff) = JC0 · K(b_eff / j_HC0; JCa, JCb)</p>
                <p>b_eff = B_eff / μ₀ задаётся в кА/м, J и Jc — в А/мм².
                    Выбранное поле задаётся щелчком на Jc, ползунком или числом;
                    E(J) пересчитывается при этом поле.</p>
            </Show>
            <Show when={props.kind === "ej"}>
                <p class="hts-formula">E = ρJ; T(u, δ) = 2 / (1 + exp(u / δ))</p>
                <Show when={props.record?.j_type === 1}>
                    <p><b>Текущая модель: j_type = 1.</b></p>
                    <p class="hts-formula">ρ = T(K₀(b_eff / j_HC0) · K₀(J / Jc), j1_delta) / j_gmin</p>
                </Show>
                <Show when={props.record?.j_type === 2}>
                    <p><b>Текущая модель: j_type = 2.</b></p>
                    <p class="hts-formula">ρ = (J / Jc)<sup>j2_n</sup> / j_gmin</p>
                    <p>Степень зависимости E от J равна j2_n + 1.</p>
                </Show>
                <Show when={![1, 2].includes(props.record?.j_type)}><p>Выберите модель j_type = 1 или 2.</p></Show>
                <p>При Jc ≤ 0 используется явная нулевая ветвь E(J) = 0.
                    j_gmin задаётся в МСм/м, E получается в В/м.</p>
                <p>«Логарифмическая E» меняет только вертикальную шкалу (основание 10).
                    Нулевые значения не отображаются и не заменяются малым положительным числом.
                    Ось J остаётся линейной.</p>
            </Show>
            <Show when={props.kind === "mh"}>
                <Show when={props.record?.m_type === 1}>
                    <p><b>Текущая модель: m_type = 1, без гистерезиса.</b></p>
                    <p class="hts-formula">T(u, δ) = 2 / (1 + exp(u / δ))<br />
                        M(H) = [T(K₀(H / m_HC0), m1_delta) − 1] · H</p>
                </Show>
                <Show when={props.record?.m_type === 3}>
                    <p><b>Текущая модель: m_type = 3.</b></p>
                    <p class="hts-formula">L(H) = m3_Mmax · K(H / m_HC0; m3_a, m3_b)<br />
                        M₊(H) = L(H); M₋(H) = −L(H)</p>
                    <p>Показаны обе предельные ветви. Начальная линия M = −H идёт из
                        начала координат до первого положительного пересечения H = L(H).
                        При изменении масштаба эта точка не меняется.
                        График не является временной петлёй конкретного расчёта.</p>
                </Show>
                <Show when={![1, 3].includes(props.record?.m_type)}><p>Выберите модель m_type = 1 или 3; m_type = 2 зарезервирована.</p></Show>
                <p>H вдоль оси c и M задаются в кА/м.</p>
            </Show>
            <p>Масштаб: выделите рамкой нужный прямоугольник. Shift + перетаскивание
                перемещает график, колесо меняет масштаб. «Автомасштаб» возвращает полный
                диапазон характеристики. Escape отменяет незавершённую рамку.</p>
        </div>
    </dialog>;
}
