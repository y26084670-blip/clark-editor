import {createMemo,createSignal,For,Show} from "solid-js";
import {FloatingWindow} from "../window/FloatingWindow.jsx";
import {createUniformFieldCoilDefaults,uniformFieldCoilOrientation,uniformFieldCoilParameters} from "../../services/generator/uniformFieldCoil.js";
import "./UniformFieldCoilDialog.css";

export function UniformFieldCoilDialog(props) {
  const [params,setParams]=createSignal(createUniformFieldCoilDefaults());
  const change=(key,value)=>setParams(old=>({...old,[key]:value}));
  const orientation=createMemo(()=>{
    try{return uniformFieldCoilOrientation(params().direction).angles;}
    catch{return [null,null,null];}
  });
  const analysis=createMemo(()=>{
    try{return {values:uniformFieldCoilParameters(params(),props.model)};}
    catch(error){return {error:error.message};}
  });
  const number=v=>Number.isFinite(v)?v.toLocaleString("ru-RU",{maximumSignificantDigits:7}):"—";
  return <FloatingWindow open={props.open} title="Катушка однородного поля" initialWidth={600} initialHeight={640}
    minWidth={600} minHeight={240} fitContentHeight class="uniform-field-coil-window"
    storageKey="web-gui:uniform-field-coil:compact" onClose={props.onClose}>
    <div class="uniform-field-coil">
      <label>Название <input value={params().name} onInput={e=>change("name",e.currentTarget.value)} disabled={props.busy}/></label>
      <div class="coil-input-row">
        <label>H0, кА/м <input type="number" min="0" step="any" value={params().H0} onInput={e=>change("H0",e.currentTarget.valueAsNumber)} disabled={props.busy}/></label>
        <label>R, мм <input type="number" min="0" step="any" value={params().radius} onInput={e=>change("radius",e.currentTarget.valueAsNumber)} disabled={props.busy}/></label>
        <label>L, мм <input type="number" min="0" step="any" value={params().length} onInput={e=>change("length",e.currentTarget.valueAsNumber)} disabled={props.busy}/></label>
        <label>Раскрытие, град <input title="dvi базового сектора; также угол локальной симметрии" type="number" min="0" max="360" step="any" value={params().opening} onInput={e=>change("opening",e.currentTarget.valueAsNumber)} disabled={props.busy}/></label>
      </div>
      <fieldset disabled={props.busy}><legend>Направление поля — ненулевой вектор</legend><div class="coil-input-row">
        <For each={["X","Y","Z"]}>{(name,index)=><label>{name}<input type="number" step="any" value={params().direction[index()]}
          onInput={e=>change("direction",params().direction.map((v,i)=>i===index()?e.currentTarget.valueAsNumber:v))}/></label>}</For>
      </div>
        <div class="coil-angle-title">Углы локальной СК, град (для существующей катушки)</div>
        <div class="coil-input-row coil-orientation-angles">
          <For each={["X","Y","Z"]}>{(name,index)=><label>Угол {name}
            <input readOnly aria-label={`Угол локальной СК ${name}, град`}
              title="Угол поворота локальной СК (symVi); значение можно скопировать"
              value={Number.isFinite(orientation()[index()])?String(Number(orientation()[index()].toFixed(8))):"—"}/>
          </label>}</For>
        </div>
      </fieldset>
      <div class="coil-input-row">
        <label>Номер импульса <input type="number" min="0" step="1" value={params().amplitude} onInput={e=>change("amplitude",e.currentTarget.valueAsNumber)} disabled={props.busy}/></label>
        <label>Номер траектории <input type="number" min="0" step="1" value={params().move} onInput={e=>change("move",e.currentTarget.valueAsNumber)} disabled={props.busy}/></label>
      </div>
      <p>Центр — (0, 0, 0). Номер 0: постоянная амплитуда / без движения.</p>
      <Show when={analysis().values}>{values=><>
        <p>R1 = {number(values().r1)} мм · T = 10 мм · L = {number(values().length)} мм<br/>j0 = {number(values().j0)} А/мм² · локальных образов: {values().segments} · dvi = {number(values().opening)}° · охват {number(values().coveredAngle)}°</p>
        <Show when={values().coveredAngle<360-1e-9}><p class="coil-sector-notice" role="note">Число образов = floor(360 / dvi). Остаток {number(360-values().coveredAngle)}° не заполняется; введённый dvi не изменяется. Ток и аналитическая оценка относятся к полной катушке 360°.</p></Show>
        <table><caption>Аналитическая оценка на оси, при единичном множителе амплитуды</caption>
          <thead><tr><th>Положение</th><th>H, кА/м</th><th>Отклонение от H(0), %</th></tr></thead>
          <tbody><tr><td>0</td><td>{number(values().field0)}</td><td>0</td></tr>
            <tr><td>R = {number(values().radius)} мм</td><td>{number(values().fieldR)}</td><td>{number(values().relativeDeviation)}</td></tr></tbody>
        </table>
        <p>Неоднородность |H(R) − H(0)| / |H(0)| = {number(values().nonuniformity)}%. Оценка непрерывной катушки; проверка поля во всей сфере не выполняется.</p>
        <Show when={values().H0===0}><p>При H0 = 0 относительная погрешность не определена.</p></Show>
      </>}</Show>
      <Show when={analysis().error||props.error}><p class="coil-error" role="alert">{String(analysis().error||props.error).startsWith("ERROR:")?"":"ERROR: "}{analysis().error||props.error}</p></Show>
      <Show when={props.notice}><p role="status">{props.notice}</p></Show>
      <div class="coil-actions"><button disabled={props.busy||!!analysis().error} onClick={()=>props.onApply(params())}>Добавить катушку</button>
        <button onClick={props.onClose}>Закрыть</button></div>
    </div>
  </FloatingWindow>;
}
