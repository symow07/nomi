import { deflateRawSync, inflateRawSync } from 'node:zlib';

/**
 * EXT — AN EXCEL FILE (.xlsx), READ AS THE TABLE IT IS.
 *
 * An .xlsx file is a ZIP of XML parts. This reads it with nothing but
 * node:zlib — no spreadsheet library (the product keeps to its handful of
 * dependencies) — and turns the FIRST sheet into rows of text, which then go
 * the same way as a CSV: the owner maps the columns, then the review.
 *
 * Read defensively, because a file is a stranger's bytes: a ZIP whose parts
 * inflate past 20 MB in all, a sheet past 5,000 rows or 60 columns, an
 * encrypted part, or anything that is not a workbook is refused (null) — the
 * page says it could not read a table, as for a broken CSV. Formulas are read
 * as the value Excel saved with them; dates as Excel's serial number (the
 * owner sees it, and the review never takes a figure she did not confirm).
 */
const MAX_INFLATED = 20 * 1024 * 1024;
export const XLSX_MAX_ROWS = 5000;
export const XLSX_MAX_COLS = 60;

/** Does this look like a ZIP (and so possibly a workbook)? */
export const looksLikeXlsx = (b: Buffer): boolean => b.length > 4 && b.readUInt32LE(0) === 0x04034b50;

type Entry = { readonly name: string; readonly method: number; readonly compressed: number; readonly size: number; readonly offset: number; readonly flags: number };

function entries(b: Buffer): Entry[] | null {
  // The end-of-central-directory record: within the last 64 KiB + 22 bytes.
  const from = Math.max(0, b.length - 65_557);
  let eocd = -1;
  for (let i = b.length - 22; i >= from; i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const out: Entry[] = [];
  for (let n = 0; n < count && n < 2000; n++) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== 0x02014b50) return null;
    const flags = b.readUInt16LE(p + 8);
    const method = b.readUInt16LE(p + 10);
    const compressed = b.readUInt32LE(p + 20);
    const size = b.readUInt32LE(p + 24);
    const nameLen = b.readUInt16LE(p + 28);
    const extraLen = b.readUInt16LE(p + 30);
    const commentLen = b.readUInt16LE(p + 32);
    const offset = b.readUInt32LE(p + 42);
    out.push({ name: b.toString('utf8', p + 46, p + 46 + nameLen), method, compressed, size, offset, flags });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function read(b: Buffer, e: Entry, budget: { left: number }): string | null {
  if (e.flags & 1) return null;   // encrypted
  if (e.size > budget.left) return null;
  const h = e.offset;
  if (h + 30 > b.length || b.readUInt32LE(h) !== 0x04034b50) return null;
  const start = h + 30 + b.readUInt16LE(h + 26) + b.readUInt16LE(h + 28);
  const raw = b.subarray(start, start + e.compressed);
  let data: Buffer;
  try {
    data = e.method === 0 ? raw : e.method === 8 ? inflateRawSync(raw, { maxOutputLength: budget.left }) : Buffer.alloc(0);
  } catch {
    return null;
  }
  if (e.method !== 0 && e.method !== 8) return null;
  budget.left -= data.length;
  return data.toString('utf8');
}

const unescapeXml = (s: string): string => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#([0-9]+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&');

/** The text of every <t> in a string item (rich text runs joined). */
const textOf = (xml: string): string => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1]!)).join('');

/** "B12" → column 1 (0-based). */
const columnOf = (ref: string): number => {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** The first sheet of a workbook, as rows of trimmed text; null when it is not one this can read. */
export function xlsxRows(b: Buffer): string[][] | null {
  if (!looksLikeXlsx(b)) return null;
  const list = entries(b);
  if (!list) return null;
  const budget = { left: MAX_INFLATED };
  const byName = new Map(list.map((e) => [e.name, e]));
  // The first sheet as the workbook orders it, through its relationship.
  const workbook = byName.get('xl/workbook.xml');
  const rels = byName.get('xl/_rels/workbook.xml.rels');
  let sheetPath = 'xl/worksheets/sheet1.xml';
  if (workbook && rels) {
    const wb = read(b, workbook, budget); const rl = read(b, rels, budget);
    const rid = wb ? /<sheet\b[^>]*\br:id="([^"]+)"/.exec(wb)?.[1] : undefined;
    const target = rid && rl ? new RegExp(`<Relationship\\b[^>]*\\bId="${rid.replace(/[^A-Za-z0-9]/g, '')}"[^>]*\\bTarget="([^"]+)"`).exec(rl)?.[1]
      ?? new RegExp(`<Relationship\\b[^>]*\\bTarget="([^"]+)"[^>]*\\bId="${rid.replace(/[^A-Za-z0-9]/g, '')}"`).exec(rl)?.[1] : undefined;
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }
  const sheet = byName.get(sheetPath);
  if (!sheet) return null;
  const shared: string[] = [];
  const sst = byName.get('xl/sharedStrings.xml');
  if (sst) {
    const xml = read(b, sst, budget);
    if (xml === null) return null;
    for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]!));
  }
  const xml = read(b, sheet, budget);
  if (xml === null) return null;
  const rows: string[][] = [];
  for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    if (rows.length >= XLSX_MAX_ROWS) return null;
    const row: string[] = [];
    for (const c of r[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]!;
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const col = ref ? columnOf(ref) : row.length;
      if (col >= XLSX_MAX_COLS) continue;
      const type = /\bt="([a-zA-Z]+)"/.exec(attrs)?.[1] ?? 'n';
      const body = c[2] ?? '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      const value = type === 's' ? (shared[Number(v)] ?? '')
        : type === 'inlineStr' ? textOf(body)
        : type === 'b' ? (v === '1' ? 'TRUE' : 'FALSE')
        : unescapeXml(v ?? '');
      while (row.length < col) row.push('');
      row[col] = value.trim();
    }
    rows.push(row);
  }
  const body = rows.filter((r) => r.some((x) => x !== ''));
  return body.length >= 2 ? body : null;
}

