import {
  For, Show, batch, createEffect, createMemo, createSignal, createUniqueId,
  onCleanup, onMount, untrack,
} from "solid-js";
import { FloatingWindow } from "../window/FloatingWindow.jsx";
import { selectionService } from "../../services/selectionService.js";
import { unsavedChangesService } from "../../services/unsavedChangesService.js";
import { TaskStatusCells } from "./TaskStatusCells.jsx";
import { IterationControl } from "./IterationControl.jsx";
import { useTaskStatuses } from "../../services/taskStatusMonitor.js";
import {
  TASK_LIST_FILE, createNativeLaunchUri, invalidateLaunchRequest,
  prepareLaunchRequest, readLaunchResult,
  readTaskList, refreshTaskList, setTaskListEntriesEnabled,
  parseMpiRanks, formatMpiRanks, readRuntimeSettings,
} from "../../services/taskLaunchService.js";
import "./TaskLaunchWindow.css";

const ACCEPT_TIMEOUT_MS = 45000;
const keyOf = path => path.toLowerCase();
const errorText = error => error?.message || String(error);

export function TaskLaunchWindow(props) {
  const listId = createUniqueId();
  const [entries, setEntries] = createSignal([]);
  const taskStatus = useTaskStatuses(
    () => entries().map(entry => ({ key: entry.path, root: props.rootHandle, path: entry.path })),
    { refreshOnChange: false },
  );
  const [listExists, setListExists] = createSignal(false);
  const [listValid, setListValid] = createSignal(false);
  const [selected, setSelected] = createSignal(new Set());
  const [activeIndex, setActiveIndex] = createSignal(0);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [notice, setNotice] = createSignal("");
  const [importMessages, setImportMessages] = createSignal([]);
  const [mpiValue, setMpiValue] = createSignal("default");
  const [mpiEdited, setMpiEdited] = createSignal(false);
  const [settingsPending, setSettingsPending] = createSignal(null);
  const mpiError = createMemo(() => {
    try { parseMpiRanks(mpiValue()); return ""; }
    catch (failure) { return errorText(failure); }
  });
  const binding = () => props.binding ?? null;
  const [proof, setProof] = createSignal(null);
  const [pending, setPending] = createSignal(null);
  const [confirmImport, setConfirmImport] = createSignal(false);
  const [loadedPath, setLoadedPath] = createSignal(null);
  const [resolvingLoaded, setResolvingLoaded] = createSignal(false);
  const [loadedPathError, setLoadedPathError] = createSignal(false);
  let listElement;
  let anchorIndex = 0;
  let rootRevision = 0;
  let loadedRevision = 0;
  let disposed = false;
  let polling = false;
  let settingsPolling = false;

  const current = (root, revision) => !disposed
    && root === props.rootHandle && revision === rootRevision;
  const enabledEntries = createMemo(() => entries().filter(entry => entry.enabled));
  const loadedIncluded = createMemo(() => {
    const path = loadedPath();
    return Boolean(path && enabledEntries().some(entry => keyOf(entry.path) === keyOf(path)));
  });
  const includedDirty = createMemo(() => unsavedChangesService.hasDirty() && loadedIncluded());
  const awaitingAcceptance = () => pending()?.state === "waiting";
  const locked = () => busy() || awaitingAcceptance() || props.bindingBusy;
  const canLaunch = () => !locked() && !resolvingLoaded() && !loadedPathError() && !includedDirty()
    && !props.blockedMessage
    && listExists() && listValid() && enabledEntries().length > 0
    && binding()?.bindingState === "bound" && Boolean(proof());

  createEffect(() => props.onBusyChange?.(busy() || awaitingAcceptance()));

  async function armLaunch(root, revision, marker = binding()) {
    setProof(null);
    if (!marker || marker.bindingState !== "bound" || !listExists() || !listValid()) return;
    const prepared = await prepareLaunchRequest(root, marker);
    if (current(root, revision) && !awaitingAcceptance() && !props.bindingBusy
      && marker.workspaceId === binding()?.workspaceId
      && binding()?.bindingState === "bound") setProof(prepared);
  }

  async function loadRoot(root, revision) {
    if (!root) return;
    setBusy(true);
    try {
      const result = await readTaskList(root);
      if (!current(root, revision)) return;
      setEntries(result.entries);
      setListExists(result.exists);
      setListValid(true);
      await taskStatus.refresh();
      if (!current(root, revision)) return;
      await armLaunch(root, revision);
    } catch (failure) {
      if (current(root, revision)) setError(errorText(failure));
    } finally {
      if (current(root, revision)) setBusy(false);
    }
  }

  createEffect(() => {
    const root = props.rootHandle;
    const revision = ++rootRevision;
    untrack(() => {
      batch(() => {
        setEntries([]);
        setListExists(false);
        setListValid(false);
        setSelected(new Set());
        setActiveIndex(0);
        setBusy(false);
        setError("");
        setNotice("");
        setImportMessages([]);
        setProof(null);
        setPending(null);
        setConfirmImport(false);
        setMpiValue("default");
        setMpiEdited(false);
        setSettingsPending(null);
      });
      anchorIndex = 0;
      void loadRoot(root, revision);
    });
  });

  createEffect(() => {
    const marker = binding();
    untrack(() => {
      setProof(null);
      if (!mpiEdited()) setMpiValue(formatMpiRanks(marker?.mpiRanks));
      if (marker?.bindingState === "bound") void refreshOnFocus();
    });
  });

  createEffect(() => {
    const request = props.settingsRequest;
    untrack(() => {
      setSettingsPending(request ? { ...request, startedAt: Date.now() } : null);
      if (request && !mpiEdited()) setMpiValue("default");
      void pollSettings();
    });
  });

  async function pollSettings() {
    const request = settingsPending();
    const root = props.rootHandle;
    const revision = rootRevision;
    if (!request || !root || disposed || settingsPolling) return;
    settingsPolling = true;
    try {
      const result = await readRuntimeSettings(root, request);
      if (!current(root, revision) || settingsPending()?.requestId !== request.requestId) return;
      if (result) {
        if (!mpiEdited()) setMpiValue(formatMpiRanks(result.mpiRanks));
        setSettingsPending(null);
      } else if (Date.now() - request.startedAt >= ACCEPT_TIMEOUT_MS) setSettingsPending(null);
    } catch {
      // An unavailable/being-replaced settings file leaves the explicit default.
      if (current(root, revision) && settingsPending()?.requestId === request.requestId
        && Date.now() - request.startedAt >= ACCEPT_TIMEOUT_MS) setSettingsPending(null);
    } finally { settingsPolling = false; }
  }

  createEffect(() => {
    const root = props.rootHandle;
    const loaded = selectionService.loadedTaskHandle();
    const demo = selectionService.loadedTaskIsDemo();
    const revision = ++loadedRevision;
    setLoadedPath(null);
    setLoadedPathError(false);
    setResolvingLoaded(Boolean(root && loaded && !demo));
    if (!root || !loaded || demo) return;
    void root.resolve(loaded).then(parts => {
      if (!disposed && revision === loadedRevision) {
        setLoadedPath(parts?.join("/") ?? null);
      }
    }).catch(failure => {
      if (!disposed && revision === loadedRevision) {
        setLoadedPathError(true);
        setError("Не удалось определить каталог загруженного задания: " + errorText(failure));
      }
    }).finally(() => {
      if (!disposed && revision === loadedRevision) setResolvingLoaded(false);
    });
  });

  async function changeList(operation, refreshStatus = false) {
    if (locked() || !props.rootHandle) return;
    const root = props.rootHandle;
    const revision = rootRevision;
    setBusy(true);
    setProof(null);
    setError("");
    setNotice("");
    setConfirmImport(false);
    try {
      const result = await operation(root);
      if (!current(root, revision)) return;
      const retained = new Set(result.entries.map(entry => entry.path));
      setEntries(result.entries);
      setListExists(result.exists);
      setListValid(true);
      setSelected(previous => new Set([...previous].filter(path => retained.has(path))));
      setActiveIndex(0);
      anchorIndex = 0;
      if (refreshStatus) {
        await taskStatus.refresh();
        if (!current(root, revision)) return;
      }
      await armLaunch(root, revision);
    } catch (failure) {
      if (current(root, revision)) setError(errorText(failure));
    } finally {
      if (current(root, revision)) setBusy(false);
    }
  }

  const updateList = () => changeList(root => refreshTaskList(root), true);
  const toggleSelected = enabled => {
    const snapshot = entries();
    const selection = new Set(selected());
    if (!selection.size || !listValid()) return;
    return changeList(root => setTaskListEntriesEnabled(root, snapshot, selection, enabled));
  };

  const toggleEntry = entry => {
    if (!listValid()) return;
    const snapshot = entries();
    return changeList(root => setTaskListEntriesEnabled(
      root, snapshot, new Set([entry.path]), !entry.enabled,
    ));
  };

  async function saveLoadedModel() {
    if (locked() || !includedDirty()) return;
    const root = props.rootHandle;
    const revision = rootRevision;
    setBusy(true);
    setError("");
    try {
      await props.onSave?.();
      if (current(root, revision) && includedDirty()) {
        setNotice("Сохраните изменения загруженного задания перед запуском.");
      } else if (current(root, revision)) setNotice("Модель сохранена. Можно запускать список.");
    } catch (failure) {
      if (current(root, revision)) setError(errorText(failure));
    } finally {
      if (current(root, revision)) setBusy(false);
    }
  }

  function launch(action) {
    if (!canLaunch() || (["circuit", "modelica"].includes(action) && enabledEntries().length !== 1)) return;
    const prepared = proof();
    const snapshot = entries().map(entry => ({ ...entry }));
    try {
      const ranks = action === "import" || !mpiEdited() ? null : parseMpiRanks(mpiValue());
      if (ranks !== null && binding()?.launchOptionsVersion !== 1) {
        throw new Error("Для выбора числа процессов обновите установленный Clark и повторите привязку.");
      }
      const uri = createNativeLaunchUri(prepared.workspaceId, action, prepared.requestId, ranks);
      if (action === "import") props.onBeforeImport?.(snapshot, loadedIncluded());
      setPending({
        ...prepared, action, entries: snapshot, startedAt: Date.now(), state: "waiting",
      });
      setProof(null);
      setConfirmImport(false);
      setError("");
      setImportMessages([]);
      setNotice("Ожидание ответа Clark… Подтвердите открытие Clark, если браузер запросит разрешение.");
      // Files are already closed and the URI is opened directly from this click.
      window.location.href = uri;
    } catch (failure) {
      setPending(null);
      setError(errorText(failure));
      setProof(prepared);
    }
  }

  async function acceptRun(root, revision, run, result) {
    // Native acceptance means the proof was consumed and the task list captured.
    // Keep observing this run, but prepare a new request and release the UI.
    if (run.state === "accepted") return;
    setBusy(true);
    setPending({ ...run, state: "accepted" });
    setError("");
    setNotice(result.message || "Clark выполняет задания…");
    try {
      await armLaunch(root, revision);
    } finally {
      if (current(root, revision)) setBusy(false);
    }
  }

  async function finishRun(root, revision, run, result) {
    setBusy(true);
    setPending(null);
    if (result.state === "error") {
      setNotice("");
      setError(result.message);
    } else {
      setError("");
      setNotice(result.message || "Выполнение завершено.");
    }
    try {
      if (result.state === "completed" || (run.action === "import"
        && (run.state === "accepted" || Number.isInteger(result.exitCode)))) {
        if (run.action === "import" && result.state === "completed") {
          setNotice("Импорт данных завершён. Перенос используемых характеристик из XAP.lib…");
        }
        const report = await props.onLaunchComplete?.(run.entries, run.action, {
          root, result, isCurrent: () => current(root, revision),
        });
        if (!current(root, revision)) return;
        if (run.action === "import") {
          setImportMessages(report?.messages ?? []);
          if (result.state === "completed") {
            setNotice(`Импорт завершён. Обработано характеристик ФММ: ${report?.imported ?? 0}.`);
          }
        }
      }
      if (!current(root, revision)) return;
      await armLaunch(root, revision);
    } catch (failure) {
      if (current(root, revision)) setError(errorText(failure));
    } finally {
      if (current(root, revision)) setBusy(false);
    }
  }

  async function pollNative() {
    if (polling || disposed || busy() || props.bindingBusy || !props.rootHandle) return;
    const root = props.rootHandle;
    const revision = rootRevision;
    const run = pending();
    if (!run) return;
    polling = true;
    try {
      if (run) {
        let result = null;
        try { result = await readLaunchResult(root, run.requestId); }
        catch { /* A concurrent native replacement is retried on the next poll. */ }
        if (!current(root, revision) || pending()?.requestId !== run.requestId) return;
        // A list write may have started while the result file was being read.
        if (busy() || props.bindingBusy) return;
        if (result?.workspaceId === run.workspaceId && result.action === run.action) {
          if (result.state === "accepted") {
            await acceptRun(root, revision, run, result);
          } else {
            await finishRun(root, revision, run, result);
          }
        } else if (run.state === "waiting" && Date.now() - run.startedAt >= ACCEPT_TIMEOUT_MS) {
          setBusy(true);
          try {
            // A locked proof may already belong to a native launch. Keep waiting
            // unless invalidation succeeds and its latest result is still absent.
            await invalidateLaunchRequest(root);
            if (!current(root, revision) || pending()?.requestId !== run.requestId) return;
            const latest = await readLaunchResult(root, run.requestId);
            if (!current(root, revision) || pending()?.requestId !== run.requestId) return;
            if (latest?.workspaceId === run.workspaceId && latest.action === run.action) {
              if (latest.state === "accepted") {
                await acceptRun(root, revision, run, latest);
              } else await finishRun(root, revision, run, latest);
              return;
            }
            setPending(null);
            setProof(null);
            setNotice("");
            setError("Ответ Clark не получен. Проверьте установку Clark и повторите запуск. После переноса каталога свяжите его повторно.");
            await armLaunch(root, revision);
          } catch (failure) {
            if (current(root, revision)) setError(errorText(failure));
          } finally {
            if (current(root, revision)) setBusy(false);
          }
        }
      }
    } catch (failure) {
      if (current(root, revision)) setError(errorText(failure));
    } finally {
      polling = false;
    }
  }

  async function refreshOnFocus() {
    if (pending()) await pollNative();
    if (awaitingAcceptance()) return;
    if (busy() || props.bindingBusy || disposed || !props.rootHandle) return;
    const root = props.rootHandle;
    const revision = rootRevision;
    try {
      const marker = binding();
      if (marker?.bindingState === "bound" && !proof()) {
        setBusy(true);
        try { await armLaunch(root, revision, marker); }
        finally { if (current(root, revision)) setBusy(false); }
      }
    } catch (failure) {
      if (current(root, revision)) setError(errorText(failure));
    }
  }

  onMount(() => {
    const timer = window.setInterval(() => { void pollNative(); void pollSettings(); }, 1000);
    const onFocus = () => { void refreshOnFocus(); void pollSettings(); };
    window.addEventListener("focus", onFocus);
    onCleanup(() => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    });
  });
  onCleanup(() => {
    disposed = true;
    rootRevision += 1;
    loadedRevision += 1;
    props.onBusyChange?.(false);
  });

  function selectAll() {
    setSelected(new Set(entries().map(entry => entry.path)));
    listElement?.focus({ preventScroll: true });
  }

  function selectRow(index, { shiftKey = false, ctrlKey = false, metaKey = false } = {}) {
    const rows = entries();
    if (!rows[index]) return;
    const multiple = ctrlKey || metaKey;
    if (shiftKey) {
      const next = multiple ? new Set(selected()) : new Set();
      const first = Math.min(anchorIndex, index);
      const last = Math.max(anchorIndex, index);
      for (let position = first; position <= last; position += 1) {
        if (rows[position]) next.add(rows[position].path);
      }
      setSelected(next);
    } else if (multiple) {
      const next = new Set(selected());
      if (next.has(rows[index].path)) next.delete(rows[index].path);
      else next.add(rows[index].path);
      setSelected(next);
      anchorIndex = index;
    } else {
      setSelected(new Set([rows[index].path]));
      anchorIndex = index;
    }
    setActiveIndex(index);
    listElement?.focus({ preventScroll: true });
  }

  function handleListKeyDown(event) {
    const rows = entries();
    if (!rows.length || event.altKey || event.isComposing) return;
    if ((event.ctrlKey || event.metaKey) && event.code === "KeyA") {
      event.preventDefault();
      event.stopPropagation();
      selectAll();
      return;
    }
    const previous = activeIndex();
    const moves = { ArrowDown: previous + 1, ArrowUp: previous - 1, Home: 0, End: rows.length - 1 };
    if (Object.hasOwn(moves, event.key)) {
      event.preventDefault();
      event.stopPropagation();
      const next = Math.max(0, Math.min(rows.length - 1, moves[event.key]));
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey) setActiveIndex(next);
      else selectRow(next, event);
      document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    } else if (event.code === "Space") {
      event.preventDefault();
      event.stopPropagation();
      selectRow(previous, { ctrlKey: true });
    }
  }

  return (
    <FloatingWindow
      open={props.open}
      title={`Список заданий — ${props.rootHandle?.name ?? ""}`}
      initialWidth={880} initialHeight={600} minWidth={560} minHeight={360}
      storageKey="web-gui:task-launch-window"
      class="task-launch-window"
      onClose={props.onClose}
    >
      <div class="task-launch-body">
        <div class="task-launch-metadata">
          <span>путь к файлу со списком заданий:</span>
          <span title={props.rootHandle?.name}>{props.rootHandle?.name}/{TASK_LIST_FILE}</span>
        </div>
        <div class="task-launch-toolbar">
          <button type="button" disabled={locked() || !props.rootHandle}
            title="Обновить список заданий и признаки их состояния. Новые задания добавляются отключёнными; подключение существующих сохраняется."
            onClick={updateList}>Обновить список</button>
          <button type="button" disabled={locked() || !listValid() || !selected().size}
            title="Включить выделенные задания в список для расчёта или импорта. Или дважды щелкнуть по строке в списке."
            onClick={() => toggleSelected(true)}>Подключить</button>
          <button type="button" disabled={locked() || !listValid() || !selected().size}
            title="Исключить выделенные задания из запуска, сохранив их в списке. Или дважды щелкнуть по строке в списке."
            onClick={() => toggleSelected(false)}>Отключить</button>
          <button type="button" disabled={!entries().length}
            title="Выделить все строки списка (Ctrl+A). Подключение заданий выполняется отдельной кнопкой."
            onClick={selectAll}>Выделить все</button>
        </div>
        <Show when={error()}><div class="task-launch-error" role="alert">{error()}</div></Show>
        <Show when={notice()}><div class="task-launch-notice" role="status">{notice()}</div></Show>
        <Show when={props.blockedMessage}><div class="task-launch-notice" role="status">{props.blockedMessage}</div></Show>
        <Show when={importMessages().length}>
          <details open>
            <summary>Импорт характеристик: сообщения ({importMessages().length})</summary>
            <For each={importMessages()}>{message => (
              <div class={message.level === "error" ? "task-launch-error" : "task-launch-notice"}
                role={message.level === "error" ? "alert" : "status"}>
                {message.path}: {message.text}
              </div>
            )}</For>
          </details>
        </Show>
        <Show when={includedDirty()}>
          <div class="task-launch-save-prompt">
            <span>Включённое задание содержит несохранённые изменения.</span>
            <button type="button" disabled={locked() || !props.onSave}
              title="Сохранить изменения загруженной модели перед запуском подключённых заданий."
              onClick={saveLoadedModel}>Сохранить модель</button>
          </div>
        </Show>
        <div
          ref={listElement} id={listId} class="task-launch-list" role="listbox"
          aria-label="Список заданий" aria-multiselectable="true" tabIndex="0"
          aria-activedescendant={entries().length ? `${listId}-${activeIndex()}` : undefined}
          onKeyDown={handleListKeyDown}
        >
          <For each={entries()} fallback={
            <div class="task-launch-empty">{busy() ? "Загрузка…" : listExists() && listValid()
              ? "В списке нет заданий. Нажмите «Обновить список»."
              : "Нажмите «Обновить список», чтобы собрать задания базового каталога."}</div>
          }>{(entry, index) => (
            <div
              id={`${listId}-${index()}`} role="option" aria-selected={selected().has(entry.path)}
              class="task-launch-row task-status-row"
              classList={{ "is-disabled": !entry.enabled, "is-selected": selected().has(entry.path), "is-active": activeIndex() === index() }}
              onClick={event => selectRow(index(), event)}
              onDblClick={() => toggleEntry(entry)}
              title={entry.enabled
                ? "Двойной щелчок — отключить это задание от запуска"
                : "Двойной щелчок — подключить это задание к запуску"}
            >
              <TaskStatusCells status={taskStatus(entry.path)} />
              <span class="task-status-name">{entry.enabled ? "" : "*"}{entry.path}</span>
            </div>
          )}</For>
        </div>
        <div class="task-launch-counts">
          <span>Всего: {entries().length}</span><span>Подключено: {enabledEntries().length}</span>
          <span>Выделено: {selected().size}</span><span class="task-launch-selection-hint">Выделение: Ctrl / Shift</span>
        </div>
        <Show when={confirmImport()}>
          <div class="task-launch-import-confirm">
            <span>Импорт заменит исходные данные и используемые характеристики ФММ из локальных XAP.lib. Не закрывайте страницу и не меняйте базовый каталог до завершения. Продолжить?</span>
            <button type="button" disabled={!canLaunch()}
              title="Подтвердить импорт для всех подключённых заданий с заменой их исходных данных."
              onClick={() => launch("import")}>Выполнить импорт</button>
            <button type="button" title="Отменить подтверждение импорта. Исходные данные останутся без изменений."
              onClick={() => setConfirmImport(false)}>Отмена</button>
          </div>
        </Show>
        <div class="task-launch-runtime">
        <label class="task-launch-mpi">
          <span>Процессов MPI:</span>
          <input type="text" inputMode="numeric" value={mpiValue()} disabled={locked()}
            aria-invalid={Boolean(mpiError())}
            title="Число процессов для расчёта и полевого решателя цепи. default — значение из настроек Clark. Импорт не использует MPI."
            onInput={event => { setMpiEdited(true); setMpiValue(event.currentTarget.value); }}
            onBlur={() => { if (!mpiValue().trim()) setMpiValue("default"); }} />
          <Show when={mpiError()}><span class="task-launch-error" role="alert">{mpiError()}</span></Show>
        </label>
        <IterationControl rootHandle={props.rootHandle} binding={binding()} active={props.open} />
        </div>
        <div class="task-launch-actions">
          <button type="button" disabled={!canLaunch() || Boolean(mpiError())}
            title="Запустить расчёт всех подключённых заданий независимо от выделения строк."
            onClick={() => launch("solver")}>Запустить расчёт</button>
          <button type="button" disabled={!canLaunch() || Boolean(mpiError()) || enabledEntries().length !== 1}
            title="Запустить установленную OM-модель для одного задания REAL64. Модель выбирается в input3XX/om-client.json."
            onClick={() => launch("modelica")}>Запустить OM-клиент</button>
          <button type="button" disabled={!canLaunch()}
            title="Открыть подтверждение импорта для всех подключённых заданий. Импорт заменит их исходные данные."
            onClick={() => setConfirmImport(true)}>Запустить импорт данных</button>
        </div>
      </div>
    </FloatingWindow>
  );
}
