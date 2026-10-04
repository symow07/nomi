import { readFileSync } from 'node:fs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { TRIAL_ICONS, type TrialEntry, type TrialFamily } from './trialIcons.js';

/**
 * THE FONT-AND-ICONS TRIAL (branch trial/font-and-icons, 2026-10-04) — NOT SHIPPED, NEVER MERGED.
 *
 * The owner: "A visual trial so I can judge a new font and new icons on my real screen BEFORE we commit
 * anything app-wide … Put everything on one internal preview route (e.g. /dev/trial) that is NOT linked
 * from the app and NOT shipped."
 *
 * So nothing here changes a page of the app. Every address is under /dev/trial, none is linked from
 * anywhere, and none exists unless the process was started with TRIAL_ROUTES=on outside production
 * (main.ts; the smoke script passes the variable through). Each one wants an owner signed in.
 *
 *   /dev/trial           the left nav three times, side by side (stacked on a phone), each labelled:
 *                        A Iconoir, B Lucide, C Phosphor bold. Same entries, same words, same states.
 *   /dev/trial/today     the real Today page, as /app draws it for whoever is signed in, with Switzer
 *                        on its Latin text and its nav's. ?icons=a|b|c also swaps the nav's drawings.
 *
 * Both are the app's own pages, fetched in-process (`app.inject`) with the visitor's cookie, then given
 * one more stylesheet (/dev/trial/trial.css). The comparison takes the real <nav> out of that page, so
 * it carries the real business name, the real waiting count and the real stylesheet's rules.
 *
 * SWITZER (Fontshare, Indian Type Foundry; ITF Free Font License v2.0). Commercial use and self-hosting
 * are allowed. Distributing the files is not — "through a repository … or on publicly accessible
 * servers" (§02) — and neither is changing them, subsetting and conversion included. So the font is NOT
 * in git: `node tools/fetch-switzer.mjs` gets each person their own copy from Fontshare into
 * assets/trial/ (ignored by git), and this file serves it unchanged, to a signed-in owner only. Without
 * it the pages still draw, in Noto, and say how to fetch it.
 *
 * Latin only. The face claims Latin's code points alone (`unicode-range`) and applies only on a page
 * whose language is English, Spanish or French; the Arabic and Chinese stacks are not touched, and a
 * Chinese or Arabic name inside an English page still falls through to Noto.
 */

const FONT = new URL('../../../assets/trial/Switzer-Variable.woff2', import.meta.url);
const FONT_ADDRESS = '/dev/trial/Switzer-Variable.woff2';

const fontFile = (): Buffer | null => {
  try { return readFileSync(FONT); } catch { return null; }
};

/**
 * Google Fonts' "latin" and "latin-ext" ranges, the two that hold English, Spanish and French: no
 * Arabic, no Han, no Cyrillic. A code point in the range that Switzer does not draw falls through to
 * the next family, as every face's does.
 */
const LATIN = 'U+0000-00FF, U+0100-02BA, U+02BB-02BC, U+02BD-02C5, U+02C6, U+02C7-02CC, U+02CE-02D7, U+02DA, '
  + 'U+02DC, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2000-206F, U+20A0-20C0, '
  + 'U+2113, U+2122, U+2191, U+2193, U+2212, U+2215, U+2C60-2C7F, U+A720-A7FF, U+FEFF, U+FFFD';

/**
 * THE LINES. Measured on the served files, a label at 15 px has stems of 1.6 px in Switzer at 500 (Noto:
 * 1.59), 1.9 at 600, 2.3 at 700; the phone's 13 px labels, 1.4 at 500 and 1.7 at 600. A and B are lines
 * on a 24-unit grid drawn at 24 px, so a unit is a pixel: their line is set to the stem of the words
 * beside them — 1.6 at rest, 1.9 on the entry you are on (its word is 600), 1.4 and 1.7 on a phone.
 * Iconoir ships 1.5 and Lucide 2; both are moved to the words.
 *
 * C is the owner's spec: Phosphor's bold, 15 per cent larger (24 → 28 px), in the wordmark's near-black
 * (the ink token, the wordmark's colour). Bold's line is 24 of 256 units, so 2.6 px at 28 — a weight heavier than the words at
 * rest, as asked. Its outline cannot be thinned; its size is what the spec sets.
 *
 * COLOUR. All three draw in the same ink, so the drawing is the only difference. The words keep the
 * rail's colours (stone at rest, ink where you are). Where you are, the drawing turns deep magenta
 * (`--color-nav-active`), as the app's does today — but as a LINE, in all three: the app fills it, and
 * neither Iconoir nor Lucide has a filled drawing of these six (Iconoir's solid set has only the mail).
 *
 * LEVEL. Each icon is centred on its word's first line (the app's rule, kept). Measured on the served
 * page at 1280 px, every icon's centre sits 0.1 px from the centre of its word's capitals in all three,
 * so nothing is nudged. On a phone the icon stands over its word, as the app's tiles do.
 */
