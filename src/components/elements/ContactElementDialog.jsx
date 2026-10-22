import { createMemo, createSignal, Show } from "solid-js";
import { FloatingWindow } from "../window/FloatingWindow.jsx";
import { createContactElementDefaults, contactElementParameters, CONTACT_CURRENT_NOTICE, CONTACT_THICKNESS_NOTICE } from "../../services/generator/contactElement.js";
import "./ContactElementDialog.css";

export function ContactElementDialog(props) {
  const [params, setParams] = createSignal(createContactElementDefaults(props.model));
  const change = (key, event) => { const value = event.currentTarget.valueAsNumber; props.onChange?.(); setParams(old => ({ ...old, [key]: value })); };
  const error = createMemo(() => {
    try { contactElementParameters(props.model, params()); return ""; }
    catch (error) { return error.message; }
  });
  return <FloatingWindow open={props.open} title="Контактный элемент" initialWidth={560} initialHeight={520}
    minWidth={360} minHeight={240} fitContentHeight class="contact-element-window"
    storageKey="web-gui:contact-element" onClose={props.onClose}>
    <div class="contact-element-dialog">
      <label>Номер элемента-проводника<input type="number" min="1" step="1" value={params().element} onInput={e => change("element", e)} disabled={props.busy}/></label>
      <label>Номер грани для ввода тока<input type="number" min="1" max="6" step="1" value={params().face} onInput={e => change("face", e)} disabled={props.busy}/></label>
      <label>Толщина контактного элемента, мм<input type="number" min="0" step="any" value={params().thickness} onInput={e => change("thickness", e)} disabled={props.busy}/></label>
      <label>Нормальная плотность тока, А/мм²<input type="number" step="any" value={params().normalCurrent} onInput={e => change("normalCurrent", e)} disabled={props.busy}/></label>
      <p>Положительный ток направлен внутрь проводника, отрицательный — наружу. Элемент строится снаружи, без зазора, с разбиением 1 × 1 × 1.</p>
      <p>Номер грани: включите «Грани» в общих опциях окна 3D и наведите указатель на поверхность.</p>
      <p>{CONTACT_THICKNESS_NOTICE}</p>
      <p>{CONTACT_CURRENT_NOTICE}</p>
      <Show when={props.error || (!props.notice && error())}><p class="contact-element-error" role="alert">{props.error || (!props.notice && error())}</p></Show>
      <Show when={props.notice}><p role="status">{props.notice}</p></Show>
      <div class="contact-element-actions"><button disabled={props.busy || !!error()} onClick={() => props.onApply(params())}>Добавить элемент</button>
        <button onClick={props.onClose}>Закрыть</button></div>
    </div>
  </FloatingWindow>;
}
