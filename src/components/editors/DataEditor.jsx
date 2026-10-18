//
// динамическая вкладка согласно схеме
//

/*
===============================================================================
Контракт использования schema
До создания экземпляра Tabulator объект schema является единственным
контекстом описания таблицы и передается в функции построения интерфейса:
    buildColumns(schema)
    modelToRows(schema, ...)
    rowsToModel(schema, ...)
    ...
Сразу после создания Tabulator ссылка на schema дополнительно сохраняется в
    table._gui.schema
Начиная с этого момента любой код, работающий с существующим экземпляром
Tabulator, должен использовать table._gui.schema, а не внешний параметр schema.
Таким образом существуют две стадии жизненного цикла:
    до new Tabulator()   → schema
    после new Tabulator() → table._gui.schema
Данное соглашение позволяет использовать экземпляр Tabulator как полный
контекст GUI без изменения существующих функций построения таблицы.
===============================================================================
*/
import {
  FIELD_TYPES,
  TABS,
  STORAGE_TYPES,
  VIEW_TYPES,
} from "../../services/schemas/common/constants";
import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { TabulatorFull as Tabulator } from "tabulator-tables";
import { TableBuilder } from "../../tabulator/builders/TableBuilder";
import { resolveProperty } from "../../tabulator/schema/propertyResolver";
import {
  modelToRows,
  rowsToModel,
} from "../../tabulator/converters/modelConverter";
import { recordRowLabel } from "../../tabulator/converters/rowLabel";
import { DetailRegion } from "../../tabulator/views/DetailRegion";
import { dataService } from "../../services/dataService";
import { selectionService } from "../../services/selectionService";
import { modelService } from "../../services/modelService";
import { applyVariantChange } from "../../services/model/variantChange";
import {
  isComputedProperty,
  isPropertyReadonly,
} from "../../services/model/modelCompute";
import { selectionContextService } from "../../services/selectionContextService";
import { recordsActions } from "../../tabulator/actions/recordsActions";
import { viewRegistry } from "../../tabulator/views/viewRegistry";
import { COMMON_TABLE_OPTIONS } from "../../tabulator/tableOptions";
import { diagnosticService } from "../../services/diagnosticService";
import {
  schemaConstraintDiagnostics,
} from "../../services/modelConstraintDiagnostics.js";
import { viewSettingsService } from "../../services/viewSettingsService";
import {
  hasRecordColumnsView,
  recordColumnField,
  recordIndexFromColumn,
} from "../../tabulator/converters/recordColumns";
import { RecordGraphRegion } from "../graphs/RecordGraphRegion.jsx";
import { TimeFunctionGenerator } from "../generator/TimeFunctionGenerator.jsx";
import { unsavedChangesService } from "../../services/unsavedChangesService.js";
import {
  DATA_EDITOR_DETAIL_SPLIT_LIMITS,
  resizedEditorLowerRatio,
  resizedEditorTableRatio,
} from "../../services/dataEditorLayout.js";
import { applyGeneratedSeries } from "../../services/generator/timeFunctionModel.js";
import { timeTableClipboardPatch } from "../../services/timeTableClipboard.js";
import {
  materializeReferenceViewRows,
  referenceViewDependencies,
  referenceViewEntries,
  referenceViewValues,
} from "../../services/referenceViewService.js";

import { jweakLocalLocksStructure, JWEAK_STRUCTURE_NOTICE }
  from "../../services/solver/jweakLocalValidation.js";

import "tabulator-tables/dist/css/tabulator.min.css";
import "../../tabs/Tasks.css";
import "./DataEditor.css";

