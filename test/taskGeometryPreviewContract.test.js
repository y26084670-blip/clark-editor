import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../src/App.jsx", import.meta.url);
const componentUrl = new URL(
  "../src/components/geometry/TaskGeometryPreview.jsx",
  import.meta.url,
);
const serviceUrl = new URL(
  "../src/services/taskGeometryPreviewService.js",
  import.meta.url,
);
const tasksUrl = new URL("../src/tabs/Tasks.jsx", import.meta.url);
const stylesUrl = new URL("../src/tabs/Tasks.css", import.meta.url);

test("task geometry preview loads only the three geometry model parts", async () => {
  const source = await readFile(serviceUrl, "utf8");

  assert.match(source, /generalSchema/u);
  assert.match(source, /elementsSchema/u);
  assert.match(source, /regionsSchema/u);
  assert.match(source, /dataService\.load\(handle, schema, diagnostics\)/u);
  assert.match(source, /getDirectoryHandle\(DIRECTORIES\.INPUT\)/u);
  assert.match(source, /Promise\.all/u);
  assert.doesNotMatch(source, /modelService|selectionService|setModelPart/u);
});

test("task geometry preview shows original objects with mouse-only camera controls", async () => {
  const source = await readFile(componentUrl, "utf8");

  assert.match(source, /<ThreeGeometryViewport/u);
  assert.match(source, /elements: "all"/u);
  assert.match(source, /regions: "all"/u);
  assert.match(source, /axial: false/u);
  assert.match(source, /local: false/u);
  assert.match(source, /mirror: false/u);
  assert.match(source, /periodic: false/u);
  assert.match(source, /projection="orthographic"/u);
  assert.match(source, /autoFit=\{true\}/u);
  assert.match(source, /<ThreeGeometryViewport\s+taskPreview\b/u);
  assert.doesNotMatch(source, /onKeyDown|viewRequest|tabIndex/u);
  assert.match(source, /showVertices=\{false\}/u);
  assert.match(source, /showDiscretizationLines=\{false\}/u);
  assert.match(source, /showCentersAndNodes=\{false\}/u);
  assert.doesNotMatch(source, /<button/u);
});

test("preview is above summary and follows task-tab activity", async () => {
  const [app, tasks, styles] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(tasksUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
  ]);

  const previewIndex = tasks.indexOf("<TaskGeometryPreview");
  const summaryIndex = tasks.indexOf('class="task-summary-content"');
  assert.ok(previewIndex >= 0 && summaryIndex > previewIndex);
  assert.match(tasks, /taskHandle=\{selectedTask\(\)\?\.handle\}/u);
  assert.match(tasks, /active=\{props\.active\}/u);
  assert.match(app, /<Tasks[\s\S]*?active=\{props\.active\}/u);
  assert.match(
    styles,
    /\.task-summary-panel\s*\{[^}]*display:\s*grid;[^}]*grid-template-rows:\s*minmax\(240px, 3fr\) minmax\(160px, 2fr\);/su,
  );
});
