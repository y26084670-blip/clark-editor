import { Show, createEffect, createSignal } from "solid-js";
import { ValidationIndicator } from "./components/diagnostics/ValidationIndicator";
import { GeneralInformationDialog } from "./components/help/GeneralInformationDialog";
import { selectionService } from "./services/selectionService";
import {
  getFilePickerErrorMessage,
  getFileSystemAccessSupport,
  isFilePickerCancellation,
} from "./services/fileSystemAccessSupport";
import aboutIconUrl from "./assets/zaica.BMP";
import packageMetadata from "../package.json";
import { WhatsNewDialog } from "./components/updates/WhatsNewDialog.jsx";
import "./TaskInfoBar.css";

const GENERAL_INFORMATION_STARTUP_KEY = "e3d.generalInformation.openAtStartup";
let generalInformationStartupPreference = true;
let startupPreferenceStorageAvailable = true;

function readGeneralInformationStartupPreference() {
  if (startupPreferenceStorageAvailable) {
    try {
      const saved = window.localStorage.getItem(GENERAL_INFORMATION_STARTUP_KEY);
      if (saved !== null) generalInformationStartupPreference = saved !== "false";
    } catch {
      startupPreferenceStorageAvailable = false;
    }
  }
  return generalInformationStartupPreference;
}

function saveGeneralInformationStartupPreference(enabled) {
  generalInformationStartupPreference = enabled;
  if (startupPreferenceStorageAvailable) {
    try {
      window.localStorage.setItem(GENERAL_INFORMATION_STARTUP_KEY, String(enabled));
    } catch {
      startupPreferenceStorageAvailable = false;
    }
  }
}

