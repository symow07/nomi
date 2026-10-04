import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { TRIAL2_ICONS, type IconEntry, type IconFamily } from './trial2Icons.js';

/**
 * THE SECOND ICON TRIAL (branch trial/icons-v2, 2026-10-05) — NOT SHIPPED, NEVER MERGED.
 *
 * The owner: "A second visual icon trial only. Font is PARKED … purely about nav icons … Reference:
 * Instagram's icons. Thin-to-medium stroke, EVEN weight, soft ROUNDED corners and rounded line caps,
 * generously sized, lots of breathing room … NOT bold, NOT heavy, NOT sharp-cornered, NOT hairline-thin."
 *
 * ONE address, /dev/trial2 (and its stylesheet), unlinked, existing only when the process started with
 * TRIAL_ROUTES=on outside production (main.ts), and only for a signed-in owner. Nothing else changes:
 * the words are the app's Noto, through the app's own stylesheet.
 *
 * The page takes the real nav out of Today as /app draws it for the visitor (`app.inject` with their
 * cookie), so the business name, the waiting count and every rule of the rail are the real ones, and
 * draws it six times: two families side by side (A Phosphor regular, B Solar Linear), each with
 * Today's three candidate icons (1 a calendar with today marked, 2 a rounded house, 3 a ring). Every
 * other icon stays the same within a family. A close-up of the six Today rows heads the page.
 *
 * THE LINE, EVEN AND THE SAME IN BOTH. Each icon is 28 px, 15 per cent over the rail's 24. Phosphor's
 * regular line is 16 of 256 units: 1.75 px at 28. Solar's line is 1.5 of 24 units: 1.75 px at 28, set
 * here (the drawings carry no width of their own). Beside 15 px words whose stems measure 1.59 px at 500
 * and 1.9 px at 600, that is between the two: medium, never hairline, never bold. Phosphor's light
 * weight would be 1.3 px at this size, and its bold 2.6 px. Instagram draws its nav at about 2 px
 * on 24 px; this is a shade lighter, for 28 px shapes beside 15 px words.
 *
 * The heading "Customers" carries a smaller icon (18 px). It is held to the same 1.75 px line: Phosphor
 * by its bold weight (24 units at 18 px is 1.69 px), Solar by a wider setting (2.33 units).
 *
 * ROUNDED. Solar Linear is drawn with round caps and soft-cornered shapes. Phosphor has no rounding
 * switch in its package: its regular weight already ends every line round and rounds every joint and
 * box corner as drawn, so that is what is shown, unchanged.
 *
 * COLOUR AND STATE. Every icon is ink (the token, the wordmark's near-black), the words keep the rail's
 * colours. The entry you are on keeps the app's white pill and its word in weight, and its icon turns
 * deep magenta (`--color-nav-active`) — as a LINE: nothing is filled to say "you are here".
 *
 * TODAY 3 is a ring, not a filled disc: in this app a solid disc already means "needs you" (the
 * identity run), and a disc in the rail would say it too.
 *
 * AIR. Each entry is 52 px tall instead of 44, with 16 px between icon and word instead of 12 and 8 px
 * between entries; a phone's tile is 64 px tall with 8 px between icon and word.
 */

type Today = 'today1' | 'today2' | 'today3';
const FAMILIES: readonly { key: 'a' | 'b'; family: IconFamily; title: string; note: string }[] = [
  { key: 'a', family: 'phosphor', title: 'A — Phosphor, regular', note: 'Phosphor 2.1.1 · MIT · regular · 28 px · line 1.75 px' },
  { key: 'b', family: 'solar', title: 'B — Solar, Linear', note: 'Solar by 480 Design · CC BY 4.0 · Linear · 28 px · line 1.75 px' },
];
const TODAYS: readonly { key: Today; n: string; title: string }[] = [
  { key: 'today1', n: '1', title: 'A calendar with today marked' },
  { key: 'today2', n: '2', title: 'A rounded house' },
  { key: 'today3', n: '3', title: 'A soft ring' },
];

