import { createEffect, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import {
  buildSketchRequest,
  checkSketchFiles,
  SKETCH_CHAT_PROMPT,
  SKETCH_LIMITS,
} from "../../services/sketchRequestService.js";
import {
  buildMeshRequest,
  examples,
  fetchGeometryAsset,
  geometryAsset,
  meshPrompt,
} from "../../services/geometryPreparation.js";
import { femmCurrents, importFemm } from "../../services/femmGeometryImport.js";
import { createStoredZip } from "../../services/zipStore.js";
import { validateTaskName } from "../../services/taskDirectoryService.js";
import "./SketchRequestDialog.css";

const headings = {
  sketch: "Запрос к ИИ по эскизу",
  mesh: "Запрос к ИИ по сетке",
  direct: "Прямой импорт геометрии",
};
const accept = { sketch: ".svg,.png,.jpg,.jpeg,.webp", mesh: ".msh", direct: ".fem,.step,.stp" };
const ownCondition = {
  sketch:
    "Используй приложенные изображения. Определи тела, размеры и оси. Уточни недостающие размеры и материал. Подготовь крупные ШГ, затем назначь dp.",
  mesh: "Определи тела по меткам и связности сетки. Сохрани отверстия и границы материалов. Уточни единицы и условия для плоского сечения. Подготовь крупные ШГ и внутреннее разбиение.",
};

export function SketchRequestDialog(props) {
  let dialog,
    fileInput,
    promptDetails,
    generation,
    version = 0,
    sourceVersion = 0,
    editedCondition = false;
  const [variant, setVariant] = createSignal(0),
    [files, setFiles] = createSignal([]);
  const [title, setTitle] = createSignal(""),
    [description, setDescription] = createSignal("");
  const [currents, setCurrents] = createSignal({}),
    [length, setLength] = createSignal("6000");
  const [dp, setDp] = createSignal("2 4 1"),
    [mz, setMz] = createSignal("800");
  const [loading, setLoading] = createSignal(false),
    [busy, setBusy] = createSignal(false),
    [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal(""),
    [notice, setNotice] = createSignal(""),
    [prepared, setPrepared] = createSignal(null);
  const direct = () => props.mode === "direct";
  const isFem = () => direct() && /\.fem$/i.test(files()[0]?.file.name ?? "");
  const prompt = () => (props.mode === "mesh" ? meshPrompt : SKETCH_CHAT_PROMPT);

  function invalidate() {
    version++;
    generation?.abort();
    setBusy(false);
    setNotice("");
    setError("");
    const previous = prepared();
    if (previous) URL.revokeObjectURL(previous.url);
    setPrepared(null);
  }
  function clearFiles() {
    for (const item of files()) URL.revokeObjectURL(item.url);
    setFiles([]);
    setCurrents({});
  }
  function reset() {
    sourceVersion++;
    setLoading(false);
    invalidate();
    clearFiles();
    if (fileInput) fileInput.value = "";
  }
  function attach(items) {
    setFiles(items.map((file) => ({ file, url: URL.createObjectURL(file) })));
  }
  async function selectExample(index) {
    reset();
    const own = sourceVersion,
      mode = props.mode,
      sample = examples[mode][index];
    setVariant(index);
    editedCondition = false;
    setDescription("");
    setTitle("");
    setLoading(true);
    setLength("6000");
    setDp("2 4 1");
    setMz("800");
    try {
      const [data, condition] = await Promise.all([
        fetchGeometryAsset(sample.file).then((r) => r.blob()),
        sample.conditions ? fetchGeometryAsset(sample.conditions).then((r) => r.text()) : "",
      ]);
      const file = new File([data], sample.file, {
        type: sample.file.endsWith(".svg") ? "image/svg+xml" : data.type,
      });
      const values = sample.file.endsWith(".fem") ? femmCurrents(await file.text()) : {};
      if (own !== sourceVersion) return;
      attach([file]);
      setCurrents(values);
      setTitle(mode === "direct" ? sample.file.replace(/\.[^.]+$/, "") : "Рамка и отдельный магнит");
      let text = condition.replace(/^E-GEOMETRY-03[^\n]*\r?\n\s*/, "").trim();
      if (sample.file === "frame.png")
        text = text
          .replace("векторный эскиз sketch.svg", "эскиз frame.png")
          .replace("При необходимости отрисовать SVG для просмотра. ", "");
      setDescription(text.replace(/sketch\.svg/g, sample.file).replace("source.msh", "source/model.msh"));
    } catch (e) {
      if (own === sourceVersion) setError(e.message);
    } finally {
      if (own === sourceVersion) setLoading(false);
    }
  }
  createEffect(() => {
    const mode = props.mode;
    untrack(() => {
      if (mode) {
        if (!dialog.open) dialog.showModal();
        void selectExample(0);
      } else {
        reset();
        if (dialog.open) dialog.close();
      }
    });
  });
  onCleanup(reset);

  async function replaceFiles(event) {
    const items = Array.from(event.currentTarget.files);
    if (!items.length) return;
    const mode = props.mode;
    reset();
    const own = sourceVersion;
    setLoading(true);
    setVariant(-1);
    try {
      if (mode === "sketch") checkSketchFiles(items);
      else if (
        items.length !== 1 ||
        !items[0].size ||
        items[0].size > 24 * 1024 ** 2 ||
        !(mode === "mesh" ? /\.msh$/i : /\.(fem|stp|step)$/i).test(items[0].name)
      )
        throw new Error("Проверьте формат выбранного файла и размер до 24 МиБ.");
      const values =
        mode === "direct" && /\.fem$/i.test(items[0].name) ? femmCurrents(await items[0].text()) : {};
      if (own !== sourceVersion) return;
      if (!editedCondition && !direct()) setDescription(ownCondition[mode]);
      setTitle(items[0].name.replace(/\.[^.]+$/, ""));
      setCurrents(values);
      attach(items);
    } catch (e) {
      if (own === sourceVersion) setError(e.message);
    } finally {
      if (own === sourceVersion) setLoading(false);
    }
  }
  async function prepare() {
    invalidate();
    const own = version;
    generation = new AbortController();
    const signal = generation.signal,
      mode = props.mode,
      items = files().map((item) => item.file);
    setBusy(true);
    try {
      let result;
      if (mode === "sketch") {
        const { getSketchContext } = await import("../../services/sketchContextService.js");
        result = await buildSketchRequest(
          {
            files: items,
            title: title(),
            description: description(),
            context: getSketchContext(),
            separateContext: true,
          },
          { signal },
        );
      } else if (mode === "mesh") {
        result = await buildMeshRequest(
          { file: items[0], title: title(), description: description() },
          { signal },
        );
      } else {
        const name = validateTaskName(title().trim());
        const field = (value) => (String(value).trim() === "" ? NaN : Number(value));
        if (isFem()) {
          const profile = await fetchGeometryAsset("tvv320-profile.json", signal).then((r) => r.json());
          result = await importFemm({
            profile,
            source: await items[0].text(),
            filename: items[0].name,
            length: field(length()),
            currents: Object.fromEntries(Object.entries(currents()).map(([k, v]) => [k, field(v)])),
          });
        } else {
          const { importStep } = await import("../../services/stepGeometryImport.js");
          result = await importStep(new Uint8Array(await items[0].arrayBuffer()), {
            filename: items[0].name,
            mz: field(mz()),
            dp: dp()
              .trim()
              .split(/[\s,;×]+/)
              .map(field),
          });
        }
        result.filename = name + ".zip";
        result.zip = createStoredZip(
          result.entries.map((entry) => ({ ...entry, name: name + "/" + entry.name })),
        );
      }
      if (version === own && !signal.aborted)
        setPrepared({ ...result, url: URL.createObjectURL(result.zip) });
    } catch (e) {
      if (version === own) setError(e.message);
    } finally {
      if (version === own) setBusy(false);
    }
  }
  async function save() {
    if (!prepared()?.entries || saving()) return;
    setSaving(true);
    setError("");
    try {
      await props.onSaveTask(title().trim(), prepared().entries);
      props.onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt());
      setNotice("Инструкция скопирована");
    } catch {
      if (promptDetails) promptDetails.open = true;
      setNotice("Не удалось скопировать. Выделите текст инструкции ниже и скопируйте вручную.");
    }
  }
  function download() {
    const a = document.createElement("a");
    a.href = prepared().url;
    a.download = prepared().filename;
    document.body.append(a);
    try {
      a.click();
    } finally {
      a.remove();
    }
  }
  return (
    <dialog
      ref={dialog}
      class="sketch-request-dialog"
      aria-labelledby="geometry-preparation-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!saving()) props.onClose();
      }}
    >
      <header>
        <h2 id="geometry-preparation-title">{headings[props.mode]}</h2>
        <button
          type="button"
          aria-label="Закрыть подготовку геометрии"
          disabled={saving()}
          onClick={props.onClose}
        >
          ×
        </button>
      </header>
      <div class="sketch-request-content">
        <Show when={!direct()}>
          <p>
            <a href={geometryAsset("01_CLARK_Context.zip")} download>
              Скачать общий контекст CLARK
            </a>
            . В новом чате сначала выполните START.txt из этого архива, затем REQUEST.md из пакета выбранной
            задачи.
          </p>
        </Show>
        <label>
          Пример
          <select
            aria-label="Пример"
            value={variant()}
            disabled={saving()}
            onChange={(e) => void selectExample(Number(e.currentTarget.value))}
          >
            <Show when={variant() < 0}>
              <option value="-1" disabled>
                Свои файлы
              </option>
            </Show>
            <For each={examples[props.mode] ?? []}>
              {(sample, i) => (
                <option value={i()} selected={variant() === i()}>
                  {sample.label}
                </option>
              )}
            </For>
          </select>
        </label>
        <Show when={!direct() && variant() >= 0}>
          <a href={geometryAsset("frame-reference.zip")} download>
            Скачать контрольное задание CLARK для примера
          </a>
        </Show>
        <label>
          {direct() ? "Название задания" : "Название запроса"}
          <input
            value={title()}
            disabled={loading() || saving()}
            maxLength={120}
            onInput={(e) => {
              invalidate();
              setTitle(e.currentTarget.value);
            }}
          />
        </label>
        <label>
          Заменить исходные файлы
          <input
            type="file"
            ref={fileInput}
            accept={accept[props.mode]}
            multiple={props.mode === "sketch"}
            disabled={saving()}
            onChange={replaceFiles}
          />
        </label>
        <Show when={loading()}>
          <p role="status">Чтение исходных файлов…</p>
        </Show>
        <div class="sketch-request-previews">
          <For each={files()}>
            {(item) => (
              <figure>
                <Show when={props.mode === "sketch"}>
                  <img src={item.url} alt={item.file.name} />
                </Show>
                <figcaption>
                  <a href={item.url} download={item.file.name}>
                    {item.file.name}
                  </a>
                </figcaption>
              </figure>
            )}
          </For>
        </div>
        <Show when={!direct()}>
          <label>
            {props.mode === "sketch" ? "Масштаб и уточнения" : "Условие задачи"}
            <textarea
              rows={6}
              maxLength={SKETCH_LIMITS.description}
              value={description()}
              disabled={loading()}
              onInput={(e) => {
                editedCondition = true;
                invalidate();
                setDescription(e.currentTarget.value);
              }}
            />
          </label>
        </Show>
        <Show when={direct() && files().length}>
          <Show
            when={isFem()}
            fallback={
              <>
                <p>
                  STEP/STP. По одному ШГ на прямоугольное тело с гранями вдоль глобальных координатных
                  плоскостей. Для каждого тела задаётся одинаковая однородная намагниченность.
                </p>
                <label>
                  Разбиение каждого ШГ (D1 D2 D3)
                  <input
                    value={dp()}
                    disabled={saving()}
                    onInput={(e) => {
                      invalidate();
                      setDp(e.currentTarget.value);
                    }}
                  />
                </label>
                <label>
                  Mz, кА/м
                  <input
                    type="number"
                    step="any"
                    value={mz()}
                    disabled={saving()}
                    onInput={(e) => {
                      invalidate();
                      setMz(e.currentTarget.value);
                    }}
                  />
                </label>
              </>
            }
          >
            <p>
              Профиль ТВВ-320 в чистой 2D-постановке. Контуры и обмотки привязаны к исходной геометрии FEMM.{" "}
              <a href={geometryAsset("03_CLARK_FEMM_2D.zip")} download>
                Исходные FEM/ANS и проверочные расчёты
              </a>
            </p>
            <label>
              Длина вдоль X, мм
              <input
                type="number"
                step="any"
                value={length()}
                disabled={saving()}
                onInput={(e) => {
                  invalidate();
                  setLength(e.currentTarget.value);
                }}
              />
            </label>
            <fieldset class="geometry-currents">
              <legend>Токи цепей, А</legend>
              <For each={Object.keys(currents())}>
                {(name) => (
                  <label>
                    {name}
                    <input
                      type="number"
                      step="any"
                      value={currents()[name]}
                      disabled={saving()}
                      onInput={(e) => {
                        invalidate();
                        setCurrents({ ...currents(), [name]: e.currentTarget.value });
                      }}
                    />
                  </label>
                )}
              </For>
            </fieldset>
          </Show>
        </Show>
        <Show when={prepared()}>
          <div class="sketch-request-result">
            <Show
              when={direct()}
              fallback={
                <>
                  <a href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">
                    ChatGPT
                  </a>
                  <details ref={promptDetails}>
                    <summary>Инструкция для чата</summary>
                    <p>{prompt()}</p>
                  </details>
                </>
              }
            >
              <p role="status">{prepared().summary}</p>
            </Show>
          </div>
        </Show>
        <Show when={notice()}>
          <p role="status">{notice()}</p>
        </Show>
        <Show when={error()}>
          <p class="sketch-request-error" role="alert">
            {error()}
          </p>
        </Show>
      </div>
      <footer>
        <button
          type="button"
          class="sketch-request-primary"
          disabled={loading() || busy() || saving() || !files().length}
          onClick={prepare}
        >
          {busy() ? "Подготовка пакета…" : direct() ? "Построить задание" : "Подготовить ZIP"}
        </button>
        <button type="button" disabled={!prepared() || saving()} onClick={download}>
          {direct() ? "Скачать задание ZIP" : "Скачать пакет ZIP"}
        </button>
        <Show when={!direct()}>
          <button type="button" disabled={!prepared()} onClick={copyPrompt}>
            Скопировать инструкцию
          </button>
        </Show>
        <Show when={direct()}>
          <button
            type="button"
            disabled={!props.project || !prepared() || saving()}
            title={
              props.project
                ? "Сохранить новое задание в выбранном локальном проекте"
                : "Выберите локальный проект на вкладке заданий"
            }
            onClick={save}
          >
            {saving() ? "Сохранение…" : "Сохранить в проект"}
          </button>
        </Show>
        <button class="sketch-request-close" type="button" disabled={saving()} onClick={props.onClose}>
          Закрыть
        </button>
      </footer>
    </dialog>
  );
}
