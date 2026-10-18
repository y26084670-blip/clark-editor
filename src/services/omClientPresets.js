import { parseOMJson, validateOMPreset } from "./omClientService.js";

// Add a JSON file to this directory to ship a model preset with the editor.
// A developer's editor-preset.json can also be loaded directly in the window.
const files = import.meta.glob("../data/om-presets/*.json", { eager: true, import: "default" });
export const omClientPresets = Object.values(files).map(validateOMPreset);
export const omPresetKey = preset => `${preset.selection.model}/${preset.label}`;
const STORAGE_KEY = "web-gui:om-client-presets";

export function readOMPresets() {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    const imported = text ? parseOMJson(text, "Сохранённые пресеты") : [];
    if (!Array.isArray(imported)) throw new Error("Некорректный список пресетов.");
    imported.forEach(validateOMPreset);
    // Old browser entries may differ only by their informational build version.
    const keys = new Set();
    const unique = imported.filter(preset => {
      const key = omPresetKey(preset);
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    });
    return { presets: [...unique, ...omClientPresets.filter(p => !keys.has(omPresetKey(p)))], notice: "" };
  } catch {
    return { presets: omClientPresets, notice: "Не удалось прочитать сохранённые пресеты браузера. При необходимости загрузите editor-preset.json повторно." };
  }
}

export function rememberOMPreset(preset, presets) {
  const builtins = new Set(omClientPresets);
  const imported = [preset, ...presets.filter(p => !builtins.has(p) && omPresetKey(p) !== omPresetKey(preset))];
  try {
    const text = JSON.stringify(imported);
    parseOMJson(text, "Сохранённые пресеты");
    localStorage.setItem(STORAGE_KEY, text);
    return "";
  } catch { return "Пресет доступен в этом сеансе; браузер не смог запомнить его для следующего открытия."; }
}