const trialCss = `
nav.side .ni.t2 { color:var(--color-ink); inline-size:28px; block-size:28px; margin-block:calc((1lh - 28px) / 2); }
nav.side .ni.t2-solar { stroke-width:1.5px; stroke-linejoin:round; }
nav.side a.navlink.active .ni.t2 { color:var(--color-nav-active); }
nav.side .navhead .ni.t2 { inline-size:18px; block-size:18px; margin-block:0; margin-inline:5px; }
nav.side .navhead .ni.t2-solar { stroke-width:2.33px; }
.t2-page nav.side a.navlink.active { view-transition-name:none; }
:is(.t2-col, .t2-close) nav.side a.navlink { min-height:52px; padding-block:calc((52px - 1lh) / 2); gap:var(--space-16); margin-bottom:var(--space-8); }

.t2-page { margin:0; background:var(--color-paper); color:var(--color-ink); padding:var(--space-24) var(--space-24) var(--space-48); }
.t2-page h1 { font-size:var(--font-size-display); font-weight:700; margin:0 0 var(--space-4); }
.t2-page .t2-lede { margin:0 0 var(--space-24); color:var(--color-ink-secondary); max-inline-size:72ch; }
.t2-page h2 { font-size:var(--font-size-title); font-weight:600; margin:var(--space-32) 0 var(--space-12); }
.t2-page h3 { font-size:var(--font-size-base); font-weight:600; margin:0; }
.t2-page .t2-note { margin:var(--space-4) 0 var(--space-12); font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
.t2-close { display:grid; grid-template-columns:max-content repeat(3, max-content); gap:var(--space-16) var(--space-32); align-items:center; }
.t2-close .t2-head { font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
.t2-close .t2-cell { zoom:2; }
.t2-close .t2-cell nav.side { all:unset; display:block; }
.t2-close .t2-cell a.navlink { pointer-events:none; }
.t2-row { display:grid; grid-template-columns:repeat(2, 240px); gap:var(--space-48); align-items:start; margin-bottom:var(--space-32); }
.t2-col nav.side { position:static; block-size:auto; min-block-size:560px; border:1px solid var(--color-border); border-radius:var(--radius-card); }

@media (max-width: 720px) {
  nav.side .ni.t2 { margin-block:0; }
  .t2-page { padding:var(--space-16); }
  .t2-close { grid-template-columns:max-content repeat(3, minmax(0, 1fr)); gap:var(--space-12); }
  .t2-close .t2-cell { zoom:1.2; min-inline-size:0; }
  .t2-row { grid-template-columns:minmax(0, 1fr); gap:var(--space-16); }
  .t2-col nav.side { min-block-size:0; animation:none; }
  :is(.t2-col, .t2-close) nav.side a.navlink { animation:none; min-height:64px; padding-block:var(--space-8); gap:var(--space-8); margin-bottom:0; }
}
`;

/** One drawing, in the rail's class (`ni`: its motion and colour rules apply) plus the trial's. */
const drawing = (family: IconFamily, entry: IconEntry): string => {
  const d = TRIAL2_ICONS[family][entry];
  const cls = `ni t2 t2-${family}`;
  return family === 'phosphor'
    ? `<svg class="${cls}" viewBox="0 0 256 256" width="28" height="28" fill="currentColor" aria-hidden="true" focusable="false">${d}</svg>`
    : `<svg class="${cls}" viewBox="0 0 24 24" width="28" height="28" fill="none" aria-hidden="true" focusable="false">${d}</svg>`;
};

const CONSTANT: Readonly<Record<string, IconEntry>> = { inbox: 'inbox', calendar: 'calendar', employee: 'employee', settings: 'settings' };

