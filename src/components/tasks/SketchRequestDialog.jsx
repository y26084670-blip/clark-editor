import { createEffect, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import { buildSketchRequest, checkSketchFiles, SKETCH_CHAT_PROMPT, SKETCH_LIMITS } from "../../services/sketchRequestService.js";
import "./SketchRequestDialog.css";

export function SketchRequestDialog(props) {
  let dialog, titleInput, fileInput, controller, epoch = 0;
  const [title, setTitle] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [previews, setPreviews] = createSignal([]);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [prepared, setPrepared] = createSignal(null);
  const [copyStatus, setCopyStatus] = createSignal("");
  function invalidate() {
    epoch++; controller?.abort(); controller = null; setBusy(false); setCopyStatus("");
    const previous = prepared(); if (previous) { URL.revokeObjectURL(previous.zipUrl); URL.revokeObjectURL(previous.textUrl); }
    setPrepared(null); setError("");
  }
  function clearImages() { for (const entry of previews()) URL.revokeObjectURL(entry.url); setPreviews([]); }
  function cleanup() { invalidate(); clearImages(); }
  createEffect(() => {
    if (props.open) {
      untrack(() => { cleanup(); setTitle(""); setDescription(""); if (fileInput) fileInput.value = ""; });
      if (!dialog.open) dialog.showModal(); queueMicrotask(() => { if (dialog.open) titleInput?.focus(); });
    } else { untrack(cleanup); if (dialog.open) dialog.close(); }
  });
  onCleanup(cleanup);
  function selectImages(event) {
    invalidate(); clearImages();
    const files = [...event.currentTarget.files];
    if (!files.length) return;
    try { checkSketchFiles(files); setPreviews(files.map(file => ({ file, url: URL.createObjectURL(file) }))); }
    catch (err) { setError(err.message); event.currentTarget.value = ""; }
  }
  async function prepare() {
    if (busy()) return;
    invalidate(); const ownEpoch = epoch; controller = new AbortController(); const signal = controller.signal;
    setBusy(true);
    try {
      const { getSketchContext } = await import("../../services/sketchContextService.js");
      const result = await buildSketchRequest({ title: title(), description: description(), files: previews().map(p => p.file), context: getSketchContext() }, { signal });
      if (signal.aborted || ownEpoch !== epoch || !props.open) return;
      setPrepared({ ...result, zipUrl: URL.createObjectURL(result.zip), textUrl: URL.createObjectURL(new Blob([result.request], { type: "text/markdown;charset=utf-8" })) });
    } catch (err) { if (ownEpoch === epoch && err.name !== "AbortError") setError(err.message); }
    finally { if (ownEpoch === epoch) { controller = null; setBusy(false); } }
  }
  async function copyPrompt() {
    const ownEpoch = epoch;
    try { await navigator.clipboard.writeText(SKETCH_CHAT_PROMPT); if (ownEpoch === epoch) setCopyStatus("Инструкция скопирована"); }
    catch { if (ownEpoch === epoch) setCopyStatus("Не удалось скопировать. Выделите текст инструкции ниже и скопируйте вручную."); }
  }
  return <dialog ref={dialog} class="sketch-request-dialog" aria-labelledby="sketch-request-title"
    onCancel={event => { event.preventDefault(); props.onClose(); }}>
    <header><h2 id="sketch-request-title">Создать геометрию по эскизу</h2><button type="button" aria-label="Закрыть подготовку по эскизу" onClick={props.onClose}>×</button></header>
    <div class="sketch-request-content">
      <p>Подготовьте пакет для нового чата ChatGPT. Модель получит эскиз, ваше условие и правила CLARK, задаст уточнения и подготовит исходные данные.</p>
      <label>Название задания<input ref={titleInput} value={title()} maxLength={120} placeholder="Например, кольца и стержень"
        onInput={e => { invalidate(); setTitle(e.currentTarget.value); }} /></label>
      <label>Эскизы<input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" multiple onChange={selectImages} /></label>
      <small>От 1 до 3 изображений, до 8 МиБ каждое и 16 МиБ вместе. Исходные изображения сохраняются без преобразования.</small>
      <div class="sketch-request-previews"><For each={previews()}>{entry => <figure><img src={entry.url} alt={`Эскиз: ${entry.file.name}`}
        onError={() => setError("Не удалось показать изображение. Проверьте выбранный файл.")} /><figcaption>{entry.file.name}</figcaption></figure>}</For></div>
      <label>Условие и известные размеры<textarea rows={5} value={description()} maxLength={SKETCH_LIMITS.description}
        placeholder="Что изображено? Какие размеры известны? Что должно двигаться и что требуется определить? Неизвестные данные можно уточнить в чате."
        onInput={e => { invalidate(); setDescription(e.currentTarget.value); }} /></label>
      <details><summary>Что получит модель</summary><p>Выбранные Вами изображения и введённое условие, а также полученные от Editor инструкцию CLARK и формальное описание исходных данных. Пакет как zip архив передаёте вы; Editor ничего не отправляет к ИИ.</p></details>
      <p class="sketch-request-error" role="alert">{error()}</p>
      <p role="status">{busy() ? "Подготовка пакета…" : prepared() ? "Пакет готов к скачиванию" : ""}</p>
      <button class="sketch-request-primary" type="button" disabled={busy() || !previews().length} onClick={prepare}>Подготовить пакет</button>
      <Show when={prepared()}>{result => <section class="sketch-request-result" aria-label="Готовый пакет">
        <div class="sketch-request-downloads"><a href={result().zipUrl} download={result().filename}>Скачать пакет ZIP</a>
          <a href={result().textUrl} download="REQUEST.md">Скачать REQUEST.md отдельно</a></div>
        <ol><li>Откройте <a href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">ChatGPT</a> и приложите пакет. Если архив не читается, приложите REQUEST.md и исходные изображения отдельно.</li>
          <li>Отправьте инструкцию ниже и ответьте на вопросы модели. Возможность выполнить весь цикл на Free зависит от доступных инструментов и лимитов.</li>
          <li>Полученный каталог с input3XX распакуйте в <strong>новое место</strong> выбранного проекта CLARK. Вернитесь в Editor, обновите список, загрузите задание, проверьте 3D и данные, затем сохраните.</li></ol>
        <label>Инструкция для начала чата<textarea rows={4} readonly value={SKETCH_CHAT_PROMPT} /></label>
        <button type="button" onClick={copyPrompt}>Скопировать инструкцию</button><span role="status">{copyStatus()}</span>
      </section>}</Show>
    </div>
    <footer><button type="button" onClick={props.onClose}>Вернуться к заданиям</button></footer>
  </dialog>;
}
