import { Show, createEffect, createSignal, onCleanup } from "solid-js";
import { validateDownloadUrl } from "../../services/examplesService";
import { createInstallerDownloadUri, validateInstallerMetadata } from "../../services/installerDownloadService";
import "./ExamplesInstaller.css";

export function ExamplesInstaller(props) {
  const [links, setLinks] = createSignal(null);
  const [configLoading, setConfigLoading] = createSignal(false);
  const [configError, setConfigError] = createSignal("");
  const [directDownload, setDirectDownload] = createSignal(false);
  const [nativeUri, setNativeUri] = createSignal("");
  const [downloadMessage, setDownloadMessage] = createSignal("");
  let configController;
  let disposed = false;

  async function loadConfiguration() {
    if (links() || configController) return;
    const controller = new AbortController();
    configController = controller;
    setConfigLoading(true);
    setConfigError("");
    try {
      const baseUrl = new URL(import.meta.env.BASE_URL, window.location.href);
      const response = await fetch(new URL("examples-config.json", baseUrl), {
        signal: controller.signal,
        credentials: "omit",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Не удалось получить ссылки для скачивания.");
      const config = await response.json();
      if (controller.signal.aborted || disposed) return;
      let directAvailable = false;
      try { validateInstallerMetadata(config); directAvailable = true; } catch { /* The ordinary link remains usable. */ }
      setLinks({
        examples: validateDownloadUrl(config?.examplesArchiveUrl, baseUrl),
        installer: validateDownloadUrl(config?.solverInstallerUrl, baseUrl),
        directAvailable,
      });
    } catch {
      if (controller.signal.aborted || disposed) return;
      setConfigError("Не удалось получить ссылки для скачивания. Закройте и снова откройте эту панель, чтобы повторить попытку.");
    } finally {
      if (configController === controller) {
        configController = undefined;
        if (!disposed) setConfigLoading(false);
      }
    }
  }

  createEffect(() => {
    if (props.open) {
      void loadConfiguration();
    } else {
      configController?.abort();
      configController = undefined;
      setConfigLoading(false);
    }
  });

  onCleanup(() => {
    disposed = true;
    configController?.abort();
  });

  return (
    <div class="examples-installer" aria-label="Установка примеров и решателя">
      <div class="examples-installer-actions">
        <a
          class="examples-archive-link"
          href={links()?.examples}
          aria-disabled={!links()}
          tabindex={links() ? 0 : -1}
          target="_blank"
          rel="noopener noreferrer"
          title="Открыть страницу скачивания ZIP-архива примеров"
        >
          Установить примеры
        </a>
        <div class="examples-installer-download">
          <label class="examples-installer-direct">
            <input type="checkbox" checked={directDownload()} onChange={event => {
              setDirectDownload(event.currentTarget.checked);
              setNativeUri(event.currentTarget.checked ? createInstallerDownloadUri() : "");
              setDownloadMessage("");
            }} />
            Прямая загрузка
          </label>
          <a
            href={directDownload() ? (links()?.directAvailable ? nativeUri() : undefined) : links()?.installer}
            aria-disabled={!links()?.installer || (directDownload() && !links()?.directAvailable)}
            tabindex={links()?.installer && (!directDownload() || links()?.directAvailable) ? 0 : -1}
            target={directDownload() ? "_self" : "_blank"}
            rel="noopener noreferrer"
            title={directDownload() ? "Скачать установщик через установленный Clark" : "Открыть страницу скачивания ClarkInstaller.exe"}
            onClick={event => {
              if (!links()?.installer || (directDownload() && !links()?.directAvailable)) { event.preventDefault(); return; }
              if (directDownload()) setDownloadMessage("Ожидайте окно загрузки Clark. Если оно не открылось, снимите отметку и скачайте установщик обычным способом.");
            }}
          >
            Скачать установщик решателя
          </a>
        </div>
      </div>
      <p class="examples-installer-description">
        Без отметки «Прямая загрузка» установщик скачивается со страницы облачного сервиса.
        Прямая загрузка требует установленного Clark с поддержкой этой функции;
        выбор файла и прогресс отображаются в отдельном окне.
        ZIP-архив примеров
        удобно распаковать в корень рабочего диска, обычно D:\. Затем выберите
        распакованный каталог с проектами в редакторе.
      </p>
      <Show when={directDownload() && links() && !links().directAvailable}>
        <p class="examples-installer-error" role="alert">Прямая загрузка пока не настроена. Снимите отметку для обычного скачивания.</p>
      </Show>
      <Show when={downloadMessage()}><p role="status">{downloadMessage()}</p></Show>
      <Show when={configLoading()}><p role="status">Получение ссылок для скачивания…</p></Show>
      <Show when={configError()}><p class="examples-installer-error" role="alert">{configError()}</p></Show>
    </div>
  );
}
