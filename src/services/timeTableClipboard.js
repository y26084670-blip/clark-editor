// Clipboard TSV is row-major, just like BaseModel ARRAY values. File storage
// order and derived node counts remain the responsibility of the schema.
export function parseTimeTableClipboard(text, columns) {
  if (!Number.isInteger(columns) || columns < 2) throw new Error("Не задано число колонок таблицы.");
  if (typeof text !== "string" || !text.trim()) throw new Error("Буфер обмена пуст. Скопируйте числовую таблицу без заголовка.");
  const lines = text.replace(/^\uFEFF/u, "").split(/\r\n|\n|\r/u);
  while (lines.at(-1) === "") lines.pop();
  return lines.map((line, row) => {
    const cells = line.split("\t");
    if (cells.length !== columns) {
      throw new Error(`Строка ${row + 1}: требуется ${columns} колонки с разделением табуляцией; получено ${cells.length}.`);
    }
    return cells.map((cell, column) => {
      let value = cell.trim();
      // Excel can copy a formatted number with space / NBSP thousands groups.
      if (/^[+-]?\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d*)?(?:[eEdD][+-]?\d+)?$/u.test(value)) {
        value = value.replace(/[ \u00a0\u202f]/gu, "");
      }
      if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eEdD][+-]?\d+)?$/u.test(value)) {
        throw new Error(`Строка ${row + 1}, колонка ${column + 1}: требуется число; получено «${cell.trim()}». Копируйте значения без заголовка.`);
      }
      const number = Number(value.replace(",", ".").replace(/[dD]/u, "e"));
      if (!Number.isFinite(number)) throw new Error(`Строка ${row + 1}, колонка ${column + 1}: число вне допустимого диапазона.`);
      return number;
    });
  });
}

export function timeTableClipboardPatch(schema, propertyName, text) {
  const action = schema?.views?.clipboardTables?.find(item => item.property === propertyName);
  const property = schema?.properties?.[propertyName];
  if (!action || !property || property.readonly) throw new Error("Таблица не поддерживает замену из буфера.");
  return { [propertyName]: parseTimeTableClipboard(text, property.nColumns) };
}
