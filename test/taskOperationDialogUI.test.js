import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const jsx = readFileSync(new URL("../src/components/tasks/TaskOperationDialog.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/components/tasks/TaskOperationDialog.css", import.meta.url), "utf8");
const sideCss = readFileSync(new URL("../src/components/SidePanel.css", import.meta.url), "utf8");

test("task operation dialogs use dark theme and equal action button widths", () => {
  assert.match(css, /\.task-operation-dialog\s*\{[\s\S]*background:\s*#1d2228;[\s\S]*color:\s*#edf2f7;[\s\S]*color-scheme:\s*dark;/);
  assert.match(css, /\.task-operation-actions\s*\{[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(css, /\.task-operation-actions button\s*\{[\s\S]*width:\s*100%;/);
  assert.match(sideCss, /\.side-panel-option\s*\{[\s\S]*width:\s*100%;/);
});

test("rename and delete require the confirmation checkbox before submit", () => {
  assert.match(jsx, /Все операции с этим заданием будут остановлены/);
  assert.match(jsx, /disabled=\{props\.busy \|\| props\.failed \|\| \(needsStopped\(\) && !stopped\(\)\)\}/);
  assert.match(jsx, /const relocation = \(\) => \["rename", "move"\]\.includes/);
  assert.match(jsx, /const deletion = \(\) => props\.request\?\.kind === "delete"/);
});
