import {
  For, Show, batch, createEffect, createMemo, createSignal, createUniqueId,
  onCleanup, onMount, untrack,
} from "solid-js";
import { FloatingWindow } from "../window/FloatingWindow.jsx";
import { selectionService } from "../../services/selectionService.js";
import { unsavedChangesService } from "../../services/unsavedChangesService.js";
import { IterationControl } from "./IterationControl.jsx";
import { useTaskStatuses } from "../../services/taskStatusMonitor.js";
import { readTaskSolutionEntry } from "../../services/taskStatusService.js";
import {
  createNativeLaunchUri, invalidateLaunchRequest,
  prepareLaunchRequest, readLaunchResult,
  readTaskList, writeTaskList,
  parseMpiRanks, formatMpiRanks, readRuntimeSettings,
} from "../../services/taskLaunchService.js";
import { TASK_DRAG_TYPE, createTaskQueueEntry, describeTaskQueue } from "../../services/taskQueueService.js";
import "./TaskLaunchWindow.css";

const ACCEPT_TIMEOUT_MS = 45000;
const keyOf = path => path.toLowerCase();
const errorText = error => error?.message || String(error);

export function TaskLaunchWindow(props) {
  const listId = createUniqueId();
  const [entries, setEntries] = createSignal([]);
  const taskStatus = useTaskStatuses(
    () => entries().map(entry => ({ key: entry.path, root: entry.rootHandle, path: entry.taskPath })),
    { refreshOnChange: false, read: readTaskSolutionEntry },
  );
  const [listExists, setListExists] = createSignal(false);
  const [listValid, setListValid] = createSignal(false);
  const [dragOver, setDragOver] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [notice, setNotice] = createSignal("");
  const [importMessages, setImportMessages] = createSignal([]);
  const [mpiValue, setMpiValue] = createSignal("default");
  const [mpiEdited, setMpiEdited] = createSignal(false);
  const [launchMode, setLaunchMode] = createSignal("solver");
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
  const [modelicaError, setModelicaError] = createSignal("");
  let modelicaDialog, modelicaButton;
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
    return Boolean(path && enabledEntries().some(entry => keyOf(props.diskHandle ? entry.displayPath : entry.taskPath) === keyOf(path)));
  });
  const includedDirty = createMemo(() => unsavedChangesService.hasDirty() && loadedIncluded());
  const awaitingAcceptance = () => pending()?.state === "waiting";
  const locked = () => busy() || awaitingAcceptance() || props.bindingBusy;
  const launchReady = () => !locked() && !resolvingLoaded() && !loadedPathError() && !includedDirty()
    && !props.blockedMessage
    && listExists() && listValid()
    && binding()?.bindingState === "bound" && Boolean(proof());
  const canLaunch = () => launchReady() && enabledEntries().length > 0;
  const selectedLaunchReady = () => (launchMode() === "modelica" ? launchReady() : canLaunch())
    && (launchMode() === "import" || !mpiError());

  createEffect(() => props.onBusyChange?.(busy() || awaitingAcceptance()));
  createEffect(() => { if (!props.open) modelicaDialog?.close(); });

  async function armLaunch(root, revision, marker = binding()) {
    setProof(null);
    if (!marker || marker.bindingState !== "bound" || !listExists() || !listValid()) return;
    if (entries().some(entry => entry.path.startsWith("../")) && marker.taskQueueVersion !== 1) {
      setNotice("Для запуска списка из нескольких каталогов обновите установленный Clark и повторите связывание с Решателем.");
      return;
    }
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
      setEntries(describeTaskQueue(root, props.catalogs ?? [], result.entries));
      setListExists(result.exists);
      setListValid(true);
      if (result.exists) await props.onQueueChange?.(root);
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
    modelicaDialog?.close();
    untrack(() => {
      batch(() => {
        setEntries([]);
        setListExists(false);
        setListValid(false);
        setDragOver(false);
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
    void (props.diskHandle ?? root).resolve(loaded).then(parts => {
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
      setEntries(describeTaskQueue(root, props.catalogs ?? [], result.entries));
      setListExists(result.exists);
      setListValid(true);
      await props.onQueueChange?.(root);
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

  const acceptsDrop = event => !locked() && Boolean(props.draggedTask)
    && Array.from(event.dataTransfer?.types ?? []).includes(TASK_DRAG_TYPE);

  function handleDragOver(event) {
    if (!acceptsDrop(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragOver(true);
  }

  function handleDrop(event) {
    setDragOver(false);
    if (!acceptsDrop(event)) return;
    event.preventDefault();
    const source = props.draggedTask;
    const snapshot = entries();
    void changeList(async root => {
      const entry = await createTaskQueueEntry(root, props.diskHandle, source);
      return writeTaskList(root, [...snapshot, entry]);
    }, true);
  }

  function removeEntry(entry) {
    const snapshot = entries().filter(item => keyOf(item.path) !== keyOf(entry.path));
    return changeList(root => writeTaskList(root, snapshot));
  }

  async function navigateEntry(entry) {
    if (locked() || !props.onNavigate) return;
    setBusy(true);
    setError("");
    try { await props.onNavigate(entry); }
    catch (failure) { if (!disposed) setError(errorText(failure)); }
    finally { if (!disposed) setBusy(false); }
  }

  createEffect(() => { if (props.open) untrack(() => { void taskStatus.refresh(); }); });

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
    if (action === "modelica" && launchReady() && enabledEntries().length !== 1) {
      setModelicaError(`Для запуска ОМ-клиента подключите ровно одно задание. Сейчас подключено: ${enabledEntries().length}.`);
      if (!modelicaDialog.open) modelicaDialog.showModal();
      return;
    }
    if (!canLaunch() || (action === "circuit" && enabledEntries().length !== 1)) return;
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

  return (
    <Show when={props.open}>
    <FloatingWindow
      open={props.open}
      title="Список заданий для расчета: сформируйте перетаскиванием из списков в проектах и запустите расчет"
      expandedRect={props.initialRect}
      minimizedTitle="Список заданий для расчета"
      minimizedWidth={400} minWidth={280} minHeight={360}
      allowMaximize={false}
      storageKey="web-gui:task-queue-window-v2"
      titleActions={<button type="button" class="task-launch-refresh"
        aria-label="Обновить состояние расчета заданий" title="Обновить галочки выполненного расчета"
        aria-busy={taskStatus.busy()} disabled={locked() || taskStatus.busy() || !entries().length}
        onClick={() => { void taskStatus.refresh(); }}>↻</button>}
      class="task-launch-window"
      onClose={props.onClose}
    >
      <div class="task-launch-body">
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
          class="task-launch-list" classList={{ "is-drag-over": dragOver() }}
          role="list" aria-label="Список заданий для расчета"
          onDragOver={handleDragOver}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragOver(false); }}
          onDrop={handleDrop}
        >
          <For each={entries()} fallback={
            <div class="task-launch-empty">{busy() ? "Загрузка…" : "Перетащите сюда задания из списка выбранного проекта."}</div>
          }>{entry => (
            <div role="listitem" class="task-launch-row" tabIndex="0"
              title="Двойной щелчок — выбрать каталог, проект и задание"
              onDblClick={event => { if (!event.target.closest("button")) void navigateEntry(entry); }}
              onKeyDown={event => { if (event.key === "Enter" && event.target === event.currentTarget) void navigateEntry(entry); }}>
              <span class="task-launch-solution" title={taskStatus(entry.path).errors.hasSolution
                ?? (taskStatus(entry.path).hasSolution ? "Решение получено" : "Нет завершенного расчета")}>
                <Show when={taskStatus(entry.path).hasSolution === true}>
                  <span role="img" aria-label="Решение получено">✓</span>
                </Show>
              </span>
              <span class="task-status-name" title={entry.displayPath}>{entry.displayPath}</span>
              <button type="button" class="task-launch-remove" disabled={locked()}
                aria-label={`Удалить из списка: ${entry.displayPath}`}
                title="Удалить задание из списка расчета"
                onClick={() => removeEntry(entry)}>×</button>
            </div>
          )}</For>
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
          <div class="task-launch-mode">
            <label class="task-launch-mpi">
              <span>MPI</span>
              <input type="text" inputMode="numeric" aria-label="Число процессов MPI" value={mpiValue()} disabled={locked() || launchMode() === "import"}
                aria-invalid={launchMode() !== "import" && Boolean(mpiError())}
                title="Число процессов для расчёта и полевого решателя цепи. default — значение из настроек Clark. Импорт не использует MPI."
                onInput={event => { setMpiEdited(true); setMpiValue(event.currentTarget.value); }}
                onBlur={() => { if (!mpiValue().trim()) setMpiValue("default"); }} />
            </label>
            <Show when={launchMode() !== "import" && mpiError()}><span class="task-launch-error" role="alert">{mpiError()}</span></Show>
            <button ref={modelicaButton} class="task-launch-start" type="button" disabled={!selectedLaunchReady()}
              onClick={() => launchMode() === "import" ? setConfirmImport(true) : launch(launchMode())}>Запустить</button>
            <div class="task-launch-modes" role="radiogroup" aria-label="Режим запуска">
              <For each={[[ "solver", "расчёт" ], [ "modelica", "ОМ клиент" ], [ "import", "импорт" ]]}>{([mode, label]) =>
                <label><input type="radio" name={`${listId}-launch-mode`} checked={launchMode() === mode} disabled={locked()}
                  onChange={() => { setConfirmImport(false); setLaunchMode(mode); }} />{label}</label>}</For>
            </div>
          </div>
          <IterationControl rootHandle={props.rootHandle} binding={binding()} active={props.open} />
        </div>
        <dialog ref={modelicaDialog} class="task-launch-modal" aria-labelledby={`${listId}-om-error`}
          onClose={() => modelicaButton?.focus()}>
          <h2 id={`${listId}-om-error`}>Запуск ОМ-клиента</h2>
          <p role="alert">{modelicaError()}</p>
          <form method="dialog"><button type="submit" autofocus>Закрыть</button></form>
        </dialog>
      </div>
    </FloatingWindow>
    </Show>
  );
}
