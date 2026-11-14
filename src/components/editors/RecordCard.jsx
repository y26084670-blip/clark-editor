import { Index, Show, createEffect, createMemo, on, onCleanup } from "solid-js";
import { FIELD_TYPES } from "../../services/schemas/common/constants";
import { decodeArrayView, encodeArrayView } from "../../tabulator/converters/arrayViewCodec";
import { validateConstraintValue } from "../../tabulator/validators/types/constraintValidator";

const AXES = ["X", "Y", "Z"];
const PARAMETER_LABELS = {
  Hx: "Высота по X′", Ly: "Основание по Y′", Lz: "Основание по Z′",
  Ly2: "Верх по Y′", Lz2: "Верх по Z′",
  L15: "Первая сторона по Z′", L37: "Вторая сторона по Z′",
  Z037: "Смещение второй стороны по Z′", DY: "Основание по Y′",
  H: "Высота по X′", YV: "Вершина по Y′", ZV: "Вершина по Z′",
};

export function CardInput(props) {
  let input, editing = false, initialText;
  const text = () => {
    const value = props.value;
    if (!props.floatDigits || props.property.type !== FIELD_TYPES.FLOAT || !Number.isFinite(value)) {
      return String(value ?? "");
    }
    const [mantissa, exponent] = value.toPrecision(props.floatDigits).split("e");
    const compact = mantissa.includes(".") ? mantissa.replace(/\.?0+$/, "") : mantissa;
    return exponent === undefined ? compact : compact + "e" + exponent;
  };
  const numeric = () => props.property.type === FIELD_TYPES.FLOAT || props.property.type === FIELD_TYPES.INTEGER;
  const invalid = () => !validateConstraintValue(props.value, props.property);
  createEffect(() => {
    const next = text();
    if (!editing) input.value = next;
  });
  function finish() {
    if (!editing) return;
    editing = false;
    const raw = input.value;
    // Focusing a rounded display value must never round the stored number.
    if (raw === initialText) {
      input.value = text();
      return;
    }
    const normalized = raw.trim().replace(",", ".");
    let value = raw;
    if (numeric()) {
      const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
      value = Number(normalized);
      const invalidInteger = props.property.type === FIELD_TYPES.INTEGER && !Number.isInteger(value);
      if (!decimal.test(normalized) || !Number.isFinite(value) || invalidInteger) {
        input.value = text();
        props.onError("Введите " + (props.property.type === FIELD_TYPES.INTEGER ? "целое" : "конечное") + " число.");
        return;
      }
    }
    if (!Object.is(value, props.value)) props.onChange(value);
    input.value = text();
  }
  function keydown(e) {
    if (e.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      editing = false;
      input.value = text();
      input.blur();
    } else if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
    } else if (numeric() && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
      && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      const end = input.value.length;
      const caret = e.key === "ArrowRight" ? input.selectionStart : input.selectionEnd;
      const next = e.key === "Home" ? 0 : e.key === "End" ? end
        : Math.max(0, Math.min(end, caret + (e.key === "ArrowLeft" ? -1 : 1)));
      input.setSelectionRange(next, next);
    } else return;
    e.stopPropagation();
  }
  onCleanup(() => { editing = false; });
  return <input ref={input} type="text" inputmode={numeric() ? "decimal" : "text"}
    aria-label={props.label} title={props.title || props.label} aria-invalid={invalid()}
    data-field={props.field} readOnly={props.readonly}
    onFocus={() => { initialText = input.value; editing = !props.readonly; props.onError(""); }}
    onDblClick={e => e.currentTarget.select()} onBlur={finish} onKeyDown={keydown} />;
}

function Section(props) {
  return <fieldset class={'record-card-section ' + (props.class || "")}><legend>{props.title}</legend>{props.children}</fieldset>;
}

