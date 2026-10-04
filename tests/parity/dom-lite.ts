/**
 * THE MOTION PASS (2026-10-04) — a page as a tree, and a selector asked of it,
 * with no browser: enough of HTML and of CSS selectors to answer "does this
 * rule's selector match anything the product really draws?"
 * (docs/MOTION-TRUTH.md: the old motion test passed when the stylesheet's TEXT
 * held the rules, so two rebuilds could say motion was "used" while nothing on
 * a page wore it.)
 *
 * The parser reads the product's own markup: quoted attributes, void
 * elements, comments, and the raw text of script, style and textarea. The
 * matcher knows type, #id, .class, [attr], [attr="v"], :not(), :nth-child(n),
 * :first-child, :last-child and the four combinators. A state the reader or
 * the script brings (:hover, :active, :focus…, [open]) is left to the caller.
 */

export type El = {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: El[];
  parent: El | null;
};

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea', 'title']);

/** The document as a tree under a synthetic root. */
export function parse(html: string): El {
  const root: El = { tag: '#root', attrs: {}, children: [], parent: null };
  let at: El = root;
  const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[1]) {
      const close = m[1].toLowerCase();
      for (let x: El | null = at; x && x !== root; x = x.parent) if (x.tag === close) { at = x.parent!; break; }
      continue;
    }
    if (!m[2]) continue;
    const tag = m[2].toLowerCase();
    const attrs: Record<string, string> = {};
    for (const a of (m[3] ?? '').matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      attrs[a[1]!.toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? '';
    }
    const el: El = { tag, attrs, children: [], parent: at };
    at.children.push(el);
    if (RAW.has(tag)) {
      const end = html.toLowerCase().indexOf(`</${tag}`, re.lastIndex);
      re.lastIndex = end < 0 ? html.length : end;
      continue;
    }
    if (!VOID.has(tag) && !m[4]) at = el;
  }
  return root;
}

export const all = (root: El): El[] => root.children.flatMap((c) => [c, ...all(c)]);

type Compound = { tag: string | null; id: string | null; classes: string[]; attrs: [string, string | null][]; not: Compound[][]; nth: number | null; first: boolean; last: boolean };

/** One compound selector (no combinators), read left to right. */
function compound(s: string): Compound {
  const c: Compound = { tag: null, id: null, classes: [], attrs: [], not: [], nth: null, first: false, last: false };
  let i = 0;
  const ident = (): string => { const m = /^[\w-]+/.exec(s.slice(i))![0]; i += m.length; return m; };
  if (/^[a-zA-Z*]/.test(s)) { c.tag = s[0] === '*' ? null : ident(); if (s[i] === '*') i++; }
  while (i < s.length) {
    const ch = s[i];
    if (ch === '.') { i++; c.classes.push(ident()); }
    else if (ch === '#') { i++; c.id = ident(); }
    else if (ch === '[') {
      const end = s.indexOf(']', i);
      const m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(s.slice(i, end + 1));
      if (!m) throw new Error(`attribute selector this reader does not know: ${s}`);
      c.attrs.push([m[1]!, m[2] ?? null]);
      i = end + 1;
    } else if (ch === ':') {
      let depth = 0; let j = i + 1;
      for (; j < s.length; j++) { if (s[j] === '(') depth++; else if (s[j] === ')') depth--; else if (depth === 0 && /[.#[:]/.test(s[j]!)) break; }
      const pseudo = s.slice(i, j);
      const not = /^:not\((.*)\)$/.exec(pseudo);
      const nth = /^:nth-child\((\d+)\)$/.exec(pseudo);
      if (not) c.not.push(not[1]!.split(',').map((x) => compound(x.trim())));
      else if (nth) c.nth = Number(nth[1]);
      else if (pseudo === ':first-child') c.first = true;
      else if (pseudo === ':last-child') c.last = true;
      else throw new Error(`pseudo-class this reader does not know: ${pseudo} in ${s}`);
      i = j;
    } else throw new Error(`selector this reader does not know: ${s}`);
  }
  return c;
}

const classesOf = (e: El): string[] => (e.attrs['class'] ?? '').split(/\s+/).filter(Boolean);
const siblings = (e: El): El[] => (e.parent ? e.parent.children : [e]);

function fits(e: El, c: Compound): boolean {
  if (c.tag && e.tag !== c.tag) return false;
  if (c.id && e.attrs['id'] !== c.id) return false;
  const cls = classesOf(e);
  if (!c.classes.every((x) => cls.includes(x))) return false;
  if (!c.attrs.every(([k, v]) => k in e.attrs && (v === null || e.attrs[k] === v))) return false;
  if (c.not.some((alts) => alts.some((x) => fits(e, x)))) return false;
  const at = siblings(e).indexOf(e);
  if (c.nth !== null && at !== c.nth - 1) return false;
  if (c.first && at !== 0) return false;
  if (c.last && at !== siblings(e).length - 1) return false;
  return true;
}

/** Does `selector` (a complex selector: compounds and combinators) match `e`? */
export function matches(e: El, selector: string): boolean {
  const parts = selector.trim().replace(/\s*([>+~])\s*/g, ' $1 ').split(/\s+/);
  const steps: { c: Compound; comb: string }[] = [];
  let comb = ' ';
  for (const p of parts) {
    if (p === '>' || p === '+' || p === '~') { comb = p; continue; }
    steps.push({ c: compound(p === ':root' ? 'html' : p), comb });
    comb = ' ';
  }
  const from = (el: El, k: number): boolean => {
    if (!fits(el, steps[k]!.c)) return false;
    if (k === 0) return true;
    const how = steps[k]!.comb;
    if (how === '>') return !!el.parent && from(el.parent, k - 1);
    if (how === ' ') { for (let x = el.parent; x; x = x.parent) if (from(x, k - 1)) return true; return false; }
    const sib = siblings(el); const i = sib.indexOf(el);
    if (how === '+') return i > 0 && from(sib[i - 1]!, k - 1);
    return sib.slice(0, i).some((x) => from(x, k - 1));
  };
  return from(e, steps.length - 1);
}

/** Every element of the tree `selector` matches. */
export const select = (root: El, selector: string): El[] => all(root).filter((e) => matches(e, selector));
