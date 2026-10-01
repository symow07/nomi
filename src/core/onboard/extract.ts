/**
 * EXT — WHAT A MODEL'S READING OF A LINE MAY BECOME. Pure.
 *
 * M37's rule stands: the model produces TEXT and the parser produces
 * PRODUCTS. The extractor is the exception the owner asks for, on the lines
 * the parser could not make a product of — and it is contained here, so that
 * no figure exists that the line does not hold:
 *
 *   · the line it names must be one of the lines it was given, verbatim;
 *   · the name must be written on that line;
 *   · the price, as written, must be a number on that line (read with either
 *     decimal mark); the minimum too. A figure the line does not hold drops
 *     the whole reading — never a row with the figure left out;
 *   · each line is read once.
 *
 * What survives carries the model's confidence per field, 0 to 1. Every such
 * row waits for the owner's own tick (`needsTick`), and one read less surely
 * than LOW_CONFIDENCE anywhere is flagged.
 */
export type FieldConfidence = { readonly name: number; readonly price: number; readonly unit: number; readonly moq: number };
export const LOW_CONFIDENCE = 0.8;

/** One line as the extractor read it, before containment. */
export type ExtractedLine = {
  readonly line: string;
  readonly name: string;
  /** As written on the line ("1,200.50", "24,5"); null: the line names no price. */
  readonly price: string | null;
  readonly unit: string | null;
  readonly moq: number | null;
  readonly confidence: FieldConfidence;
};

export type ContainedLine = {
  readonly line: string;
  readonly name: string;
  readonly price: number | null;
  readonly unit: string | null;
  readonly moq: number | null;
  readonly confidence: FieldConfidence;
};

const squash = (s: string): string => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

/** A number as written, with either decimal mark ("1,200.50", "1.200,50", "24,5", "24.50"); null when it is not one. */
export function readFigure(raw: string): number | null {
  const s = raw.normalize('NFKC').replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf('.'); const lastComma = s.lastIndexOf(',');
  let n: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',';
    n = s.replace(new RegExp(`\\${dec === '.' ? ',' : '.'}`, 'g'), '').replace(dec, '.');
  } else if (lastComma >= 0) {
    // "1,200" is a thousand and two hundred; "24,5" and "24,50" are a decimal.
    n = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(/,(?=\d*$)/, '.').replace(/,/g, '');
  } else {
    n = /^\d{1,3}(\.\d{3}){2,}$/.test(s) ? s.replace(/\./g, '') : s;
  }
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

/** Every number written on the line, each read as written. */
export const figuresOn = (line: string): number[] =>
  [...line.normalize('NFKC').matchAll(/\d[\d.,]*\d|\d/g)].map((m) => readFigure(m[0])).filter((v): v is number => v !== null);

const clamp = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

export function containExtracted(items: readonly ExtractedLine[], lines: readonly string[]): ContainedLine[] {
  const open = new Map(lines.map((l) => [l.trim(), true]));
  const out: ContainedLine[] = [];
  for (const it of items) {
    const line = it.line.trim();
    if (!open.get(line)) continue;
    const name = it.name.trim().replace(/\s+/g, ' ');
    if (!name || name.length > 120 || !squash(line).includes(squash(name))) continue;
    const figures = figuresOn(line);
    const price = it.price === null ? null : readFigure(it.price);
    if (it.price !== null && (price === null || price <= 0 || !figures.includes(price))) continue;
    const moq = it.moq;
    if (moq !== null && (!Number.isInteger(moq) || moq < 1 || !figures.includes(moq))) continue;
    open.set(line, false);
    out.push({
      line, name, price, unit: it.unit?.trim().slice(0, 30) || null, moq,
      confidence: { name: clamp(it.confidence?.name), price: clamp(it.confidence?.price), unit: clamp(it.confidence?.unit), moq: clamp(it.confidence?.moq) },
    });
  }
  return out;
}

/** The fields read less surely than LOW_CONFIDENCE — only those that were read at all. */
export function lessSure(c: FieldConfidence, row: { readonly price: number | null; readonly moq: number | null }): readonly ('name' | 'price' | 'unit' | 'moq')[] {
  return (['name', 'price', 'unit', 'moq'] as const).filter((f) =>
    c[f] < LOW_CONFIDENCE && !(f === 'price' && row.price === null) && !(f === 'moq' && row.moq === null));
}

/**
 * The extractor's answer, read defensively: JSON `{ "products": [...] }`
 * anywhere in the text; a field of the wrong shape makes that item nothing,
 * never a guess. Containment still follows.
 */
export function parseExtractorAnswer(raw: string): ExtractedLine[] {
  const start = raw.indexOf('{'); const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let body: unknown;
  try { body = JSON.parse(raw.slice(start, end + 1)); } catch { return []; }
  const list = (body as { products?: unknown } | null)?.products;
  if (!Array.isArray(list)) return [];
  const out: ExtractedLine[] = [];
  for (const x of list.slice(0, 200)) {
    if (typeof x !== 'object' || x === null) continue;
    const o = x as Record<string, unknown>;
    if (typeof o['line'] !== 'string' || typeof o['name'] !== 'string') continue;
    const price = typeof o['price'] === 'string' ? o['price'] : typeof o['price'] === 'number' ? String(o['price']) : o['price'] === null || o['price'] === undefined ? null : undefined;
    if (price === undefined) continue;
    const moq = o['moq'] === null || o['moq'] === undefined ? null : typeof o['moq'] === 'number' ? o['moq'] : undefined;
    if (moq === undefined) continue;
    const c = (o['confidence'] ?? {}) as Record<string, unknown>;
    out.push({
      line: o['line'], name: o['name'], price, unit: typeof o['unit'] === 'string' ? o['unit'] : null, moq,
      confidence: { name: Number(c['name'] ?? 0), price: Number(c['price'] ?? 0), unit: Number(c['unit'] ?? 0), moq: Number(c['moq'] ?? 0) },
    });
  }
  return out;
}
