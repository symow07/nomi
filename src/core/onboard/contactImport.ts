import { normalizePhone } from '../channel/phone.js';
import { tableRecords } from './csvTable.js';
import {
  CONTACT_IMPORT_COLUMNS, type ContactImportColumn, type ContactImportColumns, type ContactImportCounts,
  type ContactImportFields, type ContactImportFileRefusal, type ContactImportMapping, type ContactImportPreview,
  type ContactImportPreviewRow, type ContactImportRowRefusal, type ContactImportVerdict, type ImportedContact,
} from './setupMinutes.js';

/**
 * BLOCK 4.4 — CUSTOMERS FROM A FILE: reading it, and what each row would become. Pure: no I/O, no clock.
 *
 * A file (CSV, TSV, a text file, or the first sheet of a workbook — the workbook is read in src/net/xlsx.ts) or a
 * pasted table becomes RECORDS: every record as read, cells trimmed, a blank record kept as one so a row number said
 * back is the one the owner's file shows. The owner says which column is which (`guessColumns` pre-chooses from the
 * header); then every row is read (`readContacts`) and, once the database has said which numbers are already a
 * customer, judged (`contactsPreview`):
 *   · the phone must be written in international form, with + or 00 — the country is NEVER guessed — and read by
 *     `normalizePhone`, the same digits a WhatsApp message arrives from;
 *   · the first row with a number owns it: a later row with the same number is a duplicate, even when the first was
 *     refused for something else or left unticked;
 *   · a language must be recognised (a two-letter code, a tag such as pt-BR, or the language's name in English, in
 *     itself, or in one of the owner's languages); one that is not refuses the row — nothing is guessed;
 *   · a name over 120 characters and notes over 1,000 refuse the row: nothing is cut.
 */

export const CONTACT_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
/** Customers in one file, at most: records that are not blank, the header aside. */
export const CONTACT_IMPORT_MAX_ROWS = 5000;
/** Records kept, blank ones and the header included (0232's own check on `contact_imports.cells`). */
export const CONTACT_IMPORT_MAX_RECORDS = 10001;
export const CONTACT_NAME_MAX = 120;
export const CONTACT_NOTES_MAX = 1000;

export type ContactRecords = readonly (readonly string[])[];
export type ContactRead = { readonly ok: true; readonly records: ContactRecords } | { readonly ok: false; readonly reason: ContactImportFileRefusal };

const blank = (r: readonly string[]): boolean => r.every((c) => c === '');

/**
 * A file's bytes as text: UTF-8 (a byte-order mark allowed), or UTF-16 when its mark says so (a spreadsheet's
 * "Unicode text"). Null when the bytes are not that text — the owner is told to save it as CSV UTF-8 — or carry a
 * NUL, which no table of names and numbers holds.
 */
export function decodeContactFile(bytes: Uint8Array): string | null {
  try {
    const text = bytes[0] === 0xff && bytes[1] === 0xfe ? new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(2))
      : bytes[0] === 0xfe && bytes[1] === 0xff ? new TextDecoder('utf-16be', { fatal: true }).decode(bytes.subarray(2))
      : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return text.includes('\u0000') ? null : text;
  } catch {
    return null;
  }
}

/** A pasted table or a decoded file: tabs, semicolons or commas, quotes as CSV writes them. */
export function readContactText(text: string): ContactRead {
  if (new TextEncoder().encode(text).length > CONTACT_IMPORT_MAX_BYTES) return { ok: false, reason: 'too_large' };
  const { records, unterminated } = tableRecords(text, ['\t', ';', ',']);
  if (unterminated) return { ok: false, reason: 'not_a_table' };
  return readContactRecords(records.map((r) => r.map((c) => c.trim())));
}

