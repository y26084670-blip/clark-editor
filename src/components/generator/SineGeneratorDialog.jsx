import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";

function SineFormula() {
  return <div class="sine-generator-formula">
    <math display="block" aria-label="a(t) = A(t) B(t) sin(2πFt + πVI/180)">
      <mrow><mi>a</mi><mo stretchy="false">(</mo><mi>t</mi><mo stretchy="false">)</mo><mo>=</mo>
        <mi>A</mi><mo stretchy="false">(</mo><mi>t</mi><mo stretchy="false">)</mo><mo>·</mo>
        <mi>B</mi><mo stretchy="false">(</mo><mi>t</mi><mo stretchy="false">)</mo><mo>·</mo>
        <mi mathvariant="normal">sin</mi><mo>(</mo>
        <mn>2</mn><mi>π</mi><mi>F</mi><mi>t</mi><mo>+</mo>
        <mfrac><mrow><mi>π</mi><mi mathvariant="normal">VI</mi></mrow><mn>180</mn></mfrac>
        <mo>)</mo></mrow>
    </math>
    <math display="block" aria-label="A(t): 1 при τ₁ = 0; exp(−t/τ₁) при τ₁ > 0">
      <mrow><mi>A</mi><mo stretchy="false">(</mo><mi>t</mi><mo stretchy="false">)</mo><mo>=</mo><mo stretchy="true">{'{'}</mo>
        <mtable columnalign="left left">
          <mtr><mtd><mn>1</mn></mtd><mtd><msub><mi>τ</mi><mn>1</mn></msub><mo>=</mo><mn>0</mn></mtd></mtr>
          <mtr><mtd><msup><mi>e</mi><mrow><mo>−</mo><mfrac><mi>t</mi><msub><mi>τ</mi><mn>1</mn></msub></mfrac></mrow></msup></mtd>
            <mtd><msub><mi>τ</mi><mn>1</mn></msub><mo>&gt;</mo><mn>0</mn></mtd></mtr>
        </mtable></mrow>
    </math>
    <math display="block" aria-label="B(t): 1 при τ₂ = 0; 1 − exp(−t/τ₂) при τ₂ > 0">
      <mrow><mi>B</mi><mo stretchy="false">(</mo><mi>t</mi><mo stretchy="false">)</mo><mo>=</mo><mo stretchy="true">{'{'}</mo>
        <mtable columnalign="left left">
          <mtr><mtd><mn>1</mn></mtd><mtd><msub><mi>τ</mi><mn>2</mn></msub><mo>=</mo><mn>0</mn></mtd></mtr>
          <mtr><mtd><mn>1</mn><mo>−</mo><msup><mi>e</mi><mrow><mo>−</mo><mfrac><mi>t</mi><msub><mi>τ</mi><mn>2</mn></msub></mfrac></mrow></msup></mtd>
            <mtd><msub><mi>τ</mi><mn>2</mn></msub><mo>&gt;</mo><mn>0</mn></mtd></mtr>
        </mtable></mrow>
    </math>
    <p>При F = 0 зависимость — комбинация экспонент с множителем sin(π·VI/180).</p>
  </div>;
}

export function SineGeneratorDialog(props) {
  const [frequency, setFrequency] = createSignal("50");
  const [phase, setPhase] = createSignal("0");
  const [tau1, setTau1] = createSignal("0");
  const [tau2, setTau2] = createSignal("0");
  const [error, setError] = createSignal("");
  const [help, setHelp] = createSignal(false);
  const [helpPosition, setHelpPosition] = createSignal({});
  let dialog;
  let disposed = false;

  createEffect(() => {
    if (props.open) {
      setError("");
      queueMicrotask(() => {
        if (!disposed && props.open && dialog?.isConnected && !dialog.open) dialog.showModal();
      });
    } else {
      dialog?.close();
      setHelp(false);
    }
  });
  createEffect(() => {
    props.taskHandle;
    setFrequency("50"); setPhase("0"); setTau1("0"); setTau2("0");
    setError("");
  });
  onCleanup(() => { disposed = true; dialog?.close(); });

  const change = (setter, value) => { setter(value); setError(""); };
  function showHelp() {
    const bounds = dialog.getBoundingClientRect();
    const width = Math.min(bounds.width, window.innerWidth - 32);
    setHelpPosition({
      left: `${Math.max(16, Math.min(bounds.left, window.innerWidth - width - 16))}px`,
      top: `${Math.max(16, Math.min(bounds.top + 44, window.innerHeight - 280))}px`,
      width: `${width}px`,
    });
    setHelp(true);
  }
  function generate(event) {
    event.preventDefault();
    try {
      props.onGenerate({ frequency: frequency(), phase: phase(), tau1: tau1(), tau2: tau2() });
      props.onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return <Portal>
    <dialog ref={dialog} class="sine-generator-dialog" aria-label="Синус - генератор"
      aria-modal="true" onCancel={event => { event.preventDefault(); props.onClose(); }}>
      <form onSubmit={generate}>
        <div class="sine-generator-heading">
          <strong>Синус - генератор</strong>
          <button type="button" class="sine-generator-help" aria-label="Формула синус-генератора"
            aria-describedby={help() ? "sine-generator-formula" : undefined}
            aria-expanded={help()} onMouseEnter={showHelp} onMouseLeave={() => setHelp(false)}
            onFocus={showHelp} onBlur={() => setHelp(false)}
            onClick={showHelp}>?</button>
        </div>
        <Show when={help()}>
          <div id="sine-generator-formula" class="sine-generator-tooltip" style={helpPosition()} role="tooltip"><SineFormula /></div>
        </Show>
        <div class="sine-generator-inputs">
          <label>F — Частота, Гц<input name="frequency" type="number" min="0" step="any" required autofocus value={frequency()}
            onInput={event => change(setFrequency, event.currentTarget.value)} /></label>
          <label>VI — Фаза, град<input name="phase" type="number" step="any" required value={phase()}
            onInput={event => change(setPhase, event.currentTarget.value)} /></label>
          <label title="TAU1 — постоянная времени затухания">τ₁ — Затухание, с<input name="tau1" type="number" min="0" step="any" required value={tau1()}
            onInput={event => change(setTau1, event.currentTarget.value)} /></label>
          <label title="TAU2 — постоянная времени стабилизации">τ₂ — Стабилизация, с<input name="tau2" type="number" min="0" step="any" required value={tau2()}
            onInput={event => change(setTau2, event.currentTarget.value)} /></label>
        </div>
        <Show when={error()}><p class="sine-generator-error" role="alert">{error()}</p></Show>
        <div class="sine-generator-actions">
          <button type="submit" disabled={!props.taskHandle}>Генерировать</button>
          <button type="button" onClick={props.onClose}>Закрыть</button>
        </div>
      </form>
    </dialog>
  </Portal>;
}
