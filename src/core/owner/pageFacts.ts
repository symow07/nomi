/**
 * EXT — A PAGE OF THE OWNER'S SITE, PROPOSED AS FACTS. Pure.
 *
 * Her shipping, returns, payment or care page holds answers her customers ask
 * for. The model proposes them as short facts, each with the sentence it came
 * from; this module decides what may be proposed at all:
 *
 *   · the quoted sentence must be ON the page (after the page is read as
 *     text: scripts, styles and markup gone, entities decoded, spaces
 *     collapsed) — a fact the page does not say is dropped;
 *   · a fact is 5 to 300 characters; at most 20 are proposed; the same fact
 *     twice is one.
 *
 * Nothing here writes: the owner ticks line by line, as in "How you sell".
 */
export type PageFact = { readonly fact: string; readonly quote: string };
export const PAGE_FACTS_MAX = 20;
export const PAGE_TEXT_MAX = 60_000;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

/** The text a reader sees on an HTML page, paragraphs kept as lines. */
export function pageText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => safeCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m);
  return text.split('\n').map((l) => l.replace(/[ \t\f\v\r]+/g, ' ').trim()).filter(Boolean).join('\n').slice(0, PAGE_TEXT_MAX);
}

const safeCodePoint = (n: number): string => (Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : ' ');
const squash = (s: string): string => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

export function containFacts(items: readonly PageFact[], text: string): PageFact[] {
  const page = squash(text);
  const seen = new Set<string>();
  const out: PageFact[] = [];
  for (const it of items) {
    const fact = it.fact.trim().replace(/\s+/g, ' ');
    const quote = it.quote.trim().replace(/\s+/g, ' ');
    if (fact.length < 5 || fact.length > 300 || quote.length < 5 || !page.includes(squash(quote))) continue;
    const key = squash(fact);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ fact, quote });
    if (out.length >= PAGE_FACTS_MAX) break;
  }
  return out;
}

/** The model's answer, `{ "facts": [{ "fact": "", "quote": "" }] }`, read defensively. */
export function parseFactsAnswer(raw: string): PageFact[] {
  const start = raw.indexOf('{'); const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let body: unknown;
  try { body = JSON.parse(raw.slice(start, end + 1)); } catch { return []; }
  const list = (body as { facts?: unknown } | null)?.facts;
  if (!Array.isArray(list)) return [];
  return list.slice(0, 100).flatMap((x) => {
    const o = (typeof x === 'object' && x !== null ? x : {}) as Record<string, unknown>;
    return typeof o['fact'] === 'string' && typeof o['quote'] === 'string' ? [{ fact: o['fact'], quote: o['quote'] }] : [];
  });
}