/** Records read some other way (a workbook's sheet), held to the same limits. */
export function readContactRecords(input: ContactRecords): ContactRead {
  const records = [...input];
  while (records.length > 0 && blank(records[records.length - 1]!)) records.pop();
  const filled = records.filter((r) => !blank(r)).length;
  if (filled === 0) return { ok: false, reason: 'empty' };
  if (records.length > CONTACT_IMPORT_MAX_RECORDS) return { ok: false, reason: 'too_many' };
  const data = filled - (guessColumns(records).hasHeader ? 1 : 0);
  if (data === 0) return { ok: false, reason: 'empty' };
  if (data > CONTACT_IMPORT_MAX_ROWS) return { ok: false, reason: 'too_many' };
  return { ok: true, records };
}

// ── which column is which ──────────────────────────────────────────────────────────────────────────────────────────

/** A header as compared: case, accents, spaces and punctuation between words set aside. */
export const foldHeader = (s: string): string =>
  s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[\s_\-.:]+/gu, ' ').trim();

/** The headers each field is pre-chosen by (the design spec §1.4), folded as `foldHeader` folds a cell. */
export const CONTACT_HEADER_WORDS: Readonly<Record<ContactImportColumn, ReadonlySet<string>>> = {
  name: new Set(['name', 'full name', 'customer', 'contact', 'nom', 'nombre', '姓名', '名字', 'الاسم'].map(foldHeader)),
  phone: new Set(['phone', 'mobile', 'whatsapp', 'tel', 'telephone', 'number', 'téléphone', 'teléfono', '电话', '手机', 'الهاتف', 'رقم',
    'phone number', 'mobile number', 'whatsapp number', 'mobile phone', 'cell', 'cell phone'].map(foldHeader)),
  language: new Set(['language', 'lang', 'langue', 'idioma', '语言', 'اللغة'].map(foldHeader)),
  notes: new Set(['notes', 'note', 'comment', 'comments', 'remarks', '备注', 'ملاحظات'].map(foldHeader)),
};

export const contactImportWidth = (records: ContactRecords): number => records.reduce((w, r) => Math.max(w, r.length), 0);

/**
 * The pre-choice: a field is the first column whose header is one of its words, and the first record is a header
 * when any cell of it is. With no header, the phone is the column whose first cells read as international numbers.
 */
export function guessColumns(records: ContactRecords): { readonly hasHeader: boolean; readonly mapping: ContactImportMapping } {
  const first = (records[0] ?? []).map(foldHeader);
  const found = (f: ContactImportColumn): number | null => { const i = first.findIndex((c) => CONTACT_HEADER_WORDS[f].has(c)); return i < 0 ? null : i; };
  const mapping = { name: found('name'), phone: found('phone'), language: found('language'), notes: found('notes') };
  if (CONTACT_IMPORT_COLUMNS.some((f) => mapping[f] !== null)) return { hasHeader: true, mapping };
  const sample = records.filter((r) => !blank(r)).slice(0, 20);
  let phone: number | null = null;
  for (let i = 0; i < contactImportWidth(records) && phone === null; i++) {
    const cells = sample.map((r) => r[i] ?? '').filter((c) => c !== '');
    if (cells.length > 0 && cells.filter((c) => readPhone(c).ok).length * 2 >= cells.length) phone = i;
  }
  return { hasHeader: false, mapping: { name: null, phone, language: null, notes: null } };
}

/**
 * The owner's choice from the Columns form: each field a column number or '' ("— none —"). A number that is not a
 * column is none. No phone column is the one refusal.
 */
export function readContactMapping(fields: Readonly<Partial<Record<ContactImportColumn, unknown>>>, width: number):
  { readonly ok: true; readonly mapping: ContactImportMapping } | { readonly ok: false; readonly reason: 'no_phone_column' } {
  const pick = (f: ContactImportColumn): number | null => {
    const v = fields[f];
    if (typeof v !== 'string' || !/^(0|[1-9][0-9]{0,3})$/.test(v.trim())) return null;
    const n = Number(v.trim());
    return n < width ? n : null;
  };
  const mapping = { name: pick('name'), phone: pick('phone'), language: pick('language'), notes: pick('notes') };
  return mapping.phone === null ? { ok: false, reason: 'no_phone_column' } : { ok: true, mapping };
}

