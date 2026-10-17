//
// вкладка выбора задания
//
import { Show, batch, createEffect, createSignal, onCleanup, onMount, untrack } from "solid-js";
import { TaskOperationDialog } from "../components/tasks/TaskOperationDialog.jsx";
import { TaskGifGallery } from "../components/tasks/TaskGifGallery.jsx";
import { runTaskDirectoryOperation, suggestTaskCopyName } from "../services/taskDirectoryService.js";
import { initializeTaskDirectory } from "../services/taskTemplateService.js";
import { selectionService } from "../services/selectionService";
import { diagnosticService } from "../services/diagnosticService";
import { modelService } from "../services/modelService";
import { unsavedChangesService } from "../services/unsavedChangesService.js";
import { DEMO_TASK_NAME, loadDemoTask } from "../services/demoTaskService.js";
import { DIRECTORIES, TABS } from "../services/schemas/common/constants";
import { TaskGeometryPreview } from "../components/geometry/TaskGeometryPreview.jsx";
import { TaskLaunchWindow } from "../components/tasks/TaskLaunchWindow.jsx";
import { OMClientWindow } from "../components/tasks/OMClientWindow.jsx";
import { TaskStatusCells } from "../components/tasks/TaskStatusCells.jsx";
import { LastOpenedTaskMarker, ProjectSelectValue } from "../components/tasks/LastOpenedTaskMarker.jsx";
import { useTaskStatuses } from "../services/taskStatusMonitor.js";
import { createLastOpenedTaskHistory, sortTaskDirectories } from "../services/taskLastOpenedService.js";
import { createTaskSelectionChannel, readTaskSelection } from "../services/taskSelectionChannel.js";
import { importUsedTaskMaterials } from "../services/taskImportMaterialsService.js";
import {
  prepareWorkspaceBinding,
  readWorkspaceBinding,
  createNativeSettingsRequest,
} from "../services/taskLaunchService.js";
import {
  readTaskResultsSummary,
  readTaskSummary,
} from "../services/taskSummaryService.js";
import {
  getFilePickerErrorMessage,
  getFileSystemAccessSupport,
  isFilePickerCancellation,
} from "../services/fileSystemAccessSupport";

import "./Tasks.css";

const PROJECTS_ROOT_NAME = "clark.projects";
const EMPTY_TASK_INFO = Object.freeze({
  summaryText: "",
});

function fitBindingLine(container, text) {
  const available = container?.clientWidth;
  if (!text || !(available > 1)) return;
  // Re-measure at the original size so enlarging the panel restores the font.
  let size = 12;
  text.style.fontSize = `${size}px`;
  for (let pass = 0; pass < 3; pass += 1) {
    const width = text.getBoundingClientRect().width;
    if (!(width > available - 1)) break;
    size *= (available - 1) / width;
    text.style.fontSize = `${size}px`;
  }
}

