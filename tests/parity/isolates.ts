/**
 * THE RIGHT-TO-LEFT TEST's reader (the design pass §9): every digit run and
 * currency sign on a page that sits OUTSIDE an isolate, with the words around
 * it. An isolate is a `<bdi>`, an element with `dir="auto"` or `dir="ltr"`
 * (the browser isolates those), or U+2066–U+2068 … U+2069 in the text.
 *
 * Not read: the head, scripts, styles, templates, what is typed into a
 * textarea, and attributes — none of them is text laid out on the page.
 */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const FIGURE = /[0-9\u0660-\u0669\u06F0-\u06F9]+|\p{Sc}/gu;

const decode = (s: string): string => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
  .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** The text with every isolated stretch taken out, innermost first. */
const outsideMarks = (s: string): string => {
  let prev = '';
  let cur = s;
  while (cur !== prev) { prev = cur; cur = cur.replace(/[\u2066\u2067\u2068][^\u2066-\u2069]*\u2069/g, ' '); }
  return cur;
};

export function unisolatedFigures(html: string): string[] {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<head\b[\s\S]*?<\/head>/i, ' ')
    .replace(/<(script|style|template|textarea)\b[\s\S]*?<\/\1>/gi, ' ');
  const found: string[] = [];
  const open: { tag: string; isolates: boolean; opened: string }[] = [];
  let depth = 0;   // how many open elements isolate
  for (const m of body.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>|([^<]+)/g)) {
    const [, close, rawTag, attrs, text] = m;
    if (text !== undefined) {
      if (depth > 0) continue;
      const plain = outsideMarks(decode(text));
      const inside = open.at(-1)?.opened ?? '';
      for (const hit of plain.matchAll(FIGURE)) {
        const around = plain.slice(Math.max(0, hit.index! - 30), hit.index! + hit[0].length + 30).replace(/\s+/g, ' ').trim();
        found.push(`${around} — in ${inside.slice(0, 80)}`);
      }
      continue;
    }
    const tag = rawTag!.toLowerCase();
    if (close) {
      const at = open.map((o) => o.tag).lastIndexOf(tag);
      if (at === -1) continue;
      for (const o of open.splice(at)) if (o.isolates) depth--;
      continue;
    }
    if (VOID.has(tag) || attrs!.trimEnd().endsWith('/')) continue;
    // `dir="rtl"` only says again which way the page runs (the root carries
    // it); `auto` and `ltr` set a value apart, as `<bdi>` does.
    const isolates = tag === 'bdi' || /\sdir="(auto|ltr)"/.test(attrs!);
    open.push({ tag, isolates, opened: m[0] });
    if (isolates) depth++;
  }
  return found;
}

/**
 * The text as a reader sees it, without the isolate marks: for the tests that
 * check a page's WORDS. Whether the figures are isolated is this file's
 * other function's business.
 */
export const withoutIsolates = (html: string): string => html.replace(/[\u2066-\u2069]/g, '');
