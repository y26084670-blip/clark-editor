import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const windowUrl = new URL(
  "../src/components/geometry/GeometryViewerWindow.jsx",
  import.meta.url,
);
const viewportUrl = new URL(
  "../src/components/geometry/ThreeGeometryViewport.jsx",
  import.meta.url,
);
const stylesUrl = new URL(
  "../src/components/geometry/GeometryViewerWindow.css",
  import.meta.url,
);

function assertAppearsAfter(source, later, earlier) {
  const laterIndex = source.indexOf(later);
  const earlierIndex = source.indexOf(earlier);
  assert.notEqual(earlierIndex, -1, `missing earlier marker: ${earlier}`);
  assert.notEqual(laterIndex, -1, `missing later marker: ${later}`);
  assert.ok(
    laterIndex > earlierIndex,
    `expected ${later} to appear after ${earlier}`,
  );
}

test("geometry viewer builds a reactive scene in a modeless floating window", async () => {
  const source = await readFile(windowUrl, "utf8");

  assert.match(source, /buildGeometryScene\(input, \{ bilinear: bilinear\(\)/u);
  assert.match(source, /<FloatingWindow/u);
  assert.match(source, /open=\{props\.open\}/u);
  assert.match(source, /onClose=\{props\.onClose\}/u);
  assert.match(source, /scene=\{displayScene\(\)\}/u);
  assert.match(source, /active=\{props\.open\}/u);
  assert.match(source, /role="toolbar"/u);
  assert.match(source, /role="dialog"/u);
  assert.match(source, /aria-modal="false"/u);
  assert.match(source, /initialWidth=\{1220\}/u);
  assert.match(source, /storageKey="web-gui:geometry-viewer-window:v2"/u);
});

test("toolbar exposes option panels and transient camera commands", async () => {
  const source = await readFile(windowUrl, "utf8");

  assert.match(source, />\s*Элементы\s*<\/button>/u);
  assert.match(source, />\s*Области\s*<\/button>/u);
  assert.match(source, />\s*Симметрии\s*<\/button>/u);
  assert.match(source, />\s*Общие опции\s*<\/button>/u);
  assert.match(source, />\s*Показ\s*<\/button>/u);
  assert.match(source, /aria-expanded=\{openPanel\(\) === "elements"\}/u);
  assert.match(source, /aria-expanded=\{openPanel\(\) === "regions"\}/u);
  assert.match(source, /aria-expanded=\{openPanel\(\) === "symmetry"\}/u);
  assert.match(source, /aria-expanded=\{openPanel\(\) === "general"\}/u);
  assert.match(source, /aria-expanded=\{openPanel\(\) === "view" \|\| openPanel\(\) === "sources"\}/u);
  assert.match(source, /aria-haspopup="dialog"/u);
  assert.match(source, /aria-label="Общие опции отображения"/u);

  assert.match(source, /createGeometryViewSetting\("geometryTransparency", 0\)/u);
  assert.match(source, /type="range" min="0" max="100" step="1"/u);
  assert.doesNotMatch(source, /<option value="(?:solid|translucent|wireframe)"/u);
  assert.doesNotMatch(source, /Вписать всё/u);
  assert.doesNotMatch(source, /fitRequest/u);
  const menu = source.slice(source.indexOf('<Show when={openPanel() === "view"}>'), source.indexOf('<Show when={openPanel() === "elements"}>'));
  assertAppearsAfter(menu, ">Настройка стрелок</button>", ">Сечение</button>");
  assert.doesNotMatch(menu, /Показать все|вид (по|против) [XYZ]/u);
  assert.match(source, /createGeometryViewSetting\("bilinear", false\)/u);
  assert.doesNotMatch(source, /role="menuitem"/u);
  assert.match(source, /setViewRequest\(\(previous\) =>/u);
  assert.match(source, /sequence:\s*\(previous\?\.sequence \?\? 0\) \+ 1/u);
  assert.match(source, /closePanel\(true\)/u);
  assert.match(source, /setViewRequest\(null\)/u);
  assert.match(source, /tabIndex="0"/u);
  assert.match(source, /geometryCameraCommandFromKeyboardEvent\(event\)/u);
  assert.match(source, /isGeometryCameraShortcutTarget\(event\.target\)/u);
  assert.match(source, /fitAllPadding=\{FLOATING_FIT_ALL_PADDING\}/u);
  assert.doesNotMatch(source, /aria-label="Детализация геометрии"/u);
  assert.doesNotMatch(source, /aria-label="Тип проекции"/u);

  assertAppearsAfter(
    source,
    "aria-label=\"Общие опции отображения\"",
    ">\n              Симметрии",
  );
  assertAppearsAfter(source, ">\n              Показ", "aria-label=\"Общие опции отображения\"");
  assertAppearsAfter(source, "aria-label=\"Прозрачность геометрии и рёбер\"", ">\n              Показ");

  assert.match(source, /mode="solid"/u);
  assert.match(source, /geometryOpacity=\{1 - geometryTransparency\(\) \/ 100\}/u);
  assert.match(source, /showEdges=\{showEdges\(\)\}/u);
  assert.match(source, /showVertices=\{showVertices\(\)\}/u);
  assert.match(
    source,
    /showDiscretizationLines=\{showDiscretizationLines\(\)\}/u,
  );
  assert.match(
    source,
    /showCentersAndNodes=\{showCentersAndNodes\(\)\}/u,
  );
  assert.match(
    source,
    /projection=\{orthographicView\(\) \? "orthographic" : "perspective"\}/u,
  );
  assert.match(source, /viewRequest=\{viewRequest\(\)\}/u);
  assert.match(source, /filters=\{filters\(\)\}/u);
});

test("the section opens from Показ and its controls follow the editing sequence", async () => {
  const source = await readFile(windowUrl, "utf8");
  const toolbar = source.slice(source.indexOf('role="toolbar"'), source.indexOf('<Show when={sectionEnabled()'));
  assertAppearsAfter(toolbar, 'class="geometry-viewer-transparency"', 'togglePanel("view", event)');
  assert.doesNotMatch(toolbar, />Сечение</u);
  const panel = source.slice(source.indexOf('<Show when={openPanel() === "view"}>'));
  assertAppearsAfter(panel, '>Сечение</button>', '>Построения</button>');
  const row = source.slice(source.indexOf('aria-label="Настройки сечения"'), source.indexOf('<Show when={openPanel()}>'));
  assertAppearsAfter(row, '"Применить"', 'Глубина среза');
  assertAppearsAfter(row, 'Сменить вид', '"Сбросить"');
  assert.match(row, /disabled=\{!fixedSection\(\)\} checked=\{reverseSection\(\)\}\s+onChange=\{event => setReverseSection\(event\.currentTarget\.checked\)\}/u);
  assertAppearsAfter(row, 'aria-label="Закрыть сечение"', 'Сменить вид');
});

test("object modes are exclusive while symmetry and general filters are independent", async () => {
  const source = await readFile(windowUrl, "utf8");

  assert.match(source, /objectModes:\s*\{\s*elements:/su);
  assert.match(source, /selections:\s*\{\s*elements:/su);
  assert.match(source, /symmetry:\s*\{\s*axial:/su);
  for (const group of ["elements", "regions"]) {
    assert.ok(source.includes('createGeometryViewSetting("' + group + 'Mode", "all")'));
    assert.equal(source.split('name="geometry-' + group + '-mode"').length - 1, 4);
  }
  for (const label of ["Выделенные в списке", "Кроме выделенных", "Не показывать"])
    assert.equal(source.split(label + "\n").length - 1, 2);
  for (const flag of ["showLocalSymmetry","showAxialSymmetry","showPeriodicSymmetry","showMirrorSymmetry",
    "orthographicView","showFaces","bilinear","showEdges","showVertices","showDiscretizationLines","showCentersAndNodes",
    "showRegionNormals","showPrescribedSources"]) {
    assert.ok(source.includes("checked={" + flag + "()}"), flag);
  }
  assert.match(source, /createGeometryViewSetting\("showEdges", true\)/u);
  assert.match(source, /createGeometryViewSetting\("showVertices", false\)/u);
  assert.match(source, /createGeometryViewSetting\("bilinear", false\)/u);
  assert.doesNotMatch(source, /disabled=\{renderMode\(\) === "wireframe"\}/u);
});

test("diagnostics retain record numbers and concise reasons", async () => {
  const source = await readFile(windowUrl, "utf8");

  assert.match(source, /Диагностика геометрии/u);
  assert.match(source, /recordIndex \+ 1/u);
  assert.match(source, /diagnostic\?\.schemaId === "elements"/u);
  assert.match(source, /diagnostic\?\.schemaId === "regions"/u);
  assert.match(source, /DIAGNOSTIC_REASONS/u);
  assert.match(source, /title=\{diagnosticDetail\(diagnostic\)\}/u);
});

test("Three viewport loads lazily and releases WebGL resources", async () => {
  const source = await readFile(viewportUrl, "utf8");

  assert.match(source, /import\("three"\)/u);
  assert.match(
    source,
    /import\("three\/addons\/controls\/OrbitControls\.js"\)/u,
  );
  assert.match(source, /new ResizeObserver\(resizeRenderer\)/u);
  assert.match(source, /requestAnimationFrame/u);
  assert.doesNotMatch(source, /setAnimationLoop/u);
  assert.doesNotMatch(source, /new THREE\.InstancedMesh/u);
  assert.match(source, /controls\?\.dispose\(\)/u);
  assert.match(source, /renderer\?\.dispose\?\.\(\)/u);
  assert.match(source, /renderer\?\.forceContextLoss\?\.\(\)/u);
  assert.match(source, /geometry\?\.dispose\?\.\(\)/u);
});

test("Three viewport switches orthographic and perspective cameras", async () => {
  const source = await readFile(viewportUrl, "utf8");

  assert.match(source, /DEFAULT_PROJECTION = "orthographic"/u);
  assert.match(source, /new THREE\.OrthographicCamera/u);
  assert.match(source, /new THREE\.PerspectiveCamera/u);
  assert.match(source, /camera\.isOrthographicCamera/u);
  assert.match(source, /controls\.object = camera/u);
  assert.match(source, /const preservedTarget = controls\.target\.clone\(\)/u);
  assert.match(source, /switchProjection\(projection\)/u);
  assert.match(source, /fitCameraToBounds\(THREE, camera, controls, currentBounds\)/u);
});

test("Three viewport uses tight framing and supports persistent preview fitting", async () => {
  const source = await readFile(viewportUrl, "utf8");

  assert.match(source, /CAMERA_FRAME_PADDING = 1\.08/u);
  assert.match(source, /const padding = normalizeFramePadding\(framePadding\)/u);
  assert.match(source, /props\.fitAllPadding/u);
  assert.match(
    source,
    /props\.autoFit === true[\s\S]*?fitCameraToBounds\(THREE, camera, controls, currentBounds\);/u,
  );
  assert.match(source, /!hasFramedGeometry \|\| props\.autoFit === true/u);
});

test("Three viewport applies repeatable fixed camera-view requests", async () => {
  const source = await readFile(viewportUrl, "utf8");

  assert.match(source, /normalizeGeometryCameraCommand\(request\?\.command\)/u);
  assert.match(source, /geometryCameraFrame\(command\)/u);
  assert.match(source, /camera\.up\.fromArray\(frame\.up\)/u);
  assert.match(
    source,
    /camera\.position\.fromArray\(frame\.offset\)\.add\(controls\.target\)/u,
  );
  assert.match(source, /rebuildOrbitControls\(\)/u);
  assert.match(source, /OrbitControlsClass = controlsModule\.OrbitControls/u);
  assert.match(source, /controls = createOrbitControls\(target\)/u);
  assert.match(source, /controls\.dispose\(\)/u);
  assert.match(source, /props\.viewRequest/u);
  assert.match(source, /applyViewRequest\(request\)/u);
  assert.doesNotMatch(source, /props\.fitRequest/u);
});

test("Three viewport applies object, selection, and symmetry filters", async () => {
  const source = await readFile(viewportUrl, "utf8");

  assert.match(source, /primitiveVisible\(/u);
  assert.match(source, /instanceVisible\(/u);
  assert.match(source, /filters\?\.objectModes/u);
  assert.match(source, /filters\?\.selections/u);
  assert.match(source, /filters\?\.symmetry/u);
});

test("Three viewport renders the full selection and fixes reflected face winding", async () => {
  const source = await readFile(viewportUrl, "utf8");

  assert.match(source, /budget = Infinity/u);
  assert.match(source, /renderedPrimitives \+= objectCost/u);
  assert.match(source, /matrix\.fromArray\(instance\.matrix\)/u);
  assert.match(source, /matrix\.determinant\(\) < 0/u);
  assert.match(source, /sourceIndices\[index \+ 2\]/u);
  assert.match(source, /instanceCategory\(instance\) === category/u);
  assert.match(source, /selectedInstances/u);
  assert.match(source, /truncated/u);
  assert.match(source, /depthWrite:\s*mode !== "translucent"/u);
});

test("vertices and geometry expose hover picking metadata", async () => {
  const source = await readFile(viewportUrl, "utf8");

  assert.match(source, /appendVertexBatch\(/u);
  assert.match(source, /new THREE\.Points\(/u);
  assert.match(source, /size:\s*VERTEX_POINT_SIZE/u);
  assert.match(source, /sizeAttenuation:\s*false/u);
  assert.match(source, /new THREE\.Raycaster\(/u);
  assert.match(source, /findVertexMetadataRange\(/u);
  assert.match(source, /formatGeometryTooltip\(/u);
  assert.match(source, /formatVertexTooltip\(/u);
  assert.match(source, /geometryHit\.point/u);
  assert.match(source, /hitPoint\.x, hitPoint\.y, hitPoint\.z/u);
  assert.match(source, /String\(text\)\.split\("\\n"\)/u);
  assert.match(source, /longestLineLength/u);
  assert.match(source, /geometryHitInstance\(/u);
  assert.match(source, /vertexHitMetadata\(/u);
  assert.match(source, /instances,\s*kind:\s*pickKind,\s*span:\s*pickSpan/su);
  assert.match(source, /mergedTopologyLineGeometry\(/u);
  assert.match(source, /pickSpan = wireframe\.vertexSpan/u);
  assert.match(source, /pickFrame = requestAnimationFrame/u);
  assert.match(source, /PICK_INTERVAL_MS = 80/u);
  assert.match(source, /controlsInteracting/u);
  assert.match(source, /materializeVertexPoints/u);
  assert.match(source, /vertexBatches/u);
  assert.match(source, /showVertices/u);
  assert.match(source, /class="geometry-viewport-tooltip"/u);
});

test("degenerate geometry falls back to pickable topology lines or points", async () => {
  const source = await readFile(viewportUrl, "utf8");

  assert.match(source, /function primitiveRenderShape\(/u);
  assert.match(source, /hasNonzeroTriangle\(primitive\)/u);
  assert.match(source, /primitive\.edgeIndices/u);
  assert.match(source, /function mergedTopologyLineGeometry\(/u);
  assert.match(source, /function mergedDegeneratePointGeometry\(/u);
  assert.match(source, /renderShape === "line"/u);
  assert.match(source, /renderShape === "point"/u);
  assert.match(source, /new THREE\.PointsMaterial\(\{/u);
  assert.match(source, /size:\s*DEGENERATE_POINT_SIZE/u);
  assert.match(source, /sizeAttenuation:\s*false/u);
  assert.match(source, /pickKind = "points"/u);
  assert.match(source, /pickKind = "lines"/u);
  assert.match(source, /renderShape,/u);
  assert.match(
    source,
    /if \(sphere\.radius === 0\) distance = Math\.max\(distance, 1\)/u,
  );
});

test("discretization helpers are lazy, complete and point-pickable", async () => {
  const source = await readFile(viewportUrl, "utf8");

  assert.match(source, /buildElementDiscretization/u);
  assert.match(source, /buildRegionDiscretization/u);
  assert.match(source, /countElementDiscretization/u);
  assert.match(source, /countRegionDiscretization/u);
  assert.match(source, /vertices \+= count \* instances\.length/u);
  assert.match(source, /sourcePointCount: count/u);
  assert.match(source, /includeLines: layer === "lines"/u);
  assert.match(source, /includePoints: layer === "points"/u);
  assert.match(source, /materializeDiscretizationLines/u);
  assert.match(source, /materializeDiscretizationPoints/u);
  assert.match(
    source,
    /if \(primitive\.discretization\) \{[\s\S]*?discretizationBatches\.push/u,
  );
  assert.match(source, /new THREE\.LineSegments\(/u);
  assert.match(
    source,
    /function createDiscretizationLines[\s\S]*?new THREE\.LineBasicMaterial\(\{[\s\S]*?color:\s*0x72d5ff[\s\S]*?lines\.name = "geometry-discretization-lines"/u,
  );
  assert.match(source, /geometry-discretization-lines/u);
  assert.match(source, /geometry-discretization-points/u);
  assert.match(source, /primitive\?\.controlVertices \?\? primitive\?\.vertices/u);
  assert.match(source, /findPointMetadataRange/u);
  assert.match(source, /pointHitMetadata/u);
  assert.match(source, /formatDiscretizationPointTooltip/u);
  assert.match(source, /discretizationWorldPositions/u);
  assert.match(source, /new Float64Array\(positions\)/u);
  assert.doesNotMatch(source, /discretizationTruncated/u);
  assert.match(source, /helperPointsShown/u);
  assert.match(
    source,
    /surfaceEdgesShown === true \|\|[\s\S]*?helperLinesShown \|\| helperPointsShown/u,
  );
  assert.doesNotMatch(
    source,
    /geometryPickTargets\.push\(discretizationLines\)/u,
  );
});

test("surface lighting preserves visibly flat faces", async () => {
  const source = await readFile(viewportUrl, "utf8");

  assert.match(source, /new THREE\.MeshLambertMaterial/u);
  assert.match(source, /flatShading:\s*!primitive\.smoothSurface/u);
  assert.match(source, /new THREE\.AmbientLight\(0xffffff, 1\.25\)/u);
  assert.match(source, /new THREE\.DirectionalLight\(0xffffff, 0\.55\)/u);
  assert.doesNotMatch(source, /new THREE\.MeshStandardMaterial/u);
  assert.match(source, /if \(primitive\.smoothSurface\) geometry\.computeVertexNormals\(\)/u);
  assert.doesNotMatch(source, /new THREE\.HemisphereLight/u);
});

test("material colors follow element properties and symmetry role", async () => {
  const source = await readFile(viewportUrl, "utf8");

  assert.match(source, /resolveGeometryMaterialStyle\(primitive\.materialKind, original\)/u);
  assert.match(source, /const original = category === "base"/u);
  assert.match(
    source,
    /primitive\.materialKind === GEOMETRY_MATERIAL_KINDS\.VIRTUAL/u,
  );
  assert.doesNotMatch(source, /category === "mirror"[\s\S]*?color:/u);
});

test("surface edges are controlled independently and remain thin", async () => {
  const source = await readFile(viewportUrl, "utf8");

  assert.match(source, /function appendSurfaceEdges\(/u);
  assert.match(
    source,
    /const showSurfaceEdges = renderShape === "surface" && showEdges === true/u,
  );
  assert.match(source, /renderObjectCost\(primitive, mode, showEdges\)/u);
  assert.match(source, /new THREE\.LineBasicMaterial\(\{[\s\S]*?color: style\.edgeColor/su);
  assert.match(source, /linewidth:\s*1/u);
  assert.match(source, /polygonOffset:\s*showSurfaceEdges/u);
  assert.match(source, /appendSurfaceEdges\(/u);
  assert.doesNotMatch(source, /new THREE\.EdgesGeometry/u);
  assert.match(source, /const wireframe = mergedTopologyLineGeometry\(THREE, primitive, instances\)/u);
  assert.match(source, /primitive\.edgeIndices/u);
});

test("axes use a separate bottom-left screen-space scene", async () => {
  const source = await readFile(viewportUrl, "utf8");

  assert.match(source, /createAxesGizmo\(THREE\)/u);
  assert.match(source, /createAxisArrow/u);
  assert.match(source, /new THREE\.CylinderGeometry/u);
  assert.match(source, /new THREE\.ConeGeometry/u);
  assert.match(source, /createAxisLabel/u);
  assert.match(source, /AXES_GIZMO_MARGIN/u);
  assert.match(source, /renderer\.setScissor\(/u);
  assert.match(source, /renderer\.clearDepth\(\)/u);
  assert.match(source, /renderer\.render\(axesScene, axesCamera\)/u);
  assert.doesNotMatch(source, /new THREE\.AxesHelper/u);
});

test("geometry viewer canvas, menus, and tooltip fill the resizable window", async () => {
  const styles = await readFile(stylesUrl, "utf8");

  assert.match(
    styles,
    /\.geometry-viewer-window\s*\{[^}]*position:\s*relative;[^}]*height:\s*100%;[^}]*min-height:\s*0;/su,
  );
  assert.match(
    styles,
    /\.geometry-viewer-canvas-region\s*\{[^}]*flex:\s*1 1 0;[^}]*min-height:\s*0;/su,
  );
  assert.match(styles, /\.three-geometry-viewport\s*\{[^}]*inset:\s*0;/su);
  assert.match(
    styles,
    /\.three-geometry-viewport canvas\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;/su,
  );
  assert.match(
    styles,
    /\.geometry-viewer-toolbar-controls\s*\{[^}]*display:\s*grid;[^}]*grid-auto-flow:\s*column;[^}]*grid-auto-columns:\s*1fr;[^}]*width:\s*max-content;[^}]*min-width:\s*100%;/su,
  );
  assert.match(
    styles,
    /\.geometry-viewer-menu-button,[\s\S]*?\.geometry-viewer-select\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;/su,
  );
  assert.match(
    styles,
    /\.geometry-viewer-options-panel\s*\{[^}]*position:\s*absolute;[^}]*z-index:\s*6;/su,
  );
  assert.match(
    styles,
    /\.geometry-viewport-tooltip\s*\{[^}]*position:\s*absolute;[^}]*overflow-wrap:\s*anywhere;[^}]*white-space:\s*pre-line;[^}]*pointer-events:\s*none;/su,
  );
  assert.match(
    styles,
    /\.geometry-viewer-view-command\s*\{[^}]*min-height:\s*27px;[^}]*text-align:\s*left;[^}]*cursor:\s*pointer;/su,
  );
});