const trialCss = (): string => `
@font-face { font-family:"Switzer"; font-style:normal; font-weight:300 700; font-display:swap;
  src:url(${FONT_ADDRESS}) format("woff2"); unicode-range:${LATIN}; }
html:is([lang="en"],[lang="es"],[lang="fr"]) :is(nav.side, main#main, .trial-page) { font-family:"Switzer", var(--font-family); }

nav.side .ni.tv { color:var(--color-ink); stroke-width:1.6px; }
nav.side a.navlink.active .ni.tv { color:var(--color-nav-active); stroke-width:1.9px; }
nav.side .ni.tv-phosphor { inline-size:28px; block-size:28px; margin-block:calc((1lh - 28px) / 2); }
nav.side .navhead .ni.tv { inline-size:16px; block-size:16px; stroke-width:1.4px; }
nav.side .navhead .ni.tv-phosphor { inline-size:18px; block-size:18px; margin-block:0; margin-inline:5px; }

.trial-page { margin:0; background:var(--color-paper); color:var(--color-ink); padding:var(--space-24) var(--space-24) var(--space-48); }
.trial-page h1 { font-size:var(--font-size-display); font-weight:600; margin:0 0 var(--space-4); letter-spacing:var(--tracking-tight); }
.trial-page .trial-lede { margin:0 0 var(--space-24); color:var(--color-ink-secondary); max-inline-size:68ch; }
.trial-page .trial-lede a { color:var(--color-brand); }
.trial-grid { display:grid; grid-template-columns:repeat(3, 208px); gap:var(--space-48); align-items:start; }
.trial-col h2 { font-size:var(--font-size-title); font-weight:600; margin:0; }
.trial-col .trial-note { margin:var(--space-4) 0 var(--space-12); font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
.trial-col nav.side { position:static; block-size:600px; border:1px solid var(--color-border); border-radius:var(--radius-card); }
.trial-missing { margin:0 0 var(--space-24); padding:var(--space-12) var(--space-16); border-radius:var(--radius-card);
  background:var(--color-surface); box-shadow:var(--shadow-lift1); max-inline-size:68ch; }

@media (max-width: 720px) {
  nav.side .ni.tv { stroke-width:1.4px; }
  nav.side a.navlink.active .ni.tv { stroke-width:1.7px; }
  nav.side .ni.tv-phosphor { margin-block:0; }
  .trial-page { padding:var(--space-16); }
  .trial-grid { grid-template-columns:minmax(0, 1fr); gap:var(--space-24); }
  .trial-col nav.side { block-size:auto; animation:none; border-radius:var(--radius-card); }
  .trial-col nav.side a.navlink { animation:none; }
}
`;

const FAMILY: Readonly<Record<'a' | 'b' | 'c', TrialFamily>> = { a: 'iconoir', b: 'lucide', c: 'phosphor' };

/** One drawing, in the rail's class (`ni`, so the rail's size and motion apply) plus the trial's own. */
const drawing = (family: TrialFamily, entry: TrialEntry): string => {
  const d = TRIAL_ICONS[family][entry];
  const cls = `ni tv tv-${family}`;
  if (family === 'phosphor') {
    return `<svg class="${cls}" viewBox="0 0 256 256" width="28" height="28" fill="currentColor" aria-hidden="true" focusable="false">${d}</svg>`;
  }
  const caps = family === 'lucide' ? ' stroke-linecap="round" stroke-linejoin="round"' : '';
  return `<svg class="${cls}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor"${caps} aria-hidden="true" focusable="false">${d}</svg>`;
};

const ENTRIES: ReadonlySet<string> = new Set(['home', 'inbox', 'calendar', 'employee', 'settings']);

/**
 * The real nav with its drawings swapped: each entry's first <svg> (the assistant's slot included) and
 * the "Customers" heading's. Given a suffix, ids take it, so three copies on one page stay distinct.
 */
const swapIcons = (nav: string, family: TrialFamily, suffix?: string): string => {
  const swapped = nav
    .replace(/(<a\b[^>]*\bdata-nav="(\w+)"[^>]*>)\s*<svg\b[\s\S]*?<\/svg>/g, (whole, open: string, id: string) =>
      ENTRIES.has(id) ? open + drawing(family, id as TrialEntry) : whole)
    .replace(/(<span class="navhead"[^>]*>)<svg\b[\s\S]*?<\/svg>/, (_w, open: string) => open + drawing(family, 'customers'));
  return suffix === undefined ? swapped
    : swapped.replace(/\b(id|aria-labelledby)="([^"]+)"/g, (_w, attr: string, v: string) => `${attr}="${v}-${suffix}"`);
};

