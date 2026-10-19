import { For, Index, Show, createMemo } from "solid-js";
import { omFormGroups, omValueAt } from "../../services/omModelForm.js";
import { OM_CLARK_TYPES, omClarkOptions } from "../../services/omClarkBindings.js";

function ObjectChoice(props) {
  const options = () => props.options ?? [];
  const found = () => options().some(option => option.value === props.value);
  return <select aria-label={props.label} aria-invalid={!found()} title={props.label}
    value={String(props.value ?? "")} onChange={event => props.onChange(event.currentTarget.value === "" ? null : Number(event.currentTarget.value))}>
    <option value="" selected={props.value == null}>Выберите объект…</option>
    <Show when={props.value != null && !found()}><option value={String(props.value)} selected>
      №{String(props.value)} — отсутствует в задании
    </option></Show>
    <For each={options()}>{option => <option value={String(option.value)} selected={option.value === props.value}>{option.label}</option>}</For>
  </select>;
}

function ParameterField(props) {
  const field = () => props.field;
  const value = () => omValueAt(props.data, field().path) ?? field().default;
  const label = () => `${field().label}${props.rowLabel ? ` · ${props.rowLabel}` : ""}`;
  const options = () => field().options ?? (field().type === "boolean" ? [{ value: false, label: "Нет" }, { value: true, label: "Да" }] : null);
  return <label class="om-model-field" title={field().description}>
    <span>{field().label}<Show when={field().unit}> <small>({field().unit})</small></Show></span>
    <Show when={!field().readonly} fallback={<output>{String(value() ?? "—")}</output>}>
      <Show when={field().source === "task-pulse"} fallback={
        <Show when={options()} fallback={
          <input aria-label={label()} type={field().type === "string" ? "text" : "number"}
            step={field().type === "integer" ? "1" : "any"} min={field().minimum} max={field().maximum}
            value={value() ?? ""} onChange={event => {
              const input = event.currentTarget;
              props.onChange(field().path, field().type === "string" ? input.value : input.value === "" ? null : Number(input.value));
              input.value = String(value() ?? "");
            }} />
        }>
          <select aria-label={label()} value={JSON.stringify(value()) ?? ""}
            onChange={event => props.onChange(field().path, JSON.parse(event.currentTarget.value))}>
            <Show when={!options()?.some(option => option.value === value())}><option value="" disabled selected>Выберите значение…</option></Show>
            <For each={options()}>{option => <option value={JSON.stringify(option.value)} selected={option.value === value()}>{option.label}</option>}</For>
          </select>
        </Show>
      }>
        <ObjectChoice value={value()} options={props.catalog["task-pulse"]} label={label()}
          onChange={next => props.onChange(field().path, next)} />
      </Show>
    </Show>
  </label>;
}

export function OMModelForm(props) {
  const groups = createMemo(() => omFormGroups(props.preset.contract, props.data));
  const catalog = createMemo(() => {
    const amplitudes = omClarkOptions("AMP", props.models);
    return { AMP: amplitudes, RSP: amplitudes, "task-pulse": amplitudes,
      PSI: omClarkOptions("PSI", props.models), MOVE: omClarkOptions("MOVE", props.models) };
  });
  const bindings = createMemo(() => ["inputs", "outputs"].flatMap(side =>
    (props.contract?.[side] ?? []).map((group, index) => ({ ...group, side, index,
      presentation: props.preset.contract.ui.ports?.find(port => port.side === side && port.kind === group.kind) }))));
  return <div class="om-model-form">
    <p class="om-model-grid">Шаг времени задания: <strong>{props.models?.general?.timeStep ?? "—"} с</strong>
      <span> · Число шагов: {props.models?.general?.countTimeSteps ?? "—"}</span></p>
    <Index each={groups()}>{group => <section class="om-model-group" aria-label={group().label}>
      <h3>{group().label}</h3>
      <Index each={group().rows}>{row => <div class="om-model-row">
        <Show when={row().label}><p class="om-model-row-label">{row().label}</p></Show>
        <div class="om-model-fields">
          <Index each={row().fields}>{field => <ParameterField field={field()} data={props.data}
            rowLabel={row().label} catalog={catalog()} onChange={props.onFieldChange} />}</Index>
        </div>
      </div>}</Index>
    </section>}</Index>
    <section class="om-model-group" aria-label="Связи с Clark">
      <h3>Связи с Clark</h3>
      <Index each={bindings()}>{group => <div class="om-model-binding-group">
        <h4>{OM_CLARK_TYPES[group().kind]?.label ?? group().kind} <small>· {OM_CLARK_TYPES[group().kind]?.direction}</small></h4>
        <Show when={OM_CLARK_TYPES[group().kind]?.note}><p class="om-model-note">{OM_CLARK_TYPES[group().kind].note}</p></Show>
        <Index each={group().variables}>{(variable, index) => <label class="om-model-binding" title={variable()}>
          <span>{(group().presentation?.label ?? variable()).replaceAll("{i}", String(index + 1))}
            <Show when={group().presentation?.unit}> <small>({group().presentation.unit})</small></Show></span>
          <ObjectChoice options={catalog()[group().kind]}
            value={props.coupling[group().side]?.[group().index]?.indices?.[index]}
            label={`${group().kind} · ${variable()}`}
            onChange={value => props.onBindingChange(group().side, group().index, index, value)} />
        </label>}</Index>
      </div>}</Index>
    </section>
  </div>;
}