/** The rows as CSV, every cell quoted: the table import reads it as it reads any export. */
export const rowsAsCsv = (rows: readonly (readonly string[])[]): string =>
  rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');

/**
 * B2 (Phase 5) — A WORKBOOK OF SEVERAL NAMED SHEETS, read with each cell's kind and each row's own number: the Nomi
 * workbook names a problem by its sheet, row and column, and a figure the spreadsheet holds as a NUMBER is never
 * ambiguous ("1.125" typed as text may be a thousand; stored as a number it is one and an eighth). Same limits as
 * above, per sheet.
 */
export type XlsxCell = { readonly text: string; readonly number: boolean };
export type XlsxSheet = { readonly name: string; readonly rows: ReadonlyMap<number, readonly XlsxCell[]> };

export function xlsxSheets(b: Buffer): { readonly sheets: readonly XlsxSheet[]; readonly date1904: boolean } | null {
  if (!looksLikeXlsx(b)) return null;
  const list = entries(b);
  if (!list) return null;
  const budget = { left: MAX_INFLATED };
  const byName = new Map(list.map((e) => [e.name, e]));
  const workbook = byName.get('xl/workbook.xml');
  const rels = byName.get('xl/_rels/workbook.xml.rels');
  if (!workbook || !rels) return null;
  const wb = read(b, workbook, budget); const rl = read(b, rels, budget);
  if (wb === null || rl === null) return null;
  const targets = new Map<string, string>();
  for (const m of rl.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[1]!)?.[1]; const target = /\bTarget="([^"]+)"/.exec(m[1]!)?.[1];
    if (id && target) targets.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`);
  }
  const shared: string[] = [];
  const sst = byName.get('xl/sharedStrings.xml');
  if (sst) {
    const xml = read(b, sst, budget);
    if (xml === null) return null;
    for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]!));
  }
  const sheets: XlsxSheet[] = [];
  for (const s of wb.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const name = unescapeXml(/\bname="([^"]*)"/.exec(s[1]!)?.[1] ?? '');
    const rid = /\br:id="([^"]+)"/.exec(s[1]!)?.[1];
    const entry = rid ? byName.get(targets.get(rid) ?? '') : undefined;
    if (!entry) return null;
    const xml = read(b, entry, budget);
    if (xml === null) return null;
    const rows = new Map<number, XlsxCell[]>();
    for (const r of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
      if (rows.size >= XLSX_MAX_ROWS) return null;
      const n = Number(/\br="(\d+)"/.exec(r[1] ?? r[3] ?? '')?.[1] ?? rows.size + 1);
      const row: XlsxCell[] = [];
      for (const c of (r[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1]!;
        const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
        const col = ref ? columnOf(ref) : row.length;
        if (col >= XLSX_MAX_COLS) continue;
        const type = /\bt="([a-zA-Z]+)"/.exec(attrs)?.[1] ?? 'n';
        const body = c[2] ?? '';
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        const cell: XlsxCell = type === 's' ? { text: (shared[Number(v)] ?? '').trim(), number: false }
          : type === 'inlineStr' ? { text: textOf(body).trim(), number: false }
          : type === 'str' || type === 'e' ? { text: unescapeXml(v ?? '').trim(), number: false }
          : type === 'b' ? { text: v === '1' ? 'TRUE' : 'FALSE', number: false }
          : { text: unescapeXml(v ?? '').trim(), number: v !== undefined };
        while (row.length < col) row.push({ text: '', number: false });
        row[col] = cell;
      }
      if (row.some((x) => x.text !== '')) rows.set(n, row);
    }
    sheets.push({ name, rows });
  }
  return { sheets, date1904: /<workbookPr\b[^>]*\bdate1904="(1|true)"/.test(wb) };
}

/** A cell to write: text, or a number given as its exact decimal text (never a float). */
export type XlsxValue = string | { readonly number: string } | null;

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
const escapeXml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // characters XML 1.0 cannot carry at all
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const columnName = (i: number): string => { let s = ''; let n = i + 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

/** A workbook of these sheets, in this order: the parts Excel, LibreOffice and Google Sheets need, and no more. */
export function xlsxWrite(sheets: readonly { readonly name: string; readonly rows: readonly (readonly XlsxValue[])[] }[]): Buffer {
  const sheetXml = (rows: readonly (readonly XlsxValue[])[]): string => {
    const body = rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => {
      const ref = `${columnName(j)}${i + 1}`;
      if (v === null || v === '') return '';
      if (typeof v === 'object') return `<c r="${ref}"><v>${escapeXml(v.number)}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(v)}</t></is></c>`;
    }).join('')}</row>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
  };
  const parts: [string, string][] = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${
      sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${
      sheets.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${
      sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    }<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows)] as [string, string]),
  ];
  const locals: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const [name, text] of parts) {
    const data = Buffer.from(text, 'utf8');
    const packed = deflateRawSync(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
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
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(parts.length, 8); end.writeUInt16LE(parts.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}