export function TaskInfoBar(props) {
  const [browseNotice, setBrowseNotice] = createSignal("");
  const [aboutOpen, setAboutOpen] = createSignal(false);
  const [generalInformationOpenAtStartup, setGeneralInformationOpenAtStartup] = createSignal(
    readGeneralInformationStartupPreference(),
  );
  const [generalInformationOpen, setGeneralInformationOpen] = createSignal(
    generalInformationOpenAtStartup(),
  );
  createEffect(() => props.onGeneralInformationOpenChange?.(generalInformationOpen()));
  const saveButtonTitle = () => props.isDemo
    ? "Сохранение демонстрационной задачи недоступно"
    : props.saveFeedback?.message
      ?? (props.saveBusy ? "Сохранение модели…" : "Сохранить модель");
  const validationButtonTitle = () => props.validationFeedback?.message
    ?? (props.validationBusy ? "Проверка модели…" : "Проверить модель");

  let noticeDialog;
  let noticeButton;
  let aboutDialog;
  let aboutButton;
  let aboutCloseButton;
  let generalInformationButton;

  // Модальность обеспечивается нативным <dialog>: удержание фокуса,
  // блокировка страницы и закрытие по Esc — штатное поведение элемента.
  createEffect(() => {
    if (!noticeDialog) return;
    if (browseNotice()) {
      if (!noticeDialog.open) {
        noticeDialog.showModal();
        noticeButton?.focus();
      }
    } else if (noticeDialog.open) {
      noticeDialog.close();
    }
  });

  createEffect(() => {
    if (!aboutDialog) return;
    if (aboutOpen()) {
      if (!aboutDialog.open) {
        aboutDialog.showModal();
        aboutCloseButton?.focus();
      }
    } else if (aboutDialog.open) {
      aboutDialog.close();
    }
  });

  // Просмотр содержимого каталога задания: подкаталоги и файлы.
  // Диалог выбора каталога файлы не показывает, поэтому используется
  // диалог открытия файла. Результат намеренно не используется:
  // выбор задания не изменяется.
  async function handleBrowse() {
    const handle = selectionService.loadedTaskHandle();
    if (!handle) return;
    if (props.isDemo) {
      setBrowseNotice(
        "Демонстрационная задача находится в памяти браузера и не имеет каталога на диске.",
      );
      return;
    }

    const support = getFileSystemAccessSupport(window, {
      requireOpenFilePicker: true,
    });
    if (!support.supported) {
      setBrowseNotice(support.message);
      return;
    }

    try {
      const picked = await window.showOpenFilePicker({
        id: "task-browse",
        startIn: handle,
        multiple: false,
        excludeAcceptAllOption: false,
      });
      // Системный диалог не является проводником: двойной щелчок по файлу
      // означает его выбор, а не запуск обработчика по умолчанию.
      if (picked?.length) {
        setBrowseNotice(
          "Работа с файлами в Проводнике выполняется через контекстное меню "
          + "при нажатии правой кнопки мыши.",
        );
      }
    } catch (error) {
      // Отмена выбора пользователем — штатная ситуация.
      if (isFilePickerCancellation(error)) return;

      console.error("Ошибка просмотра каталога задания", error);
      setBrowseNotice(
        getFilePickerErrorMessage(error, "просмотреть каталог задания"),
      );
    }
  }

  return (
    <div class="task-info-bar">
      <button
        class="menu-button"
        onClick={props.onMenuToggle}
        title="Дополнительные функции"
        aria-label="Открыть дополнительные функции"
        aria-expanded={props.menuOpen}
      >
        ☰
      </button>

      <div class="task-info-title">
        <div>Редактируемое</div>
        <div>задание</div>
      </div>

      <button
        class="validate-button"
        disabled={!props.path}
        onClick={handleBrowse}
        title="Просмотр каталога задания (выбор задания не изменяется)"
      >
        📂
      </button>

      <div
        class="task-info-path"
        title={props.path ?? ""}
        aria-live="polite"
        aria-atomic="true"
      >
        <Show
          keyed
          when={props.path}
          fallback={
            <span class="task-info-path-empty">
              Задание для редактирования не загружено
            </span>
          }
        >
          {(path) => <span class="task-info-path-value">{path}</span>}
        </Show>
      </div>

      <div class="validation-controls">
        <button
          ref={props.geometryViewerButtonRef}
          class="geometry-button"
          disabled={!props.path}
          onClick={props.onGeometryViewerToggle}
          title={props.geometryViewerOpen
            ? "Закрыть 3D-просмотр геометрии"
            : "Открыть 3D-просмотр геометрии"}
          aria-label={props.geometryViewerOpen
            ? "Закрыть 3D-просмотр геометрии"
            : "Открыть 3D-просмотр геометрии"}
          aria-pressed={props.geometryViewerOpen}
        >
          3D
        </button>

        <button
          class="validate-button model-validation-button"
          classList={{
            "validation-button-running": props.validating,
            "validation-button-success": props.validationFeedback?.status === "success",
            "validation-button-error": props.validationFeedback?.status === "error",
          }}
          disabled={!props.path || props.validationBusy}
          onClick={props.onValidate}
          title={validationButtonTitle()}
          aria-label="Проверить модель"
          aria-busy={Boolean(props.validating)}
        >
          <span class="validation-button-label">Проверить модель</span>
          <Show when={props.validationFeedback}>
            <span class="validation-button-confirmation" aria-hidden="true">
              {props.validationFeedback?.status === "success" ? "✓" : "!"}
            </span>
          </Show>
        </button>
        <span class="validation-feedback-announcement" role="status" aria-live="polite">
          {props.validationFeedback?.message ?? (props.validating ? "Проверка модели…" : "")}
        </span>

        <ValidationIndicator />

        <button
          class="save-button"
          classList={{
            "save-button-saving": props.saving,
            "save-button-success": props.saveFeedback?.status === "success",
            "save-button-error": props.saveFeedback?.status === "error",
          }}
          disabled={!props.path || props.isDemo || props.saveBusy}
          onClick={props.onSave}
          title={saveButtonTitle()}
          aria-label="Сохранить модель"
          aria-busy={Boolean(props.saving)}
        >
          <span class="save-button-symbol" aria-hidden="true">💾</span>
          <Show when={props.saveFeedback}>
            <span class="save-button-confirmation" aria-hidden="true">
              {props.saveFeedback?.status === "success" ? "✓" : "!"}
            </span>
          </Show>
        </button>
        <span class="save-feedback-announcement" role="status" aria-live="polite">
          {props.saveFeedback?.message ?? (props.saving ? "Сохранение модели…" : "")}
        </span>

        <button
          ref={(el) => (generalInformationButton = el)}
          type="button"
          class="general-information-button"
          onClick={() => setGeneralInformationOpen(true)}
          title="Быстрый старт"
          aria-label="Быстрый старт"
          aria-haspopup="dialog"
        >
          Быстрый старт
        </button>

        <WhatsNewDialog app="editor" />
        <a class="documentation-button"
          href={`${import.meta.env.BASE_URL}user-guide/index.html`}
          target="_blank" rel="noopener noreferrer"
          title="Открыть документацию в новой вкладке">Документация</a>

        <button
          ref={(el) => (aboutButton = el)}
          class="about-button"
          onClick={() => setAboutOpen(true)}
          title="О программе"
          aria-label="О программе"
          aria-haspopup="dialog"
        >
          <img
            class="about-button-image"
            src={aboutIconUrl}
            alt=""
            aria-hidden="true"
            draggable={false}
          />
        </button>
      </div>

      <GeneralInformationDialog
        open={generalInformationOpen()}
        openAtStartup={generalInformationOpenAtStartup()}
        onOpenAtStartupChange={(enabled) => {
          setGeneralInformationOpenAtStartup(enabled);
          saveGeneralInformationStartupPreference(enabled);
        }}
        onClose={() => {
          setGeneralInformationOpen(false);
          generalInformationButton?.focus();
        }}
      />

      <dialog
        class="modal-window"
        ref={(el) => (noticeDialog = el)}
        onClose={() => setBrowseNotice("")}
      >
        <div class="modal-text">{browseNotice()}</div>
        <button
          class="validate-button"
          ref={(el) => (noticeButton = el)}
          onClick={() => setBrowseNotice("")}
        >
          Закрыть
        </button>
      </dialog>

      <dialog
        class="about-dialog"
        ref={(el) => (aboutDialog = el)}
        aria-labelledby="about-dialog-title"
        onClose={() => {
          setAboutOpen(false);
          aboutButton?.focus();
        }}
      >
        <h2 id="about-dialog-title" class="about-title">О программе E3D</h2>
        <p class="about-description">
          <span>Программа предназначена для подготовки,</span>
          <span>проверки, сохранения и визуализации</span>
          <span>исходных данных расчётных задач Clark,</span>
          <span>включая геометрию, параметры модели</span>
          <span>и характеристики материалов.</span>
        </p>
        <div class="about-separator" aria-hidden="true" />
        <div class="about-version">Версия: {packageMetadata.version}</div>
        <div class="about-credits">
          <div>Разработчик: ChatGPT 5.6 Sol</div>
          <div class="about-curator-stack">
            <div>Куратор: Кулаев Ю.</div>
            <div>2026 г.</div>
            <button
              ref={(el) => (aboutCloseButton = el)}
              class="about-close-button"
              onClick={() => setAboutOpen(false)}
            >
              Закрыть
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
