/** English fallback sweep: actual text nodes, ignoring scripts, fields and already isolated values. */
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);


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

export function unisolatedEnglish(html: string): string[] {
  const body = html
    .replace(/<!doctype[^>]*>/gi, ' ')
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
      // These fixtures use Arabic names. Nomi is the brand, not a fallback sentence.
      if (/[A-Za-z]/.test(plain) && !/\p{Script=Arabic}/u.test(plain) && plain.trim() !== 'Nomi')
        found.push(`${plain.replace(/\s+/g, ' ').trim()} — in ${inside.slice(0, 100)}`);
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
    const isolates = tag === 'bdi' || (/\slang="en"/.test(attrs!) && /\sdir="ltr"/.test(attrs!));
    open.push({ tag, isolates, opened: m[0] });
    if (isolates) depth++;
  }
  return found;
}

