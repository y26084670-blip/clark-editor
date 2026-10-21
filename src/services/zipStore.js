// Small bounded ZIP/STORE writer. UTF-8 paths; no compression, ZIP64 or extraction.
const encoder = new TextEncoder();
export const ZIP_MAX_BYTES = 32 * 1024 * 1024;
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function header(length) {
  const bytes = new Uint8Array(length), view = new DataView(bytes.buffer);
  return { bytes, u16: (p, v) => view.setUint16(p, v, true), u32: (p, v) => view.setUint32(p, v, true) };
}
export function createStoredZip(files) {
  if (!Array.isArray(files) || !files.length || files.length > 100) throw new Error("Недопустимый состав ZIP");
  const names = new Set(), entries = files.map(({ name, data }) => {
    if (typeof name !== "string" || !name || /[\\:\u0000-\u001f]/u.test(name)
      || name.split("/").some(p => !p || p === "." || p === "..") || names.has(name)) throw new Error("Недопустимое или повторное имя ZIP");
    names.add(name);
    const path = encoder.encode(name), bytes = typeof data === "string" ? encoder.encode(data) : data;
    if (path.length > 65535 || !(bytes instanceof Uint8Array)) throw new Error("Недопустимые данные ZIP");
    return { path, bytes };
  });
  const total = 22 + entries.reduce((sum, { path, bytes }) => sum + 76 + 2 * path.length + bytes.length, 0);
  if (total > ZIP_MAX_BYTES) throw new Error("Пакет превышает 32 МиБ");
  const local = [], central = []; let offset = 0, centralSize = 0;
  for (const { path, bytes } of entries) {
    const crc = crc32(bytes), h = header(30), c = header(46);
    h.u32(0, 0x04034b50); h.u16(4, 20); h.u16(6, 0x800); h.u16(12, 33); // 1980-01-01
    h.u32(14, crc); h.u32(18, bytes.length); h.u32(22, bytes.length); h.u16(26, path.length);
    c.u32(0, 0x02014b50); c.u16(4, 20); c.u16(6, 20); c.u16(8, 0x800); c.u16(14, 33);
    c.u32(16, crc); c.u32(20, bytes.length); c.u32(24, bytes.length); c.u16(28, path.length); c.u32(42, offset);
    local.push(h.bytes, path, bytes); central.push(c.bytes, path);
    offset += 30 + path.length + bytes.length; centralSize += 46 + path.length;
  }
  const end = header(22); end.u32(0, 0x06054b50); end.u16(8, entries.length); end.u16(10, entries.length);
  end.u32(12, centralSize); end.u32(16, offset);
  return new Blob([...local, ...central, end.bytes], { type: "application/zip" });
}
