import { inflateRawSync } from 'node:zlib';

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
