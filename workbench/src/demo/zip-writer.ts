import { crc32, deflateRawSync } from "node:zlib";

export type ZipEntry = { name: string; data?: Buffer | string; method?: 0 | 8; flags?: number; /** test hooks to build hostile archives */ lieUsize?: number; rawCompressed?: Buffer };

/** Minimal zip writer (demo packages and tests). Not used on any analysis path. */
export function writeZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8"), data = typeof e.data === "string" ? Buffer.from(e.data, "utf8") : (e.data ?? Buffer.alloc(0));
    const method = e.method ?? 8, comp = e.rawCompressed ?? (method === 8 ? deflateRawSync(data) : data), crc = crc32(data) >>> 0, usize = e.lieUsize ?? data.length, flags = e.flags ?? 0;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(flags, 6); lh.writeUInt16LE(method, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(usize, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(flags, 8); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(usize, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, comp); central.push(ch, name); offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central), eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}
