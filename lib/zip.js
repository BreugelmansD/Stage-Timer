'use strict';
/**
 * Minimale ZIP-lezer (voldoende voor .docx en .xlsx), zonder dependencies.
 */
const zlib = require('zlib');

function readZip(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('Geen geldig ZIP-bestand');

  // Zoek "End of central directory" (vanaf het einde, max. 64KB commentaar).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Geen geldig ZIP-bestand');

  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  const entries = new Map();

  for (let n = 0; n < count; n++) {
    if (ptr + 46 > buf.length || buf.readUInt32LE(ptr) !== 0x02014b50) break;
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen);
    entries.set(name, { method, compSize, localOffset });
    ptr += 46 + nameLen + extraLen + commentLen;
  }

  return {
    names: () => [...entries.keys()],
    has: (name) => entries.has(name),
    read(name) {
      const e = entries.get(name);
      if (!e) return null;
      const lo = e.localOffset;
      if (buf.readUInt32LE(lo) !== 0x04034b50) throw new Error('Beschadigd ZIP-bestand');
      const start = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
      const data = buf.subarray(start, start + e.compSize);
      if (e.method === 0) return Buffer.from(data);
      if (e.method === 8) return zlib.inflateRawSync(data);
      throw new Error(`Niet-ondersteunde ZIP-compressie (${e.method})`);
    },
    readText(name) {
      const b = this.read(name);
      return b ? b.toString('utf8') : null;
    },
  };
}

module.exports = { readZip };
