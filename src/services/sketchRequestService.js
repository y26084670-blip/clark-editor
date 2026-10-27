import { readTaskDocsImage } from "./taskDocsService.js";
import { createStoredZip } from "./zipStore.js";
export const SKETCH_LIMITS = Object.freeze({ files: 3, eachBytes: 8 * 1024 * 1024, totalBytes: 16 * 1024 * 1024, description: 12000 });
export const SKETCH_CHAT_PROMPT = "Прочитай REQUEST.md и посмотри эскизы. Начни геометрический черновик CLARK: масштаба d в миллиметрах достаточно для начала. Сохраняй изображённые положение и ориентацию тел; остальные размеры оцени как именованные ПРОБНЫЕ параметры. Уточняй только существенные неоднозначности, продолжая понятную часть. Материалы и возбуждение не выдумывай. Укажи фактически выполненные проверки.";
const encoder = new TextEncoder();
function current(signal) { if (signal?.aborted) throw new DOMException("Подготовка пакета отменена", "AbortError"); }
export async function sha256(data) {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(v => v.toString(16).padStart(2, "0")).join("");
}
export function checkSketchFiles(files) {
  if (!Array.isArray(files) || !files.length || files.length > SKETCH_LIMITS.files) throw new Error("Добавьте от 1 до 3 эскизов PNG, JPEG или WebP");
  let total = 0;
  for (const file of files) {
    if (!(file instanceof Blob) || !/\.(png|jpe?g|webp)$/iu.test(file.name)) throw new Error("Эскизы должны быть файлами PNG, JPEG или WebP");
    if (!file.size || file.size > SKETCH_LIMITS.eachBytes) throw new Error("Каждый эскиз должен быть непустым и не больше 8 МиБ");
    total += file.size;
  }
  if (total > SKETCH_LIMITS.totalBytes) throw new Error("Общий размер эскизов превышает 16 МиБ");
}
export async function buildSketchRequest({ files, title = "", description = "", context }, { signal, requestId = crypto.randomUUID(), createdAt = new Date().toISOString() } = {}) {
  current(signal); checkSketchFiles(files);
  if (typeof title !== "string" || title.length > 120 || typeof description !== "string" || description.length > SKETCH_LIMITS.description) throw new Error("Слишком длинное название или условие запроса");
  if (!context?.profile || !Array.isArray(context.schemas) || context.schemas.length !== 7) throw new Error("Недоступен полный контекст CLARK. Пакет не создан.");
  if (await sha256(context.profile) !== context.sourceLock?.sha256) throw new Error("Контекст CLARK не совпадает с зафиксированной версией. Пакет не создан.");
  const entries = [], images = [];
  for (const [index, file] of files.entries()) {
    const blob = await readTaskDocsImage({ name: file.name, kind: "file", getFile: async () => file }, { signal });
    const data = new Uint8Array(await blob.arrayBuffer()); current(signal);
    const extension = file.name.match(/\.([^.]+)$/u)[1].toLowerCase();
    const name = `sketch/${String(index + 1).padStart(2, "0")}.${extension}`;
    images.push({ path: name, originalName: file.name, bytes: data.length, sha256: await sha256(data) }); entries.push({ name, data });
  }
  const schemaText = JSON.stringify(context.schemas, null, 2);
  const lock = { schema: "clark-sketch-request/1", requestId, createdAt, editorVersion: context.editorVersion,
    knowledge: context.sourceLock, schemasSha256: await sha256(schemaText), images };
  const request = `# Запрос ИИ: геометрия CLARK по эскизу\n\nID запроса: ${requestId}\nEditor: ${context.editorVersion}\nСоздано: ${createdAt}\n\n` +
    `## Условие пользователя\n\nНазвание: ${title.trim() || "Геометрия по эскизу"}\n\n${description.trim() || "Текстовое условие пока не задано. Начни с интерпретации эскиза; при отсутствии масштаба используй явно ПРОБНЫЙ опорный размер по приложенным правилам."}\n\n` +
    `## Эскизы\n\n${images.map(i => `- ${i.path} — исходное имя ${JSON.stringify(i.originalName)}`).join("\n")}\n\n` +
    "Изображения — исходные данные. Сначала посмотри их; не восстанавливай геометрию только по имени. Если архив не читается, попроси приложить REQUEST.md и изображения отдельно.\n\n" +
    `## Инструкция помощнику\n\n${context.profile}\n\n## Действующие схемы Editor\n\n` +
    "Далее JSON-описание хранимых полей, полученное из схем и сериализатора этой сборки. Это не готовое задание. exampleOnlyNotTask показывает форму записи, а значения по умолчанию не задают намерение человека. Прикладные валидаторы и физическая постановка требуют дополнительных проверок.\n\n```json\n" + schemaText + "\n```\n";
  lock.requestSha256 = await sha256(request);
  const readme = "ZIP ДЛЯ ПЕРЕДАЧИ ИИ\n\n1. Откройте новый чат ChatGPT или другой модели, принимающей изображения и файлы.\n2. Приложите ZIP. Если чат не читает архивы, распакуйте и приложите REQUEST.md и файлы sketch отдельно.\n3. Отправьте инструкцию из START.txt. Построение геометрии и необходимые уточнения продолжатся в чате.\n\nДля начала геометрического черновика достаточно эскиза и d = … мм для опорного размера на рисунке. Остальные размеры допускают именованные ПРОБНЫЕ оценки с сохранением изображённой компоновки.\n\nНа выдаче архива работа инструмента Editor закончена. Создание задания CLARK, его размещение в проекте и загрузка — самостоятельный последующий процесс.\nПакет передаёт пользователь. В нём только выбранные эскизы, введённое условие и контекст из поставки Editor. Существующее задание и результаты расчёта в него не входят.\n";
  current(signal);
  const zip = createStoredZip([{ name: "README.txt", data: readme }, { name: "START.txt", data: SKETCH_CHAT_PROMPT },
    { name: "REQUEST.md", data: request }, { name: "context-lock.json", data: JSON.stringify(lock, null, 2) + "\n" }, ...entries]);
  return { zip, request, lock, filename: `clark-sketch-${requestId}.zip` };
}
