import { createEffect, createMemo, createSignal, For, onCleanup, onMount } from "solid-js";

import { Tasks } from "./tabs/Tasks.jsx";
import { DataEditor } from "./components/editors/DataEditor.jsx";
import { MaterialLibraryTab } from "./tabs/MaterialLibraryTab.jsx";
import { tabRegistry } from "./services/tabRegistry";
import { materialTabRegistry } from "./services/materialTabRegistry";
import { TaskInfoBar } from "./TaskInfoBar";
import { SidePanel } from "./components/SidePanel";
import { MaterialSelectionDialog } from "./components/materials/MaterialSelectionDialog.jsx";
import { GeometryViewerWindow } from "./components/geometry/GeometryViewerWindow.jsx";
import { MedAutofillDialog } from "./components/elements/MedAutofillDialog.jsx";
import {UniformFieldCoilDialog} from "./components/elements/UniformFieldCoilDialog.jsx";
import {applyUniformFieldCoil} from "./services/generator/uniformFieldCoil.js";
import { createMedRequest, medRequestIsCurrent, medRequestCanNavigate, applyMedResult } from "./services/medAutofillService.js";
import {
  TABS,
  VALIDATION_LEVELS,
} from "./services/schemas/common/constants";
import { selectionService } from "./services/selectionService";
import { modelService } from "./services/modelService";
import { materialLibraryHistoryService } from "./services/materialLibraryHistoryService.js";
import { modelValidator } from "./tabulator/validators/types/modelValidator";
import { diagnosticService } from "./services/diagnosticService";
import { dataService } from "./services/dataService";
import { viewSettingsService } from "./services/viewSettingsService";
import { selectionContextService } from "./services/selectionContextService.js";
import { unsavedChangesService } from "./services/unsavedChangesService.js";
import { writeTaskSummary } from "./services/taskSummaryService.js";
import { taskApprovalService } from "./services/taskApprovalService.js";
import {
  assignSelectedElementMaterial,
  clearSelectedElementMaterials,
  selectedElementMaterialRequest,
  selectedElementsRequest,
} from "./tabulator/actions/elementMaterialActions.js";
import { loadMaterialReferenceCatalog } from "./services/materialReferenceValidation.js";
import { createError } from "./tabulator/validators/common/createDiagnostic.js";
import { loadJweakLocal, createJweakLocalLoader } from "./services/jweakLocalService.js";
import { installModelSaveShortcut } from "./services/modelSaveShortcut.js";
import { installHorizontalDragScroll } from "./services/horizontalDragScroll.js";
import { installLinkedHorizontalScrollbar } from "./services/linkedHorizontalScrollbar.js";
import { installBrowserContextMenuSuppression } from "./services/browserContextMenu.js";

import "./App.css";

