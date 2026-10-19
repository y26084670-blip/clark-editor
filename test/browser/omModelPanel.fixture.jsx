import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { OMClientWindow } from "../../src/components/tasks/OMClientWindow.jsx";
import { TaskStatusCells } from "../../src/components/tasks/TaskStatusCells.jsx";
import { useTaskStatuses } from "../../src/services/taskStatusMonitor.js";
import source from "../../src/data/om-presets/circuit-star.json";

const preset = structuredClone(source);
preset.data.extension = { untouched: "vendor data" };
preset.data.branches.forEach((row, i) => { row.R_Ohm = i + 10; });
preset.coupling.outputs[0].indices = [2, 7, 9];
const root = await navigator.storage.getDirectory();
const task = await root.getDirectoryHandle("om-panel-check", { create: true });
const input = await task.getDirectoryHandle("input3XX", { create: true });
try { await input.removeEntry("_om-client.json"); } catch (error) { if (error.name !== "NotFoundError") throw error; }
const output = await task.getDirectoryHandle("output3XX", { create: true });
await output.getFileHandle("_summary_out.txt", { create: true });
const pulses = Array.from({ length: 6 }, () => ({ impuls: [[0, 0], [1, 1]] }));
async function write(name, value) {
  const stream = await (await input.getFileHandle(name, { create: true })).createWritable();
  await stream.write(value); await stream.close();
}
await write("om-client.json", JSON.stringify(preset.selection));
await write("circuit-config.json", JSON.stringify(preset.data));
await write("server-config.json", JSON.stringify(preset.coupling));
await write("amplitudes.txt", pulses.map(() => JSON.stringify({ n: 2, impuls: [0, 1, 0, 1] })).join("\n") + "\n");
const [dirtyParts, setDirtyParts] = createSignal([]);
const [models, setModels] = createSignal({ amps: pulses, moves: [], general: { timeStep: 0.001, countTimeSteps: 20 },
  elements: [{ name: "Статор A", indCoil: 2, indAmp: 1, targ: 0 },
    { name: "Статор B", indCoil: 2, indAmp: 1, targ: 0 },
    { name: "Ротор", indCoil: 7, indAmp: 2, targ: 0 }],
  regions: [{ name: "Воздух", indCoil: 9 }] });
let state;
window.omPanelFixture = {
  setDirtyParts, setModels, models,
  state: () => state,
  async read(name) { return (await (await input.getFileHandle(name)).getFile()).text(); },
};
render(() => {
  const statuses = useTaskStatuses(() => [{ key: task, handle: task }]);
  return <><div id="task-status-fixture" style="position:fixed;left:8px;top:8px;display:grid;grid-template-columns:42px 30px 18px">
    <TaskStatusCells status={statuses(task)} />
  </div><OMClientWindow request={{ handle: task, path: "check/OM" }}
  onFilesChange={() => { void statuses.refresh(); }}
  taskModel={models()} amplitudes={models().amps} amplitudesDirty={dirtyParts().includes("amps")}
  dirtyParts={dirtyParts()} onStateChange={value => { state = value; }} /></>;
}, document.getElementById("root"));
