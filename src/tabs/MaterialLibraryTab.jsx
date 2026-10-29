import {
  createEffect,
  createMemo,
  untrack,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { TabulatorFull as Tabulator } from "tabulator-tables";

import { FmmGraphRegion } from "../components/materials/FmmGraphRegion.jsx";
import { MaterialDeleteConfirmationDialog } from "../components/materials/MaterialDeleteConfirmationDialog.jsx";
import { ConstantMuFmmDialog } from "../components/materials/ConstantMuFmmDialog.jsx";
import { matchesConstantMuRecord, saveConstantMuFmm } from "../services/materials/constantMuFmm.js";
import { FmmClipboardDialog } from "../components/materials/FmmClipboardDialog.jsx";
import { modelToRows } from "../tabulator/converters/modelConverter";
import { TableBuilder } from "../tabulator/builders/TableBuilder";
import { DetailRegion } from "../tabulator/views/DetailRegion";
import { HtsMaterialDetailView } from "../tabulator/views/HtsMaterialDetailView.js";
import { TableView } from "../tabulator/views/TableView";
import { COMMON_TABLE_OPTIONS } from "../tabulator/tableOptions";
import { FIELD_TYPES } from "../services/schemas/common/constants";
import { loadTaskMaterialLibrary } from "../services/materials/materialLibraryService.js";
import { selectionService } from "../services/selectionService";
import { materialLibraryRevisionService } from "../services/materialLibraryRevisionService.js";
import {
  MaterialBatchConflictError,
  MaterialBatchWriteError,
  taskMaterialLibraryService,
} from "../services/taskMaterialLibraryService";
import { findLocalXap, importUsedFmmMaterials } from "../services/taskImportMaterialsService.js";
import { modelService } from "../services/modelService.js";
import { diagnosticService } from "../services/diagnosticService.js";
import { createFmmMaterialFile } from "../services/materialImport/xapLibImporter.js";
import { createHtsMaterialFile } from "../services/materialImport/htsConfigImporter.js";
import { materialLibraryHistoryService } from "../services/materialLibraryHistoryService.js";
import { unsavedChangesService } from "../services/unsavedChangesService.js";
import {
  resizedDetailRatio,
  resizedLowerHeight,
} from "../services/materials/materialLibraryLayout.js";
import { createMaterialLibraryLoadQueue } from "../services/materials/materialLibraryLoadQueue.js";
import {
  createEmptyFmmMaterial,
  parseFmmClipboardText,
  saveFmmClipboardBlock,
} from "../services/materials/fmmTableInput.js";
import {
  getFilePickerErrorMessage,
} from "../services/fileSystemAccessSupport";

import "tabulator-tables/dist/css/tabulator.min.css";
import "./MaterialLibraryTab.css";

function withoutRowLabel(rowData) {
  const { rowLabel, ...record } = rowData;
  return record;
}
function editableMaterialSchema(schema) {
  return {
    ...schema,
    properties: Object.fromEntries(
      Object.entries(schema.properties).map(([name, property]) => [
        name,
        property.type === FIELD_TYPES.ARRAY
          ? {
              ...property,
              readonly: false,
              items: { ...property.items, readonly: false },
            }
          : { ...property, readonly: false },
      ]),
    ),
  };
}

function replacementQuestion(title, conflicts) {
  const limit = 10;
  const paths = conflicts
    .slice(0, limit)
    .map(conflict => `• ${conflict.path}`);
  if (conflicts.length > limit) {
    paths.push(`• …и ещё ${conflicts.length - limit}`);
  }

  return `${title}\n\n${paths.join("\n")}\n\nЗаменить эти файлы?`;
}

function writeSummary(prefix, results) {
  const counts = {
    created: 0,
    replaced: 0,
    unchanged: 0,
  };
  for (const result of results ?? []) {
    if (result?.status in counts) {
      counts[result.status] += 1;
    }
  }
  return `${prefix}: создано — ${counts.created}, заменено — `
    + `${counts.replaced}, без изменений — ${counts.unchanged}.`;
}

function actionErrorMessage(error, action) {
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    return getFilePickerErrorMessage(error, action);
  }
  return error instanceof Error ? error.message : String(error);
}

function partialWriteMessage(summary, error) {
  return `${summary}: обработано — ${error.written.length}; `
    + `не удалось записать «${error.failed.path}»; `
    + `осталось — ${error.remaining.length}. `
    + "Проверьте доступ к каталогу задания и повторите операцию.";
}

