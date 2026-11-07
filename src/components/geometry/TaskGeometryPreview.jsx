import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";

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
  const task = createMemo(previous => {
    const handle = props.taskHandle;
    return handle === previous || props.active !== false ? handle : null;
  });
  return <Show when={task()} keyed>{handle => <PreviewContents {...props} taskHandle={handle} />}</Show>;
}

function PreviewContents(props) {
  const [scene, setScene] = createSignal(null);
  const [savedModel, setSavedModel] = createSignal(null);
  const [sameAsLoaded, setSameAsLoaded] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [message, setMessage] = createSignal("");
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

  const previewModel = createMemo(previous => {
    if (props.active === false) return previous;
    const saved = savedModel();
    if (!saved) return null;
    const live = sameAsLoaded() ? props.model : null;
    const general = live?.general ?? saved.general;
    const elements = live?.elements ?? saved.elements;
    const regions = live?.regions ?? saved.regions;
    return previous && previous.general === general && previous.elements === elements && previous.regions === regions
      ? previous : { general, elements, regions };
  });

  createEffect(() => {
    const model = previewModel();
    if (!model) return;
    try {
      const nextScene = buildGeometryScene(model, { originalOnly: true });
      setScene(nextScene);
      setMessage("");
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
    const revision = ++loadRevision;

    setSavedModel(null);
    setScene(null);
    setViewRequest(null);
    setLoading(false);
    setMessage("");
    if (!taskHandle) return;

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
      <Show when={scene()}>
          <ThreeGeometryViewport
            scene={scene()}
            active={props.active}
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
      </Show>
      <Show when={!loading() && message()} keyed>
        {(text) => <div class="task-geometry-preview-overlay">{text}</div>}
      </Show>
    </section>
  );
}