const NAV = /<nav\b[^>]*class="side"[\s\S]*?<\/nav>/;

export interface TrialDeps {
  /** Whether the request carries an owner's session (the app's own check). */
  readonly signedIn: (req: FastifyRequest) => boolean;
}

export function registerTrial(app: FastifyInstance, deps: TrialDeps): void {
  /** Today exactly as /app draws it for this visitor, or null when they are not signed in. */
  const today = async (req: FastifyRequest): Promise<string | null> => {
    const headers: Record<string, string> = {};
    for (const h of ['cookie', 'accept-language', 'user-agent'] as const) {
      const v = req.headers[h];
      if (typeof v === 'string') headers[h] = v;
    }
    const res = await app.inject({ method: 'GET', url: '/app', headers });
    return res.statusCode === 200 ? res.body : null;
  };
  const hidden = (reply: FastifyReply) => reply
    .header('cache-control', 'no-store').header('x-robots-tag', 'noindex, nofollow').header('referrer-policy', 'no-referrer');
  const withTrial = (html: string): string => html.replace('</head>',
    '<meta name="robots" content="noindex, nofollow"><link rel="stylesheet" href="/dev/trial/trial.css"></head>');
  const missing = (): string => fontFile() ? '' : '<p class="trial-missing">Switzer is not on this machine, so the words '
    + 'are in Noto. Fetch your own copy (its licence wants each person to): <code>node tools/fetch-switzer.mjs</code>, '
    + 'then reload.</p>';

  app.get('/dev/trial/trial.css', async (req, reply) => {
    if (!deps.signedIn(req)) return reply.code(404).send();
    return hidden(reply).type('text/css; charset=utf-8').send(trialCss());
  });

  app.get(FONT_ADDRESS, async (req, reply) => {
    if (!deps.signedIn(req)) return reply.code(404).send();
    const bytes = fontFile();
    if (!bytes) return reply.code(404).send();
    return hidden(reply).header('x-content-type-options', 'nosniff').type('font/woff2').send(bytes);
  });

  app.get('/dev/trial/today', async (req, reply) => {
    const html = await today(req);
    if (html === null) return reply.redirect('/login');
    const pick = String((req.query as { icons?: string } | undefined)?.icons ?? '').toLowerCase();
    const family = pick === 'a' || pick === 'b' || pick === 'c' ? FAMILY[pick] : null;
    const drawn = family ? html.replace(NAV, (nav) => swapIcons(nav, family)) : html;
    return hidden(reply).type('text/html; charset=utf-8').send(withTrial(drawn));
  });

  app.get('/dev/trial', async (req, reply) => {
    const html = await today(req);
    if (html === null) return reply.redirect('/login');
    const nav = NAV.exec(html)?.[0] ?? '';
    const root = /<html\b([^>]*)>/.exec(html)?.[1] ?? ' lang="en"';
    const sheets = (html.match(/<link\b[^>]*rel="stylesheet"[^>]*>/g) ?? []).join('');
    const col = (key: 'a' | 'b' | 'c', title: string, note: string) => `<section class="trial-col" aria-labelledby="t-${key}">
      <h2 id="t-${key}">${title}</h2><p class="trial-note">${note}</p>
      ${swapIcons(nav, FAMILY[key], key).replace('<nav ', `<nav data-trial="${key}" `)}</section>`;
    const page = `<!doctype html><html${root}><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>Trial · the nav three ways</title>${sheets}<link rel="stylesheet" href="/dev/trial/trial.css"></head>
<body class="trial-page"><h1>The nav, three ways</h1>
<p class="trial-lede">The same entries, words and states, on Today. Only the drawings differ. The words are in Switzer.
Not linked from the app, and not shipped. <a href="/dev/trial/today">Today in Switzer</a> ·
<a href="/dev/trial/today?icons=a">with A</a> · <a href="/dev/trial/today?icons=b">with B</a> ·
<a href="/dev/trial/today?icons=c">with C</a></p>${missing()}
<div class="trial-grid">
${col('a', 'A — Iconoir', 'Iconoir 7.12.1 · MIT · 24 px · line 1.6 px, as the words')}
${col('b', 'B — Lucide', 'Lucide 1.52.0 · ISC · 24 px · line 1.6 px, as the words')}
${col('c', 'C — Phosphor bold', 'Phosphor 2.1.1 · MIT · bold · 28 px (+15 per cent) · near-black')}
</div></body></html>`;
    return hidden(reply).type('text/html; charset=utf-8').send(page);
  });
}