export function MaterialLibraryTab(props) {
  const definition = props.definition;
  const schema = definition.schema;
  const taskHandle = selectionService.loadedTaskHandle;
  const isFmm = definition.kind === "FMM";
  const tableSchema = editableMaterialSchema(schema);

  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  const [selectedRecords, setSelectedRecords] = createSignal([]);
  const [actionBusy, setActionBusy] = createSignal(false);
  const [actionMessage, setActionMessage] = createSignal("");
  const [actionError, setActionError] = createSignal("");
  // A fresh session also handles A -> B -> A: an old manual choice must not
  // override the local default of a newly loaded task. No DOM change event
  // or asynchronously ordered "auto-switch" effect is required.
  const librarySession = createMemo(() => ({ destination: taskHandle() }));
  const [sourceChoice, setSourceChoice] = createSignal(null);
  const librarySource = createMemo(() => {
    const session = librarySession();
    const choice = sourceChoice();
    return choice?.session === session
      ? choice.source : session.destination ? "task" : "default";
  });
  const [loadedLibrary, setLoadedLibrary] = createSignal(null);
  const [emptyLibrary, setEmptyLibrary] = createSignal(false);
  const [nameFilter, setNameFilter] = createSignal("");
  const [dirtyRecords, setDirtyRecords] = createSignal([]);
  const [deleteRequest, setDeleteRequest] = createSignal(null);
  const [currentFmmRecord, setCurrentFmmRecord] = createSignal(null);
  const [clipboardRequest, setClipboardRequest] = createSignal(null);
  const [constantMuOpen, setConstantMuOpen] = createSignal(false);
  const [legacyFmmStatus, setLegacyFmmStatus] = createSignal("missing");
  const [tableReady, setTableReady] = createSignal(false);
  const [lowerHeight, setLowerHeight] = createSignal(
    definition.detail.defaultHeight ?? 360,
  );
  const [detailRatio, setDetailRatio] = createSignal(0.5);

  let tableHost;
  let lowerRegionHost;
  let detailTitleHost;
  let detailToolbarHost;
  let detailViewHost;
  let table;
  let disposed = false;
  let recordLoadRevision = 0;
  let resizeCleanup = null;
  let redrawFrame = 0;
  let detachHistory = null;
  let applyingHistory = false;
  let appliedLocalRevision = null;

  const detailRegion = new DetailRegion();
  const recordDetailViews = new Map();
  const tableLoadQueue = createMaterialLibraryLoadQueue();

  const isTaskSource = () => librarySource() === "task";
  const recordsReady = () => !loading() && !error()
    && loadedLibrary()?.session === librarySession()
    && loadedLibrary()?.source === librarySource();
  const canEditLibrary = () => isTaskSource() && recordsReady() && !actionBusy() && !clipboardRequest();

  // Own writes are already applied to the live table. Consuming this revision
  // avoids a reload that would discard edits to other local characteristics.
  function notifyAppliedLibraryChange() {
    appliedLocalRevision = {
      session: librarySession(),
      revision: untrack(() => materialLibraryRevisionService.revision(definition.kind)) + 1,
    };
    diagnosticService.invalidateDiagnostics();
    materialLibraryRevisionService.notifyChanged(definition.kind);
  }

  function beginAction() {
    setActionBusy(true);
    setActionMessage("");
    setActionError("");
  }

  function endAction() {
    setActionBusy(false);
  }

  function selectedTableRecords(rows) {
    return rows.map(row => row.getData());
  }

  function applyNameFilter(value) {
    const normalized = String(value ?? "").trim().toLocaleLowerCase("ru-RU");
    if (!table) return;

    if (normalized === "") {
      table.clearFilter();
      return;
    }

    table.setFilter(record =>
      String(record?.name ?? "")
        .toLocaleLowerCase("ru-RU")
        .includes(normalized)
    );
  }

  function handleNameFilterInput(event) {
    const value = event.currentTarget.value;
    setNameFilter(value);
    applyNameFilter(value);
  }

  function clearNameFilter() {
    setNameFilter("");
    applyNameFilter("");
  }

  function taskRecordKey(record) {
    return record?._taskLibraryRecord?.relativePath
      ?? record?._taskLibraryRecord?.fileName
      ?? null;
  }

  function captureLibrarySnapshot() {
    const dirtyKeys = dirtyRecords()
      .map(taskRecordKey)
      .filter(Boolean);
    return {
      records: (table?.getData() ?? []).map(record =>
        structuredClone(withoutRowLabel(record))),
      dirtyKeys,
    };
  }

  function recordLibraryChange(before, after) {
    if (!canEditLibrary() || applyingHistory) return;
    materialLibraryHistoryService.record(schema, before, after);
  }

  async function applyLibrarySnapshot(snapshot) {
    if (!canEditLibrary() || !Array.isArray(snapshot?.records)) {
      throw new Error(
        "История локальной библиотеки не соответствует текущему источнику.",
      );
    }

    applyingHistory = true;
    clearRenderedRecords();
    setActionMessage("");
    setActionError("");
    try {
      await table.replaceData(modelToRows(tableSchema, snapshot.records));
      const dirtyKeys = new Set(snapshot.dirtyKeys ?? []);
      setDirtyRecords(
        table.getData().filter(record => dirtyKeys.has(taskRecordKey(record))),
      );
    } finally {
      applyingHistory = false;
    }
  }

  function clearLibraryHistory() {
    materialLibraryHistoryService.clear(schema.id);
  }

  function markRecordDirty(record) {
    if (!canEditLibrary() || !record?._taskLibraryRecord) return;
    setDirtyRecords(current =>
      current.includes(record) ? current : [...current, record]);
    setActionMessage("");
    setActionError("");
    setSelectedRecords(selectedTableRecords(table.getSelectedRows()));
  }

  function clearRenderedRecords() {
    setCurrentFmmRecord(null);
    detailRegion.showHint("Выберите характеристику в таблице");
    for (const entry of recordDetailViews.values()) {
      entry.view.destroy();
    }
    recordDetailViews.clear();
    setSelectedRecords([]);
  }

  function createHtsDetail(row) {
    const rowData = row.getData();
    const host = document.createElement("div");
    host.className = "nested-table-view";

    const view = new HtsMaterialDetailView({
      schema: tableSchema,
      record: rowData,
      isWritable: () => canEditLibrary(),
      setValue: async (propertyName, value) => {
        const before = captureLibrarySnapshot();
        await row.update({ [propertyName]: structuredClone(value) });
        markRecordDirty(row.getData());
        recordLibraryChange(before, captureLibrarySnapshot());
      },
    });

    const entry = {
      host,
      view,
      record: rowData,
    };
    recordDetailViews.set(rowData, entry);
    return entry;
  }

  function createPropertyDetail(row) {
    const rowData = row.getData();
    const record = rowData;
    const propertyName = definition.detail.property;
    const property = tableSchema.properties[propertyName];
    const host = document.createElement("div");
    host.className = "nested-table-view";

    const view = new TableView(
      property,
      {
        getSchema: () => tableSchema,
        getValue: () => rowData[propertyName],
        getRecord: () => record,
        getModelSnapshot: () => ({}),
        isWritable: () => canEditLibrary(),
        setValue: async (value) => {
          const before = captureLibrarySnapshot();
          await row.update({
            [propertyName]: structuredClone(value),
          });
          markRecordDirty(row.getData());
          recordLibraryChange(before, captureLibrarySnapshot());
        },
      },
      { primary: true },
    );

    const entry = {
      host,
      property,
      propertyName,
      view,
      record,
    };
    recordDetailViews.set(rowData, entry);
    return entry;
  }

  function showHtsDetail(row) {
    const rowData = row.getData();
    const entry = recordDetailViews.get(rowData)
      ?? createHtsDetail(row);
    const name = entry.record.name || rowData.rowLabel;

    detailRegion.mount(
      entry,
      entry.view,
      `Параметры характеристики — ${name}`,
      entry.host,
      null,
      null,
    );
  }

  function showPropertyDetail(row) {
    const rowData = row.getData();
    setCurrentFmmRecord(rowData);
    const entry = recordDetailViews.get(rowData)
      ?? createPropertyDetail(row);
    const name = entry.record.name || rowData.rowLabel;
    const sourceCell = row.getCell(entry.propertyName);

    detailRegion.mount(
      entry,
      entry.view,
      `${entry.property.label} — ${name}`,
      entry.host,
      entry.propertyName,
      sourceCell,
    );
  }

  function showDetail(row) {
    if (!row) {
      setCurrentFmmRecord(null);
      detailRegion.showHint("Выберите характеристику в таблице");
      return;
    }

    if (definition.detail.type === "property") {
      showPropertyDetail(row);
      return;
    }

    showHtsDetail(row);
  }

  function handleSelectionChanged(_data, rows) {
    setSelectedRecords(selectedTableRecords(rows));
    showDetail(rows.length > 0 ? rows[rows.length - 1] : null);
  }

  function createTable() {
    const columns = TableBuilder.buildColumns(tableSchema);

    for (const column of columns) {
      const property = tableSchema.properties[column.field];
      if (!property || property.type === FIELD_TYPES.ARRAY) continue;
      column.editable = () => canEditLibrary();
    }

    if (definition.detail.type === "property") {
      const propertyName = definition.detail.property;
      const detailColumn = columns.find(
        column => column.field === propertyName,
      );
      if (detailColumn) {
        detailColumn.cellClick = (_event, cell) => {
          showPropertyDetail(cell.getRow());
        };
      }
    }

    table = new Tabulator(tableHost, {
      ...COMMON_TABLE_OPTIONS,
      layout: schema.config.stretchLastColumn
        ? "fitDataStretch"
        : "fitDataFill",
      height: "100%",
      data: [],
      columns,
      selectableRows: true,
      selectableRowsRangeMode: "click",
      selectableRowsPersistence: true,
    });

    table.on("tableBuilt", () => {
      if (!disposed) {
        setTableReady(true);
      }
    });

    table._gui = {
      schema: tableSchema,
      required: false,
      detailRegion,
      model: {
        getSnapshot: () => ({}),
        getRecord: withoutRowLabel,
        setRecordValue: () => undefined,
      },
      structure: {
        mutable: false,
      },
    };

    table.on("rowSelectionChanged", handleSelectionChanged);
    table.on("cellEdited", (cell) => {
      if (!canEditLibrary() || applyingHistory) return;
      const row = cell.getRow();
      const rowIndex = table.getRows().indexOf(row);
      const before = captureLibrarySnapshot();
      if (before.records[rowIndex]) {
        before.records[rowIndex][cell.getField()] = structuredClone(
          cell.getOldValue(),
        );
      }
      markRecordDirty(row.getData());
      recordLibraryChange(before, captureLibrarySnapshot());
      if (cell.getField() === "name" && row.isSelected()) {
        detailTitleHost.textContent = definition.detail.type === "property"
          ? `${tableSchema.properties[definition.detail.property].label} — `
            + String(row.getData().name ?? "")
          : `Параметры характеристики — ${String(row.getData().name ?? "")}`;
      }
    });
  }

  async function loadRecords({
    source = librarySource(),
    destination = taskHandle(),
  } = {}) {
    const revision = ++recordLoadRevision;
    const session = librarySession();
    const isCurrent = () => !disposed && revision === recordLoadRevision
      && session === librarySession() && destination === taskHandle()
      && source === librarySource();
    setLoadedLibrary(null);
    setEmptyLibrary(false);
    clearLibraryHistory();
    setLoading(true);
    setError("");
    setDirtyRecords([]);
    setClipboardRequest(null);
    clearRenderedRecords();

    try {
      await tableLoadQueue.run(() => {
        if (!isCurrent()) return undefined;
        return table.clearData();
      });
      if (!isCurrent()) return;

      const records = source === "task"
        ? destination
          ? await loadTaskMaterialLibrary(definition.kind, destination)
          : []
        : await definition.loadRecords();
      if (!isCurrent()) return;
      const rows = modelToRows(tableSchema, records);
      await tableLoadQueue.run(() => {
        if (!isCurrent()) return undefined;
        return table.setData(rows);
      });
      if (!isCurrent()) return;
      setEmptyLibrary(records.length === 0);
      setLoadedLibrary({ session, source });
    } catch (loadError) {
      if (!isCurrent()) return;
      console.error(`${definition.id} ${source} loading error:`, loadError);
      setError(
        loadError instanceof Error
          ? loadError.message
          : String(loadError),
      );
      await tableLoadQueue.run(() => {
        if (!isCurrent()) return undefined;
        return table.setData([]);
      });
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }

  async function saveGeneratedConstantMu(record) {
    const destination = taskHandle(), session = librarySession();
    if (!isFmm || !destination || selectionService.loadedTaskIsDemo()) {
      throw new Error("Для сохранения требуется локальное задание (не демо).");
    }
    if (!recordsReady() || actionBusy() || clipboardRequest()) {
      throw new Error("Библиотека занята или ещё не загружена. Повторите сохранение после завершения операции.");
    }
    if (dirtyRecords().some(item => matchesConstantMuRecord(item, record.name))) {
      throw new Error(`Характеристика «${record.name}» имеет несохранённые правки. Сначала сохраните или отмените их во вкладке ФММ.`);
    }
    beginAction();
    let saved;
    try {
      saved = await saveConstantMuFmm({ taskHandle: destination, record, service: taskMaterialLibraryService });
      if (disposed || librarySession() !== session) return saved;
      if (isTaskSource()) {
        // Update only the generated record. Other dirty rows must not be reloaded.
        let row = table.getRows().find(item => matchesConstantMuRecord(item.getData(), record.name));
        if (row) {
          const old = row.getData(), entry = recordDetailViews.get(old);
          if (entry) { detailRegion.showHint(); entry.view.destroy(); recordDetailViews.delete(old); }
          await row.update(saved);
        } else {
          [row] = await table.addData(modelToRows(tableSchema, [saved]));
        }
        if (disposed || librarySession() !== session) return saved;
        clearNameFilter(); table.deselectRow(); row.select(); showPropertyDetail(row);
        setEmptyLibrary(false); clearLibraryHistory(); notifyAppliedLibraryChange();
      } else {
        diagnosticService.invalidateDiagnostics();
        materialLibraryRevisionService.notifyChanged(definition.kind);
      }
      return saved;
    } catch (cause) {
      if (saved) throw new Error(`Файл ${saved._taskLibraryRecord.relativePath} записан, но обновление таблицы не завершено: ${cause.message}`);
      throw cause;
    } finally { endAction(); }
  }

  async function createFmmMaterial() {
    if (!isFmm || !canEditLibrary()) return;
    const destination = taskHandle();
    const session = librarySession();
    const isCurrent = () => !disposed && librarySession() === session && isTaskSource();
    beginAction();
    try {
      const record = await createEmptyFmmMaterial({
        taskHandle: destination, service: taskMaterialLibraryService, isCurrent,
      });
      if (!record || !isCurrent()) return;
      const [row] = await table.addData(modelToRows(tableSchema, [record]));
      if (!isCurrent()) return;
      clearNameFilter();
      table.deselectRow();
      row.select();
      showPropertyDetail(row);
      setEmptyLibrary(false);
      clearLibraryHistory();
      notifyAppliedLibraryChange();
      setActionMessage("Создана и сохранена характеристика «Новая».");
    } catch (createError) {
      if (isCurrent()) {
        setActionError(`Создание не завершено: ${actionErrorMessage(createError, "создать характеристику")}`);
      }
    } finally {
      endAction();
    }
  }

  async function readFmmClipboard() {
    if (!isFmm || !canEditLibrary() || !currentFmmRecord()?._taskLibraryRecord) return;
    const record = currentFmmRecord();
    const session = librarySession();
    beginAction();
    try {
      if (typeof navigator.clipboard?.readText !== "function") {
        throw new Error("Чтение буфера недоступно. Откройте редактор через HTTPS или localhost.");
      }
      const text = await navigator.clipboard.readText();
      if (disposed || librarySession() !== session || !isTaskSource()
          || currentFmmRecord() !== record || !recordsReady()) return;
      setClipboardRequest({ record, session, rows: parseFmmClipboardText(text) });
    } catch (clipboardError) {
      if (!disposed && librarySession() === session) {
        setActionError(`Вставка не выполнена: ${clipboardError?.name === "NotAllowedError"
          ? "разрешите браузеру чтение буфера обмена и повторите операцию."
          : actionErrorMessage(clipboardError, "прочитать буфер обмена")}`);
      }
    } finally {
      endAction();
    }
  }

  async function applyFmmClipboard(startRow, endRow) {
    const request = clipboardRequest();
    if (!request || actionBusy() || !recordsReady() || !isTaskSource()) return;
    const isCurrent = () => !disposed && librarySession() === request.session
      && isTaskSource() && currentFmmRecord() === request.record;
    if (!isCurrent()) return;
    const row = table.getRows().find(item => item.getData() === request.record);
    if (!row) return;
    beginAction();
    try {
      const record = await saveFmmClipboardBlock({
        taskHandle: taskHandle(), record: request.record, rows: request.rows, startRow, endRow,
        service: taskMaterialLibraryService,
      });
      if (!isCurrent()) return;
      // Preserve the RowComponent's data identity used by detail views/history.
      await row.update(record);
      const updated = row.getData();
      setCurrentFmmRecord(updated);
      setDirtyRecords(current => current.filter(item => item !== request.record));
      const entry = recordDetailViews.get(request.record);
      if (entry) {
        detailRegion.showHint();
        entry.view.destroy();
        recordDetailViews.delete(request.record);
      }
      showPropertyDetail(row);
      setSelectedRecords(selectedTableRecords(table.getSelectedRows()));
      clearLibraryHistory();
      setClipboardRequest(null);
      notifyAppliedLibraryChange();
      setActionMessage(`Таблица H–M характеристики «${record.name}» заменена и сохранена: ${record.tabl.length} точек.`);
    } catch (pasteError) {
      if (isCurrent()) {
        setActionError(`Вставка не сохранена: ${actionErrorMessage(pasteError, "сохранить характеристику")}`);
      }
    } finally {
      endAction();
    }
  }

  async function copySelectedMaterials() {
    if (!recordsReady() || actionBusy()) return;
    const destination = taskHandle();
    if (!destination) {
      setActionError(
        "Сначала выберите задание на вкладке «Задачи и результаты».",
      );
      return;
    }

    const selected = selectedRecords();
    if (selected.length === 0) {
      setActionError("Выберите характеристики для копирования.");
      return;
    }

    const sourceRecords = selected.map(record => record._libraryRecord);
    if (sourceRecords.some(record => !record)) {
      setActionError(
        "Для одной из выбранных характеристик отсутствуют данные базовой библиотеки.",
      );
      return;
    }

    beginAction();
    try {
      const outcome = await runConfirmedBatch({
        title: "Выбранные локальные характеристики отличаются от базовых.",
        execute: options => taskMaterialLibraryService.copyMaterials({
          taskHandle: destination,
          records: sourceRecords,
          ...options,
        }),
      });

      if (outcome.status === "cancelled") {
        setActionMessage(
          `Копирование отменено; отличающиеся локальные файлы сохранены: ${outcome.count}.`,
        );
        return;
      }

      setActionMessage(
        writeSummary("Копирование завершено", outcome.result.results),
      );
      materialLibraryRevisionService.notifyChanged(definition.kind);
    } catch (copyError) {
      console.error(`${definition.id} copy error:`, copyError);
      if (copyError instanceof MaterialBatchWriteError) {
        setActionError(
          partialWriteMessage("Копирование выполнено частично", copyError),
        );
        return;
      }
      setActionError(
        `Копирование не завершено: ${actionErrorMessage(copyError, "скопировать характеристики")}`,
      );
    } finally {
      endAction();
    }
  }

  async function runConfirmedBatch({ title, execute }) {
    let overwrite = false;
    let expectedConflicts;

    while (true) {
      try {
        return {
          status: "written",
          result: await execute({ overwrite, expectedConflicts }),
        };
      } catch (writeError) {
        if (!(writeError instanceof MaterialBatchConflictError)) {
          throw writeError;
        }

        const confirmed = window.confirm(
          replacementQuestion(title, writeError.conflicts),
        );
        if (!confirmed) {
          return {
            status: "cancelled",
            count: writeError.conflicts.length,
          };
        }

        // Подтверждение относится только к точному набору путей и SHA.
        // Если файлы изменятся до повторного preflight, сервис вернёт
        // новый конфликт и цикл запросит новое подтверждение.
        overwrite = true;
        expectedConflicts = writeError.conflicts;
      }
    }
  }

  async function importLegacyFmmMaterials() {
    if (!isTaskSource() || !recordsReady() || actionBusy() || dirtyRecords().length) return;
    const destination = taskHandle();
    if (!destination) return;
    const session = librarySession();
    const isCurrent = () => !disposed && librarySession() === session && isTaskSource();
    const elements = modelService.getModel().elements;
    if (!Array.isArray(elements)) {
      setActionError("Сначала загрузите элементы задания.");
      return;
    }
    beginAction();
    try {
      const result = await importUsedFmmMaterials(destination, elements, {
        isCurrent,
        notifyChanged: () => {
          if (isCurrent()) {
            clearLibraryHistory();
            diagnosticService.invalidateDiagnostics();
          }
          materialLibraryRevisionService.notifyChanged(definition.kind);
        },
      });
      if (!isCurrent()) return;
      setActionMessage([
        ...result.messages.map(message => message.text),
        ...(result.writeResult ? [writeSummary("Импорт завершён", result.writeResult.results)] : []),
      ].join(" "));
    } catch (importError) {
      if (!isCurrent()) return;
      console.error(`${definition.id} import error:`, importError);
      setActionError(importError instanceof MaterialBatchWriteError
        ? partialWriteMessage("Импорт выполнен частично", importError)
        : `Импорт не завершён: ${actionErrorMessage(importError, "импортировать характеристики")}`);
    } finally {
      endAction();
    }
  }

  function requestDeleteSelectedMaterials() {
    if (!recordsReady() || actionBusy()) return;
    const destination = taskHandle();
    const selected = selectedRecords()
      .filter(record => record._taskLibraryRecord);
    const localRecords = selected.map(record => record._taskLibraryRecord);
    if (!destination || localRecords.length === 0) return;

    setDeleteRequest({
      records: localRecords,
      names: selected.map(record => record.name),
    });
  }

  async function confirmDeleteSelectedMaterials() {
    const destination = taskHandle();
    const request = deleteRequest();
    if (!destination || !request?.records?.length) return;

    beginAction();
    try {
      const results = await taskMaterialLibraryService.deleteMaterials({
        taskHandle: destination,
        records: request.records,
      });
      setDeleteRequest(null);
      setActionMessage(`Удалено характеристик: ${results.length}.`);
      clearLibraryHistory();
      materialLibraryRevisionService.notifyChanged(definition.kind);
    } catch (deleteError) {
      setActionError(
        `Удаление не завершено: ${actionErrorMessage(deleteError, "удалить характеристики")}`,
      );
    } finally {
      endAction();
    }
  }

  async function saveEditedMaterials() {
    if (!recordsReady() || actionBusy()) return;
    const destination = taskHandle();
    const pending = [...dirtyRecords()];
    if (!destination || pending.length === 0) return;

    beginAction();
    const saved = new Set();
    try {
      for (const record of pending) {
        const source = record._taskLibraryRecord;
        const file = isFmm
          ? createFmmMaterialFile(record)
          : createHtsMaterialFile(record);
        const result = await taskMaterialLibraryService.saveMaterial({
          taskHandle: destination,
          material: file,
          sourceRecord: source,
        });
        record._taskLibraryRecord = {
          ...source,
          name: record.name,
          fileName: result.fileName,
          relativePath: result.path,
          byteSize: result.byteSize,
          sha256: result.sha256,
          shadowedRecords: [],
          data: file.data,
        };
        saved.add(record);
      }

      setDirtyRecords([]);
      setActionMessage(`Сохранено характеристик: ${saved.size}.`);
      clearLibraryHistory();
      materialLibraryRevisionService.notifyChanged(definition.kind);
    } catch (saveError) {
      setDirtyRecords(current =>
        current.filter(record => !saved.has(record)));
      if (saved.size > 0) clearLibraryHistory();
      setActionError(
        `Сохранение не завершено: сохранено — ${saved.size}; `
        + actionErrorMessage(saveError, "сохранить характеристики"),
      );
    } finally {
      endAction();
    }
  }

  function changeLibrarySource(event) {
    const nextSource = event.currentTarget.value;
    if (!["task", "default"].includes(nextSource)
      || (nextSource === "task" && !taskHandle()) || actionBusy()) {
      event.currentTarget.value = librarySource();
      return;
    }
    if (nextSource === librarySource()) return;
    if (
      dirtyRecords().length > 0
      && !window.confirm(
        "Есть несохранённые изменения локальной библиотеки. Отменить их?",
      )
    ) {
      event.currentTarget.value = librarySource();
      return;
    }
    setSourceChoice({ session: librarySession(), source: nextSource });
  }

  function localImportTitle() {
    if (dirtyRecords().length > 0) {
      return "Сначала сохраните изменения локальных характеристик";
    }
    switch (legacyFmmStatus()) {
      case "checking":
        return "Проверяется наличие XAP.lib";
      case "error":
        return "Не удалось проверить наличие XAP.lib; импорт недоступен";
      case "missing":
        return "XAP.lib отсутствует: скопировать готовые файлы ФММ текущих элементов из базовой библиотеки. Одноимённые характеристики заменяются";
      default:
        return "Импортировать из XAP.lib только ФММ текущих элементов, включая несохранённые изменения. Недостающие имена ищутся в базовой библиотеке; готовые файлы копируются оттуда. Одноимённые характеристики заменяются; отсутствующие в обоих источниках имена выводятся в сообщении";
    }
  }

  function scheduleLayoutRedraw() {
    cancelAnimationFrame(redrawFrame);
    redrawFrame = requestAnimationFrame(() => {
      redrawFrame = 0;
      table?.redraw(true);
      void Promise.resolve(detailRegion.onVisible()).catch((resizeError) => {
        console.error(`${definition.id} resize error:`, resizeError);
      });
    });
  }

  function stopResize() {
    resizeCleanup?.();
    resizeCleanup = null;
  }

  function beginResize(event, onMove) {
    if (event.button !== 0) return;
    event.preventDefault();
    stopResize();

    const move = (moveEvent) => {
      onMove(moveEvent);
      scheduleLayoutRedraw();
    };
    const finish = () => stopResize();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
    resizeCleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }

  function beginHorizontalResize(event) {
    const tableHeight = tableHost.getBoundingClientRect().height;
    const startHeight = lowerRegionHost.getBoundingClientRect().height;
    const startY = event.clientY;
    const availableHeight = tableHeight + startHeight;
    beginResize(event, moveEvent => {
      setLowerHeight(resizedLowerHeight({
        startHeight,
        deltaY: moveEvent.clientY - startY,
        availableHeight,
      }));
    });
  }

  function beginVerticalResize(event) {
    const bounds = lowerRegionHost.getBoundingClientRect();
    beginResize(event, moveEvent => {
      setDetailRatio(resizedDetailRatio({
        pointerX: moveEvent.clientX,
        containerLeft: bounds.left,
        containerWidth: bounds.width,
      }));
    });
  }

  function handleHorizontalSplitterKey(event) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const tableHeight = tableHost.getBoundingClientRect().height;
    const currentHeight = lowerRegionHost.getBoundingClientRect().height;
    setLowerHeight(resizedLowerHeight({
      startHeight: currentHeight,
      deltaY: event.key === "ArrowUp" ? -20 : 20,
      availableHeight: tableHeight + currentHeight,
    }));
    scheduleLayoutRedraw();
  }

  function handleVerticalSplitterKey(event) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const bounds = lowerRegionHost.getBoundingClientRect();
    const contentWidth = Math.max(1, bounds.width - 6);
    const step = event.key === "ArrowLeft" ? -0.05 : 0.05;
    setDetailRatio(resizedDetailRatio({
      pointerX: bounds.left + contentWidth * (detailRatio() + step),
      containerLeft: bounds.left,
      containerWidth: bounds.width,
    }));
    scheduleLayoutRedraw();
  }

  onMount(() => {
    if (isFmm) {
      props.onConstantMuGeneratorReady?.(() => setConstantMuOpen(true));
      onCleanup(() => props.onConstantMuGeneratorReady?.(null));
    }
    detailRegion.attach({
      title: detailTitleHost,
      toolbar: detailToolbarHost,
      host: detailViewHost,
    });
    detailRegion.showHint("Выберите характеристику в таблице");
    createTable();
    detachHistory = materialLibraryHistoryService.attach(
      schema.id,
      applyLibrarySnapshot,
    );
  });

  createEffect(() => {
    unsavedChangesService.setExplicitDirty(
      schema.id,
      dirtyRecords().length > 0,
    );
  });

  createEffect(() => {
    if (!isFmm) return;
    // A pasted/generated detail is mounted while the file action still owns
    // the library. Refresh structural controls when that action releases it.
    canEditLibrary();
    currentFmmRecord();
    untrack(() => {
      for (const { view } of recordDetailViews.values()) view.syncStructureContext?.();
      if (detailRegion.view) detailRegion.buildToolbar(detailRegion.view);
    });
  });

  createEffect(() => {
    if (!props.active || !table) return;

    requestAnimationFrame(() => {
      if (!props.active || !table) return;
      table.redraw(true);
      void Promise.resolve(detailRegion.onVisible()).catch(
        visibilityError => {
          console.error(
            `${definition.id} detail visibility error:`,
            visibilityError,
          );
        },
      );
    });
  });

  createEffect(() => {
    const ready = tableReady();
    const source = librarySource();
    const destination = taskHandle();
    if (!ready || !table) return;
    if (source === "task") {
      const revision = materialLibraryRevisionService.revision(definition.kind);
      if (untrack(() => recordsReady() && appliedLocalRevision?.session === librarySession()
          && appliedLocalRevision.revision === revision)) return;
    }
    untrack(() => { void loadRecords({ source, destination }); });
  });

  createEffect(() => {
    const destination = taskHandle();
    const localSource = isTaskSource();
    if (!isFmm || !localSource || !destination) {
      setLegacyFmmStatus("missing");
      return;
    }

    let current = true;
    setLegacyFmmStatus("checking");
    void findLocalXap(destination).then(handle => {
        if (current) setLegacyFmmStatus(handle ? "importable" : "missing");      }).catch((lookupError) => {
      if (lookupError?.name === "NotFoundError") {
        if (current) setLegacyFmmStatus("missing");
      } else {
        console.error("XAP.lib availability check error:", lookupError);
        if (current) setLegacyFmmStatus("error");
      }
    });

    onCleanup(() => {
      current = false;
    });
  });

  onCleanup(() => {
    disposed = true;
    unsavedChangesService.clear(schema.id);
    detachHistory?.();
    detachHistory = null;
    clearLibraryHistory();
    stopResize();
    cancelAnimationFrame(redrawFrame);
    detailRegion.destroy();
    for (const entry of recordDetailViews.values()) {
      entry.view.destroy();
    }
    recordDetailViews.clear();
    table?.destroy();
    table = null;
  });

  return (
    <div class="material-library-tab">
      <Show when={isFmm}><ConstantMuFmmDialog open={constantMuOpen()} onClose={() => setConstantMuOpen(false)}
        taskHandle={taskHandle()} canSave={Boolean(taskHandle()) && !selectionService.loadedTaskIsDemo()}
        onSave={saveGeneratedConstantMu}/></Show>
      <div class="material-library-actions">
        <label class="material-library-source">
          <span>Источник характеристик</span>
          <select
            value={librarySource()}
            disabled={actionBusy()}
            onChange={changeLibrarySource}
          >
            <option value="task" disabled={!taskHandle()}
              selected={librarySource() === "task"}>Локальная библиотека задания</option>
            <option value="default" selected={librarySource() === "default"}>Базовая библиотека</option>
          </select>
        </label>
        <Show when={isFmm}>
          <label class="material-library-search">
            <span class="visually-hidden">Поиск характеристики ФММ по имени</span>
            <input
              type="text"
              value={nameFilter()}
              disabled={loading()}
              placeholder="Поиск по имени"
              aria-label="Поиск характеристики ФММ по имени"
              onInput={handleNameFilterInput}
            />
            <button
              type="button"
              class="material-library-search-clear"
              disabled={nameFilter() === ""}
              title="Очистить поиск"
              aria-label="Очистить поиск"
              onClick={clearNameFilter}
            >
              ×
            </button>
          </label>
        </Show>
        <Show when={!isTaskSource()}>
          <button
            disabled={
              actionBusy() || !recordsReady()
              || !taskHandle()
              || selectedRecords().length === 0
            }
            title={
              !taskHandle()
                ? "Сначала выберите задание"
                : "Скопировать выделенные базовые характеристики в задание"
            }
            onClick={copySelectedMaterials}
          >
            Копировать в задание
          </button>
        </Show>
        <Show when={isTaskSource()}>
          <Show when={isFmm}>
            <button
              disabled={
                actionBusy() || !recordsReady()
                || !taskHandle()
                || !["importable", "missing"].includes(legacyFmmStatus())
                || dirtyRecords().length > 0
              }
              title={localImportTitle()}
              onClick={importLegacyFmmMaterials}
            >
              Импортировать
            </button>
            <button disabled={!canEditLibrary()}
              title="Создать локальную характеристику Новая с 12 нулевыми парами H–M"
              onClick={createFmmMaterial}>
              Создать
            </button>
            <button disabled={!canEditLibrary() || !currentFmmRecord()?._taskLibraryRecord}
              title="Заменить текущую таблицу H–M выбранными строками первых двух колонок буфера и сохранить характеристику"
              onClick={readFmmClipboard}>
              Из буфера
            </button>
          </Show>
          <button
            disabled={actionBusy() || !recordsReady() || dirtyRecords().length === 0}
            title="Сохранить изменённые локальные характеристики"
            onClick={saveEditedMaterials}
          >
            Сохранить
          </button>
          <button
            disabled={
              actionBusy() || !recordsReady()
              || selectedRecords().length === 0
              || dirtyRecords().length > 0
            }
            title="Удалить выбранные локальные характеристики"
            onClick={requestDeleteSelectedMaterials}
          >
            Удалить
          </button>
          <Show when={dirtyRecords().length > 0}>
            <span class="material-library-action-progress">
              Изменено: {dirtyRecords().length}
            </span>
          </Show>
        </Show>
        <Show when={actionBusy()}>
          <span class="material-library-action-progress">
            Выполняется операция…
          </span>
        </Show>
      </div>

      <Show when={!taskHandle()}>
        <div class="material-library-action-hint">
          Для работы с локальной библиотекой сначала выберите задание.
        </div>
      </Show>
      <Show when={actionMessage()}>
        <div class="material-library-action-status" aria-live="polite">
          {actionMessage()}
        </div>
      </Show>
      <Show when={actionError()}>
        <div
          class="material-library-action-status material-library-error"
          role="alert"
        >
          {actionError()}
        </div>
      </Show>

      <Show when={loading()}>
        <div class="material-library-message">
          Загрузка {isTaskSource() ? "локальной" : "базовой"} библиотеки…
        </div>
      </Show>
      <Show when={error()}>
        <div class="material-library-message material-library-error">
          Библиотека недоступна: {error()}
        </div>
      </Show>

      <Show when={recordsReady() && isTaskSource() && emptyLibrary()}>
        <div class="material-library-message" role="status">
          Локальная библиотека {definition.kind === "FMM" ? "ФММ" : "ВТСП"} отсутствует или пуста.
          Для подбора характеристик выберите «Базовая библиотека».
        </div>
      </Show>
      <div
        class="material-library-table"
        aria-busy={!recordsReady()}
        style={{ visibility: recordsReady() ? "visible" : "hidden" }}
        ref={(element) => (tableHost = element)}
      />

      <Show when={definition.graphRegion}>
        <div
          class="material-library-splitter material-library-splitter-horizontal"
          role="separator"
          aria-label="Изменить высоту таблицы деталей и графика"
          aria-orientation="horizontal"
          aria-valuenow={Math.round(lowerHeight())}
          tabIndex="0"
          onPointerDown={beginHorizontalResize}
          onKeyDown={handleHorizontalSplitterKey}
        />
      </Show>

      <div
        classList={{
          "material-library-lower": true,
          "with-graph": definition.graphRegion,
        }}
        style={{
          "flex-basis": `${lowerHeight()}px`,
          ...(definition.graphRegion ? {
            "--material-detail-percent": `${detailRatio() * 100}%`,
          } : {}),
        }}
        ref={(element) => (lowerRegionHost = element)}
      >
        <div class="detail-region material-library-detail">
          <div class="detail-region-header">
            <div
              class="detail-region-title"
              ref={(element) => (detailTitleHost = element)}
            />
            <div
              class="detail-region-toolbar"
              ref={(element) => (detailToolbarHost = element)}
            />
          </div>
          <div
            class="detail-region-host"
            ref={(element) => (detailViewHost = element)}
          />
        </div>

        <Show when={definition.graphRegion}>
          <div
            class="material-library-splitter material-library-splitter-vertical"
            role="separator"
            aria-label="Изменить ширину таблицы деталей и графика"
            aria-orientation="vertical"
            aria-valuenow={Math.round(detailRatio() * 100)}
            tabIndex="0"
            onPointerDown={beginVerticalResize}
            onKeyDown={handleVerticalSplitterKey}
          />
          <FmmGraphRegion
            records={selectedRecords()}
            property={
              tableSchema.properties[definition.detail.property]
            }
          />
        </Show>
      </div>
      <MaterialDeleteConfirmationDialog
        request={deleteRequest()}
        busy={actionBusy()}
        onCancel={() => setDeleteRequest(null)}
        onConfirm={confirmDeleteSelectedMaterials}
      />
      <FmmClipboardDialog request={clipboardRequest()} busy={actionBusy()} error={actionError()}
        onCancel={() => { if (!actionBusy()) setClipboardRequest(null); }}
        onApply={applyFmmClipboard} />
    </div>
  );
}
