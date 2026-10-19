import { Show, createEffect, createSignal, onCleanup } from "solid-js";
import { validateDownloadUrl } from "../../services/examplesService";
import "./ExamplesInstaller.css";

export function ExamplesInstaller(props) {
  const [links, setLinks] = createSignal(null);
  const [configLoading, setConfigLoading] = createSignal(false);
  const [configError, setConfigError] = createSignal("");
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
      setLinks({
        examples: validateDownloadUrl(config?.examplesArchiveUrl, baseUrl),
        installer: validateDownloadUrl(config?.solverInstallerUrl, baseUrl),
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
          href={links()?.examples}
          aria-disabled={!links()}
          tabindex={links() ? 0 : -1}
          target="_blank"
          rel="noopener noreferrer"
          title="Открыть страницу скачивания ZIP-архива примеров"
        >
          Установить примеры
        </a>
        <a
          href={links()?.installer}
          aria-disabled={!links()}
          tabindex={links() ? 0 : -1}
          target="_blank"
          rel="noopener noreferrer"
          title="Открыть страницу скачивания ClarkInstaller.exe"
        >
          Скачать установщик решателя
        </a>
      </div>
      <p class="examples-installer-description">
        Кнопки открывают страницы скачивания в новой вкладке. ZIP-архив примеров
        удобно распаковать в корень рабочего диска, обычно D:\. Затем выберите
        распакованный каталог с проектами в редакторе.
      </p>
      <Show when={configLoading()}><p role="status">Получение ссылок для скачивания…</p></Show>
      <Show when={configError()}><p class="examples-installer-error" role="alert">{configError()}</p></Show>
    </div>
  );
}