// Selection chooses the record. Each control reads its current value from BaseModel
// and commits a single property through the same edit path as the parent table.
export function RecordCard(props) {
  let panel;
  const schema = props.schema;
  const element = schema.views.recordCard.kind === "element";
  const record = () => props.record;
  const geo = createMemo(() => decodeArrayView(schema.properties.geo, record()?.geo, record()));
  function change(field, value) {
    props.onChange(field, value);
  }
  function input(field, label, position) {
    const p = schema.properties[field];
    const [r, c] = position ?? [];
    const matrix = () => field === "geo" ? geo().rows : record()?.[field];
    return <CardInput field={field} label={label || p.label} title={p.description}
      property={position ? p.items : p} readonly={p.readonly} floatDigits={element ? 10 : undefined}
      value={position ? matrix()?.[r]?.[c] : record()?.[field]} onError={props.onError}
      onChange={value => {
        if (!position) return change(field, value);
        const source = matrix() ?? [];
        const rows = Array.from({ length: Math.max(source.length, r + 1) }, (_, i) =>
          Array.isArray(source[i]) ? [...source[i]] : []);
        rows[r][c] = value;
        change(field, field === "geo" ? encodeArrayView(p, rows, record(), geo()) : rows);
      }} />;
  }
  function scalar(field, shortLabel) {
    const p = schema.properties[field];
    const label = shortLabel || p.label;
    if (p.type === FIELD_TYPES.BOOLEAN) return <label class="record-card-check" title={p.description}>
      <input type="checkbox" data-field={field} checked={!!record()?.[field]} disabled={p.readonly}
        onChange={e => change(field, e.currentTarget.checked)} />{label}</label>;
    if (p.type === FIELD_TYPES.ENUM) return <label class="record-card-pair" title={p.description}>
      <span>{label}</span><select aria-label={p.label} data-field={field}
        value={String(record()?.[field])}
        onChange={e => change(field, Number(e.currentTarget.value))}>
        <Show when={!p.enum.some(option => option.value === record()?.[field])}>
          <option value={String(record()?.[field])}>{String(record()?.[field] ?? "")}</option>
        </Show>
        {p.enum.map(option => <option value={option.value} disabled={option.disabled}>{option.label}</option>)}
      </select></label>;
    return <label class="record-card-pair"><span>{label}</span>{input(field, p.label)}</label>;
  }
  function matrix(field, names) {
    return <div class="record-card-matrix-line" style={{"--count": names.length}}>
      {names.map((name, i) => <label><span>{name}</span>{input(field, schema.properties[field].label + " " + name, [i, 0])}</label>)}
    </div>;
  }
  function geometry(type) {
    const p = geo();
    if (type === 0 || !Number.isInteger(type) || type < 0 || type > (element ? 4 : 3)) {
      const count = type === 0 ? (element ? 8 : 4) : p.rows.length;
      return <table class="record-card-coordinates"><thead><tr><th>№</th>{AXES.map(a => <th>{a}</th>)}</tr></thead>
        <tbody><Index each={Array.from({length: count}, (_, i) => i)}>{(_, r) => <tr><th>{r+1}</th>{AXES.map((a,c) =>
          <td>{input("geo", "V" + (r+1) + " " + a, [r,c])}</td>)}</tr>}</Index></tbody></table>;
    }
    const param = (i, label = p.itemLabels[i]) => <label class="record-card-pair">
      <span>{label}</span>{input("geo", label, [i, 0])}</label>;
    if (element && type === 1) return <><div class="record-card-parameter-grid">
      {Array.from({length: 8}, (_, i) => param(i, p.itemLabels[i].toUpperCase()))}</div>{param(8, "Раскрытие, °")}</>;
    if (!element && type === 1) return <div class="record-card-parameter-grid stacked">
      {param(0, "Нижний радиус")}{param(1, "Верхний радиус")}{param(3, "Проекция на X")}{param(2, "Раскрытие, °")}</div>;
    if (!element && type === 2) return <table class="record-card-coordinates"><thead><tr><th></th><th>Начало A</th><th>Конец B</th></tr></thead>
      <tbody>{AXES.map((a,i) => <tr><th>{a}</th><td>{input("geo", a+" A", [i,0])}</td><td>{input("geo", a+" B", [i+3,0])}</td></tr>)}</tbody></table>;
    if (!element) return <>{param(0, "Основание L")}{param(1, "Высота H")}</>;
    return p.itemLabels.map((key, i) => param(i, type === 2 ? key : PARAMETER_LABELS[key] || key));
  }
  function coordinates() {
    return <Section title="Локальная система координат" class="record-card-local">
      <table class="record-card-coordinates"><thead><tr><th></th><th>Поворот, °</th><th>Начало</th><th>Смещение</th></tr></thead>
        <tbody>{AXES.map((a,i) => <tr><th>{a}</th>{["symVi","symR0","dr"].map(field =>
          <td>{input(field,schema.properties[field].label + " " + a,[i,0])}</td>)}</tr>)}</tbody></table>
      <div class="record-card-parameter-grid">{scalar("symYl","Угол, °")}{scalar("symLs","Образов")}</div>
    </Section>;
  }

  createEffect(on(() => props.focusRequest, target => {
    if (target && record()) {
      const control = [...(panel?.querySelectorAll("[data-field]") ?? [])].find(el => el.dataset.field === target.field);
      control?.focus();
    }
  }));
  return <aside class="record-card-column" classList={{"record-card-element": element, "record-card-region": !element}} aria-label={element ? "Карточка элемента" : "Карточка области"}>
    <div class="record-card-frame">
      <header class="record-card-info" aria-live="polite" title={record()?.name}>{record()
        ? "№ " + (props.index + 1) + " · " + (record().name || "Без названия")
        : "Выберите строку таблицы"}</header>
      <div ref={panel} class="record-card-panel">
        <Show when={record() ? props.index + 1 : 0} keyed>{(_number) => <>
          <div class="record-card-top">
            <div>
              {element && scalar("name", "Имя")}
              {element && scalar("targ", "Назначение")}
              {scalar("geoType", "Тип")}
              <Section title="Геометрия" class="record-card-geometry">
                <div class="record-card-geometry-fields" classList={{"record-card-sector-fields": element && record()?.geoType === 1}}>
                  <Show when={String(geo().key)} keyed>{(_variant) => geometry(record()?.geoType)}</Show>
                </div>
              </Section>
            </div>
            <div>
              {element && <><Section title="Азимутальная симметрия">{scalar("symKya","Тип")}
                <div class="record-card-parameter-grid">{scalar("symYa","Угол, °")}{scalar("symAs","Образов")}</div></Section>
                <Section title="Периодическая симметрия">{scalar("symKyp","Тип")}
                  <div class="record-card-parameter-grid">{scalar("symTx","Шаг X")}{scalar("symPs","Образов")}</div></Section></>}
              {!element && <><Section title="Разбиение">
                <label class="record-card-pair"><span>D2 (n41)</span>{input("dp","Разбиение D2 (n41)",[1,0])}</label>
                <label class="record-card-pair"><span>D1 (n21)</span>{input("dp","Разбиение D1 (n21)",[0,0])}</label>
              </Section>
                <Section title="Катушка и движение">{scalar("indMove","Траектория")}{scalar("indCoil","Катушка")}{scalar("wCoil","Множитель")}{scalar("forceGroup","Силовая группа")}</Section></>}
              {element && coordinates()}
            </div>
          </div>
          {element ? <div class="record-card-bottom"><Section title="Электрические и магнитные свойства" class="record-card-material">
            <div class="record-card-material-fields">
              {scalar("model","Модель")}
              <label class="record-card-pair"><span>Характеристика</span><button type="button" data-field="xapName"
                title="Выбрать характеристику материала" onClick={props.onChooseMaterial}>{record()?.xapName || "Выбрать…"}</button></label>
              <div><div class="record-card-caption">Углы анизотропии</div>{matrix("vkan", AXES)}</div>
              {scalar("rv","GAM, МСм/м")}
            </div>
          </Section><div><Section title="Разбиение">{matrix("dp",["D1","D2","D3"])}</Section>
            <Section title="Прочие параметры">{scalar("auto")}{scalar("take")}
              <div class="record-card-parameter-grid">{scalar("indMove","Траектория")}{scalar("indCoil","Катушка")}
                {scalar("indAmp",record()?.targ === 3 ? "Направление" : "Импульс")}{scalar("wCoil","Витки")}</div>
            </Section></div>
          </div> : coordinates()}
        </>}</Show>
        <Show when={props.error}><div class="record-card-error" role="alert">{props.error}</div></Show>
      </div>
    </div>
    <Show when={props.showDemo} fallback={<div class="record-card-reserve" aria-hidden="true" />}>
      {props.children}
    </Show>
  </aside>;
}
