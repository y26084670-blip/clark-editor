import { Show } from "solid-js";

// Native MathML, matching the formula presentation in SineGeneratorDialog.
// Parameter names match the material editor and htsMaterialLaw.js.
export function HtsGraphFormula(props) {
  const electrical = () => props.kind === "jc" || props.kind === "ej";
  const supported = () => electrical() || [1, 3].includes(props.record?.m_type);
  return <div class="hts-graph-formula">
    <Show when={electrical()}>
      <div class="hts-graph-formula-scroll"><math display="block" aria-label={"Jc = JC0 · K(b_eff / j_HC0; JCa, JCb); b_eff = B_eff / μ₀"}><mrow><msub><mi>J</mi><mi>c</mi></msub><mo>=</mo><mi mathvariant="normal">JC0</mi><mo>·</mo><mi mathvariant="normal">K</mi><mo>(</mo><mfrac><mrow><msub><mi>b</mi><mi mathvariant="normal">eff</mi></msub></mrow><mrow><mi mathvariant="normal">j_HC0</mi></mrow></mfrac><mo>;</mo><mi mathvariant="normal">JCa</mi><mo>,</mo><mi mathvariant="normal">JCb</mi><mo>)</mo><mo>,</mo><msub><mi>b</mi><mi mathvariant="normal">eff</mi></msub><mo>=</mo><mfrac><mrow><msub><mi>B</mi><mi mathvariant="normal">eff</mi></msub></mrow><mrow><msub><mi>μ</mi><mn>0</mn></msub></mrow></mfrac></mrow></math></div>
    </Show>
    <Show when={props.kind === "ej"}>
      <Show when={props.record?.j_type === 1}>
        <div class="hts-graph-formula-scroll"><math display="block" aria-label={"E(J) = 2J / {j_gmin · [1 + exp(U(b_eff / j_HC0) · U(J / Jc) / j1_delta)]}"}><mrow><mi mathvariant="normal">E</mi><mo>(</mo><mi>J</mi><mo>)</mo><mo>=</mo><mfrac><mrow><mn>2</mn><mi>J</mi></mrow><mrow><mi mathvariant="normal">j_gmin</mi><mo>·</mo><mo>[</mo><mn>1</mn><mo>+</mo><mi mathvariant="normal">exp</mi><mo>(</mo><mfrac><mrow><mi mathvariant="normal">U</mi><mo>(</mo><mfrac><mrow><msub><mi>b</mi><mi mathvariant="normal">eff</mi></msub></mrow><mrow><mi mathvariant="normal">j_HC0</mi></mrow></mfrac><mo>)</mo><mo>·</mo><mi mathvariant="normal">U</mi><mo>(</mo><mfrac><mrow><mi>J</mi></mrow><mrow><msub><mi>J</mi><mi>c</mi></msub></mrow></mfrac><mo>)</mo></mrow><mrow><mi mathvariant="normal">j1_delta</mi></mrow></mfrac><mo>)</mo><mo>]</mo></mrow></mfrac></mrow></math></div>
      </Show>
      <Show when={props.record?.j_type === 2}>
        <div class="hts-graph-formula-scroll"><math display="block" aria-label={"E(J) = (J / j_gmin) · (J / Jc)^(j2_n); показатель степени E по J равен j2_n + 1"}><mrow><mi mathvariant="normal">E</mi><mo>(</mo><mi>J</mi><mo>)</mo><mo>=</mo><mfrac><mrow><mi>J</mi></mrow><mrow><mi mathvariant="normal">j_gmin</mi></mrow></mfrac><mo>·</mo><msup><mrow><mo>(</mo><mfrac><mrow><mi>J</mi></mrow><mrow><msub><mi>J</mi><mi>c</mi></msub></mrow></mfrac><mo>)</mo></mrow><mrow><mi mathvariant="normal">j2_n</mi></mrow></msup></mrow></math></div>
        <p>Показатель степени E по J равен j2_n + 1.</p>
      </Show>
      <Show when={![1, 2].includes(props.record?.j_type)}><p>Выбранная модель E(J) не поддерживается.</p></Show>
      <div class="hts-graph-formula-scroll"><math display="block" aria-label={"При Jc ≤ 0 решатель задаёт E(J) = 0"}><mrow><msub><mi>J</mi><mi>c</mi></msub><mo>≤</mo><mn>0</mn><mo>⇒</mo><mi mathvariant="normal">E</mi><mo>(</mo><mi>J</mi><mo>)</mo><mo>=</mo><mn>0</mn></mrow></math></div>
    </Show>
    <Show when={props.kind === "mh"}>
      <Show when={props.record?.m_type === 1}>
        <div class="hts-graph-formula-scroll"><math display="block" aria-label={"M(H) = H · {2 / [1 + exp(U(H / m_HC0) / m1_delta)] − 1}"}><mrow><mi mathvariant="normal">M</mi><mo>(</mo><mi>H</mi><mo>)</mo><mo>=</mo><mi>H</mi><mo>·</mo><mo>[</mo><mfrac><mrow><mn>2</mn></mrow><mrow><mn>1</mn><mo>+</mo><mi mathvariant="normal">exp</mi><mo>(</mo><mfrac><mrow><mi mathvariant="normal">U</mi><mo>(</mo><mfrac><mrow><mi>H</mi></mrow><mrow><mi mathvariant="normal">m_HC0</mi></mrow></mfrac><mo>)</mo></mrow><mrow><mi mathvariant="normal">m1_delta</mi></mrow></mfrac><mo>)</mo></mrow></mfrac><mo>−</mo><mn>1</mn><mo>]</mo></mrow></math></div>
        <p>Модель без гистерезиса.</p>
      </Show>
      <Show when={props.record?.m_type === 3}>
        <div class="hts-graph-formula-scroll"><math display="block" aria-label={"F(H) = m3_Mmax · K(H / m_HC0; m3_a, m3_b)"}><mrow><mi mathvariant="normal">F</mi><mo>(</mo><mi>H</mi><mo>)</mo><mo>=</mo><mi mathvariant="normal">m3_Mmax</mi><mo>·</mo><mi mathvariant="normal">K</mi><mo>(</mo><mfrac><mrow><mi>H</mi></mrow><mrow><mi mathvariant="normal">m_HC0</mi></mrow></mfrac><mo>;</mo><mi mathvariant="normal">m3_a</mi><mo>,</mo><mi mathvariant="normal">m3_b</mi><mo>)</mo></mrow></math></div>
        <div class="hts-graph-formula-scroll"><math display="block" aria-label={"Предельная петля: M = −F(H) при возрастании H; M = +F(H) при убывании H"}><mrow><mi>M</mi><mo>=</mo><mo>{</mo><mtable columnalign="left left"><mtr><mtd><mo>−</mo><mi mathvariant="normal">F</mi><mo>(</mo><mi>H</mi><mo>)</mo></mtd><mtd><mi>H</mi><mo>↑</mo></mtd></mtr><mtr><mtd><mi mathvariant="normal">F</mi><mo>(</mo><mi>H</mi><mo>)</mo></mtd><mtd><mi>H</mi><mo>↓</mo></mtd></mtr></mtable></mrow></math></div>
        <div class="hts-graph-formula-scroll"><math display="block" aria-label={"Начальная линия: M = −H; 0 ≤ H ≤ H*; H* = F(H*)"}><mrow><mi>M</mi><mo>=</mo><mo>−</mo><mi>H</mi><mo>,</mo><mn>0</mn><mo>≤</mo><mi>H</mi><mo>≤</mo><msup><mi>H</mi><mrow><mo>*</mo></mrow></msup><mo>,</mo><msup><mi>H</mi><mrow><mo>*</mo></mrow></msup><mo>=</mo><mi mathvariant="normal">F</mi><mo>(</mo><msup><mi>H</mi><mrow><mo>*</mo></mrow></msup><mo>)</mo></mrow></math></div>
        <p>Траектория использует предыдущее состояние H_prev, M_prev. При продолжении предельной ветви сохраняется её знак; при развороте начинается движение с наклоном −1 до другой предельной ветви.</p>
        <div class="hts-graph-formula-scroll"><math display="block" aria-label={"ΔH = H − H_prev"}><mrow><mi>ΔH</mi><mo>=</mo><mi>H</mi><mo>−</mo><msub><mi>H</mi><mi mathvariant="normal">prev</mi></msub></mrow></math></div>
        <div class="hts-graph-formula-scroll"><math display="block" aria-label={"Траектория: M = sign(M_prev) · F(H) при продолжении предельной ветви; иначе M = min(F(H), max(−F(H), M_prev − ΔH))"}><mrow><mi>M</mi><mo>=</mo><mo>{</mo><mtable columnalign="left left"><mtr><mtd><mi mathvariant="normal">sgn</mi><mo>(</mo><msub><mi>M</mi><mi mathvariant="normal">prev</mi></msub><mo>)</mo><mo>·</mo><mi mathvariant="normal">F</mi><mo>(</mo><mi>H</mi><mo>)</mo></mtd><mtd><msub><mi>M</mi><mi mathvariant="normal">prev</mi></msub><mo>≠</mo><mn>0</mn><mo>,</mo><mo>|</mo><msub><mi>M</mi><mi mathvariant="normal">prev</mi></msub><mo>|</mo><mo>=</mo><mi mathvariant="normal">F</mi><mo>(</mo><msub><mi>H</mi><mi mathvariant="normal">prev</mi></msub><mo>)</mo><mo>,</mo><msub><mi>M</mi><mi mathvariant="normal">prev</mi></msub><mo>·</mo><mi>ΔH</mi><mo>≤</mo><mn>0</mn></mtd></mtr><mtr><mtd><mi mathvariant="normal">min</mi><mo>(</mo><mi mathvariant="normal">F</mi><mo>(</mo><mi>H</mi><mo>)</mo><mo>,</mo><mi mathvariant="normal">max</mi><mo>(</mo><mo>−</mo><mi mathvariant="normal">F</mi><mo>(</mo><mi>H</mi><mo>)</mo><mo>,</mo><msub><mi>M</mi><mi mathvariant="normal">prev</mi></msub><mo>−</mo><mi>ΔH</mi><mo>)</mo><mo>)</mo></mtd><mtd><mtext>иначе</mtext></mtd></mtr></mtable></mrow></math></div>
        <p>Начальная линия заканчивается в первом неотрицательном пересечении с предельной кривой.</p>
      </Show>
      <Show when={![1, 3].includes(props.record?.m_type)}><p>Модель m_type = 2 зарезервирована; график для неё не строится.</p></Show>
      <p>H и M направлены вдоль оси c материала; единицы — кА/м.</p>
    </Show>
    <Show when={supported()}>
      <div class="hts-graph-formula-scroll"><math display="block" aria-label={"U(x) = max(0, 1 − |x|); u = |x|ᵃ"}><mrow><mi mathvariant="normal">U</mi><mo>(</mo><mi>x</mi><mo>)</mo><mo>=</mo><mi mathvariant="normal">max</mi><mo>(</mo><mn>0</mn><mo>,</mo><mn>1</mn><mo>−</mo><mo>|</mo><mi>x</mi><mo>|</mo><mo>)</mo><mo>,</mo><mi>u</mi><mo>=</mo><msup><mrow><mo>|</mo><mi>x</mi><mo>|</mo></mrow><mrow><mi>a</mi></mrow></msup></mrow></math></div>
      <div class="hts-graph-formula-scroll"><math display="block" aria-label={"K(x; a, b) = 1 при b = 0; U(u)^b при b > 0; (1 + u)^b при b < 0"}><mrow><mi mathvariant="normal">K</mi><mo>(</mo><mi>x</mi><mo>;</mo><mi>a</mi><mo>,</mo><mi>b</mi><mo>)</mo><mo>=</mo><mo>{</mo><mtable columnalign="left left"><mtr><mtd><mn>1</mn></mtd><mtd><mi>b</mi><mo>=</mo><mn>0</mn></mtd></mtr><mtr><mtd><msup><mrow><mi mathvariant="normal">U</mi><mo>(</mo><mi>u</mi><mo>)</mo></mrow><mrow><mi>b</mi></mrow></msup></mtd><mtd><mi>b</mi><mo>&gt;</mo><mn>0</mn></mtd></mtr><mtr><mtd><msup><mrow><mo>(</mo><mn>1</mn><mo>+</mo><mi>u</mi><mo>)</mo></mrow><mrow><mi>b</mi></mrow></msup></mtd><mtd><mi>b</mi><mo>&lt;</mo><mn>0</mn></mtd></mtr></mtable></mrow></math></div>
    </Show>
    <Show when={electrical()}>
      <p>b_eff, H, M — кА/м; J, Jc — А/мм²; j_gmin — МСм/м; E — В/м.</p>
    </Show>
  </div>;
}