export function Tasks(props) {
  // состояние компонента
  const [rootHandle, setRootHandle] = createSignal(null);
  const [rootName, setRootName] = createSignal("");
  const [projects, setProjects] = createSignal([]);
  const [selectedProject, setSelectedProject] = createSignal("");
  const [tasks, setTasks] = createSignal([]);
  const [lastTask, setLastTask] = createSignal(null);
  const [lastTaskNotice, setLastTaskNotice] = createSignal("");
  const lastTaskHistory = createLastOpenedTaskHistory({ app: "editor", onChange: setLastTask, onNotice: setLastTaskNotice });
  const lastProjectName = () => projects()[lastTask()?.projectIndex - 1]?.name;
  const isLastTask = task => selectedProject() === lastProjectName() && tasks().indexOf(task) + 1 === lastTask()?.taskIndex;
  const taskStatus = useTaskStatuses(
    () => tasks().map(task => ({ key: task.handle, handle: task.handle })),
  );
  const [selectedTask, setSelectedTask] = createSignal(null);
  const loadedTaskHandle = selectionService.loadedTaskHandle;
  const loadedTaskPath = selectionService.loadedTaskPath;
  const [taskErrorMessage, setTaskErrorMessage] = createSignal("");
  const [pendingTaskLoad, setPendingTaskLoad] = createSignal(null);
  const [taskInfo, setTaskInfo] = createSignal(EMPTY_TASK_INFO);
  const [taskResultsText, setTaskResultsText] = createSignal("");
  const [demoLoading, setDemoLoading] = createSignal(false);
  const [taskLaunchOpen, setTaskLaunchOpen] = createSignal(false);
  const [omClientRequest, setOMClientRequest] = createSignal(null);
  const [omClientState, setOMClientState] = createSignal({ open: false, dirty: false, busy: false, path: "" });
  const [settingsRequest, setSettingsRequest] = createSignal(null);
  const [previewRevision, setPreviewRevision] = createSignal(1);
  const [workspaceBinding, setWorkspaceBinding] = createSignal(null);
  const [bindingBusy, setBindingBusy] = createSignal(false);
  const [bindUri, setBindUri] = createSignal("");
  const [bindingNotice, setBindingNotice] = createSignal("");
  const [launchBusy, setLaunchBusy] = createSignal(false);
  const [operation, setOperation] = createSignal(null);
  const [operationBusy, setOperationBusy] = createSignal(false);
  const [operationError, setOperationError] = createSignal("");
  const [operationFailed, setOperationFailed] = createSignal(false);
  const [galleryBusy, setGalleryBusy] = createSignal(false);
  const [selectionReceiving, setSelectionReceiving] = createSignal(false);
  const [selectionSending, setSelectionSending] = createSignal(false);
  const [selectionNotice, setSelectionNotice] = createSignal("");
  let taskListElement;
  let bindingHint, bindingHintText, bindingFitFrame = 0, bindingFitDisposed = false;
  const bindingStatusText = () => rootHandle() ? bindingNotice() || "Каталог не связан с Решателем." : "";
  const bindingHintTitle = () => "Для подготовки к запуску расчетов выполнить: «Связать с Решателем»"
    + (bindingStatusText() ? ` ${bindingStatusText()}` : "");
  const scheduleBindingFit = () => {
    if (bindingFitDisposed || bindingFitFrame) return;
    bindingFitFrame = window.requestAnimationFrame(() => {
      bindingFitFrame = 0;
      if (!bindingFitDisposed) fitBindingLine(bindingHint, bindingHintText);
    });
  };
  createEffect(() => { bindingStatusText(); props.active; scheduleBindingFit(); });
  onMount(() => {
    const observer = new ResizeObserver(scheduleBindingFit);
    observer.observe(bindingHint);
    window.addEventListener("resize", scheduleBindingFit);
    document.fonts?.addEventListener("loadingdone", scheduleBindingFit);
    document.fonts?.ready.then(scheduleBindingFit);
    scheduleBindingFit();
    onCleanup(() => {
      bindingFitDisposed = true;
      observer.disconnect();
      window.removeEventListener("resize", scheduleBindingFit);
      document.fonts?.removeEventListener("loadingdone", scheduleBindingFit);
      if (bindingFitFrame) window.cancelAnimationFrame(bindingFitFrame);
    });
  });

  createEffect(() => {
    const handle = loadedTaskHandle(), path = loadedTaskPath();
    const isDemo = selectionService.loadedTaskIsDemo();
    untrack(() => {
      if (omClientState().open) setOMClientRequest(handle && !isDemo ? { handle, path } : null);
    });
  });

  const galleryDisabled = () => Boolean(operation()) || demoLoading() || bindingBusy()
    || launchBusy() || taskLaunchOpen() || omClientState().busy || props.editorBusy || selectionReceiving();
  const operationsBlocked = () => galleryDisabled() || galleryBusy();
  createEffect(() => props.onTaskActionsChange?.({
    createEnabled: Boolean(selectedProject()) && !operationsBlocked() && !omClientState().open,
    selectedEnabled: Boolean(selectedTask()) && !operationsBlocked() && !omClientState().open,
    run: openTaskOperation,
  }));

  function openTaskOperation(kind) {
    if (operationsBlocked() || omClientState().open || !selectedProject() || (kind !== "create" && !selectedTask())) return;
    const parent = projects().find(project => project.name === selectedProject())?.handle;
    if (!parent) return;
    invalidateBrowserSelection();
    setOperationError("");
    setOperationFailed(false);
    setOperation({ kind, parent, root: rootHandle(), projectName: selectedProject(), task: selectedTask(),
      name: kind === "create" ? "Новое задание" : selectedTask().name });
    if (kind === "copy") {
      const request = operation();
      setOperationBusy(true);
      suggestTaskCopyName(parent, request.name).then(name => {
        if (operation() === request) setOperation({ ...request, name });
      }).catch(error => setOperationError(error.message)).finally(() => setOperationBusy(false));
    }
  }

  async function submitTaskOperation(name) {
    const request = operation();
    if (!request || operationBusy() || operationFailed()) return;
    const relocate = ["rename", "move"].includes(request.kind);
    setOperationError("");
    setOperationBusy(true);
    let destination = request.parent;
    let wasLoaded = false;
    let completedResult = null;
    try {
      // Invoke the picker directly from the submit gesture, before any await.
      if (request.kind === "move") destination = await window.showDirectoryPicker({ mode: "readwrite", id: "task-move-project" });
      if (loadedTaskHandle() && request.task) wasLoaded = await loadedTaskHandle().isSameEntry(request.task.handle);
      if (relocate && wasLoaded && unsavedChangesService.hasDirty()) {
        throw new Error("Сначала сохраните изменения выбранного задания и его библиотек. Операция не выполнялась.");
      }
      const result = await runTaskDirectoryOperation({ kind: request.kind, root: request.root,
        sourceParent: request.parent, source: request.kind === "create" ? null : request.task?.handle,
        destinationParent: destination, name: request.kind === "move" ? request.name : name,
        initialize: initializeTaskDirectory });
      completedResult = result;
      await finishTaskOperation(request, destination, result, (relocate || request.kind === "delete") && wasLoaded);
      setOperation(null);
    } catch (error) {
      if (isFilePickerCancellation(error)) return;
      const result = error.operationResult ?? completedResult;
      if (completedResult) error.message = `Файловая операция завершена, но обновление интерфейса не удалось. Задание: «${destination.name}/${result.name}». ${error.message}`;
      if (result) {
        setOperationFailed(true);
        try { await finishTaskOperation(request, destination, result, (relocate || request.kind === "delete") && wasLoaded && result.deletionStarted); }
        catch (refreshError) { error.message += `\nНе удалось обновить список: ${refreshError.message}`; }
      }
      setOperationError(error.message);
    } finally {
      setOperationBusy(false);
    }
  }

  async function finishTaskOperation(request, destination, result, rebindLoaded) {
    if (request.kind === "delete") {
      invalidateBrowserSelection();
      if (rebindLoaded) {
        batch(() => { clearLoadedTaskState(); unsavedChangesService.clear(); });
      }
      setSelectedTask(null);
      setTaskInfo(EMPTY_TASK_INFO);
      setTaskResultsText("");
      setTasks([]);
      setTasks(await getSubdirs(request.parent));
      return;
    }
    if (rebindLoaded) {
      const relative = await request.root.resolve(result.handle);
      const fullPath = relative ? `${request.root.name}/${relative.join("/")}` : `${destination.name}/${result.name}`;
      commitTaskLoad({ task: { name: result.name, handle: result.handle }, fullPath, openEditor: false });
    }
    const updated = await getSubdirs(request.parent);
    setTasks(updated);
    const sameProject = await destination.isSameEntry(request.parent);
    const chosen = sameProject && result.verified ? updated.find(task => task.name === result.name)
      : updated.find(task => task.name === request.task?.name);
    if (chosen) await selectTaskCandidate(chosen);
    else { setSelectedTask(null); setTaskInfo(EMPTY_TASK_INFO); setTaskResultsText(""); }
  }

  let taskErrorDialog;
  let taskErrorCloseButton;
  let taskErrorReturnFocus;
  let unsavedDialog;
  let returnToEditingButton;
  let selectionRevision = 0;
  let taskLoadRevision = 0;
  let taskInfoRevision = 0;
  let directoryPickRevision = 0;
  let bindingRevision = 0;
  let bindingPolling = false;
  let disposed = false;
  const selectionChannel = createTaskSelectionChannel({ app: "editor", onSelection: receiveTaskSelection });
  onCleanup(() => selectionChannel.dispose());

  async function receiveTaskSelection(request) {
    if (operationsBlocked() || pendingTaskLoad() || document.querySelector("dialog[open]")) {
      throw new Error("Editor занят. Завершите текущую операцию и повторите переход.");
    }
    const root = rootHandle();
    const revision = invalidateBrowserSelection();
    directoryPickRevision += 1;
    setSelectionReceiving(true);
    setSelectionNotice("");
    try {
      const selected = await readTaskSelection(root, request, {
        isCurrent: () => !disposed && root === rootHandle() && revision === selectionRevision && !props.editorBusy,
      });
      batch(() => {
        setProjects(selected.projects);
        setSelectedProject(selected.project.name);
        setTasks(selected.tasks);
        void selectTaskCandidate(selected.task, { external: true });
      });
      props.onOpenTab?.(TABS.TASKS.id);
      setSelectionNotice(`Выбрано задание из Viewer: ${selected.project.name}/${selected.task.name}`);
      queueMicrotask(() => {
        if (!disposed && revision === selectionRevision) {
          taskListElement?.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
          taskListElement?.focus({ preventScroll: true });
        }
      });
    } finally { setSelectionReceiving(false); }
  }

  async function showInViewer(event) {
    if (!selectedTask() || selectedTask().isDemo || operationsBlocked() || selectionSending()) return;
    const sourceButton = event.currentTarget;
    const task = selectedTask(), project = selectedProject(), root = rootHandle();
    setSelectionSending(true); setSelectionNotice("");
    try {
      await selectionChannel.select({ baseHandle: root, projectName: project, taskName: task.name });
      if (!disposed) setSelectionNotice(`В Viewer выделено задание: ${project}/${task.name}`);
    } catch (error) { if (!disposed) showTaskError(error.message, sourceButton); }
    finally { if (!disposed) setSelectionSending(false); }
  }

  // Сброс данных прежнего задания выполняется до любой новой загрузки.
  const clearLoadedTaskState = () => {
    selectionService.setLoadedTaskHandle(null);
    selectionService.setLoadedTaskPath(null);
    selectionService.setLoadedTaskIsDemo(false);
    modelService.clearModel();
    diagnosticService.clearDiagnostics();
    diagnosticService.clearLoadResult();
  };

  const invalidateBrowserSelection = () => {
    selectionRevision += 1;
    taskLoadRevision += 1;
    taskInfoRevision += 1;
    return selectionRevision;
  };

  const showTaskError = (message, returnFocus = null) => {
    taskErrorReturnFocus = returnFocus;
    setTaskErrorMessage(message);
    queueMicrotask(() => {
      if (disposed || !taskErrorDialog?.isConnected) return;
      if (!taskErrorDialog.open) {
        taskErrorDialog.showModal();
      }
      taskErrorCloseButton?.focus();
    });
  };

  const showLoadError = (taskName) => {
    showTaskError(
      `Данные задания «${taskName}» не загружены: обязательный каталог `
      + `«${DIRECTORIES.INPUT}» отсутствует.`,
    );
  };

  const bindingIsCurrent = (root, revision) => !disposed
    && root === rootHandle() && revision === bindingRevision;
  const bindingDisabled = () => !rootHandle() || bindingBusy() || launchBusy() || galleryBusy()
    || workspaceBinding()?.bindingState === "bound";

  const resetWorkspaceBinding = () => {
    bindingRevision += 1;
    setWorkspaceBinding(null);
    setSettingsRequest(null);
    setBindingBusy(false);
    setBindUri("");
    setBindingNotice("");
  };

  function openBindingUri(uri) {
    // Keep the prepared URI until confirmation, so a retry uses a direct click.
    setBindingNotice("Выберите в окне Решателя тот же базовый каталог «"
      + rootHandle().name + "». После отмены можно нажать «Связать с Решателем» повторно.");
    window.location.href = uri;
  }

  function openTaskLaunch() {
    if (operationsBlocked()) return;
    const request = createNativeSettingsRequest(workspaceBinding());
    setSettingsRequest(request);
    setTaskLaunchOpen(true);
    // A direct click retains browser permission to open the protocol handler.
    if (request) window.location.href = request.uri;
  }

  function openOMClient() {
    if (operationsBlocked()) return;
    const handle = loadedTaskHandle();
    if (!handle || selectionService.loadedTaskIsDemo()) {
      showTaskError(selectionService.loadedTaskIsDemo()
        ? "Для клиентской модели нужно обычное задание, сохранённое в каталоге проекта. Выберите его в списке и нажмите «Загрузить для редактирования», затем откройте «Клиентская модель». Демо не имеет каталога для сохранения OM-данных."
        : "Задание для редактирования не загружено. Выберите задание в списке и нажмите «Загрузить для редактирования» или дважды щёлкните по заданию. Затем откройте «Клиентская модель».");
      return;
    }
    setOMClientRequest({ handle, path: loadedTaskPath() });
  }

  async function bindWorkspace() {
    if (bindingDisabled()) return;
    const root = rootHandle();
    const revision = bindingRevision;
    setBindingBusy(true);
    try {
      if (bindUri()) {
        openBindingUri(bindUri());
        return;
      }
      const prepared = await prepareWorkspaceBinding(root);
      if (!bindingIsCurrent(root, revision)) return;
      setWorkspaceBinding({ workspaceId: prepared.workspaceId, bindingState: "pending" });
      setBindUri(prepared.uri);
      if (navigator.userActivation && !navigator.userActivation.isActive) {
        setBindingNotice("Подготовка завершена. Нажмите «Связать с Решателем» ещё раз, "
          + "чтобы открыть выбор каталога в Windows.");
      } else openBindingUri(prepared.uri);
    } catch (error) {
      if (bindingIsCurrent(root, revision)) {
        showTaskError("Не удалось связать каталог с Решателем: "
          + (error?.message || String(error)));
      }
    } finally {
      if (bindingIsCurrent(root, revision)) setBindingBusy(false);
    }
  }

  async function pollWorkspaceBinding() {
    const expected = workspaceBinding();
    if (disposed || bindingPolling || bindingBusy()
      || expected?.bindingState !== "pending" || !rootHandle()) return;
    const root = rootHandle();
    const revision = bindingRevision;
    bindingPolling = true;
    try {
      const marker = await readWorkspaceBinding(root);
      if (!bindingIsCurrent(root, revision)
        || workspaceBinding()?.workspaceId !== expected.workspaceId) return;
      if (marker?.workspaceId === expected.workspaceId && marker.bindingState === "bound") {
        batch(() => {
          setWorkspaceBinding(marker);
          setBindUri("");
          setBindingNotice("Каталог связан с Решателем.");
        });
      }
    } catch {
      // The native handler may be replacing the marker; retry on the next poll.
    } finally {
      bindingPolling = false;
    }
  }

  onMount(() => {
    const timer = window.setInterval(() => { void pollWorkspaceBinding(); }, 1000);
    const onFocus = () => { void pollWorkspaceBinding(); };
    window.addEventListener("focus", onFocus);
    onCleanup(() => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    });
  });
  onCleanup(() => { disposed = true; bindingRevision += 1; directoryPickRevision += 1; lastTaskHistory.dispose(); });

  // получение полного пути
  const getFullPath = async (root, handle) => {
    const segments = await root.resolve(handle);
    if (!segments) return root.name;
    return root.name + "/" + segments.join("/");
  };

  // получение списка подкаталогов
  const getSubdirs = async (dirHandle) => {
    const dirs = [];
    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind === "directory") {
        dirs.push({
          name,
          handle,
        });
      }
    }
    return sortTaskDirectories(dirs);
  };

  // выбор корневого каталога
  const handlePickDirectory = async () => {
    if (bindingBusy() || operation() || galleryBusy() || selectionReceiving()) return;
    const support = getFileSystemAccessSupport(window);
    if (!support.supported) {
      showTaskError(support.message);
      return;
    }

    const pickRevision = ++directoryPickRevision;
    try {
      const handle = await window.showDirectoryPicker({
        mode: "readwrite",
      });
      const previous = rootHandle();
      const sameDirectory = previous ? await previous.isSameEntry(handle) : false;
      if (disposed || pickRevision !== directoryPickRevision) return;
      const requestId = invalidateBrowserSelection();
      if (!sameDirectory) resetWorkspaceBinding();
      setRootHandle(sameDirectory ? previous : handle);
      setRootName("Корневой каталог: " + handle.name);
      setProjects([]);
      setSelectedProject("");
      setTasks([]);
      setSelectedTask(null);
      setTaskInfo(EMPTY_TASK_INFO);
      setTaskResultsText("");
      const historyRead = lastTaskHistory.open(sameDirectory ? previous : handle);

      const subdirs = await getSubdirs(handle);
      if (disposed || requestId !== selectionRevision || pickRevision !== directoryPickRevision) return;
      setProjects(subdirs);
      await historyRead;
    } catch (error) {
      if (disposed || pickRevision !== directoryPickRevision) return;
      // Отмена выбора пользователем — штатная ситуация.
      if (isFilePickerCancellation(error)) return;

      console.error("Ошибка выбора каталога", error);
      showTaskError(
        getFilePickerErrorMessage(error, "выбрать каталог с проектами"),
      );
    }
  };

  // выбор проекта
  const handleProjectChange = async (event) => {
    if (operation() || galleryBusy() || selectionReceiving()) return;
    const projectName = event.currentTarget.value;
    const requestId = invalidateBrowserSelection();
    setSelectedProject(projectName);
    setTasks([]);
    setSelectedTask(null);
    setTaskInfo(EMPTY_TASK_INFO);
    setTaskResultsText("");
    if (!projectName) return;
    try {
      const root = rootHandle();
      if (!root) return;
      const projectHandle = await root.getDirectoryHandle(projectName);
      const taskDirs = await getSubdirs(projectHandle);
      if (requestId !== selectionRevision) return;
      setTasks(taskDirs);
    } catch (error) {
      console.error(
        "Ошибка получения списка заданий выбранного проекта",
        error,
      );
    }
  };

  // выбор задания
  const commitTaskLoad = ({ task, fullPath, openEditor = true, lastTaskSnapshot }) => {
    batch(() => {
      clearLoadedTaskState();
      selectionService.setLoadedTaskIsDemo(task.isDemo === true);
      selectionService.setLoadedTaskPath(fullPath);
      selectionService.setLoadedTaskHandle(task.handle);
    });
    if (openEditor && !task.isDemo) void lastTaskHistory.remember(lastTaskSnapshot);
    if (openEditor) props.onOpenTab?.(TABS.GENERAL.id);
    if (task.isDemo) void selectTaskCandidate(task);
    console.log("Выбранное задание:", fullPath);
  };

  const selectTaskCandidate = async (task, { external = false } = {}) => {
    if (galleryBusy() || (selectionReceiving() && !external)) return;
    taskLoadRevision += 1;
    const requestId = ++taskInfoRevision;
    setSelectedTask(task);
    setTaskInfo(EMPTY_TASK_INFO);
    setTaskResultsText("");

    const isCurrentSelection = () => !(
      requestId !== taskInfoRevision
      || selectedTask()?.handle !== task.handle
    );

    // Сводки читаются независимо: задержка или ошибка одной не скрывает другую.
    // Повторный выбор той же строки также перечитывает файлы после расчёта.
    await Promise.all([
      (async () => {
        try {
          const info = await readTaskSummary(task.handle);
          if (isCurrentSelection()) setTaskInfo(info);
        } catch (error) {
          if (!isCurrentSelection()) return;
          console.error("Ошибка чтения информации о выбранном задании:", error);
          setTaskInfo({
            summaryText: "Ошибка чтения информации о задании: "
              + (error?.message || error?.name || String(error)),
          });
        }
      })(),
      (async () => {
        try {
          const text = await readTaskResultsSummary(task.handle);
          if (isCurrentSelection()) setTaskResultsText(text);
        } catch (error) {
          if (!isCurrentSelection()) return;
          console.error("Ошибка чтения результатов расчёта:", error);
          setTaskResultsText("Ошибка чтения результатов расчёта: "
            + (error?.message || error?.name || String(error)));
        }
      })(),
    ]);
  };

  const offerTaskLoad = (request) => {
    if (omClientState().busy) {
      showTaskError("Дождитесь завершения операции с OM-данными, затем загрузите другое задание.");
      return;
    }
    if (loadedTaskHandle() && (unsavedChangesService.hasDirty() || omClientState().dirty)) {
      setPendingTaskLoad(request);
      queueMicrotask(() => {
        if (!unsavedDialog.open) unsavedDialog.showModal();
        returnToEditingButton?.focus();
      });
      return;
    }
    commitTaskLoad(request);
  };

  const handleLaunchComplete = async (entries, action, context) => {
    const root = context.root;
    const isCurrent = () => context.isCurrent() && root === rootHandle();
    if (!isCurrent()) return;
    let report;
    if (action === "import") {
      report = context.result.state === "completed"
        ? await importUsedTaskMaterials(root, entries, { isCurrent })
        : { imported: 0, messages: [{ level: "info", path: "Список заданий",
          text: "Clark сообщил об ошибке импорта данных. Автоперенос XAP.lib не выполнялся: свежесть kvs.txt не подтверждена." }] };
    }
    if (!isCurrent()) return report;
    const task = selectedTask();
    if (!root || !task || task.isDemo) return report;
    const segments = await root.resolve(task.handle);
    if (!isCurrent() || task !== selectedTask() || !segments) return report;
    const relativePath = segments.join("/").toLowerCase();
    if (!entries.some(entry => entry.enabled && entry.path.toLowerCase() === relativePath)) return report;
    if (action === "import") setPreviewRevision(value => value + 1);
    await selectTaskCandidate(task);
    return report;
  };

  const requestDemoLoad = async () => {
    if (operation() || galleryBusy()) return;
    if (demoLoading()) return;
    const requestId = ++taskLoadRevision;
    setDemoLoading(true);
    try {
      const handle = await loadDemoTask();
      if (requestId !== taskLoadRevision) return;
      offerTaskLoad({
        task: { name: DEMO_TASK_NAME, handle, isDemo: true },
        fullPath: DEMO_TASK_NAME,
      });
    } catch (error) {
      if (requestId !== taskLoadRevision) return;
      showTaskError(
        "Демонстрационная задача не загружена: "
        + (error?.message || error?.name || String(error)),
      );
    } finally {
      setDemoLoading(false);
    }
  };

  const requestTaskLoad = async () => {
    if (operation() || galleryBusy()) return;
    const task = selectedTask();
    if (!task || task.handle === loadedTaskHandle()) return;
    const requestId = ++taskLoadRevision;

    try {
      const root = rootHandle();
      if (!root) return;
      const lastTaskSnapshot = lastTaskHistory.capture(projects(), selectedProject(), tasks(), task);

      const [, fullPath] = await Promise.all([
        task.handle.getDirectoryHandle(DIRECTORIES.INPUT),
        getFullPath(root, task.handle),
      ]);
      if (requestId !== taskLoadRevision) return;

      offerTaskLoad({ task, fullPath, lastTaskSnapshot });
    } catch (error) {
      if (requestId !== taskLoadRevision) return;
      if (error?.name === "NotFoundError") {
        showLoadError(task.name);
        return;
      }
      console.error("Ошибка обработки задания:", error);
    }
  };

  const confirmTaskLoad = () => {
    const request = pendingTaskLoad();
    if (!request) return;
    setPendingTaskLoad(null);
    unsavedDialog.close();
    commitTaskLoad(request);
  };

  const returnToEditing = () => {
    setPendingTaskLoad(null);
    unsavedDialog.close();
    props.onReturnToEditing?.();
  };

  const taskLoaded = () =>
    Boolean(selectedTask()?.handle)
    && selectedTask()?.handle === loadedTaskHandle();

  return (
    <div
      class="tasks-layout"
      style={{
        "grid-template-columns": props.summaryBounds
          ? `minmax(360px, 1fr) ${props.summaryBounds.width}px `
            + `calc(${props.summaryBounds.left}px - var(--tasks-panel-gap))`
          : undefined,
      }}
    >
      <div class="task-browser-panel">
        <div class="task-browser-content">
          <div>
            <div class="task-directory-actions">
              <div class="task-directory-buttons">
                <button
                  id="pickDir"
                  disabled={bindingBusy() || Boolean(operation()) || galleryBusy() || selectionReceiving()}
                  title={`Базовый каталог с проектами, обычно ${PROJECTS_ROOT_NAME}. Смена каталога не останавливает текущий расчёт. Одновременно допускается запуск только одного решателя.`}
                  onClick={handlePickDirectory}
                >
                  Выбрать каталог с проектами
                </button>
                <button
                  type="button"
                  class="task-bind-button"
                  classList={{ "is-bound": workspaceBinding()?.bindingState === "bound" }}
                  disabled={bindingDisabled()}
                  aria-busy={bindingBusy()}
                  title={workspaceBinding()?.bindingState === "bound"
                    ? "Связь с Решателем для выбранного базового каталога установлена"
                    : "Связать выбранный базовый каталог с установленным Решателем"}
                  onClick={bindWorkspace}
                >
                  {workspaceBinding()?.bindingState === "bound"
                    ? "Решатель доступен" : "Связать с Решателем"}
                </button>
              </div>
              <p class="task-directory-hint" ref={bindingHint} title={bindingHintTitle()}>
                <span class="task-directory-hint-text" ref={bindingHintText}>
                  Для подготовки к запуску расчетов выполнить: «Связать с Решателем»
                  <Show when={rootHandle()}>
                    {" "}<span class="task-binding-status" role="status"
                      classList={{ "is-unbound": workspaceBinding()?.bindingState !== "bound" }}>
                      {bindingStatusText()}
                    </span>
                  </Show>
                </span>
              </p>
            </div>
            <span id="rootName">{rootName()}</span>
          </div>
          <div class="box">
            <h4>Список проектов</h4>
            <select
              id="listProject"
              class="task-project-select"
              value={selectedProject()}
              disabled={Boolean(operation()) || galleryBusy() || selectionReceiving()}
              onChange={handleProjectChange}
            >
              <ProjectSelectValue value={selectedProject()} placeholder="Выбрать проект" marked={selectedProject() === lastProjectName()} />
              <option value="">Выбрать проект</option>
              {projects().map((project) => (
                <option value={project.name}><Show when={project.name === lastProjectName()}><LastOpenedTaskMarker label="Последний открытый проект" /></Show>{project.name}</option>
              ))}
            </select>
          </div>
          <div class="task-list-group">
            <div class="task-list-heading">
              <h4>Список заданий выбранного проекта</h4>
              <button
                type="button"
                class="task-demo-button"
                disabled={demoLoading() || galleryBusy()}
                aria-busy={demoLoading()}
                title="Загрузить демонстрационную задачу для редактирования"
                onClick={requestDemoLoad}
              >
                Демо
              </button>
              <button
                type="button"
                class="task-status-refresh"
                disabled={!tasks().length || taskStatus.busy() || galleryBusy() || operationBusy()}
                aria-label="Обновить признаки состояния заданий"
                aria-busy={taskStatus.busy()}
                title="Обновить признаки состояния заданий"
                onClick={() => { void taskStatus.refresh(); }}
              >↻</button>
            </div>
            <div
              id="listTask"
              class="listTask"
              ref={taskListElement}
              tabIndex="0"
            >
              {tasks().map((task) => (
                <div
                  classList={{
                    "listTask-item": true,
                    "task-status-row": true,
                    selected: selectedTask()?.handle === task.handle,
                  }}
                  onClick={() => selectTaskCandidate(task)}
                  onDblClick={() => {
                    if (selectedTask()?.handle === task.handle) void requestTaskLoad();
                  }}
                  title="Двойной щелчок — загрузить задание для редактирования"
                >
                  <TaskStatusCells status={taskStatus(task.handle)} />
                  <span class="task-status-name"><Show when={isLastTask(task)}><LastOpenedTaskMarker label="Последнее открытое задание" /></Show>{task.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div class="task-browser-actions">
          <button
            class="task-load-button"
            disabled={!selectedTask() || taskLoaded() || galleryBusy() || selectionReceiving()}
            onClick={requestTaskLoad}
          >
            <span class="task-load-label">
              <span class="task-load-leading">
                <Show keyed when={loadedTaskPath()}>
                  {() => (
                    <span
                      class="task-load-confirmation"
                      role="status"
                      aria-label="Задание загружено"
                      title="Задание загружено"
                    >
                      ✓
                    </span>
                  )}
                </Show>
              </span>
              <span class="task-load-text">Загрузить для редактирования</span>
              <span class="task-load-trailing" aria-hidden="true" />
            </span>
          </button>
          <button type="button" class="task-cross-open-button"
            disabled={!selectedTask() || selectedTask()?.isDemo || !selectionChannel.supported || operationsBlocked() || selectionSending()}
            aria-busy={selectionSending()}
            title="Выбрать проект и выделить это задание в открытом Viewer с тем же базовым каталогом"
            onClick={showInViewer}>Показать в Viewer</button>
          <button
            type="button"
            class="task-launch-open-button"
            disabled={!rootHandle() || operationsBlocked()}
            onClick={openTaskLaunch}
          >
            Формирование списка заданий и запуск приложений
          </button>
          <button type="button" class="task-om-open-button"
            disabled={operationsBlocked()}
            title="Данные OM-модели и конфигурация обмена для загруженного в редактор задания"
            onClick={openOMClient}>Клиентская модель…</button>
        </div>
        <Show when={lastTaskNotice()}><p class="task-last-opened-notice" role="status">{lastTaskNotice()}</p></Show>
        <div class="task-panel-caption">выбор задания</div>
      </div>
      <div class="task-summary-panel">
        <Show when={previewRevision()} keyed>
          {() => (
            <TaskGeometryPreview
              taskHandle={selectedTask()?.handle}
              active={props.active}
            />
          )}
        </Show>
        <div class="task-summary-content">
          <textarea
            class="task-summary-text"
            aria-label="Информация о выбранном задании"
            readOnly
            value={taskInfo().summaryText}
          />
        </div>
        <div class="task-panel-caption">исходные данные</div>
      </div>

      <section class="task-results-panel" aria-label="Результаты расчёта">
        <TaskGifGallery taskHandle={selectedTask()?.handle} active={props.active}
          disabled={galleryDisabled()} refreshKey={previewRevision()} onBusyChange={setGalleryBusy} />
        <textarea
          class="task-results-text"
          aria-label="Сводка результатов расчёта выбранного задания"
          readOnly
          wrap="off"
          spellcheck={false}
          value={taskResultsText()}
        />
        <div class="task-panel-caption">результаты</div>
      </section>

      <TaskLaunchWindow
        open={taskLaunchOpen() && props.active !== false}
        rootHandle={rootHandle()}
        binding={workspaceBinding()}
        settingsRequest={settingsRequest()}
        bindingBusy={bindingBusy()}
        blockedMessage={omClientState().busy ? "Дождитесь завершения операции с OM-данными."
          : omClientState().dirty ? `Сохраните или отмените изменения OM-модели: ${omClientState().path}.` : ""}
        onBusyChange={setLaunchBusy}
        onClose={() => setTaskLaunchOpen(false)}
        onSave={props.onSave}
        onBeforeImport={(_entries, loadedIncluded) => {
          if (loadedIncluded) clearLoadedTaskState();
        }}
        onLaunchComplete={handleLaunchComplete}
      />

      <OMClientWindow request={omClientRequest()} onStateChange={setOMClientState}
        amplitudes={modelService.getModel().amps ?? []} amplitudesDirty={unsavedChangesService.isDirty("amps")}
        locked={launchBusy() || bindingBusy() || operationBusy()} />

      <TaskOperationDialog request={operation()} busy={operationBusy()} error={operationError()}
        failed={operationFailed()} onSubmit={submitTaskOperation} onClose={() => setOperation(null)} />

      <dialog
        class="task-load-error-dialog"
        aria-label="Ошибка выполнения действия"
        aria-describedby="task-error-message"
        ref={(el) => (taskErrorDialog = el)}
        onClose={() => {
          setTaskErrorMessage("");
          taskErrorReturnFocus?.focus();
          taskErrorReturnFocus = null;
        }}
      >
        <p id="task-error-message">{taskErrorMessage()}</p>
        <button
          type="button"
          ref={(el) => (taskErrorCloseButton = el)}
          onClick={() => taskErrorDialog.close()}
        >
          Закрыть
        </button>
      </dialog>

      <dialog
        class="task-unsaved-dialog"
        ref={(el) => (unsavedDialog = el)}
        onCancel={(event) => event.preventDefault()}
      >
        <p>
          В редакторе есть несохранённые изменения. Загрузить другое задание
          без сохранения текущих данных, включая данные клиентской модели OM?
        </p>
        <div class="task-unsaved-actions">
          <button onClick={confirmTaskLoad}>
            Загрузить без сохранения
          </button>
          <button
            ref={(el) => (returnToEditingButton = el)}
            onClick={returnToEditing}
          >
            Вернуться к редактированию
          </button>
        </div>
      </dialog>
    </div>
  );
}