export function DataEditor(props) {
  const schema = props.schema;

  let tableDiv;
  let table;
  let loadRevision = 0;
  const [hasActiveTask, setHasActiveTask] = createSignal(false);
  const [selectedGraphRecords, setSelectedGraphRecords] = createSignal([]);
  let applyingModel = false;
  let changingStructure = false;
  let latestModelRevision = 0;
  let observedModelRevision = 0;
  let modelApplyQueue = Promise.resolve();
  const [medRowsVersion,setMedRowsVersion] = createSignal(0);
  async function flushMedEdits() {
    document.activeElement?.blur();
    await new Promise(resolve => setTimeout(resolve, 0));
    await modelApplyQueue;
  }
  createEffect(() => {
    const request = props.medNavigation;
    if (!request || !props.active) return;
    void flushMedEdits().then(async () => {
      if (!table || props.medNavigation !== request) return;
      // Default getRows() retains source order; "active" applies filtering and
      // sorting. getData() may return accessor copies, so identity is unsuitable.
      const row = table.getRows()[request.block - 1];
      if (!row || (request.row && request.row !== row)) return;
      if (!table.getRows("active").includes(row)) table.clearFilter(true);
      table.deselectRow(); row.select();
      await table.scrollToRow(row, "center", false);
      if (props.medNavigation !== request) return;
      const cell = row.getCell("med");
      if (cell) {
        const property = table._gui.schema.properties.med;
        viewRegistry.get(property.view ?? VIEW_TYPES.TABLE)?.activate?.(cell, {property});
        cell.getElement()?.focus();
      }
    }).catch(error => console.error("MED navigation:", error));
  });
  let pendingCellChange = null;
  let selectionRevision = 0;
  let observedViewDependencyKey = null;
  let mainView = null;
  let mainViewModel = null;
  let mainRegionHost;
  let mainResizeCleanup = null;
  let mainRedrawFrame = 0;
  let detailLayoutHost;
  let detailResizeCleanup = null;
  let detailRedrawFrame = 0;
  const [mainTableRatio, setMainTableRatio] = createSignal(0.65);
  const [detailLowerRatio, setDetailLowerRatio] = createSignal(0.4);
  const [detailGraphField, setDetailGraphField] = createSignal(null);

  const viewDependencies = [
    ...new Set(
      [
        ...Object.values(schema.properties).flatMap(
          (property) => property.computedView?.dependencies ?? [],
        ),
        ...referenceViewDependencies(schema),
      ],
    ),
  ];
  const referenceEntries = referenceViewEntries(schema);
  const defaultReferenceEntry =
    schema.config.storage === STORAGE_TYPES.CLUSTER &&
    referenceEntries.length === 1
      ? referenceEntries[0]
      : null;
  const hasCompactReferenceLayout = Boolean(defaultReferenceEntry);

  function activateDefaultReferenceView() {
    if (!table || !defaultReferenceEntry) return;

    const [propertyName, property] = defaultReferenceEntry;
    const row = table.getRows().find(
      item => item.getData().property === propertyName,
    );
    const cell = row?.getCell("value");
    if (!cell) return;

    const adapter = viewRegistry.get(property.view ?? VIEW_TYPES.TABLE);
    adapter?.activate?.(cell, { property });
  }

  const mainViewPropertyName =
    schema.views?.main?.property ?? null;
  const mainViewProperty = mainViewPropertyName
    ? schema.properties[mainViewPropertyName]
    : null;
  const hasMainView = Boolean(mainViewProperty);
  const hasRecordColumns = hasRecordColumnsView(schema);
  // Выделение профиля — только состояние представления: модель и история
  // не изменяются при переключении внешнего параметра разрядности.
  const activeRecordField = createMemo(() => {
    const currentSchema = table?._gui?.schema ?? schema;
    const descriptor = currentSchema.views.recordsAsColumns?.activeRecord;
    if (!descriptor) return null;

    const model = Object.fromEntries(
      descriptor.dependencies.map(id => [
        id,
        modelService.getModelPartUpdate(id)?.data,
      ]),
    );
    const index = descriptor.index({ model });
    return Number.isInteger(index) &&
      index >= 0 && index < currentSchema.config.recordCount
      ? recordColumnField(index)
      : null;
  });

  function applyActiveRecordColumn(field) {
    if (!hasRecordColumns || !tableDiv) return;

    tableDiv.querySelectorAll(
      ".tabulator-col[tabulator-field], .tabulator-cell[tabulator-field]",
    ).forEach(element => {
      element.classList.toggle(
        "active-record-column",
        field !== null && element.getAttribute("tabulator-field") === field,
      );
    });
  }

  const reportsRecordSelection =
    schema.config.storage === STORAGE_TYPES.RECORDS &&
    !hasMainView &&
    !hasRecordColumns;
  const mainViewStructureMutable =
    hasMainView &&
    !isPropertyReadonly(mainViewProperty) &&
    mainViewProperty.rowsMutable !== false;
  const hasDetailRegion =
    !hasMainView && hasNestedArrays(schema);
  const hasGraphRegion =
    hasDetailRegion && Boolean(schema.views?.graph);
  const jweakStructureLocked = () => schema.id === TABS.ELEMENTS.id
    && Boolean(selectionService.loadedTaskHandle())
    && (!modelService.getModel().jweakLocal
      || jweakLocalLocksStructure(modelService.getModel().jweakLocal));
  const structureTitle = text => jweakStructureLocked() ? JWEAK_STRUCTURE_NOTICE : text;
  const hasMainToolbar =
    schema.config.storage === STORAGE_TYPES.RECORDS &&
    !hasRecordColumns &&
    (!hasMainView || mainViewStructureMutable);
  const generatorDescriptor = schema.views?.generator ?? null;
  const hasGeneratorRegion = Boolean(generatorDescriptor);

  // Transient source ID существует только в памяти и не входит в BaseModel.
  const modelSource = Symbol(`DataEditor:${schema.id}`);

  let detailTitleDiv;
  let detailToolbarDiv;
  let detailHostDiv;

  const detailRegion = new DetailRegion();

  // Создание таблицы
  function createMainTable() {
    if (hasMainView) {
      createPrimaryMainView();
      return;
    }

    const options = {
      ...COMMON_TABLE_OPTIONS,
      layout: schema.config.stretchLastColumn
        ? "fitDataStretch"
        : "fitDataFill",
      ...(hasCompactReferenceLayout ? {} : { height: "100%" }),
      data: [],
      columns: TableBuilder.buildColumns(schema),
      selectableRows: true,
      selectableRowsRangeMode: "click",
    };

    table = new Tabulator(tableDiv, options);
    props.onMedEditorReady?.({flush:flushMedEdits, rows:()=>{
      medRowsVersion(); return table.getRows();
    }});
    onCleanup(() => props.onMedEditorReady?.(null));

    // Контекст GUI данного экземпляра Tabulator.
    // См. архитектурный контракт использования schema в начале файла.
    table._gui = {
      schema,
      required: !!schema.config.required,
      detailRegion,
      model: {
        getSnapshot() {
          return modelService.getModel();
        },
        getRecord(rowData) {
          if (schema.config.storage === STORAGE_TYPES.RECORDS) {
            return rowsToModel(schema, [rowData])[0] ?? null;
          }
          return rowsToModel(schema, table.getData());
        },
        setRecordValue(rowData, field, value) {
          return setNestedRecordValue(rowData, field, value);
        },
        setRecordsValue(rowDataItems, field, value) {
          return setRecordValues(rowDataItems, field, value);
        },
      },
      structure: {
        get mutable() { return !hasRecordColumns && !jweakStructureLocked(); },
        createDefaultRow: () => dataService.createDefaultRecord(schema),
        beginChange() {
          pendingCellChange = null;
          changingStructure = true;
        },
        endChange() {
          changingStructure = false;
          const update = publishTableChanged(true);
          notifyRecordSelection();
          return update;
        },
        cancelChange() {
          changingStructure = false;
        },
        updateRowLabel(row, index) {
          const label = recordRowLabel(index);
          if (row.getData().rowLabel === label) return undefined;
          return row.update({ rowLabel: label });
        },
      },
    };

    table.on("rowSelectionChanged", handleRowSelectionChanged);

    table.on("cellClick", handleMainCellClick);

    // cellEdited предшествует dataChanged и хранит точный контекст реакции
    // свойства; сама публикация модели остаётся единственной в dataChanged.
    table.on("cellEdited", captureCellChange);
    table.on("dataChanged", handleTableChanged);

    if (hasRecordColumns) {
      const refreshActiveRecordColumn = () =>
        applyActiveRecordColumn(activeRecordField());
      table.on("tableBuilt", refreshActiveRecordColumn);
      table.on("renderComplete", refreshActiveRecordColumn);
    }
  }

  // ARRAY-представление в основной области создаётся тем же adapter,
  // что и связанная таблица, но через model-backed binding без CellComponent.
  function createPrimaryMainView() {
    const adapter = viewRegistry.get(
      mainViewProperty.view ?? VIEW_TYPES.TABLE,
    );

    if (typeof adapter?.createPrimary !== "function") {
      throw new Error(
        `View '${mainViewProperty.view}' does not support views.main.`,
      );
    }

    mainView = adapter.createPrimary({
      schema,
      property: mainViewProperty,
      propertyName: mainViewPropertyName,
      getRecords: () => mainViewModel,
      setRecords(records) {
        const update = modelService.setModelPart(
          schema,
          records,
          {
            source: modelSource,
            recordHistory: true,
          },
        );
        mainViewModel = update.data;
      },
      getModelSnapshot: () => modelService.getModel(),
      createDefaultRecord: () =>
        dataService.createDefaultRecord(schema),
    });

    mainView.attach(tableDiv);
    mainView.render();
    table = mainView.getTable();
  }

  // Вложенное представление явно завершает обновление строки-владельца,
  // затем публикует единственную ревизию BaseModel. Событие dataChanged,
  // возникающее внутри row.update, подавляется applyingModel.
  async function setNestedRecordValue(rowData, field, value) {
    const row = table
      ?.getRows()
      .find(item => item.getData() === rowData);

    if (!row) return undefined;

    applyingModel = true;

    try {
      await row.update({
        [field]: structuredClone(value),
      });
    } finally {
      applyingModel = false;
    }

    // Вложенное редактирование не является сменой варианта основной ячейки.
    pendingCellChange = null;
    publishTableChanged(true);

    return row.getData()[field];
  }

  async function setRecordValues(rowDataItems, field, value) {
    const selected = new Set(rowDataItems);
    const rows = table?.getRows().filter(row => selected.has(row.getData())) ?? [];
    if (rows.length !== selected.size) {
      throw new Error("Не все выбранные записи найдены в активной таблице.");
    }

    applyingModel = true;
    try {
      await Promise.all(rows.map(row => row.update({ [field]: value })));
    } finally {
      applyingModel = false;
    }
    pendingCellChange = null;
    return publishTableChanged(true);
  }

  async function applyGeneratedDependency({ targetValue, points }) {
    if (!hasActiveTask()) {
      throw new Error("Сначала загрузите задание.");
    }

    const selected = table?.getSelectedRows?.() ?? [];
    if (selected.length !== 1) {
      throw new Error(
        "Для применения зависимости выберите ровно одну запись основной таблицы.",
      );
    }

    const row = selected[0];
    const rowData = row.getData();
    const patch = applyGeneratedSeries({
      schema,
      record: rowData,
      targetValue,
      points,
    });

    applyingModel = true;
    try {
      await row.update(patch);
    } finally {
      applyingModel = false;
    }

    pendingCellChange = null;
    const update = publishTableChanged(false);
    detailRegion.refresh();
    return update;
  }

  async function replaceTableFromClipboard(propertyName) {
    if (!hasActiveTask() || !props.active) throw new Error("Сначала загрузите задание и откройте нужную вкладку.");
    const selected = table?.getSelectedRows?.() ?? [];
    if (selected.length !== 1) throw new Error("Выделите ровно одну строку основной таблицы.");
    if (!schema.views?.clipboardTables?.some(item => item.property === propertyName)) {
      throw new Error("Таблица не поддерживает замену из буфера.");
    }
    if (typeof navigator.clipboard?.readText !== "function") {
      throw new Error("Браузер не предоставляет чтение буфера. Откройте Editor в Chrome или Edge по HTTPS либо localhost.");
    }
    const originalTable = table, row = selected[0];
    const task = selectionService.loadedTaskHandle(), version = selectionService.taskDataVersion(), load = loadRevision;
    const isCurrent = () => props.active && hasActiveTask() && table === originalTable
      && task === selectionService.loadedTaskHandle() && version === selectionService.taskDataVersion()
      && load === loadRevision && table.getRows().includes(row)
      && table.getSelectedRows().length === 1 && table.getSelectedRows()[0] === row;
    // Begin clipboard access in the click gesture, before awaiting the active
    // cell's commit. Handle rejection immediately while that commit completes.
    const reading = navigator.clipboard.readText().then(text => ({ text }), error => ({ error }));
    await flushMedEdits();
    const revision = modelService.getModelPartUpdate(schema.id)?.revision;
    const result = await reading;
    if (!isCurrent() || revision !== modelService.getModelPartUpdate(schema.id)?.revision) {
      throw new Error("Во время чтения буфера изменились задание, вкладка, выделение или данные. Повторите команду.");
    }
    if (result.error) {
      throw new Error(result.error.name === "NotAllowedError"
        ? "Браузер не разрешил прочитать буфер обмена. Разрешите доступ и повторите команду."
        : `Не удалось прочитать буфер обмена: ${result.error.message || result.error}`);
    }
    const patch = timeTableClipboardPatch(schema, propertyName, result.text);
    applyingModel = true;
    try { await row.update(patch); }
    finally { applyingModel = false; }
    if (!isCurrent() || revision !== modelService.getModelPartUpdate(schema.id)?.revision) {
      throw new Error("Данные изменились во время вставки. Повторите команду.");
    }
    pendingCellChange = null;
    const update = publishTableChanged(true);
    detailRegion.refresh();
    return update;
  }

  async function replaceEditorData(data) {
    if (hasGraphRegion) setSelectedGraphRecords([]);

    if (hasMainView) {
      mainViewModel = data;
      await mainView?.render();
      return;
    }

    const rows =
      data === null || data === undefined
        ? []
        : materializeReferenceViewRows({
            schema,
            rows: modelToRows(schema, data),
            baseModel: data,
            modelSnapshot: modelService.getModel(),
          });
    await table.setData(rows);
    notifyRecordSelection();
    setMedRowsVersion(value=>value+1);
    activateDefaultReferenceView();
  }

  async function refreshReferenceViews() {
    if (!table || referenceEntries.length === 0) return;
    const baseModel = modelService.getModel()[schema.id];
    if (baseModel === null || baseModel === undefined) return;
    const values = referenceViewValues(
      schema,
      baseModel,
      modelService.getModel(),
    );

    applyingModel = true;
    try {
      if (schema.config.storage === STORAGE_TYPES.RECORDS) {
        const rows = table.getRows();
        await Promise.all(rows.map((row, index) =>
          row.update(values[index] ?? {})
        ));
      } else {
        const rows = table.getRows();
        for (const [propertyName, descriptor] of
          [...referenceEntries].reverse()) {
          const row = rows.find(item =>
            item.getData().property === propertyName
          );
          if (row) {
            await row.update({ value: values[propertyName] });
            continue;
          }
          await table.addRow({
            rowLabel: descriptor.label,
            property: propertyName,
            value: values[propertyName],
          }, true);
        }
      }
    } finally {
      applyingModel = false;
    }
    detailRegion.refresh();
    activateDefaultReferenceView();
  }

  function handleRowSelectionChanged(_data, rows) {
    selectionContextService.notifySelectionChanged(table);
    notifyRecordSelection(rows);
    syncSelectedGraphRecords(rows);
    const tableSchema = table?._gui?.schema;

    if (tableSchema?.config.storage === STORAGE_TYPES.RECORDS) {
      queueDetailForSelection();
      return;
    }

    showDetailForSelection(rows);
  }

  function selectedRecordIndices(rows = table?.getSelectedRows?.() ?? []) {
    const indices = (rows ?? [])
      .map((row) => Number(row?.getData?.()?.rowLabel) - 1)
      .filter((index) => Number.isInteger(index) && index >= 0);

    return [...new Set(indices)].sort((left, right) => left - right);
  }

  function notifyRecordSelection(rows) {
    if (!reportsRecordSelection) return;
    props.onRecordSelectionChange?.(
      schema.id,
      selectedRecordIndices(rows),
    );
  }

  function syncSelectedGraphRecords(rows = table?.getSelectedRows()) {
    if (!hasGraphRegion) return;
    setSelectedGraphRecords(
      (rows ?? []).map(row => structuredClone(row.getData())),
    );
  }

  // Объединение синхронной цепочки selection-событий RECORDS не создаёт
  // временные View до завершения cellClick и не закрывает детали при
  // промежуточном deselect внутри структурной операции.
  function queueDetailForSelection() {
    const revision = ++selectionRevision;

    queueMicrotask(() => {
      if (!table || revision !== selectionRevision) return;
      showDetailForSelection(table.getSelectedRows());
    });
  }

  // Перенос области деталей на последнюю выделенную запись без смены активного свойства.
  function showDetailForSelection(rows) {
    if (!rows || rows.length === 0) return;

    const field = detailRegion.getField();
    if (!field) return;

    const cell = rows[rows.length - 1].getCell(field);
    if (!cell) return;

    const tableSchema = cell.getTable()._gui?.schema;
    const property = resolveProperty(cell, tableSchema);
    if (!property) return;

    const adapter = viewRegistry.get(property.view ?? VIEW_TYPES.TABLE);
    adapter?.activate?.(cell, { property });
  }

  // Обычная ячейка RECORDS прекращает действие активной пары. Для ARRAY
  // активацию или перенос представления выполняет его ViewAdapter.
  function handleMainCellClick(_event, cell) {
    const tableSchema = cell.getTable()._gui?.schema;
    if (tableSchema?.config.storage !== STORAGE_TYPES.RECORDS) return;

    const property = resolveProperty(cell, tableSchema);
    const adapter = property
      ? viewRegistry.get(property.view ?? VIEW_TYPES.TABLE)
      : null;

    if (
      property?.type === FIELD_TYPES.ARRAY &&
      typeof adapter?.activate === "function"
    ) {
      return;
    }

    detailRegion.showHint();
  }

  // проверка наличия вложенных массивов
  function hasNestedArrays(schema) {
    return [
      ...Object.values(schema.properties),
      ...referenceViewEntries(schema).map(([, property]) => property),
    ].some((property) => property.type === FIELD_TYPES.ARRAY);
  }

  function captureCellChange(cell) {
    const rowData = cell.getRow().getData();
    let propertyName;
    let recordIndex = null;

    if (schema.config.storage === STORAGE_TYPES.CLUSTER) {
      propertyName = rowData.property;
    } else if (hasRecordColumns) {
      propertyName = rowData._property;
      recordIndex = recordIndexFromColumn(cell.getField());
    } else {
      propertyName = cell.getField();
      // getData() applies accessors and returns copies. Match the original
      // RowComponent data in source order, independent of sorting/filtering.
      recordIndex = table.getRows().findIndex(row => row.getData() === rowData);
    }

    if (
      !schema.properties[propertyName] ||
      (schema.config.storage === STORAGE_TYPES.RECORDS &&
        (!Number.isInteger(recordIndex) || recordIndex < 0))
    ) {
      pendingCellChange = null;
      return;
    }

    pendingCellChange = {
      propertyName,
      recordIndex,
      oldValue: structuredClone(cell.getOldValue()),
      newValue: structuredClone(cell.getValue()),
    };
  }

  // Событие cellEdited отличает пользовательскую правку от setData
  // при загрузке. Структурные и вложенные операции публикуются явно.
  function handleTableChanged() {
    return publishTableChanged(pendingCellChange !== null);
  }

  // Единственная публикация направления Tabulator -> BaseModel.
  function publishTableChanged(recordHistory = false) {
    if (applyingModel || changingStructure || !table) {
      return undefined;
    }

    detailRegion.clearIfSourceMissing(table);
    syncSelectedGraphRecords();

    const rows = table.getData();
    const baseModel = rowsToModel(schema, rows);
    const result = applyVariantChange(
      schema,
      baseModel,
      pendingCellChange,
    );

    pendingCellChange = null;

    // Изменение варианта требует полной внешней синхронизации. Обычная
    // правка остаётся собственной: вычисленные поля применяются точечно.
    const source = result.refresh ? null : modelSource;
    const update = modelService.setModelPart(
      schema,
      result.model,
      {
        source,
        recordHistory,
      },
    );

    if (
      source === modelSource &&
      update.computedPatches.length > 0 &&
      !applyComputedPatches(update.computedPatches)
    ) {
      // Защитный fallback при рассогласовании состава строк.
      queueModelUpdate(update);
    }

    if (referenceEntries.length > 0) {
      void refreshReferenceViews().catch((error) => {
        console.error(`${schema.id} reference view refresh error:`, error);
      });
    }

    return update;
  }

  // Точечное применение вычисленных полей той же revision. Row.update
  // синхронно публикует dataChanged, поэтому applyingModel подавляет
  // обратную запись без полного replaceData и закрытия DetailRegion.
  function applyComputedPatches(patches) {
    if (!table || patches.length === 0) return true;

    const targets = [];
    const activeField = detailRegion.getField();
    let refreshDetail = false;

    if (schema.config.storage === STORAGE_TYPES.RECORDS) {
      const rows = table.getRows();
      const grouped = new Map();

      for (const patch of patches) {
        if (
          !Number.isInteger(patch.recordIndex) ||
          !rows[patch.recordIndex]
        ) {
          return false;
        }

        if (!grouped.has(patch.recordIndex)) {
          grouped.set(patch.recordIndex, {});
        }

        grouped.get(patch.recordIndex)[patch.propertyName] =
          structuredClone(patch.value);
        refreshDetail ||= patch.propertyName === activeField;
      }

      for (const [recordIndex, values] of grouped) {
        targets.push([rows[recordIndex], values]);
      }
    } else {
      const rows = table.getRows();

      for (const patch of patches) {
        const property = schema.properties[patch.propertyName];

        // ARRAY без nColumns развёрнут в несколько строк CLUSTER.
        // Изменение длины и всех arrayIndex безопасно выполняет полный update.
        if (
          property?.type === FIELD_TYPES.ARRAY &&
          !property.nColumns
        ) {
          return false;
        }

        const row = rows.find(item =>
          item.getData().property === patch.propertyName &&
          item.getData().arrayIndex === undefined
        );
        if (!row) return false;

        targets.push([
          row,
          { value: structuredClone(patch.value) },
        ]);
        refreshDetail ||= patch.propertyName === activeField;
      }
    }

    const updates = [];
    applyingModel = true;

    try {
      for (const [row, values] of targets) {
        updates.push(row.update(values));
      }
    } finally {
      applyingModel = false;
    }

    Promise.all(updates).catch((error) => {
      console.error(
        `${schema.id} computed patch error:`,
        error,
      );
    });

    if (refreshDetail) {
      detailRegion.refresh();
    }

    return true;
  }

  // Последовательное применение внешних ревизий BaseModel к Tabulator.
  function queueModelUpdate(update) {
    latestModelRevision = Math.max(
      latestModelRevision,
      update.revision,
    );

    modelApplyQueue = modelApplyQueue
      .then(async () => {
        if (
          !table ||
          update.revision < latestModelRevision
        ) {
          return;
        }

        if (hasMainView) {
          mainViewModel = update.data;
          await mainView?.render();
          return;
        }

        const rows =
          update.data === null || update.data === undefined
            ? []
            : materializeReferenceViewRows({
                schema,
                rows: modelToRows(schema, update.data),
                baseModel: update.data,
                modelSnapshot: modelService.getModel(),
              });

        applyingModel = true;
        detailRegion.showHint();
        if (hasGraphRegion) setSelectedGraphRecords([]);

        try {
          await table.replaceData(rows);
          notifyRecordSelection();
          setMedRowsVersion(value=>value+1);
          activateDefaultReferenceView();
        } finally {
          applyingModel = false;
        }
      })
      .catch((error) => {
        console.error(
          `${schema.id} model update error:`,
          error,
        );
      });
  }

  // Операции панели основной таблицы выполняются над своей таблицей.
  function mainAction(action) {
    return () => {
      if (!hasActiveTask()) return;
      selectionContextService.setActiveTable(table);
      action();
    };
  }

  function scheduleMainLayoutRedraw() {
    cancelAnimationFrame(mainRedrawFrame);
    mainRedrawFrame = requestAnimationFrame(() => {
      mainRedrawFrame = 0;
      table?.redraw?.(true);
    });
  }

  function stopMainResize() {
    mainResizeCleanup?.();
    mainResizeCleanup = null;
  }

  function beginMainResize(event) {
    if (event.button !== 0 || !mainRegionHost) return;
    event.preventDefault();
    stopMainResize();
    const bounds = mainRegionHost.getBoundingClientRect();
    const move = (moveEvent) => {
      setMainTableRatio(resizedEditorTableRatio({
        pointerX: moveEvent.clientX,
        containerLeft: bounds.left,
        containerWidth: bounds.width,
      }));
      scheduleMainLayoutRedraw();
    };
    const finish = () => stopMainResize();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
    mainResizeCleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }

  function handleMainSplitterKey(event) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const bounds = mainRegionHost.getBoundingClientRect();
    const contentWidth = Math.max(1, bounds.width - 6);
    const step = event.key === "ArrowLeft" ? -0.05 : 0.05;
    setMainTableRatio(resizedEditorTableRatio({
      pointerX: bounds.left + contentWidth * (mainTableRatio() + step),
      containerLeft: bounds.left,
      containerWidth: bounds.width,
    }));
    scheduleMainLayoutRedraw();
  }

  function scheduleDetailLayoutRedraw() {
    cancelAnimationFrame(detailRedrawFrame);
    detailRedrawFrame = requestAnimationFrame(() => {
      detailRedrawFrame = 0;
      table?.redraw?.(true);
      mainView?.onVisible?.();
      Promise.resolve(detailRegion.onVisible()).catch((error) => {
        console.error(`${schema.id} detail resize error:`, error);
      });
    });
  }

  function stopDetailResize() {
    detailResizeCleanup?.();
    detailResizeCleanup = null;
  }

  function updateDetailLowerRatio(pointerY, bounds) {
    setDetailLowerRatio(resizedEditorLowerRatio({
      pointerY,
      containerTop: bounds.top,
      containerHeight: bounds.height,
    }));
    scheduleDetailLayoutRedraw();
  }

  function beginDetailResize(event) {
    if (event.button !== 0 || !detailLayoutHost) return;
    event.preventDefault();
    event.stopPropagation();
    stopDetailResize();

    const bounds = detailLayoutHost.getBoundingClientRect();
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    const move = (moveEvent) => updateDetailLowerRatio(moveEvent.clientY, bounds);
    const finish = () => stopDetailResize();

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    detailResizeCleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }

  function handleDetailSplitterKey(event) {
    if (
      !detailLayoutHost ||
      !["ArrowUp", "ArrowDown"].includes(event.key)
    ) {
      return;
    }
    event.preventDefault();

    const bounds = detailLayoutHost.getBoundingClientRect();
    const contentHeight = Math.max(
      1,
      bounds.height - DATA_EDITOR_DETAIL_SPLIT_LIMITS.splitterSize,
    );
    const mainHeight = contentHeight * (1 - detailLowerRatio());
    const direction = event.key === "ArrowUp" ? -1 : 1;
    const step = event.shiftKey ? 40 : 10;
    updateDetailLowerRatio(
      bounds.top + mainHeight + direction * step,
      bounds,
    );
  }

  function applyComputedColumnsVisibility(mode) {
    if (!table) return;

    if (hasMainView) {
      mainView?.setComputedColumnsVisibility?.(mode);
      return;
    }

    if (schema.config.storage === STORAGE_TYPES.RECORDS) {
      for (const [name, property] of Object.entries(schema.properties)) {
        if (!isComputedProperty(property)) continue;

        const column = table.getColumn(name);
        if (!column) continue;

        const visible =
          viewSettingsService.isComputedColumnVisible(
            property.hidden,
            mode,
          );

        if (column.isVisible?.() === visible) continue;

        if (visible) {
          column.show();
        } else {
          column.hide();
        }
      }

      for (const [name, property] of referenceEntries) {
        const column = table.getColumn(name);
        if (!column) continue;
        const visible = viewSettingsService.isComputedColumnVisible(
          property.hidden,
          mode,
        );
        if (column.isVisible?.() === visible) continue;
        if (visible) column.show();
        else column.hide();
      }
    }

    detailRegion.setComputedColumnsVisibility?.(mode);
  }

  //==========================================================================
  onMount(() => {
    createMainTable();
    props.onEditorReady?.({ flush: flushMedEdits, replaceTableFromClipboard });
    onCleanup(() => props.onEditorReady?.(null));

    if (hasDetailRegion) {
      detailRegion.attach({
        title: detailTitleDiv,
        toolbar: detailToolbarDiv,
        host: detailHostDiv,
        onFieldChanged: setDetailGraphField,
      });
    }
  });

  // Активация вкладки является явным событием жизненного цикла.
  // requestAnimationFrame выполняется после применения display:block.
  createEffect(() => {
    if (!props.active) return;

    selectionContextService.setActiveTable(table);

    requestAnimationFrame(() => {
      if (!props.active || !table) return;

      if (hasMainView) {
        Promise.resolve(mainView?.render())
          .then(() => {
            if (props.active) {
              mainView?.onVisible?.();
            }
          })
          .catch((error) => {
            console.error(
              `${schema.id} visibility refresh error:`,
              error,
            );
          });
        return;
      }

      table.redraw(true);

      Promise.resolve(detailRegion.onVisible())
        .catch((error) => {
          console.error(
            `${schema.id} detail visibility error:`,
            error,
          );
        });
    });
  });

  createEffect(() => {
    applyActiveRecordColumn(activeRecordField());
  });

  // Режим общий для вкладок, но применяется только к активному редактору.
  createEffect(() => {
    const mode = props.computedColumnsMode;

    if (!props.active || !table) return;

    applyComputedColumnsVisibility(mode);
  });

  // Загрузка данных модели
  createEffect(async () => {
    const revision = ++loadRevision;
    const dirHandle = selectionService.loadedTaskHandle();
    selectionService.taskDataVersion();

    if (hasDetailRegion) {
      detailRegion.showHint();
    }

    if (!dirHandle) {
      if (!hasActiveTask()) return;

      setHasActiveTask(false);
      diagnosticService.setConstraintResult(schema.id, []);
      if (table) {
        await replaceEditorData(null);
      }
      return;
    }

    setHasActiveTask(true);

    try {
      const diagnostics = [];
      const loadState = {};
      const baseModel = await dataService.load(dirHandle, schema, diagnostics, loadState);
      if (revision !== loadRevision) return;

      diagnosticService.setLoadResult(schema.id, diagnostics);

      if (baseModel === null) {
        diagnosticService.setConstraintResult(schema.id, []);
        const update = modelService.setModelPart(
          schema,
          null,
          { source: modelSource },
        );
        unsavedChangesService.setBaseline(schema.id, update.data);
        unsavedChangesService.setExplicitDirty(schema.id, false);
        await replaceEditorData(null);
        return;
      }

      const update = modelService.setModelPart(
        schema,
        baseModel,
        { source: modelSource },
      );
      diagnosticService.setConstraintResult(
        schema.id,
        schemaConstraintDiagnostics(schema, update.data),
      );
      unsavedChangesService.setBaseline(schema.id, update.data);
      unsavedChangesService.setExplicitDirty(schema.id, loadState.requiresSave === true);
      await replaceEditorData(update.data);
    } catch (err) {
      if (revision !== loadRevision) return;

      console.error(schema.config.file + " loading error:", err);
      const update = modelService.setModelPart(
        schema,
        null,
        { source: modelSource },
      );
      diagnosticService.setConstraintResult(schema.id, []);
      unsavedChangesService.setBaseline(schema.id, update.data);
      unsavedChangesService.setExplicitDirty(schema.id, false);
      await replaceEditorData(null);
    }
  });

  onCleanup(() => {
    stopMainResize();
    stopDetailResize();
    cancelAnimationFrame(mainRedrawFrame);
    cancelAnimationFrame(detailRedrawFrame);
  });

  // Направление BaseModel -> Tabulator. Собственные публикации редактора
  // игнорируются: их значения уже находятся в таблице.
  createEffect(() => {
    const update = modelService.getModelPartUpdate(schema.id);

    if (
      !table ||
      !update ||
      update.revision <= observedModelRevision
    ) {
      return;
    }

    observedModelRevision = update.revision;
    latestModelRevision = Math.max(
      latestModelRevision,
      update.revision,
    );

    if (update.source === modelSource) return;

    queueModelUpdate(update);
  });

  // Вычисляемое представление наблюдает только объявленные внешние части
  // BaseModel. TableView получает снимок через binding адаптера и сам на
  // modelService не подписывается.
  createEffect(() => {
    if (viewDependencies.length === 0) return;

    const revisionKey = viewDependencies
      .map(
        (id) =>
          modelService.getModelPartUpdate(id)?.revision ?? 0,
      )
      .join(":");

    if (revisionKey === observedViewDependencyKey) return;
    observedViewDependencyKey = revisionKey;

    if (!table) return;

    if (hasMainView) {
      Promise.resolve(mainView?.render()).catch((error) => {
        console.error(
          `${schema.id} computed view refresh error:`,
          error,
        );
      });
    } else if (referenceEntries.length > 0) {
      void refreshReferenceViews().catch((error) => {
        console.error(`${schema.id} reference view refresh error:`, error);
      });
    } else {
      detailRegion.refresh();
    }
  });

  //==========================================================================
  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        width: "100%",
        height: "100%",
        position: "absolute",
        inset: "0",
        "min-height": "0",
        overflow: "hidden",
        "box-sizing": "border-box",
      }}
    >
      {hasMainToolbar && (
        <div
          style={{
            display: "flex",
            gap: "6px",
            padding: "4px",
          }}
        >
          <button
            disabled={!hasActiveTask() || jweakStructureLocked()}
            title={structureTitle(!hasActiveTask()
              ? "Сначала загрузите задание"
              : hasMainView ? "Добавить строку" : "Добавить запись")}
            onClick={mainAction(() => recordsActions.addRecord())}
          >
            +
          </button>
          {!hasMainView && (
            <>
              <button
                disabled={!hasActiveTask()}
                title={!hasActiveTask()
                  ? "Сначала загрузите задание"
                  : "Копировать выделенные"}
                onClick={mainAction(() => recordsActions.copyRecords())}
              >
                {" "}
                C
              </button>
              <button
                disabled={!hasActiveTask() || jweakStructureLocked()}
                title={structureTitle(!hasActiveTask()
                  ? "Сначала загрузите задание"
                  : "Вставить скопированные")}
                onClick={mainAction(() => recordsActions.pasteRecords())}
              >
                P
              </button>
            </>
          )}
          <button
            disabled={!hasActiveTask() || jweakStructureLocked()}
            title={structureTitle(!hasActiveTask()
              ? "Сначала загрузите задание"
              : hasMainView ? "Удалить строки" : "Удалить выделенные")}
            onClick={mainAction(() => recordsActions.removeRecord())}
          >
            −
          </button>
          <button
            disabled={!hasActiveTask() || jweakStructureLocked()}
            title={structureTitle(!hasActiveTask()
              ? "Сначала загрузите задание"
              : hasMainView ? "Переместить строки вверх" : "Переместить выделенные вверх")}
            onClick={mainAction(() => recordsActions.moveRecordUp())}
          >
            ↑
          </button>
          <button
            disabled={!hasActiveTask() || jweakStructureLocked()}
            title={structureTitle(!hasActiveTask()
              ? "Сначала загрузите задание"
              : hasMainView ? "Переместить строки вниз" : "Переместить выделенные вниз")}
            onClick={mainAction(() => recordsActions.moveRecordDown())}
          >
            ↓
          </button>
          {jweakStructureLocked() && (
            <span role="status" title={JWEAK_STRUCTURE_NOTICE} style={{ "align-self": "center" }}>
              Иерархия: состав и порядок ШГ зафиксированы
            </span>
          )}
        </div>
      )}

      <div
        ref={(el) => (detailLayoutHost = el)}
        classList={{
          "data-editor-content": true,
          "with-detail-graph": hasGraphRegion,
        }}
      >
        <div
          ref={(el) => (mainRegionHost = el)}
          classList={{
            "data-editor-main": true,
            "with-generator": hasGeneratorRegion,
            "compact-reference": hasCompactReferenceLayout,
          }}
        >
          <div
            ref={(el) => (tableDiv = el)}
            class="data-editor-main-table"
            style={hasGeneratorRegion
              ? { "flex-basis": `${mainTableRatio() * 100}%` }
              : undefined}
          />
          {hasGeneratorRegion && (
            <>
              <div
                class="data-editor-main-splitter"
                role="separator"
                aria-label="Изменить ширину основной таблицы"
                aria-orientation="vertical"
                tabIndex="0"
                onPointerDown={beginMainResize}
                onKeyDown={handleMainSplitterKey}
              />
              <section
                class="data-editor-generator"
                aria-label={generatorDescriptor.title}
              >
                <div class="data-editor-generator-title">
                  {generatorDescriptor.title}
                </div>
                <TimeFunctionGenerator
                  schema={schema}
                  onApply={applyGeneratedDependency}
                />
              </section>
            </>
          )}
        </div>
        {hasGraphRegion && (
          <div
            class="data-editor-horizontal-splitter"
            role="separator"
            aria-label="Изменить высоту основной таблицы и области детализации"
            aria-orientation="horizontal"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={Math.round((1 - detailLowerRatio()) * 100)}
            tabIndex="0"
            title="Перетащите для изменения высоты таблицы и детализации"
            onPointerDown={beginDetailResize}
            onKeyDown={handleDetailSplitterKey}
          />
        )}
        {hasDetailRegion && (
          <div
            data-fill-height={
              hasCompactReferenceLayout || hasGraphRegion
                ? "true"
                : undefined
            }
            classList={{
              "data-editor-lower": true,
              "with-graph": hasGraphRegion,
              "compact-reference": hasCompactReferenceLayout,
            }}
            style={hasGraphRegion
              ? { "flex-basis": `${detailLowerRatio() * 100}%` }
              : undefined}
          >
            <div class="detail-region data-editor-detail">
              <div class="detail-region-header">
                <div
                  class="detail-region-title"
                  ref={(el) => (detailTitleDiv = el)}
                />
                <div
                  class="detail-region-toolbar"
                  ref={(el) => (detailToolbarDiv = el)}
                />
              </div>
              <div
                class="detail-region-host"
                ref={(el) => (detailHostDiv = el)}
              />
            </div>
            {hasGraphRegion && (
              <RecordGraphRegion
                schema={schema}
                records={selectedGraphRecords()}
                field={detailGraphField()}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
