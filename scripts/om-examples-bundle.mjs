import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

/** Generated public inputs only; canonical tasks and controls live in clark.tests. */
export async function readOMExamplesBundle(file) {
  const bytes = await readFile(file);
  if (bytes.length > 16 * 1024 * 1024) throw new Error('Комплект ОМ превышает 16 МБ.');
  const bundle = JSON.parse(bytes);
  if (bundle.schema !== 'clark-om-examples/1' || !Array.isArray(bundle.files)) throw new Error('Неизвестный формат комплекта ОМ.');
  const files = new Map();
  for (const entry of bundle.files) {
    if (!/^Open Modelica\/test_circuit_(with|without)_neutral_1\/input3XX\/(?:xapLibFMM\/)?[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(entry.path)
      || files.has(entry.path) || typeof entry.data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.data)) throw new Error('Некорректный путь или содержимое комплекта ОМ.');
    const data = Buffer.from(entry.data, 'base64');
    if (createHash('sha256').update(data).digest('hex') !== entry.sha256) throw new Error(`Повреждён файл примера ОМ: ${entry.path}`);
    files.set(entry.path, data);
  }
  for (const variant of ['with','without']) for (const name of ['general.txt','om-client.json','circuit-config.json','server-config.json','amplitudes.txt']) {
    if (!files.has(`Open Modelica/test_circuit_${variant}_neutral_1/input3XX/${name}`)) throw new Error('Неполный комплект примеров ОМ.');
  }
  return files;
}