/** The table as the Columns step shows it: the header's cells (none when there is no header) and the records under it. */
export function contactColumnsView(importId: string, records: ContactRecords, hasHeader: boolean, mapping: ContactImportMapping): ContactImportColumns {
  const width = contactImportWidth(records);
  const pad = (r: readonly string[]): string[] => Array.from({ length: width }, (_, i) => r[i] ?? '');
  return {
    importId,
    hasHeader,
    headers: hasHeader ? pad(records[0] ?? []) : [],
    rows: records.slice(hasHeader ? 1 : 0).filter((r) => !blank(r)).map(pad),
    mapping,
  };
}

// ── the values ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A phone as the file wrote it: international form (+ or 00 first), then the digits WhatsApp would send from — the
 * country code and the number, no "+" (`normalizePhone`, the same form a WhatsApp webhook's `from` arrives in), so the
 * customer's first WhatsApp message finds this customer.
 *
 * KNOWN LIMIT: WhatsApp's id is not always the dialled number. For some Mexican (+52) and Brazilian (+55) numbers the
 * id WhatsApp reports differs from the number as people write it (a mobile prefix digit added or dropped), so such a
 * customer, imported from a file, may not be found when they first write: their message makes a second customer, and
 * the imported one stays as it was. The country is never guessed and no digit is added or removed here.
 */
export function readPhone(raw: string): { readonly ok: true; readonly phone: string } | { readonly ok: false; readonly reason: 'no_phone' | 'not_international' | 'bad_phone' } {
  const s = raw.trim();
  if (s === '') return { ok: false, reason: 'no_phone' };
  if (!/^(\+|00)/.test(s.replace(/^[\s(]+/, ''))) return { ok: false, reason: 'not_international' };
  const phone = normalizePhone(s);
  return phone ? { ok: true, phone } : { ok: false, reason: 'bad_phone' };
}

const foldName = (s: string): string => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/gu, ' ').trim();
/** Every two-letter language code the runtime names, and each name it gives them in English, in themselves and in the owner's languages. */
let languageNames: ReadonlyMap<string, string> | null = null;
const NAMED_IN = ['en', 'zh', 'ar', 'es', 'fr', 'pt'] as const;
function namesOfLanguages(): ReadonlyMap<string, string> {
  if (languageNames) return languageNames;
  const english = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' });
  const codes: string[] = [];
  for (let a = 97; a < 123; a++) for (let b = 97; b < 123; b++) {
    const code = String.fromCharCode(a, b);
    if (english.of(code)) codes.push(code);
  }
  const names = new Map<string, string>(codes.map((c) => [c, c]));
  const add = (name: string | undefined, code: string): void => { if (name) { const k = foldName(name); if (!names.has(k)) names.set(k, code); } };
  for (const c of codes) add(english.of(c), c);
  for (const c of codes) { try { add(new Intl.DisplayNames([c], { type: 'language', fallback: 'none' }).of(c), c); } catch { /* no data for it */ } }
  for (const l of NAMED_IN) { const d = new Intl.DisplayNames([l], { type: 'language', fallback: 'none' }); for (const c of codes) add(d.of(c), c); }
  languageNames = names;
  return names;
}

/** A language as the file wrote it: its two-letter code, null when blank, undefined when not recognised. */
export function readLanguage(raw: string): string | null | undefined {
  const s = raw.trim();
  if (s === '') return null;
  const tag = /^([a-z]{2})(?:[-_][a-z0-9]{2,8})*$/i.exec(s)?.[1]?.toLowerCase();
  const names = namesOfLanguages();
  if (tag && names.get(tag) === tag) return tag;
  return names.get(foldName(s));
}

// ── every row ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** A row read, before the database says whether its number is already a customer. */
export type ContactRowRead = {
  readonly row: number;
  readonly raw: ContactImportFields;
  readonly verdict: Extract<ContactImportVerdict, { kind: 'duplicate_in_file' | 'refused' }> | { readonly kind: 'candidate'; readonly contact: ImportedContact };
};

/** Every record under the header that is not blank, read with the owner's mapping. Row numbers count from 1, the header included. */
export function readContacts(records: ContactRecords, hasHeader: boolean, mapping: ContactImportMapping): readonly ContactRowRead[] {
  const owner = new Map<string, number>();
  const out: ContactRowRead[] = [];
  records.forEach((record, i) => {
    if ((hasHeader && i === 0) || blank(record)) return;
    const cell = (f: ContactImportColumn): string => { const at = mapping[f]; return at === null ? '' : (record[at] ?? ''); };
    const raw: ContactImportFields = { name: cell('name'), phone: cell('phone'), language: cell('language'), notes: cell('notes') };
    const row = i + 1;
    const refused = (reason: ContactImportRowRefusal): ContactRowRead => ({ row, raw, verdict: { kind: 'refused', reason } });
    const phone = readPhone(raw.phone);
    if (!phone.ok) { out.push(refused(phone.reason)); return; }
    const first = owner.get(phone.phone);
    if (first !== undefined) { out.push({ row, raw, verdict: { kind: 'duplicate_in_file', firstRow: first } }); return; }
    owner.set(phone.phone, row);
    const language = readLanguage(raw.language);
    if (language === undefined) { out.push(refused('language_not_recognised')); return; }
    const name = raw.name.trim();
    if ([...name].length > CONTACT_NAME_MAX) { out.push(refused('long_name')); return; }
    const notes = raw.notes.trim();
    if ([...notes].length > CONTACT_NOTES_MAX) { out.push(refused('long_notes')); return; }
    out.push({ row, raw, verdict: { kind: 'candidate', contact: { name: name || null, phone: phone.phone, language, notes: notes || null } } });
  });
  return out;
}

/** The numbers to ask the database about. */
export const candidatePhones = (rows: readonly ContactRowRead[]): readonly string[] =>
  rows.flatMap((r) => (r.verdict.kind === 'candidate' ? [r.verdict.contact.phone] : []));

export type ExistingCustomer = { readonly id: string; readonly name: string | null };

/**
 * The Check step: each candidate is a customer already (one match), refused (several — the file cannot say which),
 * or one to add, ticked unless the owner's selection leaves it out (`selected` null is every row).
 */
export function contactsPreview(importId: string, rows: readonly ContactRowRead[],
  matches: ReadonlyMap<string, readonly ExistingCustomer[]>, selected: readonly number[] | null): ContactImportPreview {
  const ticked = selected === null ? null : new Set(selected);
  const out: ContactImportPreviewRow[] = rows.map((r) => {
    if (r.verdict.kind !== 'candidate') return { row: r.row, raw: r.raw, verdict: r.verdict };
    const contact = r.verdict.contact;
    const found = matches.get(contact.phone) ?? [];
    if (found.length > 1) return { row: r.row, raw: r.raw, verdict: { kind: 'refused', reason: 'ambiguous_existing' } };
    if (found.length === 1) return { row: r.row, raw: r.raw, verdict: { kind: 'existing', contact, customer: found[0]! } };
    return { row: r.row, raw: r.raw, verdict: { kind: 'to_add', contact, selected: ticked === null || ticked.has(r.row) } };
  });
  return { importId, rows: out, counts: countsOf(out) };
}

export function countsOf(rows: readonly ContactImportPreviewRow[]): ContactImportCounts {
  const n = (k: ContactImportVerdict['kind']): number => rows.filter((r) => r.verdict.kind === k).length;
  return {
    total: rows.length,
    toAdd: n('to_add'),
    existing: n('existing'),
    duplicateInFile: n('duplicate_in_file'),
    refused: n('refused'),
    selected: rows.filter((r) => r.verdict.kind === 'to_add' && r.verdict.selected).length,
  };
}

/** The rows the owner ticked on the Check form: repeated `rows`, each a record number; anything else is ignored. */
export function readSelectedRows(value: unknown): readonly number[] {
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  const rows = new Set<number>();
  for (const v of list) {
    if (typeof v === 'string' && /^[1-9][0-9]{0,4}$/.test(v.trim())) rows.add(Number(v.trim()));
  }
  return [...rows].sort((a, b) => a - b);
}
