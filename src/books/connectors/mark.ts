import type { CustomValues } from '../../core/books/interchange.js';

/**
 * D8/D9 — NOMI'S MARK in a system's own text fields: what the books carry that the system has no place for (an entry's
 * key, a line's party and tax code, custom values), at the end of a narration, a note or a description, as
 * "[nomi:…]" — JSON in URL-safe base64, which survives an HTML field's cleaning and any script. Read back, the mark is
 * taken off the text; anything that is not Nomi's mark, of an object, is no mark. (Odoo's values-only mark is its own:
 * src/books/connectors/odoo.ts.)
 */
type MarkValue = string | CustomValues | undefined;
const MARK_IN = /\s*\[nomi:([A-Za-z0-9_-]+)\]/;
const sorted = (v: MarkValue): MarkValue => (v && typeof v === 'object'
  ? (Object.keys(v).length > 0 ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : undefined) : v);

/** Only what is there ("" when there is nothing to say). */
export function nomiMark(m: Readonly<Record<string, MarkValue>>): string {
  const kept = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, sorted(v)] as const).filter(([, v]) => v !== undefined && v !== ''));
  return Object.keys(kept).length === 0 ? '' : `[nomi:${Buffer.from(JSON.stringify(kept)).toString('base64url')}]`;
}

/** A text, and the mark at its end read back. */
export function readNomiMark(text: string | null): { readonly rest: string | null; readonly mark: Record<string, unknown> } {
  const m = text === null ? null : MARK_IN.exec(text);
  if (!m || text === null) return { rest: text, mark: {} };
  const rest = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim();
  let v: unknown = null;
  try { v = JSON.parse(Buffer.from(m[1]!, 'base64url').toString('utf8')); } catch { v = null; }
  return { rest: rest === '' ? null : rest, mark: v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {} };
}