/** The real nav with its drawings swapped; ids take a suffix so six copies on one page stay distinct. */
const swapIcons = (nav: string, family: IconFamily, today: Today, suffix: string): string => nav
  .replace(/(<a\b[^>]*\bdata-nav="(\w+)"[^>]*>)\s*<svg\b[\s\S]*?<\/svg>/g, (whole, open: string, id: string) => {
    const entry = id === 'home' ? today : CONSTANT[id];
    return entry ? open + drawing(family, entry) : whole;
  })
  .replace(/(<span class="navhead"[^>]*>)<svg\b[\s\S]*?<\/svg>/, (_w, open: string) => open + drawing(family, 'customersSmall'))
  .replace(/\b(id|aria-labelledby)="([^"]+)"/g, (_w, attr: string, v: string) => `${attr}="${v}-${suffix}"`)
  .replace('<nav ', `<nav data-trial="${suffix}" `);

const NAV = /<nav\b[^>]*class="side"[\s\S]*?<\/nav>/;
const ACTIVE = /<a\b[^>]*class="navlink[^"]*\bactive\b[\s\S]*?<\/a>/;

export interface Trial2Deps {
  /** Whether the request carries an owner's session (the app's own check). */
  readonly signedIn: (req: FastifyRequest) => boolean;
}

export function registerTrial2(app: FastifyInstance, deps: Trial2Deps): void {
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

  app.get('/dev/trial2/trial2.css', async (req, reply) => {
    if (!deps.signedIn(req)) return reply.code(404).send();
    return hidden(reply).type('text/css; charset=utf-8').send(trialCss);
  });

  app.get('/dev/trial2', async (req, reply) => {
    const html = await today(req);
    if (html === null) return reply.redirect('/login?with=code');
    const nav = NAV.exec(html)?.[0] ?? '';
    const root = /<html\b([^>]*)>/.exec(html)?.[1] ?? ' lang="en"';
    const sheets = (html.match(/<link\b[^>]*rel="stylesheet"[^>]*>/g) ?? []).join('');

    // The close-up: the Today row alone (the white pill and its icon), six ways, at twice the size.
    const pill = (f: (typeof FAMILIES)[number], t: (typeof TODAYS)[number]) => {
      const swapped = swapIcons(nav, f.family, t.key, `c${f.key}${t.n}`);
      const row = ACTIVE.exec(swapped)?.[0] ?? '';
      return `<div class="t2-cell"><nav class="side" aria-hidden="true">${row.replace(/\saria-current="page"/, '')}</nav></div>`;
    };
    const close = `<div class="t2-close" data-shot="today-options">
      <span></span>${TODAYS.map((t) => `<span class="t2-head">${t.n} · ${t.title}</span>`).join('')}
      ${FAMILIES.map((f) => `<h3>${f.title.split(' — ')[0]}</h3>${TODAYS.map((t) => pill(f, t)).join('')}`).join('')}
    </div>`;

    const rows = TODAYS.map((t) => `<section aria-labelledby="t2-${t.n}">
      <h2 id="t2-${t.n}">Today ${t.n} · ${t.title}</h2>
      <div class="t2-row">${FAMILIES.map((f) => `<div class="t2-col">
        <h3>${f.title}</h3><p class="t2-note">${f.note}</p>${swapIcons(nav, f.family, t.key, `${f.key}${t.n}`)}</div>`).join('')}
      </div></section>`).join('');

    const page = `<!doctype html><html${root}><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>Trial · nav icons, second round</title>${sheets}<link rel="stylesheet" href="/dev/trial2/trial2.css"></head>
<body class="t2-page"><h1>Nav icons, second round</h1>
<p class="t2-lede">Two families side by side, each with Today's three candidates; every other icon stays the same.
One even 1.75 px line at 28 px, rounded ends, in ink; the entry you are on keeps its white pill, its icon in deep
magenta and never filled. The words are the app's own (Noto). Not linked from the app, and not shipped.</p>
<h2>Today, close up</h2>${close}
${rows}</body></html>`;
    return hidden(reply).type('text/html; charset=utf-8').send(page);
  });
}
