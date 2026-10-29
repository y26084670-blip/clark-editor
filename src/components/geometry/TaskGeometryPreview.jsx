import { Show, createEffect, createSignal, onCleanup } from "solid-js";

import { loadTaskGeometryPreview } from "../../services/taskGeometryPreviewService.js";
import {
  geometryCameraCommandFromKeyboardEvent,
  isGeometryCameraShortcutTarget,
} from "../../services/visualization/geometryCameraView.js";
import { buildGeometryScene } from "../../services/visualization/geometrySceneModel.js";
import { ThreeGeometryViewport } from "./ThreeGeometryViewport.jsx";
import "./GeometryViewerWindow.css";

const ORIGINAL_OBJECT_FILTERS = Object.freeze({
  objectModes: Object.freeze({
    elements: "all",
    regions: "all",
  }),
  selections: Object.freeze({
    elements: Object.freeze([]),
    regions: Object.freeze([]),
  }),
  symmetry: Object.freeze({
    axial: false,
    local: false,
    mirror: false,
    periodic: false,
  }),
});

export function TaskGeometryPreview(props) {
  const [scene, setScene] = createSignal(null);
  const [savedModel, setSavedModel] = createSignal(null);
  const [sameAsLoaded, setSameAsLoaded] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [message, setMessage] = createSignal("Выберите задание для просмотра");
  const [viewRequest, setViewRequest] = createSignal(null);
  let previewElement;
  let loadRevision = 0;
  let identityRevision = 0;

  createEffect(() => {
    const task = props.taskHandle, loaded = props.loadedTaskHandle;
    const revision = ++identityRevision;
    setSameAsLoaded(Boolean(task && task === loaded));
    if (!task || !loaded || task === loaded || typeof task.isSameEntry !== "function") return;
    void Promise.resolve().then(() => task.isSameEntry(loaded)).then(same => {
      if (revision === identityRevision) setSameAsLoaded(same);
    }).catch(() => { /* An unavailable handle keeps its own saved preview. */ });
  });

  createEffect(() => {
    const saved = savedModel();
    if (!saved) return;
    // Loaded tabs can arrive independently. Merge only the available live parts
    // into the selected task's preview; another selected task always uses disk.
    const live = sameAsLoaded() ? props.model : null;
    const model = { ...saved };
    for (const key of ["general", "elements", "regions"]) {
      if (live?.[key] !== undefined) model[key] = live[key];
    }
    try {
      const nextScene = buildGeometryScene(model);
      setScene(nextScene);
      setMessage(nextScene.primitives.length === 0 ? "Нет геометрии для предварительного просмотра" : "");
    } catch (error) {
      console.error("Ошибка предварительного просмотра задания:", error);
      setScene(null);
      setMessage("Не удалось подготовить предварительный просмотр");
    }
  });

  const requestView = (command) => {
    setViewRequest((previous) => ({
      command,
      sequence: (previous?.sequence ?? 0) + 1,
    }));
  };

  const handleKeyDown = (event) => {
    if (!isGeometryCameraShortcutTarget(event.target)) return;
    const command = geometryCameraCommandFromKeyboardEvent(event);
    if (!command) return;
    event.preventDefault();
    requestView(command);
  };

  createEffect(() => {
    const taskHandle = props.taskHandle;
    const active = props.active !== false;
    const revision = ++loadRevision;

    setSavedModel(null);
    setScene(null);
    setViewRequest(null);
    setLoading(false);
    setMessage(taskHandle ? "" : "Выберите задание для просмотра");
    if (!taskHandle || !active) return;

    setLoading(true);
    void loadTaskGeometryPreview(taskHandle)
      .then((result) => {
        if (revision !== loadRevision) return;
        setLoading(false);

        if (!result.currentFormat || !result.model) {
          setMessage("Не содержит данных актуального формата");
          return;
        }

        setSavedModel(result.model);
      })
      .catch((error) => {
        if (revision !== loadRevision) return;
        console.error("Ошибка предварительного просмотра задания:", error);
        setLoading(false);
        setMessage("Не удалось подготовить предварительный просмотр");
      });
  });

  onCleanup(() => {
    loadRevision += 1;
    identityRevision += 1;
  });

  return (
    <section
      ref={(element) => (previewElement = element)}
      class="task-geometry-preview"
      aria-label="Предварительный просмотр геометрии выбранного задания"
      aria-busy={loading()}
      tabIndex="0"
      onPointerDown={(event) => {
        if (isGeometryCameraShortcutTarget(event.target)) {
          previewElement?.focus({ preventScroll: true });
        }
      }}
      onKeyDown={handleKeyDown}
    >
      <Show when={scene()} keyed>
        {(sceneModel) => (
          <ThreeGeometryViewport
            scene={sceneModel}
            filters={ORIGINAL_OBJECT_FILTERS}
            mode="solid"
            showEdges={true}
            showVertices={false}
            showDiscretizationLines={false}
            showCentersAndNodes={false}
            projection="orthographic"
            autoFit={true}
            viewRequest={viewRequest()}
          />
        )}
      </Show>
      <Show when={loading()}>
        <div class="task-geometry-preview-overlay">Загрузка геометрии…</div>
      </Show>
      <Show when={!loading() && message()} keyed>
        {(text) => <div class="task-geometry-preview-overlay">{text}</div>}
      </Show>
    </section>
  );
}
