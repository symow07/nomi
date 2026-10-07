import { mayLoad } from '../../src/api/web/thirdParty.js';

/**
 * D7 — THE READER the third-party gate uses: every address a page, a
 * stylesheet or a script makes the browser fetch BY ITSELF, and which of them
 * the allow-list (src/api/web/thirdParty.ts) does not let that page load.
 *
 * What counts as a request — the browser fetches it without anyone choosing to:
 *   <script src>, <link href> (stylesheet, preload, icon, manifest, preconnect,
 *   dns-prefetch…), <img src|srcset>, <source src|srcset>, <video src|poster>,
 *   <audio src>, <track src>, <iframe|frame src>, <embed src>, <object data>,
 *   <input type=image src>, SVG <image|use|feImage href>, <base href> (it
 *   moves every relative address), <a ping>, a `style` attribute's or a
 *   <style> block's url(…), image-set(…) and @import, and the addresses the
 *   page's own script fetches (`data-live`, `data-rail`, `data-push-save`,
 *   `data-orb`, and an `<a data-card>`'s href: liveScript.ts reads exactly these).
 * In a script: any absolute address at all (http, https, ws, wss, or a string
 *   starting `//`), comments included: none of the scripts Nomi serves names one.
 *
 * What does NOT count, on purpose: an <a href> (a link the person chooses to
 * follow), a <form action> (a form the person chooses to send), a <link> whose
 * rel only describes the page (canonical, alternate, author…) and is never
 * fetched, a <meta> (read by crawlers, not loaded by the browser), an SVG's
 * `xmlns` (a name, never fetched), and a data: address (already in the page).
 */

export type PageRequest = { readonly kind: string; readonly url: string };

