import { For, Show, batch, createEffect, createMemo, createSignal, createUniqueId, onCleanup, onMount, untrack } from "solid-js";
import { FloatingWindow } from "../window/FloatingWindow.jsx";
import { omPresetKey, readOMPresets, rememberOMPreset } from "../../services/omClientPresets.js";
import { expandOMContract, formatOMJson, parseOMJson, readOMPresetFile, readOMTask, saveOMTask, usesTaskPulses, validateOMInputs } from "../../services/omClientService.js";
import "./OMClientWindow.css";

const fingerprint = draft => JSON.stringify(draft);
const errorText = error => error?.message || String(error);

export function OMClientWindow(props) {
  const id = createUniqueId();
  const initial = readOMPresets();
  const [open, setOpen] = createSignal(false);
  const [target, setTarget] = createSignal(null);
  const [draft, setDraft] = createSignal(null);
  const [baseline, setBaseline] = createSignal(null);
  const [clean, setClean] = createSignal("");
  const [presets, setPresets] = createSignal(initial.presets);
  const [presetKey, setPresetKey] = createSignal(omPresetKey(initial.presets[0]));
  const [activePreset, setActivePreset] = createSignal(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [notice, setNotice] = createSignal("");
  const [pending, setPending] = createSignal(null);
  let fileInput;
  let disposed = false;
  let loadRevision = 0;
  const dirty = createMemo(() => Boolean(draft() && fingerprint(draft()) !== clean()));
  const currentModelSummary = createMemo(() => {
    const value = draft();
    if (!value?.selection) return busy() ? "чтение…" : error() ? "не удалось прочитать" : "не задана";
    const name = value.selection.model;
    try {
      const data = parseOMJson(value.dataText, value.selection.dataFile);
      if (data?.schema !== "clark-circuit/2") return name;
      const count = value => Number.isInteger(value) && value > 0 ? value : "не задано";
      const neutral = data.floatingNeutral === true ? "без нулевого провода"
        : data.floatingNeutral === false ? "с нулевым проводом" : "нейтраль не задана";
      return `${name} · фаз: ${count(data.phases)} · ветвей на фазу: ${count(data.parallel)} · ${neutral}`;
    } catch { return `${name} · данные JSON требуют исправления`; }
  });
  const locked = () => busy() || props.locked;
  const selectedPreset = () => presets().find(preset => omPresetKey(preset) === presetKey());
  const validation = createMemo(() => {
    const value = draft();
    if (!value?.selection) return "Выберите пресет и нажмите «Применить».";
    try {
      validateOMInputs(value.selection, parseOMJson(value.dataText, value.selection.dataFile),
        parseOMJson(value.couplingText, value.selection.couplingFile), activePreset(), props.amplitudes ?? []);
      if (usesTaskPulses(activePreset()) && props.amplitudesDirty) {
        return "Сначала сохраните изменения вкладки «Амплитуды», затем сохраните данные клиентской модели.";
      }
      return "";
    } catch (failure) { return errorText(failure); }
  });

  const activeContract = createMemo(() => {
    try { return expandOMContract(activePreset().contract, parseOMJson(draft().dataText)); }
    catch { return null; }
  });

  createEffect(() => props.onStateChange?.({ open: open(), dirty: dirty(), busy: busy(), path: target()?.path ?? "" }));

  function requestChange(message, run, confirm = dirty()) {
    if (locked()) return;
    if (confirm) setPending({ message, run });
    else run();
  }

  async function load(request) {
    const revision = ++loadRevision;
    batch(() => {
      setBusy(true); setError(""); setNotice(initial.notice); setPending(null); setOpen(true);
      setTarget(request); setDraft(null); setBaseline(null); setClean(""); setActivePreset(null);
    });
    try {
      const result = await readOMTask(request.handle);
      if (disposed || revision !== loadRevision) return;
      const value = { selection: result.selection, dataText: result.dataText, couplingText: result.couplingText };
      const preset = presets().find(p => p.selection.model === result.selection?.model);
      batch(() => {
        setTarget(request); setDraft(value); setBaseline(result.baseline); setClean(fingerprint(value));
        setActivePreset(preset ?? null);
        if (preset) setPresetKey(omPresetKey(preset));
      });
    } catch (failure) { if (!disposed && revision === loadRevision) setError(`Не удалось открыть «${request.path}»: ${errorText(failure)}`); }
    finally { if (!disposed && revision === loadRevision) setBusy(false); }
  }

  createEffect(() => {
    const request = props.request;
    untrack(() => {
      if (!request) { clearWindow(); return; }
      if (target()?.handle === request.handle) { setOpen(true); return; }
      // Tasks confirms discarding both field and OM drafts before replacing the loaded task.
      void load(request);
    });
  });

  onMount(() => {
    const beforeUnload = event => {
      if (!dirty() && !busy()) return;
      event.preventDefault(); event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    onCleanup(() => window.removeEventListener("beforeunload", beforeUnload));
  });
  onCleanup(() => { disposed = true; props.onStateChange?.({ open: false, dirty: false, busy: false, path: "" }); });

  function applyPreset() {
    const preset = selectedPreset();
    if (!preset || !target()) return;
    requestChange("Заменить данные в окне выбранным пресетом? Файлы изменятся после сохранения.", () => {
      setDraft({ selection: structuredClone(preset.selection), dataText: formatOMJson(preset.data), couplingText: formatOMJson(preset.coupling) });
      setActivePreset(preset); setError(""); setNotice("");
    }, Boolean(draft()?.selection));
  }

  async function importPreset(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || locked()) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const preset = await readOMPresetFile(file);
      if (disposed) return;
      const storageNotice = rememberOMPreset(preset, presets());
      setPresets(previous => [preset, ...previous.filter(p => omPresetKey(p) !== omPresetKey(preset))]);
      setPresetKey(omPresetKey(preset));
      if (draft()?.selection?.model === preset.selection.model) {
        setActivePreset(preset);
        setNotice("Описание текущей модели загружено. Данные задания сохранены в окне без замены. " + storageNotice);
      } else setNotice("Пресет добавлен в список. Нажмите «Применить», чтобы использовать его данные. " + storageNotice);
    } catch (failure) { if (!disposed) setError(errorText(failure)); }
    finally { if (!disposed) setBusy(false); }
  }

  async function save() {
    if (locked() || pending() || validation() || !dirty() || !target()) return;
    const request = target(), snapshot = draft();
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await saveOMTask(request.handle, snapshot, activePreset(), baseline());
      if (disposed) return;
      const value = { selection: result.selection, dataText: result.dataText, couplingText: result.couplingText };
      batch(() => { setDraft(value); setBaseline(result.baseline); setClean(fingerprint(value)); });
      setNotice(`Сохранено: om-client.json, ${value.selection.dataFile}, ${value.selection.couplingFile}.`);
    } catch (failure) { if (!disposed) setError(errorText(failure)); }
    finally { if (!disposed) setBusy(false); }
  }

  function update(key, value) {
    setDraft(previous => ({ ...previous, [key]: value })); setNotice("");
  }

  function clearWindow() {
    loadRevision += 1;
    batch(() => {
      setOpen(false); setDraft(null); setTarget(null); setBaseline(null); setPending(null);
      setError(""); setNotice(""); setBusy(false); setClean(""); setActivePreset(null);
    });
  }

  function close() {
    requestChange("Закрыть окно без сохранения изменений OM-модели?", clearWindow);
  }

  function format() {
    try {
      const value = draft();
      setDraft({ ...value, dataText: formatOMJson(parseOMJson(value.dataText, value.selection.dataFile)),
        couplingText: formatOMJson(parseOMJson(value.couplingText, value.selection.couplingFile)) });
      setError("");
    } catch (failure) { setError(errorText(failure)); }
  }

  return (
    <FloatingWindow open={open()} title={`Клиентская модель Open Modelica для редактируемого задания${dirty() ? " *" : ""}`}
      initialWidth={700} initialHeight={720} fixedWidth={700} minHeight={360} maximizeHeightOnly
      storageKey="web-gui:om-client-window" class="om-client-window" onClose={close}>
      <div class="om-client-body" aria-busy={busy()} onKeyDown={event => {
        if ((event.ctrlKey || event.metaKey) && event.code === "KeyS"
          && !event.altKey && !event.shiftKey && !event.isComposing) {
          event.preventDefault(); event.stopPropagation(); void save();
        }
      }}>
        <p class="om-client-current-model" role="status"
          title="Модель и параметры из данных задания в этом окне. Изменения вступят в силу после сохранения.">
          <strong>Текущая модель задания:</strong> {currentModelSummary()}
          <Show when={dirty()}><span class="om-client-unsaved"> · не сохранено</span></Show>
        </p>
        <Show when={pending()}>{request => (
          <div class="om-client-confirm" role="alert">
            <span>{request().message}</span>
            <button type="button" disabled={locked()} onClick={() => { const run = request().run; setPending(null); run(); }}>Продолжить</button>
            <button type="button" onClick={() => setPending(null)}>Отмена</button>
          </div>
        )}</Show>
        <Show when={error()}><p class="om-client-error" role="alert">{error()}</p></Show>
        <Show when={notice()}><p class="om-client-notice" role="status">{notice()}</p></Show>
        <fieldset disabled={locked() || Boolean(pending())}>
          <div class="om-client-presets">
            <div class="om-client-presets-heading">
              <label for={`${id}-preset`}>Шаблон для применения</label>
              <a class="om-client-guide-link" href={`${import.meta.env.BASE_URL}user-guide/index.html#om-client`}
                target="_blank" rel="noopener noreferrer"
                aria-label="Справка по клиентской модели OpenModelica"
                title="Открыть справку по клиентской модели OpenModelica в новой вкладке">?</a>
            </div>
            <select id={`${id}-preset`} value={presetKey()}
              title="Выбор в списке не меняет модель задания. Нажмите «Применить», чтобы заменить данные в окне выбранным шаблоном."
              onChange={event => setPresetKey(event.currentTarget.value)}>
              <For each={presets()}>{preset => <option value={omPresetKey(preset)}>{preset.label.replace(/\s+[—–-]\s*шаблон\s*$/iu, "")}</option>}</For>
            </select>
            <button type="button" disabled={!target()} onClick={applyPreset}
              title="Загрузить пресет в окно. Проверьте параметры и индексы каналов, затем сохраните.">Применить</button>
            <button type="button" title="Загрузить editor-preset.json из пакета OM-модели" onClick={() => fileInput.click()}>Загрузить пресет…</button>
            <input ref={fileInput} hidden type="file" accept=".json,application/json" onChange={importPreset} />
          </div>
          <Show when={draft()?.selection}>
            <section class="om-client-json-section">
              <div class="om-client-json-heading">
                <label class="om-client-json-label" for={`${id}-data`}>Данные модели — {draft().selection.dataFile}</label>
                <Show when={activePreset()?.contract.dataSchema === "clark-circuit/2"}>
                  <details class="om-client-help"><summary>Параметры выбранной модели</summary>
                    <div class="om-client-help-content">
                      <p>phases — число фаз; parallel — число параллельных ветвей в каждой фазе. Меняются перед запуском без пересборки.</p>
                      <p>floatingNeutral: false — заземлённая нейтраль; true — изолированная. Нужный вариант выбирается автоматически.</p>
                      <For each={Object.entries(activePreset().contract.dimensions)}>{([name, rule]) => <p>{name}: {rule.maximum === undefined
                        ? "предел определяется установленным пакетом; загрузите его editor-preset.json для проверки в редакторе"
                        : `максимум ${rule.maximum}` }.</p>}</For>
                      <p>L_H — внешняя индуктивность, Гн.</p>
                      <p>R_Ohm — внешнее сопротивление, Ом.</p>
                      <p>emf — ЭДС по фазам: pulse — номер импульса во вкладке «Амплитуды», начиная с 1; amplitude — масштаб ЭДС, В.</p>
                      <p>ЭДС(t) = amplitude × импульс(t). Для нормированного импульса amplitude задаёт амплитуду ЭДС. Время — в секундах.</p>
                      <p>Порядок ветвей — фаза, затем параллельная ветвь. branches и индексы AMP/PSI/RSP содержат ровно phases × parallel записей; emf — ровно phases. Резервные записи не добавляются.</p>
                    </div>
                  </details>
                </Show>
              </div>
              <textarea id={`${id}-data`} class="om-client-json om-client-data" spellcheck={false}
                value={draft().dataText} onInput={event => update("dataText", event.currentTarget.value)} />
            </section>
            <section class="om-client-json-section">
              <div class="om-client-json-heading">
                <label class="om-client-json-label" for={`${id}-coupling`}
                  title="inputs: клиент → сервер; outputs: сервер → клиент. Индексы начинаются с 1 и следуют порядку переменных модели.">
                  Обмен клиент — сервер — {draft().selection.couplingFile}
                </label>
                <Show when={activeContract()}>
                  <details class="om-client-help"><summary
                    title="inputs: клиент → сервер; outputs: сервер → клиент. Индексы начинаются с 1 и следуют порядку переменных модели.">
                    Каналы выбранной модели
                  </summary>
                    <div class="om-client-help-content">
                      <For each={["inputs", "outputs"]}>{side => <For each={activeContract()[side]}>{group => (
                        <p>{side} / {group.kind}: {group.variables.join(", ")}</p>
                      )}</For>}</For>
                    </div>
                  </details>
                </Show>
              </div>
              <textarea id={`${id}-coupling`} class="om-client-json om-client-coupling" spellcheck={false}
                value={draft().couplingText} onInput={event => update("couplingText", event.currentTarget.value)} />
            </section>
          </Show>
          <Show when={validation()}><p class="om-client-error" role="status">{validation()}</p></Show>
          <div class="om-client-actions">
            <button type="button" disabled={!draft()?.selection} onClick={format}>Форматировать JSON</button>
            <button type="button" disabled={!target()} onClick={() => requestChange("Перечитать файлы без сохранения изменений в окне?", () => { void load(target()); })}>Перечитать</button>
            <button type="button" disabled={!dirty() || Boolean(validation())} onClick={save}>Сохранить</button>
          </div>
        </fieldset>
      </div>
    </FloatingWindow>
  );
}
