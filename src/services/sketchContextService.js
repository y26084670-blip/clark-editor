import profile from "../../data/ai-context/AI_SKETCH_CONTEXT.md?raw";
import sourceLock from "../../data/ai-context/source-lock.json";
import packageInfo from "../../package.json";
import { tabRegistry } from "./tabRegistry.js";
import { deserialize, serialize, propertyStoragePath } from "./model/modelSerializer.js";
import { isStoredProperty } from "./model/modelCompute.js";
import { arrayOrder } from "./model/arrayShape.js";

// Descriptor subset, not a second schema or a claim to encode custom validators.
const fields = ["type", "label", "description", "default", "minimum", "maximum", "exclusiveMinimum",
  "exclusiveMaximum", "minItems", "maxItems", "minLength", "maxLength", "pattern", "nColumns", "columns", "itemLabels"];
function describe(property) {
  const result = Object.fromEntries(fields.filter(k => property[k] !== undefined && typeof property[k] !== "function")
    .map(k => [k, structuredClone(property[k])]));
  if (property.enum) result.enum = property.enum.map(({ value, label, description }) => ({ value, label, description }));
  if (property.items) result.items = describe(property.items);
  if (property.nColumns) result.storageOrder = arrayOrder(property);
  if (property.variantCodec) result.variant = "Зависит от geoType; пример ниже только для значения по умолчанию.";
  return result;
}
export function getSketchContext() {
  const schemas = tabRegistry.map(schema => {
    const storage = schema.config.storage;
    const model = deserialize(storage === "cluster" ? {} : Array.from({ length: schema.config.recordCount ?? 1 }, () => ({})), schema);
    const sample = serialize(model, schema);
    return {
      id: schema.id, directory: schema.config.directory, file: schema.config.file, storage,
      required: schema.config.required, recordCount: schema.config.recordCount,
      fields: Object.fromEntries(Object.entries(schema.properties).filter(([, p]) => isStoredProperty(p))
        .map(([key, p]) => [propertyStoragePath(key, p), describe(p)])),
      exampleOnlyNotTask: storage === "cluster" ? JSON.stringify(sample) : sample.map(record => JSON.stringify(record)).join("\n"),
    };
  });
  return { profile, sourceLock, editorVersion: packageInfo.version, schemas };
}