const decode = (s: string): string => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** A tag's attributes, lower-cased names, entity-decoded values. */
function attributesOf(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of raw.matchAll(/([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    out.set(m[1]!.toLowerCase(), decode(m[2] ?? m[3] ?? m[4] ?? ''));
  }
  return out;
}

/** The addresses in a srcset (or imagesrcset): the first word of each candidate. */
const srcsetUrls = (v: string): string[] => v.split(/,(?=\s|[^\s,]*\s)/).map((c) => c.trim().split(/\s+/)[0] ?? '').filter(Boolean);

/** `rel` values that only describe the page; the browser fetches nothing for them. */
const DESCRIBES_ONLY = new Set(['canonical', 'alternate', 'author', 'license', 'help', 'next', 'prev', 'me', 'bookmark', 'external', 'tag']);

/** The attributes the page's own script turns into a fetch (liveScript.ts). */
const SCRIPT_ADDRESSES = ['data-live', 'data-rail', 'data-push-save', 'data-orb'] as const;

/** What a stylesheet asks the browser to fetch: url(…), image-set("…"), @import. */
export function cssRequests(css: string): PageRequest[] {
  const out: PageRequest[] = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  for (const m of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi)) out.push({ kind: 'css url()', url: (m[1] ?? m[2] ?? m[3] ?? '').trim() });
  for (const m of text.matchAll(/@import\s+(?:"([^"]*)"|'([^']*)')/gi)) out.push({ kind: 'css @import', url: m[1] ?? m[2] ?? '' });
  for (const m of text.matchAll(/image-set\(([^)]*(?:\([^)]*\)[^)]*)*)\)/gi)) {
    for (const s of m[1]!.matchAll(/(?<!url\(\s*)(?:"([^"]*)"|'([^']*)')/g)) out.push({ kind: 'css image-set()', url: s[1] ?? s[2] ?? '' });
  }
  return out;
}

/**
 * What a script could reach on its own: every absolute address written in it.
 * Strict on purpose — a comment is counted too — because the scripts Nomi
 * serves name none, and a new one should be a decision someone looks at.
 */
export function scriptRequests(js: string): PageRequest[] {
  const out: PageRequest[] = [];
  for (const m of js.matchAll(/\b(?:https?|wss?):\/\/[^\s'"`)<>\\]*/gi)) out.push({ kind: 'script address', url: m[0] });
  for (const m of js.matchAll(/(['"`])(\/\/[^'"`\s]*)/g)) out.push({ kind: 'script address', url: `https:${m[2]!}` });
  return out;
}

/** Every request an HTML page makes by itself (see the file's head for what counts). */
export function pageRequests(html: string): PageRequest[] {
  const out: PageRequest[] = [];
  const add = (kind: string, url: string | undefined) => { if (url !== undefined && url.trim() !== '') out.push({ kind, url: url.trim() }); };
  // Comments are not drawn, and a commented-out tag is not a request.
  const body = html.replace(/<!--[\s\S]*?-->/g, ' ');
  for (const m of body.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) out.push(...cssRequests(m[1]!));
  for (const m of body.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (m[2]!.trim()) out.push(...scriptRequests(m[2]!).map((r) => ({ ...r, kind: 'inline script address' })));
  }
  const tags = body.replace(/<(style|script|textarea|title)\b[^>]*>[\s\S]*?<\/\1>/gi, (whole, name: string) => whole.slice(0, whole.indexOf('>') + 1) + `</${name}>`);
  for (const m of tags.matchAll(/<([a-zA-Z][a-zA-Z0-9:-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g)) {
    const tag = m[1]!.toLowerCase();
    const a = attributesOf(m[2] ?? '');
    const at = (name: string) => a.get(name);
    switch (tag) {
      case 'script': add('<script src>', at('src')); break;
      case 'link': {
        const rels = (at('rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
        if (rels.length === 0 || rels.some((r) => !DESCRIBES_ONLY.has(r))) add(`<link rel="${rels.join(' ')}">`, at('href'));
        for (const u of srcsetUrls(at('imagesrcset') ?? '')) add('<link imagesrcset>', u);
        break;
      }
      case 'img': case 'source':
        add(`<${tag} src>`, at('src'));
        for (const u of srcsetUrls(at('srcset') ?? '')) add(`<${tag} srcset>`, u);
        break;
      case 'video': add('<video src>', at('src')); add('<video poster>', at('poster')); break;
      case 'audio': case 'track': case 'iframe': case 'frame': case 'embed': add(`<${tag} src>`, at('src')); break;
      case 'object': add('<object data>', at('data')); break;
      case 'input': if ((at('type') ?? '').toLowerCase() === 'image') add('<input type=image src>', at('src')); break;
      case 'image': case 'use': case 'feimage': add(`<${tag} href>`, at('href') ?? at('xlink:href')); break;
      case 'base': add('<base href>', at('href')); break;
      case 'a':
        // A link is the person's choice — except a ping, which the browser sends by itself,
        // and a card the page's own script fetches (liveScript.ts `cards`).
        for (const u of (at('ping') ?? '').split(/\s+/).filter(Boolean)) add('<a ping>', u);
        if (a.has('data-card')) add('<a data-card href> (fetched by the page\'s script)', at('href'));
        break;
      default: break;
    }
    const style = at('style');
    if (style) out.push(...cssRequests(style).map((r) => ({ ...r, kind: `style attribute ${r.kind}` })));
    for (const name of SCRIPT_ADDRESSES) add(`[${name}] (fetched by the page's script)`, at(name));
  }
  return out;
}

/**
 * The requests a page at `path` may not make: anything that is not Nomi's own
 * address and not on the allow-list for that path. A relative address, a path
 * from the root, a fragment and a data: or blob: address are Nomi's own (or no
 * request at all); `//host` is another host, whatever it looks like.
 */
export function offList(requests: readonly PageRequest[], path: string): PageRequest[] {
  return requests.filter(({ url }) => {
    const u = url.trim();
    if (u === '' || u.startsWith('#') || /^(?:data|blob|about):/i.test(u)) return false;
    if (/^[/\\]{2}/.test(u)) return !mayLoad(`https:${u.replace(/\\/g, '/')}`, path);
    if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return !mayLoad(u, path);
    return false;   // a path, from the root or relative: this page's own host
  });
}

/** In one line: what an HTML page at `path` asks of a host it may not ask. */
export const thirdPartyIn = (html: string, path: string): string[] =>
  offList(pageRequests(html), path).map((r) => `${r.kind} ${r.url}`);
