import { DIRECTORIES } from "../schemas/common/constants.js";

export const CONSTRUCTIONS_FILE = "_constructions.json";
const COLOR = /^#[0-9a-f]{6}$/i;

export function constructionCoordinate(text) {
  const normalized = String(text).trim().replace(",", ".");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(Math.fround(value)) ? value : null;
}

export function newConstruction() {
  return { id: crypto.randomUUID(), color: "#ffdc55", visible: true, closed: false, nodes: [] };
}

export function moveConstructionNode(nodes, from, to) {
  if (from === to || !Number.isInteger(from) || !Number.isInteger(to)
      || Math.min(from, to) < 0 || Math.max(from, to) >= nodes.length) return nodes;
  const result = nodes.slice();
  result.splice(to, 0, ...result.splice(from, 1));
  return result;
}

function decode(text) {
  if (text === null) return [];
  const data = JSON.parse(text);
  const ids = new Set();
  const valid = cell => {
    if (!cell || typeof cell.id !== "string" || !cell.id || ids.has(cell.id)
        || typeof cell.color !== "string" || !COLOR.test(cell.color)
        || (cell.visible !== undefined && typeof cell.visible !== "boolean")
        || typeof cell.closed !== "boolean" || !Array.isArray(cell.nodes)) return false;
    ids.add(cell.id);
    return cell.nodes.every(point => Array.isArray(point) && point.length === 3
      && point.every(n => typeof n === "number" && Number.isFinite(Math.fround(n))));
  };
  if (data?.version !== 1 || !Array.isArray(data.cells) || !data.cells.every(valid)) {
    throw new Error("Некорректный формат файла построений.");
  }
  return data.cells.map(cell => ({ ...cell, visible: cell.visible ?? true }));
}

async function readText(directory) {
  let handle;
  try { handle = await directory.getFileHandle(CONSTRUCTIONS_FILE); }
  catch (error) { if (error.name === "NotFoundError") return null; throw error; }
  return (await handle.getFile()).text();
}

// Queue opens and saves across handles, including a quick return to the same task.
// The Web Lock also serializes the compare/write pair across Editor tabs.
let pending = Promise.resolve();
function inFileOrder(action) {
  const run = () => globalThis.navigator?.locks
    ? navigator.locks.request("clark-editor:geometry-constructions", action) : action();
  const result = pending.then(run);
  pending = result.catch(() => {});
  return result;
}

export function openGeometryConstructions(task) {
  return inFileOrder(async () => {
    const directory = await task.getDirectoryHandle(DIRECTORIES.INPUT);
    let savedText = await readText(directory);
    const cells = decode(savedText);
    return {
      cells,
      save(cells) {
        const text = JSON.stringify({ version: 1, cells }) + "\n";
        return inFileOrder(async () => {
          if (await readText(directory) !== savedText) {
            throw new DOMException("Файл построений изменён в другом окне.", "InvalidModificationError");
          }
          if (text === savedText) return;
          const handle = await directory.getFileHandle(CONSTRUCTIONS_FILE, { create: true });
          // A newly created native file is empty until the first successful close.
          if (savedText === null) savedText = "";
          let stream;
          try {
            stream = await handle.createWritable();
            await stream.write(text);
            await stream.close();
            savedText = text;
          } catch (error) {
            if (stream) await stream.abort().catch(() => {});
            if (savedText === "" && await readText(directory) === "") {
              await directory.removeEntry(CONSTRUCTIONS_FILE);
              savedText = null;
            }
            throw error;
          }
        });
      },
    };
  });
}

export function buildConstructionLayer(THREE, cells) {
  const root = new THREE.Group();
  root.name = "geometry-constructions";
  for (const cell of cells) {
    if (!cell.visible || !cell.nodes.length) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(cell.nodes.flat(), 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({
      color: cell.color, size: 5, sizeAttenuation: false, depthWrite: false,
    }));
    root.add(points);
    if (cell.nodes.length > 1) {
      const Line = cell.closed && cell.nodes.length > 2 ? THREE.LineLoop : THREE.Line;
      root.add(new Line(geometry, new THREE.LineBasicMaterial({ color: cell.color, depthWrite: false })));
    }
  }
  return root;
}
