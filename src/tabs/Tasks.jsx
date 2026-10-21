//
// вкладка выбора задания
//
import { Show, batch, createEffect, createSignal, onCleanup, onMount, untrack } from "solid-js";
import { TaskOperationDialog } from "../components/tasks/TaskOperationDialog.jsx";
import { TaskMediaPanel } from "../components/tasks/TaskMediaPanel.jsx";
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
  readWorkspaceBinding,
  createNativeSettingsRequest,
} from "../services/taskLaunchService.js";
import {
  readTaskResultsSummary,
  readTaskSummary,
} from "../services/taskSummaryService.js";
import {
  getFilePickerErrorMessage,
  isFilePickerCancellation,
} from "../services/fileSystemAccessSupport";

import { TaskAccessDialog } from "../components/tasks/TaskAccessDialog.jsx";
import { pickProjectDisk, prepareCatalogBinding, readCatalogBindingResult } from "../services/taskAccessService.js";

import "./Tasks.css";

const EMPTY_TASK_INFO = Object.freeze({ summaryText: "" });

export function Tasks(props) {
  // состояние компонента
  const [diskHandle, setDiskHandle] = createSignal(null);
  const [catalogs, setCatalogs] = createSignal([]);
  const [accessOpen, setAccessOpen] = createSignal(true);
  const [accessBusy, setAccessBusy] = createSignal(false);
  const [bindingRequest, setBindingRequest] = createSignal(null);
  let accessButton;
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

  createEffect(() => {
    const handle = loadedTaskHandle(), path = loadedTaskPath();
    const isDemo = selectionService.loadedTaskIsDemo();
    untrack(() => {
      if (omClientState().open) setOMClientRequest(handle && !isDemo ? { handle, path } : null);
    });
  });

  const galleryDisabled = () => accessBusy() || Boolean(operation()) || demoLoading() || bindingBusy()
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

  const bindingIsCurrent = (disk, revision) => !disposed
    && disk === diskHandle() && revision === bindingRevision;
  const accessDisabled = () => operationsBlocked() || omClientState().open;

  function openBindingUri(uri) {
    setBindingNotice("В окне Решателя выберите тот же диск. Если окно не открылось или выбор отменён, нажмите «Связать с Решателем» ещё раз. Для этой функции нужен обновлённый обработчик Clark.");
    window.location.href = uri;
  }

  function closeAccess() {
    if (accessBusy() || bindingBusy()) return;
    setAccessOpen(false);
    queueMicrotask(() => accessButton?.focus());
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
    if (!diskHandle() || !catalogs().length || accessDisabled()) return;
    const disk = diskHandle(), revision = bindingRevision;
    setBindingBusy(true);
    try {
      if (bindingRequest()) { openBindingUri(bindingRequest().uri); return; }
      const prepared = await prepareCatalogBinding(disk, catalogs());
      if (!bindingIsCurrent(disk, revision)) return;
      setBindingRequest(prepared);
      if (navigator.userActivation && !navigator.userActivation.isActive) {
        setBindingNotice("Подготовка завершена. Нажмите «Связать с Решателем» ещё раз, чтобы открыть окно выбора диска.");
      } else openBindingUri(prepared.uri);
    } catch (error) {
      if (bindingIsCurrent(disk, revision)) setBindingNotice("Не удалось связать каталоги: " + error.message);
    } finally {
      if (bindingIsCurrent(disk, revision)) setBindingBusy(false);
    }
  }

  async function pollWorkspaceBinding() {
    const expected = bindingRequest(), disk = diskHandle(), revision = bindingRevision;
    if (disposed || bindingPolling || bindingBusy() || !expected || !disk) return;
    bindingPolling = true;
    try {
      const result = await readCatalogBindingResult(disk, expected);
      if (!result || !bindingIsCurrent(disk, revision) || bindingRequest() !== expected) return;
      const root = rootHandle();
      const marker = root ? await readWorkspaceBinding(root) : null;
      if (!bindingIsCurrent(disk, revision) || bindingRequest() !== expected) return;
      batch(() => {
        if (root === rootHandle()) setWorkspaceBinding(marker);
        setBindingRequest(null);
        setBindingNotice(result.state === "bound"
          ? `С Решателем связаны все каталоги: ${result.catalogs.length}. Можно продолжить работу.`
          : `Связано каталогов: ${result.catalogs.length} из ${expected.catalogs.length}. ${result.message || "Повторите связывание."}`);
      });
    } catch (error) {
      if (bindingIsCurrent(disk, revision)) setBindingNotice("Ожидание подтверждения Решателя: " + error.message);
    } finally { bindingPolling = false; }
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

  async function selectCatalog(catalog) {
    const requestId = invalidateBrowserSelection();
    const handle = catalog?.handle ?? null;
    batch(() => {
      setRootHandle(handle);
      setRootName(handle ? "Корневой каталог: " + catalog.name : "");
      setWorkspaceBinding(null);
      setSettingsRequest(null);
      setProjects([]); setSelectedProject(""); setTasks([]); setSelectedTask(null);
      setTaskInfo(EMPTY_TASK_INFO); setTaskResultsText("");
    });
    if (!handle) { lastTaskHistory.dispose(); setLastTask(null); setLastTaskNotice(""); return; }
    const historyRead = lastTaskHistory.open(handle);
    const [subdirs, marker] = await Promise.all([getSubdirs(handle), readWorkspaceBinding(handle).catch(() => null)]);
    if (disposed || requestId !== selectionRevision || handle !== rootHandle()) return;
    batch(() => { setProjects(subdirs); setWorkspaceBinding(marker); });
    await historyRead;
  }

  // Выбор диска не открывает служебные каталоги и не изменяет прежнюю привязку.
  const handlePickDirectory = async () => {
    if (accessDisabled()) return;
    const pickRevision = ++directoryPickRevision;
    setAccessBusy(true);
    try {
      const selected = await pickProjectDisk(window);
      if (disposed || pickRevision !== directoryPickRevision) return;
      const previousName = rootHandle()?.name;
      bindingRevision += 1;
      batch(() => {
        setDiskHandle(selected.handle); setCatalogs(selected.catalogs);
        setBindingRequest(null); setBindingNotice("");
      });
      await selectCatalog(selected.catalogs.find(item => item.name === previousName) ?? selected.catalogs[0]);
    } catch (error) {
      if (disposed || pickRevision !== directoryPickRevision || isFilePickerCancellation(error)) return;
      setBindingNotice(getFilePickerErrorMessage(error, "выбрать диск с проектами"));
    } finally {
      if (!disposed && pickRevision === directoryPickRevision) setAccessBusy(false);
    }
  };

  async function handleCatalogChange(event) {
    if (accessDisabled()) return;
    setAccessBusy(true);
    try { await selectCatalog(catalogs().find(item => item.name === event.currentTarget.value)); }
    catch (error) { showTaskError("Не удалось открыть каталог: " + error.message, accessButton); }
    finally { if (!disposed) setAccessBusy(false); }
  }

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
          ? `${props.summaryBounds.browserWidth}px minmax(320px, 1fr) `
            + `calc(${props.summaryBounds.left}px - var(--tasks-panel-gap))`
          : undefined,
      }}
    >
      <TaskAccessDialog open={accessOpen() && props.active !== false && !props.helpOpen}
        disk={diskHandle()} count={catalogs().length} busy={accessBusy() || bindingBusy()}
        notice={bindingNotice()} onPick={handlePickDirectory} onBind={bindWorkspace} onClose={closeAccess} />
      <div class="task-browser-panel">
        <div class="task-browser-content">
          <div>
            <div class="task-directory-actions">
              <label class="task-catalog-label" for="projectCatalog">Каталоги с проектами</label>
              <div class="task-directory-buttons">
                <select id="projectCatalog" aria-label="Каталоги с проектами"
                  value={rootHandle()?.name ?? ""} disabled={accessDisabled() || !catalogs().length}
                  onChange={handleCatalogChange}>
                  <Show when={!catalogs().length}><option value="">Выберите диск с проектами</option></Show>
                  {catalogs().map(catalog => <option value={catalog.name}>{catalog.name}</option>)}
                </select>
                <button ref={accessButton} type="button" class="task-access-button" aria-label="Доступ к проектам"
                  title="Выбрать диск с проектами и связать с Решателем" disabled={accessDisabled()}
                  onClick={() => setAccessOpen(true)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                    <path d="M3 7V5h7l2 2h9v13H3V7Z" /><path d="M3 10h18" />
                  </svg>
                </button>
              </div>
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
            title="Выделить задание и перейти на вкладку открытого Viewer с тем же базовым каталогом; браузер может ограничить переключение"
            onClick={showInViewer}>Выбрать в Viewer</button>
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

      <TaskMediaPanel taskHandle={selectedTask()?.handle} active={props.active}
        disabled={galleryDisabled()} refreshKey={previewRevision()} onBusyChange={setGalleryBusy}
        resultsSummary={taskResultsText()} />

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
        onFilesChange={() => { void taskStatus.refresh(); }}
        amplitudes={modelService.getModel().amps ?? []} amplitudesDirty={unsavedChangesService.isDirty("amps")}
        taskModel={modelService.getModel()}
        dirtyParts={["amps", "elements", "regions", "moves", "general"].filter(part => unsavedChangesService.isDirty(part))}
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
