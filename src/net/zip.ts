import { deflateRawSync } from 'node:zlib';

/**
 * A ZIP ARCHIVE, WRITTEN WITH NOTHING BUT node:zlib — the product keeps to its handful of dependencies. Each file
 * deflated, named in UTF-8, in the order given. The workbook (xlsx.ts) is one; the owner's copy of their papers (E1)
 * is another.
 *
 * The classic format only: at most 65,535 files and 4 GiB in all. An archive past either is refused (thrown), never
 * written wrong — a copy that opens to nothing is worse than none.
 */
export const ZIP_MAX_FILES = 65_535;
const ZIP_MAX_BYTES = 0xffff_ffff;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (b: Buffer): number => {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

export function zipWrite(files: readonly { readonly name: string; readonly data: Buffer }[]): Buffer {
  if (files.length > ZIP_MAX_FILES) throw new Error(`zip: ${files.length} files, past the ${ZIP_MAX_FILES} an archive can hold`);
  const locals: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const { name, data } of files) {
    const packed = deflateRawSync(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    if (data.length > ZIP_MAX_BYTES || offset + 30 + nameBuf.length + packed.length > ZIP_MAX_BYTES) throw new Error('zip: past the 4 GiB an archive can hold');
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, packed);
    const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(8, 10); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(packed.length, 20); cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}
