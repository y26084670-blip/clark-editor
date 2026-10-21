import { getFileSystemAccessSupport } from "./fileSystemAccessSupport.js";
import { sortTaskDirectories } from "./taskLastOpenedService.js";

export const CATALOG_REQUEST_FILE = "clark.catalogs-request.json";
export const CATALOG_RESULT_FILE = "clark.catalogs-result.json";
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validGuid = value => typeof value === "string" && GUID.test(value) && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value);

export function isProjectCatalog(name) {
  return typeof name === "string" && /^clark\..+/i.test(name) && name.length <= 255
    && name.toLowerCase() !== "clark.app" && !/[\\/<>:"|?*\x00-\x1f]|[. ]$/.test(name);
}

export async function listProjectCatalogs(disk) {
  const catalogs = [];
  // Служебные каталоги только перечисляются: их содержимое не открывается.
  for await (const [name, handle] of disk.entries()) {
    if (handle.kind === "directory" && isProjectCatalog(name)) catalogs.push({ name, handle });
  }
  return sortTaskDirectories(catalogs);
}

export async function pickProjectDisk(browser = window) {
  const support = getFileSystemAccessSupport(browser);
  if (!support.supported) throw new Error(support.message);
  const handle = await browser.showDirectoryPicker({ id: "clark-project-disk", mode: "readwrite" });
  return { handle, catalogs: await listProjectCatalogs(handle) };
}

export async function prepareCatalogBinding(disk, catalogs) {
  if (!catalogs.length || catalogs.length > 1000) throw new Error("Для связывания выберите диск с каталогами clark.* (не более 1000).");
  const names = new Set();
  for (const { name } of catalogs) {
    if (!isProjectCatalog(name) || names.has(name.toLowerCase())) throw new Error("Некорректный список каталогов clark.*.");
    names.add(name.toLowerCase());
  }
  const request = { schemaVersion: 1, requestId: crypto.randomUUID(),
    catalogs: catalogs.map(({ name }) => ({ name, workspaceId: crypto.randomUUID() })) };
  const file = await disk.getFileHandle(CATALOG_REQUEST_FILE, { create: true });
  const stream = await file.createWritable();
  try { await stream.write(JSON.stringify(request, null, 2) + "\n"); await stream.close(); }
  catch (error) { try { await stream.abort(); } catch { /* Поток уже закрыт. */ } throw error; }
  return { ...request, uri: `clark://bind-catalogs?request=${request.requestId}&name=${encodeURIComponent(disk.name || "Диск с проектами")}` };
}

export async function readCatalogBindingResult(disk, request) {
  let file;
  try { file = await (await disk.getFileHandle(CATALOG_RESULT_FILE)).getFile(); }
  catch (error) { if (error?.name === "NotFoundError") return null; throw error; }
  if (file.size > 1024 * 1024) throw new Error("Слишком большой ответ Решателя.");
  const result = JSON.parse(await file.text());
  if (result.requestId !== request.requestId) return null;
  if (result.schemaVersion !== 1 || !["bound", "error"].includes(result.state) || !Array.isArray(result.catalogs)) {
    throw new Error("Некорректный ответ Решателя при связывании каталогов.");
  }
  const seen = new Set();
  for (const item of result.catalogs) {
    if (!validGuid(item.workspaceId) || seen.has(item.name)
      || !request.catalogs.some(expected => expected.name === item.name && expected.workspaceId === item.workspaceId)) {
      throw new Error("Ответ Решателя не соответствует выбранным каталогам.");
    }
    seen.add(item.name);
  }
  if (result.state === "bound" && seen.size !== request.catalogs.length) throw new Error("Решатель подтвердил не все каталоги.");
  return result;
}
