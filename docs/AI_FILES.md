# Карта файлов и компонентов web-gui

Обновлено: 2026-10-22 17:38 UTC+3.

Пакет по эскизу (4.70.0): `SketchRequestDialog.jsx`/`.css` в
`src/components/tasks/` — ввод и выдача файлов; `Tasks.jsx` владеет открытием,
`SidePanel.jsx` — командой. `src/services/sketchRequestService.js` проверяет
входы/собирает запрос, `sketchContextService.js` извлекает текущие схемы,
`zipStore.js` пишет ограниченный ZIP. `data/ai-context/` хранит профиль и lock.
`test/sketchRequest.test.js` и `scripts/check-sketch-request-browser.mjs`
проверяют пакет/диалог; браузер использует существующий taskOperations fixture.
[UI](AI_UI_CONTRACTS.md#sketch-request-ui) ·
[Формат](AI_CLARK_INTEGRATION.md#sketch-request-package).

Общий диск (4.69.0): `src/services/projectDiskAccessService.js` — маска,
перечисление каталогов, IndexedDB, уведомление и проверка разрешения; файл
совпадает с Viewer. `TaskDocsGallery.jsx` — подсказка в нижнем списке DOCS.
`scripts/check-shared-disk-browser.mjs` проверяет два GUI на одном origin;
стенд `test/browser/projectDisk.fixture.jsx` находится в Viewer.

Доступ к диску (4.68.0): `src/services/taskAccessService.js` — запрос/ответ
`bind-catalogs`; `src/components/tasks/TaskAccessDialog.jsx`/`.css` —
общая панель выбора диска и связывания. `Tasks.jsx` владеет выбором дочернего
каталога, `App.jsx`/`TaskInfoBar.jsx` согласуют старт со справкой.
Проверки: `test/taskAccessService.test.js`, `test/taskDirectoryPermissions.test.js`,
`test/browser/taskAccess.fixture.jsx`, `scripts/check-task-access-browser.mjs`.
`scripts/browser-project-access.mjs` открывает новый диалог в существующих проверках.

## Назначение

Документ является канонической картой дерева проекта, точек входа, владельцев
реализации и направлений зависимостей. Поведение компонентов здесь не
пересказывается: точные контракты находятся в
[`AI_DATA_CONTRACTS.md`](AI_DATA_CONTRACTS.md),
[`AI_UI_CONTRACTS.md`](AI_UI_CONTRACTS.md) и
[`AI_CLARK_INTEGRATION.md`](AI_CLARK_INTEGRATION.md).

Карта проверена по `main` на коммите `105d7789c63ef9e012dbb4328b812de7535c72d3`.
Карта дополнена изменениями 4.42.0 и общими модулями истории/проигрывания 4.51.0.

## 1. Точки входа и конфигурация

| Путь | Ответственность |
|---|---|
| `index.html` | HTML-точка входа Vite и контейнер приложения. |
| `src/index.jsx` | Инициализация SolidJS и монтирование корневого `App`. |
| `src/App.jsx` | Корневая координация выбора задания, загрузки, редакторов, сохранения, диагностики, окон и глобальных состояний. Не является владельцем предметных преобразований. |
| `src/App.css` | Общая компоновка приложения и глобальное оформление. |
| `src/services/horizontalDragScroll.js` | DOM-адаптер горизонтальной прокрутки существующих областей вкладок правой кнопкой мыши; подключается в `App`. |
| `test/horizontalDragScroll.test.js` | Проверки событий, выбора области прокрутки и освобождения обработчиков адаптера. |
| `src/services/browserContextMenu.js`, `test/browserContextMenu.test.js` | Подавление штатного меню браузера на уровне документа; подключение и очистка в `App`, сохранение событий приложения. [Контракт](AI_UI_CONTRACTS.md#browser-context-menu). |
| `src/TaskInfoBar.jsx`, `src/TaskInfoBar.css` | Верхняя строка сведений о выбранном задании и состоянии данных. |
| `package.json` | Версия приложения, зависимости и канонические npm-команды. |
| `vite.config.js` | Конфигурация Vite, раздача примеров и включение third-party-notices в сборку. |
| `docs/user-guide/index.html`, `guide.css`, `guide.js`, `images/`, `evidence/` | Каноническое пользовательское HTML-руководство на единой странице, включая математическую модель (раздел 16); не импортируется в SPA. |
| `scripts/user-guide-assets.mjs` | Подготовка `.generated/user-guide` и побайтовая SHA-256-проверка `dist/user-guide`. |
| `scripts/check-online-guide-browser.py`, `test/browser/guideMaterials.fixture.jsx` | Автономный браузерный стенд справки и реальных библиотечных компонентов с управляемыми файловыми дескрипторами; не включается в production. |
| `test/userGuideAssets.test.js`, `test/materialLibrarySource.test.js` | Проверки доставки, ссылок и контрактов выбора источника. |
| `public/examples-config.json` | Публичная конфигурация примеров и адреса установщика Clark. |

## 2. Основные каталоги

| Каталог | Содержание и направление зависимостей |
|---|---|
| `src/components/` | SolidJS-компоненты интерфейса; используют сервисы и чистые модели, но не должны становиться владельцами предметных правил. |
| `src/tabs/` | Верхнеуровневые вкладки выбора задания и библиотек материалов. |
| `src/services/` | Состояния приложения, предметные операции, файловый ввод-вывод и чистые преобразования. |
| `src/tabulator/` | Адаптация схем и BaseModel к Tabulator: builders, converters, editors, formatters, actions и views. |
| `src/assets/` | Импортируемые Vite статические ресурсы интерфейса. |
| `data/default/` | Исходный комплект встроенных readonly-библиотек ФММ/ВТСП; производные ресурсы создаёт `scripts/default-library-assets.mjs`. |
| `data/demo/` | Исходные файлы встроенного демонстрационного задания; производный пакет создаёт `scripts/prepare-demo-assets.mjs`. |
| `public/` | Ресурсы, копируемые в сборку без преобразования, включая примеры и базовые библиотеки. |
| `resource/` | Служебные изображения знаков, сохраняемые как исходные ресурсы проекта. |
| `scripts/` | Подготовка ресурсов, dev/build/LAN-сценарии и HTTP-раздача примеров. |
| `deploy/caddy/` | Конфигурация и установка локального HTTPS-сервера Caddy. |
| `test/` | Node.js-тесты функций и контрактные проверки исходного текста. |
| `.github/workflows/` | Независимая сборка и публикация GitHub Pages. |
| `docs/` | Человеческие точки входа и канонические AI-документы. |

## 3. Модель данных и сериализация

| Владелец | Путь | Ответственность |
|---|---|---|
| Фабрика схем | `src/services/schemaFactory.js` | Нормативная форма схемы и дескрипторов свойств. |
| Реестр вкладок | `src/services/tabRegistry.js` | Единственный состав вкладок модели задания и связь вкладки со схемой. |
| Предметные схемы | `src/services/schemas/*.schema.js` | Контракты `general`, `conrab`, `elements`, `regions`, `amps`, `moves`, `mhj`, библиотек ФММ и ВТСП. |
| Состояние модели | `src/services/modelService.js` | Публикация BaseModel и ревизий, атомарные группы `setModelParts`; не владеет табличным представлением. |
| Сериализация | `src/services/model/modelSerializer.js` | Преобразование StorageModel ↔ BaseModel. |
| Форма ARRAY | `src/services/model/arrayShape.js` | Размеры, ориентация и индексация плоских массивов. |
| Вычисления | `src/services/model/modelCompute.js` | Единый граф `compute`/`computeStored`, нормализация и transient-патчи. |
| Смена варианта | `src/services/model/variantChange.js` | Согласованное преобразование вариантных ARRAY при изменении `geo`. |
| История модели | `src/services/modelHistoryService.js` | Undo/Redo-снимки редактируемой модели задания. |
| Загрузка/сохранение | `src/services/dataService.js` | Файловый ввод-вывод задания и преобразование между файлами и BaseModel. |
| Несохранённые данные | `src/services/unsavedChangesService.js` | Базовые версии вкладок, явные dirty-признаки и общий перечень изменений. |

## 4. Табличный слой

| Область | Пути и владельцы |
|---|---|
| Построение | `src/tabulator/builders/TableBuilder.js` создаёт таблицы по схеме и подсказки номеров записей при `rowNumberTooltip`; `src/services/schemaFactory.js` передаёт настройку. `test/recordRowTooltip.test.js` проверяет реальные схемы и построитель. `src/tabulator/tableOptions.js` владеет общими инвариантными опциями. |
| Ширина подписей конфигурации | `src/services/schemas/conrab.schema.js` выбирает `rowLabelWidth: "auto"`; `TableBuilder.js` передаёт измерение колонки штатной раскладке Tabulator. |
| Разрешение свойств | `src/tabulator/schema/propertyResolver.js` — единственная точка получения эффективного дескриптора свойства для ячейки. |
| Преобразования | `src/tabulator/converters/` содержит ARRAY/RECORDS/CLUSTER-кодеки, вычисляемые представления, подписи строк и geo-варианты. |
| Смена типа в таблице | `src/components/editors/DataEditor.jsx` передаёт контекст `cellEdited` в вариантную реакцию; `test/dataEditorVariantChange.test.js` проверяет реальные обработчики, геометрию, историю и ограничения названия. [Контракт](AI_DATA_CONTRACTS.md#element-geometry-examples). |
| Форматирование | `src/tabulator/formatters/formatterRegistry.js` и `universalFormatter.js`. |
| Редактирование | `src/tabulator/editors/editorRegistry.js`, `editorFactory.js`, `universalEditor.js`; `test/inputEditorKeyboard.test.js` проверяет клавиши ввода и сохранение фокуса. |
| Представления | `src/tabulator/views/viewRegistry.js`, `TableView.js`, `DetailRegion.js`, `HtsMaterialDetailView.js`, `registerDefaultViews.js`. |
| Операции | `src/tabulator/actions/recordsActions.js` и `elementMaterialActions.js`. |

## 5. Валидация и диагностика

| Владелец | Путь | Ответственность |
|---|---|---|
| Ограничения значения | `src/tabulator/validators/types/constraintValidator.js` и `src/tabulator/validators/constraints/` | Диспетчер и зарегистрированные проверки дескрипторных ограничений отдельной ячейки. |
| Модельные ограничения | `src/tabulator/validators/types/modelValidator.js`, `src/tabulator/validators/models/modelRegistry.js` и профильные каталоги `models/*/` | Условные, межполевые и предметные проверки BaseModel. |
| Unknown без свойств материала | `src/tabulator/validators/models/elements/elementsValidator.js`, `src/services/solver/kvDerived.js`; `test/elementsValidator.test.js` | ERROR для немагнитного Unknown с GAM=0, исходный номер строки; проверка через общий modelValidator. [Контракт](AI_DATA_CONTRACTS.md#unknown-element-sources). |
| Название элемента | `src/services/schemas/common/elementNameConstraints.js`, `src/services/schemas/elements.schema.js`, `src/tabulator/validators/models/elements/elementsValidator.js`; `test/modelElementNames.test.js` | Единый дескриптор для схемы и модельного ERROR; тест общей команды проверки с фактическими обработчиками App. [Контракт](AI_DATA_CONTRACTS.md#element-names). |
| Сводка ограничений | `src/services/modelConstraintDiagnostics.js` | Подсчёт нарушений независимо от наличия экземпляров таблиц. |
| Готовая иерархия JWeak1 | `src/services/jweakLocalService.js`, `src/services/solver/jweakLocalValidation.js` | Readonly-загрузка, проверка неизменности файла, допустимость родителей; публикация в `modelService.setJweakLocal`, координация в `App`. [Контракт](AI_DATA_CONTRACTS.md#jweak-local-input). |
| Общая диагностика | `src/services/diagnosticService.js` | Нормализация и группировка ошибок с координатами вкладки, записи и поля. |
| UI диагностики | `src/components/diagnostics/` | Окно сообщений и индикаторы проверки; не определяют предметные условия. |
| Ссылки материалов | `src/services/materialReferenceValidation.js` | Проверка `elements.xapName` относительно доступных библиотек. |

Фактические имена отдельных validator-файлов и регистраций следует искать через
импорты `modelRegistry` и схем; критерии проверки находятся в
[`AI_VERIFICATION.md`](AI_VERIFICATION.md).

## 6. Выбор задания, файловые операции и Clark

| Владелец | Путь | Ответственность |
|---|---|---|
| Выбор | `src/services/selectionService.js` | Выбранные проект и задание, а также версия загруженных данных. |
| История открытия | `src/services/taskLastOpenedService.js` | Сортировка каталогов, чтение и запись позиций последнего открытия в корне выбранного каталога. [Контракт](AI_UI_CONTRACTS.md#task-last-opened). |
| Знак последнего открытия | `src/components/tasks/LastOpenedTaskMarker.jsx`, `.css` | Общий SVG-треугольник и реактивное значение нативного списка проектов; синхронизированы с Viewer. |
| Проверка среды | `src/services/fileSystemAccessSupport.js` | Наличие безопасного контекста и File System Access API, классификация ошибок диалогов. |
| Подтверждение задания | `src/services/taskApprovalService.js` | Маркер разрешения расчёта и его файловый жизненный цикл. |
| Список и запуск | `src/services/taskLaunchService.js` | `clark.tasks.txt`, связь с обработчиком `clark://` и формирование команд запуска. |
| Окно запуска | `src/components/tasks/TaskLaunchWindow.jsx` | Представление списка и операций; предметный файловый контракт остаётся у сервиса. |
| Редактор OM | `src/components/tasks/OMClientWindow.jsx`, `.css`; подключение — `src/tabs/Tasks.jsx`/`.css` | Немодальное окно загруженного задания; данные модели и обмена, пресеты, защита черновика при загрузке другой задачи. `App.jsx` уступает ему Ctrl+S при фокусе внутри окна. [UI](AI_UI_CONTRACTS.md#om-client-editor). |
| Форма OM | `src/components/tasks/OMModelForm.jsx`, `src/services/omModelForm.js`, `src/services/omClarkBindings.js`; `test/omModelForm.test.js`, `test/omClarkBindings.test.js` | Отображение contract.ui, координатное изменение размеров массивов, readonly-каталог Clark. [Контракт](AI_CLARK_INTEGRATION.md#om-client-input-editor). |
| JSON OM | `src/services/omClientService.js`; `test/omClientService.test.js` | Чтение, валидация по контракту пресета и readonly импульсам, проверка сохранённого `amplitudes.txt` и внешних изменений, запись трёх JSON, переключение `om-client.json`/`_om-client.json` с восстановлением при ошибке. [Контракт](AI_CLARK_INTEGRATION.md#om-client-input-editor). |
| Пресеты OM | `src/data/om-presets/circuit-single.json`, `circuit-star.json` | Единый `/2` и пакет 2.0.0, ссылки на импульсы. Частного пресета 204 нет; существующие задания используют общий контракт цепи. [Формат](AI_CLARK_INTEGRATION.md#om-pulse-inputs). |
| Примеры цепи OM | `data/om-examples.json` → `.generated/examples/clark.projects/Open Modelica/test_circuit_*`; `test/omCircuitExample.test.js` | Самостоятельные постановки с подключённой и свободной нейтралью; второй вариант — Fortran, 220 В, L/R=0. Источники сравнения хранятся только в clark.tests. [Происхождение](AI_CLARK_INTEGRATION.md#om-test-204-example). |
| Пресеты OM | `src/services/omClientPresets.js`, `src/data/om-presets/*.json` | Встроенные JSON-шаблоны и запоминаемые браузером импортированные `editor-preset.json`. Контракт расширяется данными, без диспетчера по имени модели. |
| Предпросмотр | `src/services/taskGeometryPreviewService.js`, `src/components/geometry/TaskGeometryPreview.jsx` | Подготовка и показ геометрии выбранного, но ещё не загруженного задания. |
| Вкладки GIF/DOCS | `src/components/tasks/TaskMediaPanel.jsx`, `TaskMediaPanel.css` | Локальные вкладки и счётчики, отдельные области изображений/текста; подключение к выбранному заданию в `src/tabs/Tasks.jsx`. [Контракт](AI_UI_CONTRACTS.md#task-docs-gallery). |
| Галереи и окно | `src/components/tasks/TaskImageGallery.jsx`, `TaskMediaDialog.jsx`, `TaskGifGallery.css` | Общая сетка, действия, видимость миниатюр, модальное окно изображений и текста. Префикс CSS `task-gif-` сохранён для общей оболочки. |
| Специализация галерей | `src/components/tasks/TaskGifGallery.jsx`, `TaskDocsGallery.jsx` | GIF подключает плеер и удаление; DOCS — изображения и текст только для чтения. |
| Жизненный цикл изображений | `src/services/taskImageGalleryController.js`, `taskGifGalleryController.js` | Общая ограниченная очередь, счётчик скрытой галереи, отмена и освобождение URL; GIF-обёртка задаёт файловый сервис и удаление. |
| Документация задания | `src/services/taskDocsService.js`, `taskDocsTextController.js` | Чтение DOCS, форматы, порядок и выбор README; отдельная очередь и защита актуальности выбранного текста. |
| Файлы GIF | `src/services/taskGifService.js` | File System Access API для списка, чтения, записи, удаления и уведомлений об изменении. Editor использует просмотр и удаление; сохранение фильма вызывает Viewer. |
| Проверки GIF | `test/taskGifGallery.test.js`, `test/taskGifService.test.js` | Проверки контроллера, обработчиков компонента и файлового сервиса. [Методика](AI_VERIFICATION.md#verification-task-gifs-441). |
| Проверки DOCS и общей панели | `test/taskDocs.test.js`, `test/browser/taskMedia.html`, `test/browser/taskMedia.fixture.jsx`, `scripts/check-task-media-browser.mjs` | Файловый сервис и контроллер текста; браузерные сценарии с реальным Solid, OPFS, изображениями и диалогами. [Методика](AI_VERIFICATION.md#verification-task-docs). |
| Сводки | `src/services/taskSummaryService.js` | Формирование и запись `input3XX/_summary.txt` из снимка сохраняемой модели; чтение обеих сводок без разбора результатов. Вызов записи — `App.handleSave`. [Контракт](AI_CLARK_INTEGRATION.md#task-summaries). |
| Демо | `src/services/demoTaskService.js` | Загружаемая копия демонстрационного задания в памяти браузера. |
| Примеры | `src/services/examplesService.js`, `src/components/help/ExamplesInstaller.jsx` | Установка дерева примеров из HTTP-источника. |

Компоненты GIF/DOCS, их CSS, контроллеры, файловые сервисы и профильные тесты,
включая браузерный сценарий, поддерживаются одинаковыми в `clark-editor`
и `clark-viewer`. Это общая реализация
двух репозиториев; её подробный контракт в Editor —
[AI_UI_CONTRACTS](AI_UI_CONTRACTS.md#task-gif-gallery).

## 7. Библиотеки материалов

| Владелец | Путь | Ответственность |
|---|---|---|
| Реестр вкладок | `src/services/materialTabRegistry.js` | Состав вкладок библиотек вне модели задания. |
| Базовые данные | `src/services/defaultLibraryService.js` | Неизменяемые JSON-библиотеки из ресурсов сборки. |
| Локальные данные | `src/services/taskMaterialLibraryService.js` | Чтение и безопасная запись библиотек выбранного задания. |
| Модель/раскладка | `src/services/materials/materialLibraryModel.js`, `materialLibraryLayout.js`, `materialConstants.js` | Нормализация структуры и представления библиотек. |
| Загрузка | `src/services/materials/materialLibraryLoadQueue.js`, `materialLibraryService.js` | Очередь и координация источников библиотек. |
| Ревизии и история | `src/services/materialLibraryRevisionService.js`, `materialLibraryHistoryService.js` | Независимые ревизии и Undo/Redo вне BaseModel задания. |
| Импорт | `src/services/materialImport/` и `materialImportService.js` | Импорт legacy ФММ и конфигураций ВТСП. |
| UI | `src/tabs/MaterialLibraryTab.jsx`, `src/components/materials/` | Таблицы, графики и диалоги библиотек. |

## 8. Генераторы, графики и представления-ссылки

| Область | Владелец |
|---|---|
| Замена таблиц из буфера | `src/services/timeTableClipboard.js`; действия `views.clipboardTables` в `amps.schema.js`/`moves.schema.js`; координация `DataEditor.jsx`, `App.jsx`, `SidePanel.jsx` |
| Проверка вставки TSV | `test/timeTableClipboard.test.js`, `scripts/check-time-table-clipboard-browser.mjs`; реальное приложение через `test/browser/editorFeatures.fixture.jsx` |
| Формулы времени | `src/services/generator/timeFunctionExpression.js` |
| Временная сетка и применение | `src/services/generator/timeFunctionModel.js` |
| Файловая история формул | `src/services/generator/timeFunctionHistoryService.js` |
| Окно генератора | `src/components/generator/TimeFunctionGenerator.jsx` и `.css`, контейнер `src/components/editors/DataEditor.css` |
| Модель графика RECORDS | `src/services/graphs/recordGraphModel.js` |
| Копирование графиков | `src/services/graphs/graphClipboard.js` |
| Контекстное меню/область | `src/components/graphs/GraphContextMenu.jsx`, `RecordGraphRegion.jsx` |
| View-only-ссылки | `src/services/referenceViewService.js`, `src/services/references/modelReferenceViews.js` |

## 9. 3D-визуализация

| Владелец | Путь | Ответственность |
|---|---|---|
| Окно/viewport | `src/components/geometry/GeometryViewerWindow.jsx`, `ThreeGeometryViewport.jsx` | Жизненный цикл окна и Three.js-сцены. |
| Плавающий прямоугольник | `src/components/window/FloatingWindow.jsx`/`.css`; `test/floatingWindowDrag.test.js`, `test/floatingWindowContract.test.js` | Подстройка 3D при drag по текущему размеру до половины ширины с пропорциональной viewport высотой, ручной resize за стороны/угол, ограничение viewport и сохранение UI-состояния; необязательная высота по содержимому для [панели катушки](AI_UI_CONTRACTS.md#uniform-field-coil); фиксированная ширина и разворачивание по высоте для [окна OM](AI_UI_CONTRACTS.md#om-client-editor); проверка реальных обработчиков. |
| Сцена | `src/services/visualization/geometrySceneModel.js` | Чистая проекция `general`, `elements`, `regions`. |
| Время | `src/services/visualization/geometryTimeModel.js` | Положение, углы и амплитуды в выбранный момент. |
| Источники | `src/services/visualization/sourceVectorSceneModel.js` | Векторы `mhj`, AS/PS и симметричные образы. |
| Дискретизация | `src/services/visualization/geometryDiscretization.js` | Линии, центры, узлы и билинейные поверхности для отображения. |
| Камера | `geometryCameraView.js`, `geometryCameraFit.js` | Осевые виды и вписывание по текущей проекции. |
| Фильтры/стиль/picking | `geometryRenderFilters.js`, `geometryMaterialStyle.js`, `geometryPicking.js` | Видимость, палитра и адресные подписи объектов. |
| Solver-совместимая математика | `src/services/solver/rotation3d.js`, `symmetryExpansion.js`, `geometryKv.js`, `geometryTk.js`, `kvDerived.js`, `tkDerived.js`, `mhjLayout.js` | Прослеживаемые преобразования, перенесённые из Julia-решателя. |
| Допуск параллельности ШГ | `src/services/solver/geometryValidationSettings.js`, `geometryKv.js`, `schemas/conrab.schema.js` | GEO_ANGLE: default, активный профиль и пять исторических пар; [контракт](AI_DATA_CONTRACTS.md#geometry-measurement-diagnostics). |

## 10. Сборка, ресурсы и поставка

| Путь | Ответственность |
|---|---|
| `scripts/default-library-assets.mjs` | Подготовка и проверка базовых библиотек. |
| `scripts/prepare-examples-config.mjs` | Проверка и подготовка публичной конфигурации примеров. |
| `scripts/prepare-demo-assets.mjs` | Подготовка демонстрационных данных. |
| `scripts/serve-examples-assets.mjs` | Корректная HTTP-раздача дерева примеров в Vite. |
| `scripts/dev.cmd`, `build-local.cmd`, `release-lan.cmd` | Windows-сценарии разработки, сборки и LAN-выпуска. |
| `scripts/caddy/`, `deploy/caddy/` | Локальный HTTPS и конфигурация Caddy. |
| `.github/workflows/agent-check.yml` | Сборка на Ubuntu и Windows; тесты только при ручном параметре. |
| `.github/workflows/deploy-pages.yml` | Сборка и публикация GitHub Pages. |

Команды, предусловия и артефакты не дублируются здесь и находятся в
[`AI_BUILD_AND_RUNTIME.md`](AI_BUILD_AND_RUNTIME.md).

## 11. Тесты

Каждый файл `test/*.test.js` проверяет одноимённый сервис, модель или контракт
представления. Основные группы: модель и сериализация, схемы и ограничения,
табличные представления, библиотеки материалов, выбор и запуск задания,
генераторы, 3D-геометрия, сборочные ресурсы и файловые операции.

Точное состояние, команды и правила интерпретации результатов находятся только
в [`AI_VERIFICATION.md`](AI_VERIFICATION.md). Добавляя новый существенный
владелец поведения, следует добавить его в настоящий документ и определить
соответствующую проверку либо явно зафиксировать причину её отсутствия.


## 12. Подробные связи владельцев

Таблицы выше служат навигацией. Ниже находятся дополнительные границы и связи,
которые необходимо учитывать при изменении нескольких компонентов.

Schema (createSchema, tabRegistry), StorageModel, BaseModel, modelSerializer,
modelCompute, arrayShape, modelConverter, variantChange, arrayViewCodec,
computedView, referenceViewService, rowLabel, TableBuilder, tableOptions.

`modelCompute` — единственный владелец общего графа
`compute`/`computeStored`, определения участия свойства в StorageModel,
нормализации BaseModel и формирования transient-патчей вычисленных значений.

Инструменты обработки значения: universalFormatter / formatterRegistry,
universalEditor / editorRegistry / editorFactory, constraintValidator /
реестр ограничений.

Представления: ViewRegistry, ViewAdapter, View (TableView), DetailRegion и
основная View-проекция свойства вкладки.
`recordsActions.removeRecord` использует `TableView`-обработчик пакетного
удаления ARRAY; реальные таблицы/история/сохранение проверяются сценарием
`scripts/check-bulk-delete-browser.mjs` на общей `editorFeatures.fixture.jsx`.
[Контракт](AI_UI_CONTRACTS.md#bulk-array-delete).
Представление 3D-геометрии: GeometryViewerWindow,
ThreeGeometryViewport и общий UI-компонент FloatingWindow.

Прикладная проверка: modelValidator, modelRegistry.

Генерация временных зависимостей разделена на безопасный разбор
выражений, формирование временной сетки, применение результата и файловую
историю формул.
Проверку ссылок `xapName` на доступные библиотеки выполняет
`materialReferenceValidation`.

Сервисы состояния: modelService, diagnosticService, selectionService,
selectionContextService, clipboardService, dataService и
`unsavedChangesService`.
Подготовка 3D-сцены исходной геометрии выполняется чистым
`geometrySceneModel`; чистый `geometryDiscretization` рассчитывает
линии разбиения, центры и узлы только для 3D-представления.
Матрицы поворотов и раскрытие симметрий
принадлежат прослеживаемым до решателя модулям
`rotation3d` и `symmetryExpansion`. Чистый `geometryRenderFilters` владеет
режимами видимости исходных записей и образов симметрии, а
`geometryPicking` — адресными подписями объектов, вершин,
центров элементарных объёмов и узлов областей.

Базовые характеристики обслуживают `defaultLibraryService` и отдельный
`materialTabRegistry`. Чтение, копирование, импорт, редактирование и удаление в
локальной библиотеке выбранного задания выполняет
`taskMaterialLibraryService`; отдельную ревизию файлов публикует
`materialLibraryRevisionService`, независимо для ФММ и ВТСП. Несохранённые
снимки представления применяет `materialLibraryHistoryService` через контроллер
соответствующей вкладки. Эти операции не изменяют BaseModel задания и не
участвуют в его истории Undo/Redo.

`selectionService` хранит выбранное задание, его путь, признак демонстрационного
задания `loadedTaskIsDemo` и версию загруженных данных.
`selectionContextService` хранит активный экземпляр таблицы и ревизию
его выделения для операций панели; он не владеет выбранным заданием и не
дублирует состояние `selectionService`.

`fileSystemAccessSupport` является единственным владельцем проверки клиентского
окружения для операций с локальными файлами. Перед открытием системного диалога
UI проверяет `window.isSecureContext` и наличие требуемого метода File System
Access API. Для полной функциональности рекомендуются актуальные настольные
Google Chrome и Microsoft Edge. Название браузера не является условием запрета:
доступность конкретной файловой операции определяется безопасным контекстом и
наличием нужного API. При его отсутствии показывается объяснение и рекомендация
браузера. Отдельный Chromium SDK на клиенте не требуется.

Корневой каталог проектов выбирается с `mode: "readwrite"`: одно разрешение
покрывает чтение исходных данных, обычное сохранение и запись локальных
характеристик. Legacy-библиотека ФММ `XAP.lib` читается через уже выбранный
каталог задания. Пользовательский сценарий legacy-импорта ВТСП отсутствует.

Кнопка «Демо» находится справа в строке выбора каталога, имеет жёлтую надпись
и ширину по тексту. Она загружает «Демонстрационную задачу» без выбора локального
каталога. `scripts/prepare-demo-assets.mjs` упаковывает `data/demo` в статический
ресурс `.generated/demo-task.json`; пути и байты файлов сохраняются в пакете.
`demoTaskService` получает его с учётом `import.meta.env.BASE_URL` и при каждом
запуске демо создаёт отдельное записываемое дерево файлов в памяти браузера.
Содержимое `data/demo` представляется в этом дереве каталогом `input3XX`.

Демо проходит общий сценарий загрузки: предупреждение о несохранённых данных,
сброс прежней модели и диагностики, обновление предпросмотра, сводок и редакторов.
Таблицы, история и операции записи локальных характеристик работают с рабочей
копией. `DataEditor` и библиотечные сервисы используют обычный интерфейс
directory/file handle; отдельная копия BaseModel или отдельный парсер не создаётся.
В режиме демо `App` не выполняет сохранение модели, а `TaskInfoBar` отключает
кнопку «Сохранить модель». Просмотр каталога сообщает, что демо находится в памяти
браузера, без передачи виртуального handle системному диалогу. При загрузке
обычного задания признак демо сбрасывается. Повторное открытие демо и перезагрузка
страницы возвращают исходный набор данных; изменения рабочей копии не публикуются.

Выбором базового каталога владеет `Tasks`: кнопка «Выбрать каталог с проектами»
допускает произвольное имя и расположение.
`clark.projects` остаётся обычным именем каталога примеров. Требования
File System Access API и разрешение `readwrite` сохраняются.

Отказ пользователя в системном диалоге представлен только `AbortError` и
обрабатывается без сообщения. Небезопасный контекст, отсутствие API, отказ в
разрешении и прочие ошибки открытия системного файлового диалога показываются
пользователю в модальном окне; их запрещено оставлять только в консоли или
подавлять.

Допустимое направление зависимостей: UI и View → адаптеры и реестры → чистые
форматтеры, валидаторы и модельные модули. Форматтеры, валидаторы и schema не
зависят от TableView или UI-компонентов.

`src/services/modelReferenceValidation.js` — чистая проверка ссылок на `amps`/`moves`
и допустимого кода виртуального направления; вызывается валидаторами элементов
и областей. [Контракт](AI_DATA_CONTRACTS.md#time-references),
тесты — `test/modelReferenceValidation.test.js`.

## Маршрут по намерению, 22.09.2026

| Намерение | Прочитать и использовать |
|---|---|
| Сгенерировать/укрупнить ШГ | [AI_GEOMETRY_GENERATION.md](AI_GEOMETRY_GENERATION.md), схемы elements/regions, solver-совместимая геометрия, MED-анализ |
| Изменить сохранение input3XX | [AI_DATA_CONTRACTS.md](AI_DATA_CONTRACTS.md), [AI_CLARK_INTEGRATION.md](AI_CLARK_INTEGRATION.md), modelSerializer/dataService |
| Разобраться в текущем J/λ | [solver/AI_NUMERICAL_CONTRACTS.md](https://github.com/y26084670-blip/solver/blob/main/docs/AI_NUMERICAL_CONTRACTS.md#nc-jweak-nonlinear) и src/vsolver/02_current_newton.jl |
| Сравнить расчёт с эталоном | [clark.tests/AI_FILES.md](https://github.com/y26084670-blip/clark.tests/blob/main/docs/AI_FILES.md), затем контракт задачи и датированные данные |

Проверенная база кода для этого маршрута: web-gui f8c85c8a3197eb50e3baf5030d06831244b86528,
solver ab322751dc1756471b657902f675f12cac514693. Другие даты в карте относятся
к своим разделам и не подтверждают повторную проверку всего проекта.

## Файловые команды заданий (4.29.0)

- `src/services/taskDirectoryService.js` — имена, состав копии, последовательное
  копирование, SHA-256, проверка источника, перенос, удаление и обновление списка запуска.
- `src/services/taskTemplateService.js` — начальная модель через текущие схемы,
  `dataService` и штатную сводку; не содержит отдельного формата solver.
- `src/components/tasks/TaskOperationDialog.jsx` / `.css` — имя, подтверждение,
  состояние операции и ошибки; `Tasks.jsx` владеет выбором и обновлением путей.
- `App.jsx` передаёт доступные действия в `SidePanel.jsx`; доступность сохраняет
  единственный источник состояния в `Tasks`.
- `TaskInfoBar.jsx` / `.css` — кнопка «Документация» и адрес с `BASE_URL`.
- `test/taskDirectoryService.test.js`, `test/browser/taskOperations.fixture.jsx`,
  `scripts/check-task-operations-browser.mjs` — файловые отказы и браузерная приёмка.

Механизм: [файловый контракт](AI_CLARK_INTEGRATION.md#task-directory-operations).

## Сеансовые опции 3D

`src/services/visualization/geometryViewSettings.js` — скалярные настройки показа,
независимые от загруженного задания и времени жизни окна.
[Контракт](AI_UI_CONTRACTS.md#geometry-session-settings).
`test/geometryViewSettings.test.js` проверяет сохранение при смене владельца.

## Автоперенос ФММ при импорте списка

`src/services/taskImportMaterialsService.js` — сбор уникальных имён по свежему
kvs.txt, выбор записей локальной XAP.lib и пакетная запись штатным сервисом.
`Tasks.handleLaunchComplete` вызывает его до обновления представления;
`TaskLaunchWindow.finishRun` передаёт контекст запуска и отображает отчёт.
[Контракт](AI_CLARK_INTEGRATION.md#task-import-used-fmm).
`test/taskImportMaterialsService.test.js` — файловые и предметные проверки.

Выборочный импорт ФММ: `taskImportMaterialsService.js::importUsedFmmMaterials`
— общая операция над переданными элементами; `MaterialLibraryTab.jsx` передаёт
текущую BaseModel, `importUsedTaskMaterials` — свежие записи kvs.txt после
импорта списка. Контракт: [AI_CLARK_INTEGRATION](AI_CLARK_INTEGRATION.md#task-import-used-fmm).

## Добавления 4.42.0

| Владелец | Файлы | Ответственность |
|---|---|---|
| Катушка | `src/services/generator/uniformFieldCoil.js` | Аналитика, проверка параметров, генерация Elements+MHJ. |
| Окно катушки | `src/components/elements/UniformFieldCoilDialog.jsx`, `.css` | Ввод параметров и реактивная оценка; SidePanel/App координируют применение. |
| Групповая история | `src/services/modelHistoryService.js` | Связанные снимки нескольких вкладок без изменения независимых историй. |
| Проигрывание GIF | `src/components/tasks/TaskGifPlayer.jsx`, `src/services/taskGifPlayback.js` | Canvas, таймеры, предварительная подготовка кадра, crossfade при максимизации, пауза/продолжение, одиночный проход и цикл. |
| Декодирование GIF | `src/services/taskGifDecoder.js`, `src/workers/taskGifDecode.worker.js` | Последовательная декомпрессия и композиция кадров вне UI-потока. |
| Проверки | `test/uniformFieldCoil.test.js`, `test/modelHistoryService.test.js`, `test/taskGifDecoder.test.js`, `test/taskGifPlayback.test.js` | Численная сверка аналитики, схема, история, направления токов, GIF disposal и таймеры. |

## Расширения Editor 4.45.0

| Владелец | Ответственность |
|---|---|
| `src/services/generator/uniformFieldCoil.js` | Начальные значения, углы `symVi`, dvi=20°, floor(360/dvi) и диапазон геометрии/MHJ через mhjLayout. |
| `src/components/elements/UniformFieldCoilDialog.jsx`, `.css` | Поле dvi, индикаторы углов, число образов и предупреждение об угловом остатке. |
| `src/services/modelSaveShortcut.js` | Capture-обработчик Ctrl+S, подавление повторов и освобождение обработчика. |
| `src/App.jsx`, `src/components/editors/DataEditor.jsx` | Flush активного редактора, защита контекста задания и обычное сохранение. |
| `src/services/visualization/geometryCameraView.js`, `src/components/geometry/ThreeGeometryViewport.jsx` | Общий начальный ракурс и команда Ctrl+A. |
| `src/services/materials/constantMuFmm.js` | Чистая генерация 12 точек и запись через существующий сервис библиотеки. |
| `src/components/materials/ConstantMuFmmDialog.jsx`, `.css` | Нативное модальное окно и предпросмотр в памяти. |
| `src/components/SidePanel.jsx`, `src/tabs/MaterialLibraryTab.jsx` | Вызов из шторки, применение локальной характеристики без потери других dirty-строк. |
| `test/constantMuFmm.test.js`, `test/modelSaveShortcut.test.js` | Предметные и событийные проверки новых сервисов. |
| `scripts/check-editor-features-browser.mjs`, `test/browser/editorFeatures.fixture.jsx` | Приёмка actual App/Tabulator/WebGL и файловой записи в Chromium OPFS. |

[UI-контракты](AI_UI_CONTRACTS.md#model-save-shortcut) ·
[Методика](AI_VERIFICATION.md#verification-editor-445).

## Примеры ОМ и открытое редактирование — 4.59.0

`data/om-examples.json` — сформированная поставка канонических входов clark.tests;
`scripts/om-examples-bundle.mjs` проверяет пути/хеши перед объединением примеров.
TaskLaunchWindow показывает тёмную модальную ошибку количества подключённых заданий.
App/jweakLocalService перечитывают readonly-иерархию для проверки/MED без запрета
внешнего редактирования; taskMaterialLibraryService допускает явное сохранение
после внешних изменений. [Контракт данных](AI_DATA_CONTRACTS.md#jweak-local-input).


## Переход к выбранному заданию в Viewer

`src/services/taskSelectionChannel.js` и `test/taskSelectionChannel.test.js` общие
с Viewer. `scripts/check-task-selection-browser.mjs` проверяет два настоящих
BroadcastChannel/OPFS контекста; headless-фокус не подтверждает переключение
вкладок пользовательского окна. [Контракт](AI_UI_CONTRACTS.md#выбор-задания-в-другом-приложении).

`src/services/installerDownloadService.js` — команда прямой загрузки и проверка HTTPS-настройки;
`ExamplesInstaller.jsx/.css` — переключатель режима. Проверка: `test/installerDownloadService.test.js`.

### MED: заданный нормальный ток

`medAnalysisService.js` различает контакт Unknown/Unknown и Unknown/J-const;
`medContactGeometry.js::singlePrescribedContactPatch` проверяет 1×1 у донора.
Профильный тест — `test/medPrescribedCurrent.test.js`. Контракт и ограничения:
[AI_DATA_CONTRACTS](AI_DATA_CONTRACTS.md#med-prescribed-current).

`medAnalysisService.js` также вычисляет `ordinaryContactGrid`: проверяет фактические
сетки активных стыков при иерархии и адресно объясняет конфликт с контактным возбуждением.
[Семантика диагностики](AI_DATA_CONTRACTS.md#med-hierarchy-diagnostics); проверки —
`test/medPrescribedCurrent.test.js` и исходный иерархический TEAM7.
