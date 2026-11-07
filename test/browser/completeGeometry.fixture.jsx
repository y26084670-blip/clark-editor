import { createSignal, batch } from "solid-js";
import { render } from "solid-js/web";
import { GeometryViewerWindow } from "../../src/components/geometry/GeometryViewerWindow.jsx";
import { TaskGeometryPreview } from "../../src/components/geometry/TaskGeometryPreview.jsx";
import "../../src/App.css";

const vector = values => values.map(x => [x]);
const element = {
  name: "Проверка сетки", geoType: 0, targ: 0,
  geo: [[0,0,0],[2,0,0],[0,2,0],[2,2,0],[0,0,2],[2,0,2],[0,2,2],[2,2,2]],
  dp: vector([65_537,2,1]), dr: vector([0,0,0]), symVi: vector([0,0,0]), symR0: vector([0,0,0]),
  symLs: 1, symAs: 1, symPs: 1, symTx: 0, symYl: 0, symYa: 0, symKya: 1, symKyp: 1,
};
function Fixture() {
  const [key, setKey] = createSignal({});
  const [open, setOpen] = createSignal(false);
  const [model, setModel] = createSignal({ general: { mirrorSymmetryX: -1, mirrorSymmetryY: -1 },
    elements: [element], regions: [] });
  const [previewOn, setPreviewOn] = createSignal(false);
  const [previewHandle, setPreviewHandle] = createSignal(null);
  let diskReads = 0;
  // Present an empty saved task. The loaded task supplies its live geometry.
  const handle = { name: "preview", getDirectoryHandle: async () => { diskReads++; return {
    getFileHandle: async () => { throw new DOMException("missing", "NotFoundError"); },
  }; } };
  window.geometryCheck = {
    setOpen,
    resizeGrid(n) { setModel(m => ({ ...m, elements: [{ ...element, dp: vector([n,2,1]) }] })); },
    replaceTask() { setKey({}); },
    startPreview() { batch(() => { setPreviewOn(true); setPreviewHandle(handle); }); },
    setPreviewOn, diskReads: () => diskReads,
  };
  return <>
    <GeometryViewerWindow open={open()} taskKey={key()} model={model()} onClose={() => setOpen(false)} />
    <div style={{ width: "500px", height: "340px", display: previewOn() ? "block" : "none" }}>
      <TaskGeometryPreview taskHandle={previewHandle()} loadedTaskHandle={previewHandle()} model={model()} active={previewOn()} />
    </div>
  </>;
}
render(() => <Fixture />, document.getElementById("root"));
