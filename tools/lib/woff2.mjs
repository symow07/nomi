/**
 * THE CHARACTERS A FONT FILE REALLY DRAWS (the type pass, 2026-10-04).
 *
 * A face's `unicode-range` is a promise: "fetch me for these characters". The
 * packages the product vendors from promise more than some files hold — the
 * Arabic face's symbols slice claimed U+25A0–27BF, so every English page
 * fetched it twice (for ○ and ✓) and the marks were then drawn by the device's
 * fonts anyway (docs/TYPE-ICONS-TRUTH.md §1.3). This reads the file's own
 * character map, so the manifest can promise only what the file draws.
 *
 * WOFF2 (W3C, 2018): a 48-byte header, a table directory, then every table in
 * one Brotli stream, back to back, in directory order. The character map
 * (`cmap`) is never transformed, so it is read as it is in a plain font:
 * format 12 (any plane) where there is one, else format 4 (the first plane).
 * Node's own zlib decompresses Brotli; nothing else is needed.
 */
import { brotliDecompressSync } from 'node:zlib';

/** The 63 known tags, in the order the format numbers them (a directory entry names one by its index). */
const TAGS = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ',
  'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB',
  'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar',
  'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf',
  'Glat', 'Gloc', 'Feat', 'Sill'];

/** Each table of a WOFF2 file, by tag, as it sits in the decompressed stream. */
export function woff2Tables(buf) {
  if (buf.toString('latin1', 0, 4) !== 'wOF2') throw new Error('not a woff2 file');
  const count = buf.readUInt16BE(12);
  const compressed = buf.readUInt32BE(20);
  let at = 48;
  const base128 = () => {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const b = buf[at++];
      v = v * 128 + (b & 0x7f);
      if (!(b & 0x80)) return v;
    }
    throw new Error('a length longer than the format allows');
  };
  const dir = [];
  for (let i = 0; i < count; i++) {
    const flags = buf[at++];
    let tag = TAGS[flags & 0x3f];
    if ((flags & 0x3f) === 0x3f) { tag = buf.toString('latin1', at, at + 4); at += 4; }
    const version = flags >> 6;
    const length = base128();
    // glyf and loca are transformed unless their version is 3; every other table only when its version is not 0.
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
    dir.push({ tag, length: transformed ? base128() : length });
  }
  const data = brotliDecompressSync(buf.subarray(at, at + compressed));
  const tables = new Map();
  let off = 0;
  for (const d of dir) { tables.set(d.tag, data.subarray(off, off + d.length)); off += d.length; }
  return tables;
}

/** Every code point the file maps to a glyph. */
export function woff2Characters(buf) {
  const t = woff2Tables(buf).get('cmap');
  if (!t) throw new Error('a font with no character map');
  const records = t.readUInt16BE(2);
  let pick = null;
  for (let i = 0; i < records; i++) {
    const platform = t.readUInt16BE(4 + i * 8);
    const offset = t.readUInt32BE(8 + i * 8);
    const format = t.readUInt16BE(offset);
    if (format === 12) { pick = { offset, format }; break; }
    if (format === 4 && (platform === 3 || platform === 0) && !pick) pick = { offset, format };
  }
  if (!pick) throw new Error('no Unicode character map this reader knows');
  const found = new Set();
  const { offset: o } = pick;
  if (pick.format === 12) {
    const groups = t.readUInt32BE(o + 12);
    for (let i = 0; i < groups; i++) {
      const first = t.readUInt32BE(o + 16 + i * 12);
      const last = t.readUInt32BE(o + 20 + i * 12);
      for (let c = first; c <= last; c++) found.add(c);
    }
    return found;
  }
  const segments = t.readUInt16BE(o + 6) / 2;
  const ends = o + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const ranges = deltas + segments * 2;
  for (let i = 0; i < segments; i++) {
    const last = t.readUInt16BE(ends + i * 2);
    const first = t.readUInt16BE(starts + i * 2);
    const delta = t.readInt16BE(deltas + i * 2);
    const rangeOffset = t.readUInt16BE(ranges + i * 2);
    for (let c = first; c <= last && c !== 0xffff; c++) {
      let glyph;
      if (rangeOffset === 0) glyph = (c + delta) & 0xffff;
      else {
        glyph = t.readUInt16BE(ranges + i * 2 + rangeOffset + (c - first) * 2);
        if (glyph) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph) found.add(c);
    }
  }
  return found;
}

/** `U+0041-005A,U+00E9` → the code points it names. */
export function parseUnicodeRange(range) {
  const out = [];
  for (const part of range.split(',')) {
    const m = /^U\+([0-9A-Fa-f?]+)(?:-([0-9A-Fa-f]+))?$/.exec(part.trim());
    if (!m) throw new Error(`not a unicode-range: ${part}`);
    if (m[1].includes('?')) out.push([parseInt(m[1].replace(/\?/g, '0'), 16), parseInt(m[1].replace(/\?/g, 'F'), 16)]);
    else out.push([parseInt(m[1], 16), parseInt(m[2] ?? m[1], 16)]);
  }
  return out;
}

/** Code points → the shortest `unicode-range` that names exactly them. */
export function formatUnicodeRange(points) {
  const sorted = [...points].sort((a, b) => a - b);
  const parts = [];
  const hex = (n) => n.toString(16).toUpperCase().padStart(4, '0');
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(i === j ? `U+${hex(sorted[i])}` : `U+${hex(sorted[i])}-${hex(sorted[j])}`);
    i = j + 1;
  }
  return parts.join(',');
}

/** The characters a range promises that the file also draws. */
export function drawnWithin(range, drawn) {
  const out = [];
  for (const [first, last] of parseUnicodeRange(range)) for (let c = first; c <= last; c++) if (drawn.has(c)) out.push(c);
  return out;
}
