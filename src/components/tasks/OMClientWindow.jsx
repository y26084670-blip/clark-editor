import { For, Show, batch, createEffect, createMemo, createSignal, createUniqueId, onCleanup, onMount, untrack } from "solid-js";
import { FloatingWindow } from "../window/FloatingWindow.jsx";
import { omPresetKey, readOMPresets, rememberOMPreset } from "../../services/omClientPresets.js";
import { formatOMJson, parseOMJson, readOMPresetFile, readOMTask, saveOMTask, validateOMInputs } from "../../services/omClientService.js";
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
  const dirty = createMemo(() => Boolean(draft() && fingerprint(draft()) !== clean()));
  const locked = () => busy() || props.locked;
  const selectedPreset = () => presets().find(preset => omPresetKey(preset) === presetKey());
  const validation = createMemo(() => {
    const value = draft();
    if (!value?.selection) return "Выберите пресет и нажмите «Применить».";
    try {
      validateOMInputs(value.selection, parseOMJson(value.dataText, value.selection.dataFile),
        parseOMJson(value.couplingText, value.selection.couplingFile), activePreset());
      return "";
    } catch (failure) { return errorText(failure); }
  });

  createEffect(() => props.onStateChange?.({ open: open(), dirty: dirty(), busy: busy(), path: target()?.path ?? "" }));

  function requestChange(message, run, confirm = dirty()) {
    if (locked()) return;
    if (confirm) setPending({ message, run });
    else run();
  }

  async function load(request) {
    setBusy(true); setError(""); setNotice(initial.notice); setPending(null); setOpen(true);
    try {
      const result = await readOMTask(request.handle);
      if (disposed) return;
      const value = { selection: result.selection, dataText: result.dataText, couplingText: result.couplingText };
      const preset = presets().find(p => p.selection.model === result.selection?.model
        && p.selection.version === result.selection?.version)
        ?? presets().find(p => p.selection.model === result.selection?.model);
      batch(() => {
        setTarget(request); setDraft(value); setBaseline(result.baseline); setClean(fingerprint(value));
        setActivePreset(preset ?? null);
        if (preset) setPresetKey(omPresetKey(preset));
      });
    } catch (failure) { if (!disposed) setError(`Не удалось открыть «${request.path}»: ${errorText(failure)}`); }
    finally { if (!disposed) setBusy(false); }
  }

  createEffect(() => {
    const request = props.request;
    untrack(() => {
      if (!request) return;
      if (target()?.handle === request.handle) { setOpen(true); return; }
      requestChange("Открыть другое задание без сохранения изменений OM-модели?", () => { void load(request); });
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
      setActivePreset(preset); setError(""); setNotice("Пресет загружен в окно. Проверьте параметры и индексы каналов, затем сохраните.");
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
      if (draft()?.selection?.model === preset.selection.model && draft()?.selection?.version === preset.selection.version) {
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

  function close() {
    requestChange("Закрыть окно без сохранения изменений OM-модели?", () => {
      batch(() => { setOpen(false); setDraft(null); setTarget(null); setBaseline(null); setPending(null); setError(""); setNotice(""); });
    });
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
    <FloatingWindow open={open()} title={`Клиентская модель OM${dirty() ? " *" : ""}`}
      initialWidth={700} initialHeight={720} minWidth={420} minHeight={360}
      storageKey="web-gui:om-client-window" class="om-client-window" onClose={close}>
      <div class="om-client-body" aria-busy={busy()} onKeyDown={event => {
        if ((event.ctrlKey || event.metaKey) && event.code === "KeyS"
          && !event.altKey && !event.shiftKey && !event.isComposing) {
          event.preventDefault(); event.stopPropagation(); void save();
        }
      }}>
        <p class="om-client-task">Задание: <strong>{target()?.path ?? "Загрузка…"}</strong></p>
        <p class="om-client-hint">Окно закреплено за этим заданием. Можно переходить на вкладки исходных данных.</p>
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
            <label for={`${id}-preset`}>Пресет модели</label>
            <select id={`${id}-preset`} value={presetKey()} onChange={event => setPresetKey(event.currentTarget.value)}>
              <For each={presets()}>{preset => <option value={omPresetKey(preset)}>{preset.label}</option>}</For>
            </select>
            <button type="button" disabled={!target()} onClick={applyPreset}>Применить</button>
            <button type="button" title="Загрузить editor-preset.json из пакета OM-модели" onClick={() => fileInput.click()}>Загрузить пресет…</button>
            <input ref={fileInput} hidden type="file" accept=".json,application/json" onChange={importPreset} />
          </div>
          <Show when={draft()?.selection}>
            <div class="om-client-identity">
              <span>Модель: <strong>{draft().selection.model}</strong></span>
              <label>Версия пакета <input type="text" value={draft().selection.version}
                onInput={event => update("selection", { ...draft().selection, version: event.currentTarget.value })} /></label>
            </div>
            <p class="om-client-hint">Пакет выбранной модели и версии должен быть установлен в Clark.</p>
            <label class="om-client-json-label" for={`${id}-data`}>Данные модели — {draft().selection.dataFile}</label>
            <Show when={activePreset()?.contract.dataSchema === "clark-circuit/1"}>
              <p class="om-client-hint">L_H — внешняя индуктивность, Гн; R_Ohm — внешнее сопротивление, Ом. ЭДС: пары [время, с; напряжение, В]. Порядок ветвей: фаза, затем параллельная ветвь.</p>
            </Show>
            <textarea id={`${id}-data`} class="om-client-json om-client-data" spellcheck={false}
              value={draft().dataText} onInput={event => update("dataText", event.currentTarget.value)} />
            <label class="om-client-json-label" for={`${id}-coupling`}>Обмен клиент — сервер — {draft().selection.couplingFile}</label>
            <p class="om-client-hint">inputs: клиент → сервер; outputs: сервер → клиент. Индексы начинаются с 1 и следуют порядку переменных модели.</p>
            <Show when={activePreset()}>
              <details class="om-client-channels"><summary>Каналы выбранной модели</summary>
                <For each={["inputs", "outputs"]}>{side => <For each={activePreset().contract[side]}>{group => (
                  <div>{side} / {group.kind}: {group.variables.join(", ")}</div>
                )}</For>}</For>
              </details>
            </Show>
            <textarea id={`${id}-coupling`} class="om-client-json om-client-coupling" spellcheck={false}
              value={draft().couplingText} onInput={event => update("couplingText", event.currentTarget.value)} />
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