export default function App() {
  const [activeTab, setActiveTab] = createSignal(TABS.TASKS.id);
  const [taskActions, setTaskActions] = createSignal(null);
  const [taskSummaryBounds, setTaskSummaryBounds] = createSignal(null);
  const tabButtons = new Map();
  const editorControllers = new Map();
  const [clipboardBusy, setClipboardBusy] = createSignal(false);
  const [clipboardError, setClipboardError] = createSignal("");
  let clipboardErrorDialog;

  const clipboardTableActions = () => tabRegistry.find(schema => schema.id === activeTab())?.views?.clipboardTables ?? [];
  async function replaceTableFromClipboard(property) {
    if (clipboardBusy()) return;
    setSidePanelOpen(false);
    setClipboardBusy(true);
    try {
      const editor = editorControllers.get(activeTab());
      if (!editor) throw new Error("Редактор ещё не готов.");
      await editor.replaceTableFromClipboard(property);
    } catch (error) {
      setClipboardError(error instanceof Error ? error.message : String(error));
      if (clipboardErrorDialog?.isConnected && !clipboardErrorDialog.open) clipboardErrorDialog.showModal();
    } finally { setClipboardBusy(false); }
  }
  let openConstantMuGenerator;
  let tabsViewport;
  let tabsHeader;
  let tabsScrollbar;
  let tabsScrollTrack;
  let linkedTabsScrollbar;
  let tasksContent;
  let taskPanelMeasurementFrame;
  let taskPanelMeasurementDisposed = false;

  function measureTaskSummaryBounds() {
    taskPanelMeasurementFrame = undefined;
    linkedTabsScrollbar?.refresh();
    if (activeTab() !== TABS.TASKS.id || !tasksContent) return;

    const regionsButton = tabButtons.get(TABS.REGIONS.id);
    const movesButton = tabButtons.get(TABS.MOVES.id);
    if (!regionsButton || !movesButton) return;

    const regionsRect = regionsButton.getBoundingClientRect();
    const movesRect = movesButton.getBoundingClientRect();
    const contentRect = tasksContent.getBoundingClientRect();
    // Grid coordinates start inside the content border, unlike viewport rects.
    const left = regionsRect.left - contentRect.left - tasksContent.clientLeft;
    const width = movesRect.right - regionsRect.left;
    if (left <= 0 || width <= 0) return;

    setTaskSummaryBounds((previous) =>
      previous?.left === left && previous?.width === width
        ? previous
        : { left, width },
    );
  }

  function scheduleTaskPanelMeasurement() {
    if (taskPanelMeasurementDisposed || taskPanelMeasurementFrame !== undefined) return;
    taskPanelMeasurementFrame = requestAnimationFrame(measureTaskSummaryBounds);
  }

  createEffect(() => {
    // The active button becomes bold and can change the flex row's geometry.
    if (activeTab() !== TABS.TASKS.id && tabsViewport) {
      tabsViewport.scrollLeft = 0;
    }
    scheduleTaskPanelMeasurement();
  });

  onMount(() => {
    onCleanup(installBrowserContextMenuSuppression(document));
    onCleanup(installHorizontalDragScroll(tabsViewport));
    linkedTabsScrollbar = installLinkedHorizontalScrollbar({
      viewport: tabsViewport,
      scrollbar: tabsScrollbar,
      track: tabsScrollTrack,
      isEnabled: () => activeTab() === TABS.TASKS.id,
    });
    onCleanup(() => linkedTabsScrollbar.dispose());
    onCleanup(installModelSaveShortcut({
      target: window,
      isEnabled: () => activeTab() !== TABS.TASKS.id
        && !document.activeElement?.closest(".om-client-window"),
      onSave: async () => {
        const task = selectionService.loadedTaskHandle();
        const version = selectionService.taskDataVersion();
        const editor = editorControllers.get(activeTab());
        if (!task || selectionService.loadedTaskIsDemo() || savePending()) return;
        document.activeElement?.blur();
        await new Promise(resolve => setTimeout(resolve, 0));
        await editor?.flush();
        if (task === selectionService.loadedTaskHandle() && version === selectionService.taskDataVersion()) {
          await handleSave();
        }
      },
    }));
    const observer = new ResizeObserver(scheduleTaskPanelMeasurement);
    observer.observe(tabsViewport);
    observer.observe(tabsHeader);
    observer.observe(tasksContent);
    tabButtons.forEach((button) => observer.observe(button));
    window.addEventListener("resize", scheduleTaskPanelMeasurement);
    document.fonts?.addEventListener("loadingdone", scheduleTaskPanelMeasurement);
    document.fonts?.ready.then(scheduleTaskPanelMeasurement);
    scheduleTaskPanelMeasurement();

    onCleanup(() => {
      taskPanelMeasurementDisposed = true;
      observer.disconnect();
      window.removeEventListener("resize", scheduleTaskPanelMeasurement);
      document.fonts?.removeEventListener("loadingdone", scheduleTaskPanelMeasurement);
      cancelAnimationFrame(taskPanelMeasurementFrame);
    });
  });

  // The companion belongs to the same task snapshot, not to a separate editor.
  const jweakLoader = createJweakLocalLoader(data => modelService.setJweakLocal(data));
  createEffect(() => {
    const taskHandle = selectionService.loadedTaskHandle();
    selectionService.taskDataVersion();
    void jweakLoader.load(taskHandle);
  });
  onCleanup(() => jweakLoader.dispose());

  async function refreshJweakForMed() {
    const task = selectionService.loadedTaskHandle(), version = selectionService.taskDataVersion();
    const section = await loadJweakLocal(task);
    if (task !== selectionService.loadedTaskHandle() || version !== selectionService.taskDataVersion()) return false;
    const signature = value => JSON.stringify([value?.status, value?.data, value?.error]);
    if (signature(section) !== signature(modelService.getModel().jweakLocal)) modelService.setJweakLocal(section);
    return true;
  }

  const [sidePanelOpen, setSidePanelOpen] = createSignal(false);
  const [materialRequest, setMaterialRequest] = createSignal(null);
  const [geometryViewerOpen, setGeometryViewerOpen] = createSignal(false);
  const [medOpen, setMedOpen] = createSignal(false);
  const [medRequest, setMedRequest] = createSignal(null);
  const [medResult, setMedResult] = createSignal(null);
  const [medBusy, setMedBusy] = createSignal(false);
  const [medApplying, setMedApplying] = createSignal(false);
  const [medError, setMedError] = createSignal("");
  const [medNotice, setMedNotice] = createSignal("");
  const [medNavigation, setMedNavigation] = createSignal(null);
  let medWorker = null;
  let medEditor = null;
  const [coilTask,setCoilTask]=createSignal(null),[coilBusy,setCoilBusy]=createSignal(false);
  const [coilError,setCoilError]=createSignal(""),[coilNotice,setCoilNotice]=createSignal("");
  let coilRevision=0;
  function closeCoil(){coilRevision++;setCoilTask(null);setCoilBusy(false);}
  function openCoil(){setCoilError("");setCoilNotice("");setCoilTask(selectionService.loadedTaskHandle());setSidePanelOpen(false);}
  createEffect(()=>{if(coilTask() && coilTask()!==selectionService.loadedTaskHandle())closeCoil();});
  onCleanup(()=>{coilRevision++;});
  async function addCoil(params) {
    if(coilBusy()||!coilTask())return;
    const task=coilTask(),revision=++coilRevision;setCoilBusy(true);setCoilError("");setCoilNotice("");
    try {
      await medEditor?.flush();
      if(revision!==coilRevision||task!==selectionService.loadedTaskHandle()||task!==coilTask())return;
      const elementSchema=tabRegistry.find(s=>s.id===TABS.ELEMENTS.id),mhjSchema=tabRegistry.find(s=>s.id===TABS.MHJ.id);
      const result=applyUniformFieldCoil({modelService,params,elementSchema,mhjSchema,
        createElement:()=>dataService.createDefaultRecord(elementSchema)});
      setCoilNotice(`Добавлена катушка: элемент №${result.recordIndex+1}. Отмена — одной операцией Undo.`);
      await performModelValidation({restart:true});
    }catch(error){if(revision===coilRevision)setCoilError(error.message||String(error));}
    finally{if(revision===coilRevision)setCoilBusy(false);}
  }
  let medRevision = 0;
  let medAnalysisResolve = null;
  const medStale = () => Boolean(medRequest()) && !medRequestIsCurrent(
    medRequest(), modelService.getModel(), selectionService.loadedTaskHandle(),
  );
  const medCanNavigate = createMemo(() => Boolean(medResult()) && medRequestCanNavigate(
    medRequest(), modelService.getModel(), selectionService.loadedTaskHandle(), medEditor?.rows(),
  ));
  function stopMedWorker() {
    medWorker?.terminate(); medWorker = null; setMedBusy(false);
    medAnalysisResolve?.(null); medAnalysisResolve = null;
  }
  function closeMed() {
    medRevision += 1; stopMedWorker(); setMedOpen(false);
  }
  async function analyzeCurrentMed({preserveResult=false}={}) {
    const revision = ++medRevision;
    stopMedWorker(); setMedOpen(true); setMedBusy(true);
    if (!preserveResult) { setMedResult(null); setMedRequest(null); }
    setMedError(""); setMedNotice("");
    try {
      await medEditor?.flush();
      if (revision !== medRevision || !medOpen()) return null;
      if (!await refreshJweakForMed() || revision !== medRevision || !medOpen()) return null;
      const request = createMedRequest(modelService.getModel(), selectionService.loadedTaskHandle(),medEditor?.rows());
      if (revision !== medRevision || !medOpen()) return null;
      if (!medRequestIsCurrent(request, modelService.getModel(), selectionService.loadedTaskHandle())) {
        stopMedWorker(); setMedError("Исходные данные изменились во время анализа. Повторите анализ MED."); return null;
      }
      if (!preserveResult) setMedRequest(request);
      const worker = new Worker(new URL("./workers/medAnalysis.worker.js", import.meta.url), {type:"module"});
      medWorker = worker;
      const completed = new Promise(resolve=>{ medAnalysisResolve=resolve; });
      worker.onmessage = ({data}) => {
        if (revision !== medRevision || medWorker !== worker) return;
        const resolve = medAnalysisResolve; medAnalysisResolve = null;
        stopMedWorker();
        if (!medRequestIsCurrent(request,modelService.getModel(),selectionService.loadedTaskHandle())) {
          resolve?.(null); return;
        }
        if (data.error) { setMedError(data.error); resolve?.(null); }
        else { setMedRequest(request); setMedResult(data.result); resolve?.({request,result:data.result}); }
      };
      worker.onerror = event => {
        if (revision !== medRevision || medWorker !== worker) return;
        stopMedWorker(); setMedError(event.message || "Не удалось выполнить анализ MED.");
      };
      worker.postMessage(request.snapshot);
      setSidePanelOpen(false);
      return await completed;
    } catch(error) {
      if (revision !== medRevision) return null;
      stopMedWorker(); setMedError(error.message || String(error));
      return null;
    }
  }
  async function applyCurrentMed() {
    if (medApplying() || medBusy()) return;
    const applyingRequest = medRequest();
    setMedApplying(true);
    try {
      await medEditor?.flush();
      if (!medOpen() || applyingRequest !== medRequest()) return;
      if (!await refreshJweakForMed() || !medOpen() || applyingRequest !== medRequest()) return;
      let request = medRequest(), result = medResult();
      if (!request) throw new Error("Сначала выполните анализ MED.");
      if (request.taskKey !== selectionService.loadedTaskHandle()) return;
      if (!medRequestIsCurrent(request,modelService.getModel(),selectionService.loadedTaskHandle())) {
        const analyzed = await analyzeCurrentMed({preserveResult:true});
        if (!analyzed) return;
        ({request,result}=analyzed);
      }
      if (!medOpen() || request !== medRequest() || request.taskKey !== selectionService.loadedTaskHandle()) return;
      const changed = applyMedResult({request,result,modelService,
        schema:tabRegistry.find(s=>s.id===TABS.ELEMENTS.id),taskKey:selectionService.loadedTaskHandle()});
      if (!changed) { setMedNotice("Изменений MED не требуется."); return; }
      setMedRequest(null); setMedResult(null); setMedNavigation(null);
      setMedNotice("MED применён. Изменение можно отменить через Undo на вкладке элементов.");
      await performModelValidation({restart:true});
    } catch(error) { setMedError(error.message || String(error)); }
    finally { setMedApplying(false); }
  }
  async function navigateCurrentMed(block,face) {
    const request = medRequest();
    await medEditor?.flush();
    if (request !== medRequest() || medBusy() || !medCanNavigate()) return;
    setActiveTab(TABS.ELEMENTS.id);
    setMedNavigation({block,face,request,row:medEditor?.rows()?.[block-1]});
  }
  createEffect(() => {
    const request = medRequest();
    if (request && request.taskKey !== selectionService.loadedTaskHandle()) {
      closeMed(); setMedRequest(null); setMedResult(null); setMedNavigation(null);
    } else if (medStale()) {
      medRevision += 1; stopMedWorker();
      if (!medCanNavigate()) setMedNavigation(null);
    }
  });
  onCleanup(() => { medRevision += 1; stopMedWorker(); });
  const [selectedGeometryElementIndices, setSelectedGeometryElementIndices] =
    createSignal([]);
  const [selectedGeometryRegionIndices, setSelectedGeometryRegionIndices] =
    createSignal([]);
  let geometryViewerButton;
  let modelValidationRevision = 0;
  let observedGeometryTaskHandle;

  const [validationPending, setValidationPending] = createSignal(null);
  const [validationFeedback, setValidationFeedback] = createSignal(null);
  let validationFeedbackTimer;
  let validationContextVersion = 0;

  function clearValidationFeedback() {
    clearTimeout(validationFeedbackTimer);
    validationFeedbackTimer = undefined;
    setValidationFeedback(null);
  }

  createEffect(() => {
    selectionService.loadedTaskHandle();
    modelService.getModel();
    validationContextVersion += 1;
    clearValidationFeedback();
  });

  onCleanup(() => {
    validationContextVersion += 1;
    clearValidationFeedback();
  });

  function isValidationContextCurrent(context) {
    return context.version === validationContextVersion
      && context.revision === modelValidationRevision
      && context.taskHandle === selectionService.loadedTaskHandle()
      && context.modelSnapshot === modelService.getModel();
  }

  function showValidationFeedback(context, status, message) {
    if (!isValidationContextCurrent(context)) return;

    clearValidationFeedback();
    setValidationFeedback({ status, message });
    validationFeedbackTimer = setTimeout(clearValidationFeedback, 3000);
  }

  const [savePending, setSavePending] = createSignal(null);
  const [saveFeedback, setSaveFeedback] = createSignal(null);
  let saveFeedbackTimer;
  let saveContextVersion = 0;

  function clearSaveFeedback() {
    clearTimeout(saveFeedbackTimer);
    saveFeedbackTimer = undefined;
    setSaveFeedback(null);
  }

  createEffect(() => {
    selectionService.loadedTaskHandle();
    modelService.getModel();
    saveContextVersion += 1;
    clearSaveFeedback();
  });

  onCleanup(() => {
    saveContextVersion += 1;
    clearSaveFeedback();
  });

  function showSaveFeedback(context, status, message) {
    if (
      context.version !== saveContextVersion
      || context.taskHandle !== selectionService.loadedTaskHandle()
      || context.modelSnapshot !== modelService.getModel()
    ) return;

    clearSaveFeedback();
    setSaveFeedback({ status, message });
    saveFeedbackTimer = setTimeout(clearSaveFeedback, 3000);
  }

  async function collectModelDiagnostics(taskHandle, modelSnapshot) {
    const materialResult = await loadMaterialReferenceCatalog(taskHandle);
    // This companion is edited outside GUI. Validate its current contents,
    // without requiring equality to the copy read when the task was opened.
    const checkedSnapshot = { ...modelSnapshot, jweakLocal: await loadJweakLocal(taskHandle) };
    const diagnostics = modelValidator(
      { getModel: () => checkedSnapshot },
      { materialCatalog: materialResult.catalog },
    );
    diagnostics.push(...materialResult.errors.map(message => createError({
      tab: TABS.ELEMENTS,
      property: "xapName",
      message: `Проверка ссылок на характеристики не завершена: ${message}`,
    })));
    return diagnostics;
  }

  async function handleModelValidation() {
    return performModelValidation();
  }

  async function performModelValidation({restart=false} = {}) {
    const taskHandle = selectionService.loadedTaskHandle();
    if (!taskHandle || (validationPending() && !restart)) return;

    const modelSnapshot = modelService.getModel();
    const context = {
      version: validationContextVersion,
      revision: ++modelValidationRevision,
      taskHandle,
      modelSnapshot,
    };
    setValidationPending(context);
    clearValidationFeedback();

    try {
      const diagnostics = await collectModelDiagnostics(
        taskHandle,
        modelSnapshot,
      );
      if (!isValidationContextCurrent(context)) return;

      diagnosticService.setValidationResult(diagnostics);
      showValidationFeedback(
        context,
        "success",
        "Проверка модели завершена. Результат — в диагностике.",
      );
    } catch (error) {
      if (!isValidationContextCurrent(context)) return;

      const message = "Не удалось завершить проверку модели: "
        + (error?.message ?? String(error));
      diagnosticService.setValidationResult([createError({ message })]);
      showValidationFeedback(context, "error", message);
      console.error("Не удалось завершить проверку модели", error);
    } finally {
      if (validationPending() === context) setValidationPending(null);
    }
  }

  const tabs = [
    {
      id: TABS.TASKS.id,
      label: "Выбор задания",
      component: (props) => (
        <Tasks
          onTaskActionsChange={setTaskActions}
          editorBusy={Boolean(savePending() || validationPending())}
          active={props.active}
          summaryBounds={taskSummaryBounds()}
          onReturnToEditing={props.onReturnToEditing}
          onValidate={handleModelValidation}
          onSave={handleSave}
          onOpenTab={setActiveTab}
        />
      ),
      historyEnabled: false,
      changeIndicator: false,
    },

    ...tabRegistry.map((schema) => ({
      id: schema.id,
      label: schema.title,
      component: (props) => (
        <DataEditor
          schema={schema}
          active={props.active}
          computedColumnsMode={props.computedColumnsMode}
          onEditorReady={controller => {
            if (controller) editorControllers.set(schema.id, controller);
            else editorControllers.delete(schema.id);
          }}
          onRecordSelectionChange={handleGeometryRecordSelectionChange}
          medNavigation={schema.id===TABS.ELEMENTS.id ? medNavigation() : null}
          onMedEditorReady={schema.id===TABS.ELEMENTS.id ? (editor)=>{medEditor=editor;} : undefined}
        />
      ),
    })),

    ...materialTabRegistry.map((definition) => ({
      id: definition.id,
      label: definition.label,
      historyController: materialLibraryHistoryService,
      component: (props) => (
        <MaterialLibraryTab
          definition={definition}
          active={props.active}
          onConstantMuGeneratorReady={definition.kind === "FMM" ? open => { openConstantMuGenerator = open; } : undefined}
        />
      ),
    })),
  ];
  const activeTabDefinition = () =>
    tabs.find((tab) => tab.id === activeTab());
  const historyTabId = () =>
    activeTabDefinition()?.historyEnabled === false
      ? null
      : activeTab();
  const historyTabLabel = () =>
    tabs.find((tab) => tab.id === activeTab())?.label ?? "";
  const historyController = () =>
    activeTabDefinition()?.historyController ?? modelService;
  const materialActionVisible = () => activeTab() === TABS.ELEMENTS.id;
  const materialActionEnabled = () =>
    materialActionVisible()
    && Boolean(selectionService.loadedTaskHandle())
    && selectionContextService.selectedRows().length > 0;
  const geometryModel = createMemo((previous) => {
    const model = modelService.getModel();

    if (
      previous?.general === model.general
      && previous?.elements === model.elements
      && previous?.regions === model.regions
    ) {
      return previous;
    }

    return {
      general: model.general,
      elements: model.elements,
      regions: model.regions,
    };
  });
  const geometrySelections = createMemo(() => ({
    elements: selectedGeometryElementIndices(),
    regions: selectedGeometryRegionIndices(),
  }));
  // Source-table edits must not invalidate the moving geometry projection.
  const geometryMoves = createMemo(() => modelService.getModel().moves);

  function sameRecordIndices(left, right) {
    return left.length === right.length &&
      left.every((value, index) => value === right[index]);
  }

  function updateGeometrySelection(setSelection, recordIndices) {
    const next = Array.isArray(recordIndices) ? [...recordIndices] : [];
    setSelection((current) =>
      sameRecordIndices(current, next) ? current : next
    );
  }

  function handleGeometryRecordSelectionChange(schemaId, recordIndices) {
    if (schemaId === TABS.ELEMENTS.id) {
      updateGeometrySelection(
        setSelectedGeometryElementIndices,
        recordIndices,
      );
    } else if (schemaId === TABS.REGIONS.id) {
      updateGeometrySelection(
        setSelectedGeometryRegionIndices,
        recordIndices,
      );
    }
  }

  createEffect(() => {
    const taskHandle = selectionService.loadedTaskHandle();
    if (taskHandle === observedGeometryTaskHandle) return;

    observedGeometryTaskHandle = taskHandle;
    setSelectedGeometryElementIndices([]);
    setSelectedGeometryRegionIndices([]);
  });

  function handleMaterialSelectionOpen() {
    try {
      setMaterialRequest(
        selectedElementMaterialRequest(
          selectionContextService.getActiveTable(),
        ),
      );
    } catch (error) {
      setMaterialRequest({
        error: error instanceof Error ? error.message : String(error),
      });
    }
    setSidePanelOpen(false);
  }

  async function handleMaterialSelectionApply(name) {
    const request = materialRequest();
    try {
      await assignSelectedElementMaterial(request, name);
      setMaterialRequest(null);
    } catch (error) {
      setMaterialRequest({
        ...request,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function handleMakeElementsNonmagnetic() {
    try {
      const request = selectedElementsRequest(
        selectionContextService.getActiveTable(),
      );
      await clearSelectedElementMaterials(request);
      setSidePanelOpen(false);
    } catch (error) {
      console.error("Не удалось сделать элементы немагнитными", error);
    }
  }

  async function handleSave() {
    const dirHandle = selectionService.loadedTaskHandle();
    if (!dirHandle || selectionService.loadedTaskIsDemo() || savePending()) return;

    const taskDataVersion = selectionService.taskDataVersion();
    const modelSnapshot = modelService.getModel();
    const validationRevision = ++modelValidationRevision;
    const context = {
      version: saveContextVersion,
      taskHandle: dirHandle,
      modelSnapshot,
    };
    let feedbackResult;
    setSavePending(context);
    clearSaveFeedback();

    try {
      try {
        await taskApprovalService.markUnapproved(dirHandle);
      } catch (error) {
        feedbackResult = {
          status: "error",
          message: "Сохранение отменено: не удалось подготовить запись. "
            + (error?.message ?? String(error)),
        };
        console.error(
          "Сохранение отменено: не удалось создать маркер проверки",
          error,
        );
        return;
      }

      let saveFailed = false;
      let savedCount = 0;
      const saveErrors = [];
      for (const schema of tabRegistry) {
        const itemModel = modelSnapshot[schema.id];
        try {
          const saved = await dataService.save(
            dirHandle,
            schema,
            itemModel,
          );
          if (!saved) {
            saveFailed = true;
            // Отсутствующая необязательная вкладка не требует записи.
            if (itemModel != null || schema.config.required) {
              saveErrors.push(schema.title);
            }
            console.warn(`Не сохранена вкладка '${schema.id}'`);
            continue;
          }
          savedCount += 1;
          if (
            dirHandle === selectionService.loadedTaskHandle() &&
            taskDataVersion === selectionService.taskDataVersion()
          ) {
            unsavedChangesService.setBaseline(schema.id, itemModel);
            unsavedChangesService.setExplicitDirty(schema.id, false);
          }
        } catch (error) {
          saveFailed = true;
          saveErrors.push(`${schema.title}: ${error?.message ?? String(error)}`);
          console.warn(`Не удалось сохранить '${schema.id}'`, error);
        }
      }

      // Publish only after all present input files were written successfully.
      // Missing optional tabs retain the existing approval-marker semantics.
      if (saveErrors.length === 0 && savedCount > 0) {
        try {
          await writeTaskSummary(dirHandle, modelSnapshot);
        } catch (error) {
          feedbackResult = { status: "error", message: "Не удалось сохранить _summary.txt: "
            + (error?.message ?? String(error)) };
          return;
        }
      }

      feedbackResult = saveErrors.length > 0 || savedCount === 0
        ? {
          status: "error",
          message: saveErrors.length > 0
            ? `Не удалось сохранить вкладки: ${saveErrors.join("; ")}`
            : "Нет данных для сохранения",
        }
        : { status: "success", message: "Данные модели сохранены" };
      if (saveFailed) return;

      let diagnostics;
      try {
        diagnostics = await collectModelDiagnostics(
          dirHandle,
          modelSnapshot,
        );
      } catch (error) {
        console.error(
          "Маркер проверки сохранён: проверка модели не завершена",
          error,
        );
        return;
      }

      if (
        validationRevision === modelValidationRevision
        && dirHandle === selectionService.loadedTaskHandle()
        && modelSnapshot === modelService.getModel()
      ) {
        diagnosticService.setValidationResult(diagnostics);
      }

      const hasErrors = diagnostics.some(
        diagnostic => diagnostic.level === VALIDATION_LEVELS.ERROR,
      );
      if (hasErrors) return;

      try {
        await taskApprovalService.clearUnapproved(dirHandle);
      } catch (error) {
        console.error(
          "Данные сохранены без ошибок, но маркер проверки не удалён",
          error,
        );
      }
    } finally {
      setSavePending(null);
      if (feedbackResult) {
        showSaveFeedback(context, feedbackResult.status, feedbackResult.message);
      }
    }
  }

  function runHistoryAction(action) {
    void Promise.resolve()
      .then(action)
      .catch(error => console.error("History action error:", error));
  }

  function handleReturnToEditing() {
    const firstDirtyTab = unsavedChangesService.dirtyTabIds(
      tabs.filter(tab => tab.changeIndicator !== false).map(tab => tab.id),
    )[0];
    if (firstDirtyTab) setActiveTab(firstDirtyTab);
  }

  return (
    <div class="app-container">
      <TaskInfoBar
        path={selectionService.loadedTaskPath()}
        isDemo={selectionService.loadedTaskIsDemo()}
        onValidate={handleModelValidation}
        validationBusy={Boolean(validationPending())}
        validating={Boolean(validationPending())
          && validationPending().taskHandle === selectionService.loadedTaskHandle()}
        validationFeedback={validationFeedback()}
        onSave={handleSave}
        saveBusy={Boolean(savePending())}
        saving={Boolean(savePending())
          && savePending().taskHandle === selectionService.loadedTaskHandle()}
        saveFeedback={saveFeedback()}
        menuOpen={sidePanelOpen()}
        onMenuToggle={() => setSidePanelOpen((open) => !open)}
        geometryViewerOpen={geometryViewerOpen()}
        geometryViewerButtonRef={(element) => {
          geometryViewerButton = element;
        }}
        onGeometryViewerToggle={() => {
          setGeometryViewerOpen((open) => !open);
        }}
      />
      <SidePanel
        clipboardTableActions={clipboardTableActions()}
        clipboardTableEnabled={Boolean(selectionService.loadedTaskHandle()) && !clipboardBusy()}
        onReplaceTableFromClipboard={replaceTableFromClipboard}
        taskActions={activeTab() === TABS.TASKS.id ? taskActions() : null}
        onTaskAction={kind => { setSidePanelOpen(false); taskActions()?.run(kind); }}
        open={sidePanelOpen()}
        onClose={() => setSidePanelOpen(false)}
        computedColumnsMode={viewSettingsService.computedColumnsMode()}
        onComputedColumnsModeChange={
          viewSettingsService.setComputedColumnsMode
        }
        historyTabLabel={historyTabLabel()}
        historyEnabled={historyTabId() !== null}
        canUndo={historyController().canUndo(historyTabId())}
        canRedo={historyController().canRedo(historyTabId())}
        onUndo={() => runHistoryAction(
          () => historyController().undo(historyTabId()),
        )}
        onRedo={() => runHistoryAction(
          () => historyController().redo(historyTabId()),
        )}
        materialActionVisible={materialActionVisible()}
        materialActionEnabled={materialActionEnabled()}
        onChooseMaterial={handleMaterialSelectionOpen}
        medActionEnabled={Boolean(selectionService.loadedTaskHandle()) && Array.isArray(modelService.getModel().elements)}
        onAutofillMed={analyzeCurrentMed}
        onCreateUniformFieldCoil={openCoil}
        onCreateConstantMu={() => { setSidePanelOpen(false); openConstantMuGenerator?.(); }}
        onMakeNonmagnetic={handleMakeElementsNonmagnetic}
      />
      <div
        class="tabs-viewport"
        ref={tabsViewport}
        classList={{ "tasks-active": activeTab() === TABS.TASKS.id }}
      >
        <div class="tabs-frame">
          <div class="tabs-header" ref={tabsHeader}>
            <For each={tabs}>
              {(tab) => (
                <button
                  ref={(element) => tabButtons.set(tab.id, element)}
                  classList={{
                    active: activeTab() === tab.id,
                  }}
                  onClick={() => {
                    setActiveTab(tab.id);
                  }}
                >
                  <span class="tab-label">{tab.label}</span>
                  {tab.changeIndicator !== false && (
                    <span
                      classList={{
                        "tab-change-indicator": true,
                        dirty: unsavedChangesService.isDirty(tab.id),
                      }}
                      title={unsavedChangesService.isDirty(tab.id)
                        ? "Есть несохранённые изменения"
                        : "Нет несохранённых изменений"}
                      aria-label={unsavedChangesService.isDirty(tab.id)
                        ? "Есть несохранённые изменения"
                        : "Нет несохранённых изменений"}
                    />
                  )}
                </button>
              )}
            </For>
          </div>

          <div
            class="tabs-scrollbar"
            ref={tabsScrollbar}
            hidden
            tabIndex="0"
            role="region"
            aria-label="Горизонтальная прокрутка вкладок и панелей задания"
          >
            <div class="tabs-scroll-track" ref={tabsScrollTrack} aria-hidden="true" />
          </div>

          <For each={tabs}>
            {(tab) => {
              const Component = tab.component;
              return (
                <div
                  class="tab-content"
                  ref={(element) => {
                    if (tab.id === TABS.TASKS.id) tasksContent = element;
                  }}
                  style={{
                    display: activeTab() === tab.id ? "block" : "none",
                  }}
                >
                  <Component
                    active={activeTab() === tab.id}
                    computedColumnsMode={
                      viewSettingsService.computedColumnsMode()
                    }
                    onReturnToEditing={handleReturnToEditing}
                  />
                </div>
              );
            }}
          </For>
        </div>
      </div>
      <MaterialSelectionDialog
        request={materialRequest()}
        taskHandle={selectionService.loadedTaskHandle()}
        onCancel={() => setMaterialRequest(null)}
        onApply={handleMaterialSelectionApply}
      />
      <dialog ref={clipboardErrorDialog} class="clipboard-table-error" aria-label="Ошибка вставки таблицы">
        <h2>Вставка не выполнена</h2>
        <p role="alert">{clipboardError()}</p>
        <button onClick={() => clipboardErrorDialog.close()}>Закрыть</button>
      </dialog>
      <GeometryViewerWindow
        open={geometryViewerOpen()}
        model={geometryModel()}
        moves={geometryMoves()}
        amplitudes={modelService.getModel().amps}
        taskKey={selectionService.loadedTaskHandle()}
        prescribedSources={modelService.getModel().mhj}
        selections={geometrySelections()}
        onClose={() => {
          setGeometryViewerOpen(false);
          geometryViewerButton?.focus();
        }}
      />
      <MedAutofillDialog open={medOpen()} busy={medBusy()} applying={medApplying()} stale={medStale()}
        navigationEnabled={!medBusy()&&medCanNavigate()}
        result={medResult()} error={medError()} notice={medNotice()}
        onAnalyze={analyzeCurrentMed} onApply={applyCurrentMed} onClose={closeMed}
        onNavigate={navigateCurrentMed}
      />
      <UniformFieldCoilDialog open={!!coilTask()} model={modelService.getModel()} busy={coilBusy()}
        error={coilError()} notice={coilNotice()} onApply={addCoil} onClose={closeCoil}/>
    </div>
  );
}
