import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyRequest } from 'fastify';
import { registerWebApp } from '../../src/api/web/app.js';
import { shell, helpDoor, esc } from '../../src/api/web/layout.js';
import { guideFileAt, hasVideo } from '../../src/api/web/guide.js';
import { GUIDES, KB_SOURCES, helpFor, pageFrom, guideLines, guideTitle, guideDoor, FROM_MAX, type GuideId } from '../../src/api/web/helpTopics.js';
import { renderHelp, helpRoutes, topicsFor, type HelpIO, type HelpViewer } from '../../src/api/web/helpPanel.js';
import { answerHelp, linesOfGuide, helpTokens, notYetIn, NOT_YET } from '../../src/advisor/help.js';
import { NOT_YET_ASKS, NOT_YET_PASSING } from './help-not-yet-corpus.js';
import { HELP_MAIL_FIELDS, helpMail, helpMailFields, helpNoticeKey } from '../../src/core/owner/helpMail.js';
import { BUYER_CHANNELS } from '../../src/db/connectedChannels.js';
import { t } from '../../src/api/web/say.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { messages } from '../../src/core/owner/i18n/messages.js';
import { BANNED_OWNER_TERMS } from '../../src/core/owner/vocabulary.js';
import { HELP_EN } from '../../src/core/owner/i18n/help.js';
import type { AdvisorModel } from '../../src/llm/ports.js';
import type { AdvisorSpent } from '../../src/advisor/answer.js';
import { buttonsAndDoors } from './buttons-and-doors.js';
import { unisolatedFigures } from './isolates.js';

/**
 * Block 6.1 — HELP THAT ANSWERS: a "?" on every owner page, its two or three guides (with the step videos where one
 * exists), a question the advisor's model answers from those guides only, and "Write to us".
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BIZ = 'de300000-0000-4000-8000-0000000000b1';

/** Every GET route the app registers, as written (`:id` and all). */
async function appRoutes(): Promise<string[]> {
  const app = Fastify({ logger: false });
  const routes: string[] = [];
  app.addHook('onRoute', (r) => { const ms = Array.isArray(r.method) ? r.method : [r.method]; if (ms.includes('GET')) routes.push(r.url); });
  registerWebApp(app, {
    db: {} as never, sessionSecret: 'x'.repeat(64), accessCode: 'let-me-in', businessId: BIZ,
    employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, kickOutbound: async () => {},
  } as unknown as Parameters<typeof registerWebApp>[1]);
  await app.ready();
  await app.close();
  return [...new Set(routes)];
}
const matches = (route: string, href: string): boolean => {
  const path = href.split(/[?#]/)[0]!;
  const re = new RegExp(`^${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\:[A-Za-z]+|:[A-Za-z]+/g, '[^/]+')}$`);
  return re.test(path);
};

/** An owner page: an HTML page of the signed-in app (not the live line's answers, files, or the help page itself). */
const ownerPage = (r: string): boolean =>
  (r === '/app' || r.startsWith('/app/')) && !r.startsWith('/app/live/') && !r.startsWith('/app/help/')
  && !/\.(csv|xlsx|zip|pdf|json|js|png|jpg|webm|vtt|ics)$/.test(r) && !r.includes('*');

describe('Block 6.1 · every owner page has a help panel', () => {
  it('every registered owner page maps to two or three guides, and the shell draws its "?" with the page in it', async () => {
    const routes = (await appRoutes()).filter(ownerPage);
    expect(routes.length).toBeGreaterThan(100);
    const without: string[] = [];
    for (const r of routes) {
      const ids = helpFor(r);
      expect(ids.length, r).toBeGreaterThanOrEqual(2);
      expect(ids.length, r).toBeLessThanOrEqual(3);
      for (const id of ids) expect(GUIDES[id], `${r} → ${id}`).toBeDefined();
      const path = r.replace(/:[A-Za-z]+/g, '0b5e7c1a-2f3d-4e8a-9c6b-1d2e3f4a5b01');
      const html = shell({ title: 'x', active: 'home', locale: 'en', path, bodyHtml: '<h1 class="page">x</h1>' });
      if (!html.includes(`<a class="help-door" href="/app/help/page?from=${path.replace(/\/+$/, '') || '/app'}" data-card`)) without.push(r);
    }
    expect(without, 'pages whose shell has no "?"').toEqual([]);
  });

  it('every guide\'s door is a page the app has; every video it names resolves through the guide\'s own file route', async () => {
    const routes = await appRoutes();
    for (const g of Object.values(GUIDES)) {
      expect(routes.some((r) => matches(r, g.door)), `${g.id} → ${g.door}`).toBe(true);
      if (!g.video) continue;
      expect(hasVideo(g.video, 'en'), `${g.id}: no English video for ${g.video}`).toBe(true);
      for (const l of LOCALES) {
        if (!hasVideo(g.video, l)) continue;
        for (const ext of ['webm', 'vtt', 'jpg']) expect(guideFileAt(`${g.video}.${l}.${ext}`), `${g.video}.${l}.${ext}`).not.toBeNull();
      }
    }
    expect(routes).toContain('/assets/guide/:file');
    expect(routes).toContain('/app/help/page');
  });

  it('every guide has its title, its lines and its door in the catalogue, in plain owner words', () => {
    for (const id of Object.keys(GUIDES) as GuideId[]) {
      for (const k of [guideTitle(id), guideDoor(id), ...guideLines(id)]) {
        expect(messages.en[k as keyof typeof messages.en], k).toBeTruthy();
      }
    }
    for (const [k, v] of Object.entries(HELP_EN)) {
      for (const term of BANNED_OWNER_TERMS) {
        expect(new RegExp(`(?<![\\p{L}])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'iu').test(v), `${k}: "${term}"`).toBe(false);
      }
      // Nobody gendered; the assistant has no pronoun (rule 6) — a guide names it or rewords; no export-trade frame (§0).
      expect(v, k).not.toMatch(/\b(she|her|hers|he|him|his)\b|\bbuyers?\b|\bfactory\b|\bMOQ\b|\bminimum order\b|\bquotes?\b/i);
      expect(v, k).not.toMatch(/assistant[^.;]*\b(it|its)\b/i);
    }
  });

  it('every docs/kb article is accounted for: the guides it became (each naming it) or why it was left out', () => {
    const files = readdirSync(`${ROOT}docs/kb`).filter((f) => f.endsWith('.md')).sort();
    expect(Object.keys(KB_SOURCES).sort()).toEqual(files);
    for (const [file, became] of Object.entries(KB_SOURCES)) {
      if (!Array.isArray(became)) { expect((became as { dropped: string }).dropped.length, file).toBeGreaterThan(20); continue; }
      for (const id of became as GuideId[]) expect(GUIDES[id].source, `${file} → ${id}`).toBe(`docs/kb/${file}`);
    }
    for (const { id, source: src } of Object.values(GUIDES)) if (src !== 'page') expect(existsSync(`${ROOT}${src}`), id).toBe(true);
  });
});

describe('Block 6.1 · the "?" covers no control', () => {
  it('every area menu at a page\'s head keeps the room of the "?" (tools/check-help-door.mjs measures it in a browser)', () => {
    const web = `${ROOT}src/api/web/`;
    const layout = readFileSync(`${web}layout.ts`, 'utf8');
    // The room: the door's 44 px and a gap (layout.ts, beside `.help-door`).
    const ROOM = String.raw`(?:padding|margin)-inline-end:calc\(44px \+ var\(--space-8\)\)`;
    const rule = (sel: string): boolean => new RegExp(String.raw`\.content \.${sel}\b[^{]*\{[^}]*${ROOM}`).test(layout);
    // Every area's phone chooser (the second-level one in Settings sits below its own row) and every area's row of links.
    const choosers = new Set<string>(); const rows = new Set<string>();
    for (const f of readdirSync(web).filter((x) => x.endsWith('.ts'))) {
      const src = readFileSync(`${web}${f}`, 'utf8');
      for (const m of src.matchAll(/class="area-chooser ([a-z]+-chooser)"/g)) if (m[1] !== 'sa-page-chooser') choosers.add(m[1]!);
      for (const m of src.matchAll(/<nav class="([a-z]{2}-(?:nav|pages))"/g)) rows.add(m[1]!);
    }
    expect([...choosers].sort()).toEqual(['aa-chooser', 'ba-chooser', 'ca-chooser', 'pa-chooser', 'sa-chooser']);
    for (const c of [...choosers, ...rows]) expect(rule(c), c).toBe(true);
    expect(layout).toMatch(/\.content \.area-nav \.area-chooser \{ margin-inline-end:calc\(44px \+ var\(--space-8\)\)/);
  });
});

describe('Block 6.1 · the page a request came from is only ever a same-origin owner path', () => {
  it('accepts plain owner paths, query and fragment dropped', () => {
    expect(pageFrom('/app')).toBe('/app');
    expect(pageFrom('/app/')).toBe('/app');
    expect(pageFrom('/app/inbox')).toBe('/app/inbox');
    expect(pageFrom('/app/inbox?filter=all#latest')).toBe('/app/inbox');
    expect(pageFrom('/app/customers/0b5e7c1a-2f3d-4e8a-9c6b-1d2e3f4a5b01')).toBe('/app/customers/0b5e7c1a-2f3d-4e8a-9c6b-1d2e3f4a5b01');
    expect(pageFrom('/app/books/reports/made.xlsx')).toBe('/app/books/reports/made.xlsx');
  });
  it('refuses every hostile value', () => {
    for (const bad of [
      '', '//evil.example', '///evil.example', 'https://evil.example/app', 'http:/app', 'javascript:alert(1)', '/\\evil.example',
      '/app\\..\\x', '/app//evil.example', '/app/../login', '/app/./x', '/app/%2e%2e/x', '/app/%2F%2Fevil', '/app%2Fx', '/appx',
      '/apps', ' /app', '/app/inbox ', '/app/inbox\n', '/app/in box', '/app/"><script>', "/app/'x", '/app/x<y', '/login', '/',
      'app/inbox', '/app/' + 'a'.repeat(FROM_MAX), '/app/ｉｎｂｏｘ', '/app/inbox/ ',
    ]) expect(pageFrom(bad), JSON.stringify(bad)).toBeNull();
    for (const bad of [null, undefined, 42, ['/app'], { a: 1 }]) expect(pageFrom(bad)).toBeNull();
  });
  it('a hostile path in the shell gives the general door, never the value', () => {
    for (const path of ['//evil.example', '/app/"><script>alert(1)</script>', 'https://evil.example']) {
      const door = helpDoor('en', path);
      expect(door).toContain('href="/app/help/page"');
      expect(door).not.toMatch(/evil|script/);
    }
  });
  it('the help page is drawn with no way back for a refused value, and the general guides', () => {
    const html = renderHelp('en', { from: pageFrom('//evil.example'), role: 'owner', canAsk: true, canWrite: true });
    expect(html).not.toContain('evil');
    expect(html).not.toContain(t('en', 'help.back'));
    expect(html).toContain('name="q"');
  });
});

/** The tester's fifteen invented sentences (6.1's verification, Q3): ten reached the owner under the English term list. */
const INVENTED: readonly { readonly lang: 'en' | 'ar' | 'zh' | 'es' | 'fr'; readonly pick: GuideId; readonly text: string }[] = [
  { lang: 'en', pick: 'practice', text: 'Practice can also post your products to Shopify.' },
  { lang: 'en', pick: 'practice', text: 'Practice gives you 500 messages a day.' },
  { lang: 'en', pick: 'practice', text: 'Practice gives you five hundred messages a day.' },
  { lang: 'en', pick: 'practice', text: 'Practice will take videos from December.' },
  { lang: 'en', pick: 'practice', text: 'Practice can also send discount codes to customers who leave their cart.' },
  { lang: 'en', pick: 'practice', text: 'Practice also syncs your catalogue with Pinterest and Square.' },
  { lang: 'en', pick: 'approve', text: 'Every reply that waits is automatically translated into the customer’s language.' },
  { lang: 'en', pick: 'inbox', text: 'From the Inbox you can message all your customers at once.' },
  { lang: 'en', pick: 'practice', text: 'The assistant can reply to customers with voice messages.' },
  { lang: 'en', pick: 'approve', text: 'You can unsend a reply up to an hour after it goes.' },
  { lang: 'ar', pick: 'practice', text: 'يمكن للتدريب أيضًا إرسال رسائل نصية قصيرة إلى عملائك.' },
  { lang: 'ar', pick: 'practice', text: 'يرسل التدريب ردودك إلى واتساب العميل مباشرة.' },
  { lang: 'zh', pick: 'practice', text: '练习也可以给你的客户发短信。' },
  { lang: 'es', pick: 'practice', text: 'Práctica también puede hacer llamadas telefónicas a tus clientes.' },
  { lang: 'fr', pick: 'practice', text: 'Practice publie aussi vos produits sur Shopify.' },
];
const OWNER_LOCALES = ['en', 'ar', 'zh', 'es'] as const;

describe('Block 6.1 · the help question: grounded on the guides, never inventing a feature', () => {
  const usage = { inputTokens: 100, outputTokens: 20 };
  const scripted = (pick: string | null, text: string | null, log: string[] = []): AdvisorModel => ({
    recognise: async ({ entries }) => { log.push(`recognise:${entries.length}`); return { pick: pick ? { id: pick, period: null, customer: null, product: null, reference: null } : null, usage }; },
    phrase: async ({ facts }) => { log.push(`phrase:${facts.length}`); return { text, usage }; },
  });

  it('the model chooses guide lines: they stand, as the guide words them, and both calls are counted', async () => {
    const two = `${t('en', 'help.g.practice.2').toUpperCase()}   ${t('en', 'help.g.practice.1').replace(/\./g, '!')}`;
    for (const locale of OWNER_LOCALES) {
      const r = await answerHelp(scripted('practice', two), 'How do I test replies?', topicsFor('/app/assistant/practice', locale), locale);
      expect(r.answer, locale).toMatchObject({ kind: 'answer', lines: [1, 0] });
      expect(r.spent).toEqual({ llmCalls: 2, inputTokens: 200, outputTokens: 40, cachedInputTokens: 0 });
    }
  });

  it('an allowlist: the tester\'s fifteen invented sentences, in five languages, are each thrown away for the guide\'s lines', async () => {
    expect(INVENTED.length).toBe(15);
    for (const c of INVENTED) {
      const locale = c.lang === 'fr' ? 'en' : c.lang;
      const r = await answerHelp(scripted(c.pick, c.text), 'What else can it do?', topicsFor('/app/assistant/practice', locale), locale);
      expect(r.answer.kind, c.text).toBe('guide');
      if (r.answer.kind === 'guide') expect(r.answer.topic.id).toBe(c.pick);
    }
    // And the builder's own: a feature, a broadcast, a connection, a figure.
    for (const invented of ['Yes — Nomi posts your products to Shopify every night.', 'Practice can also send a broadcast to all your customers.',
      'You can connect Zapier from Practice.', 'In Practice, 75 messages a day are free.', 'In Practice you write as a customer and nothing reaches anyone.']) {
      expect((await answerHelp(scripted('practice', invented), 'More?', topicsFor('/app/assistant/practice'), 'en')).answer.kind, invented).toBe('guide');
    }
  });

  it('a guide line with one word changed, a figure changed, a line of another guide, or a line plus a sentence, is thrown away', async () => {
    const line = t('en', 'help.g.practice.2'); // "… Practice has 50 messages a day."
    const tps = topicsFor('/app/assistant/practice');
    const practice = tps.find((x) => x.id === 'practice')!;
    expect(linesOfGuide(line, practice)).toEqual([1]);
    for (const bad of [
      line.replace('photo', 'video'), line.replace('50', '500'), line.replace('50', 'fifty'), line.replace('a day', 'an hour'),
      `${line} It also sends SMS.`, `Yes! ${line}`, t('en', 'help.g.data.1'), line.slice(0, -10), '',
    ]) {
      expect(linesOfGuide(bad, practice), bad).toBeNull();
      expect((await answerHelp(scripted('practice', bad), 'Q?', tps, 'en')).answer.kind, bad).toBe('guide');
    }
    // A figure keeps its own marks: "20,000" is never "20000" or "200.00".
    expect(helpTokens('Up to 20,000 rows.')).toEqual(['up', 'to', '20,000', 'rows']);
    expect(helpTokens('up to 20000 rows')).not.toEqual(helpTokens('Up to 20,000 rows.'));
    expect(helpTokens('Up — to\u00a0“20,000” ROWS!')).toEqual(helpTokens('Up to 20,000 rows.'));
  });

  it('a question about something Nomi does not do is "not yet", and the model is not asked — the corpus, every owner language', async () => {
    const langs = new Set(NOT_YET_ASKS.map((a) => a.lang));
    expect([...langs].sort()).toEqual(['ar', 'en', 'es', 'fr', 'zh']);
    expect(new Set(NOT_YET_PASSING.map((a) => a.lang))).toEqual(langs);
    for (const n of NOT_YET) expect(NOT_YET_ASKS.some((a) => a.term === n.name), `${n.name} has an ask in the corpus`).toBe(true);
    for (const a of NOT_YET_ASKS) {
      expect(a.why.length, a.text).toBeGreaterThan(5);
      expect(notYetIn(a.text), `${a.text} (${a.why})`).toBe(a.term);
      const log: string[] = [];
      const r = await answerHelp(scripted('setup', 'Yes, of course.', log), a.text, topicsFor(null), 'en');
      expect(r.answer.kind, a.text).toBe('notYet');
      expect(log, a.text).toEqual([]);
      expect(r.spent.llmCalls).toBe(0);
    }
    for (const p of NOT_YET_PASSING) {
      expect(p.why.length, p.text).toBeGreaterThan(5);
      expect(notYetIn(p.text), `${p.text} (${p.why})`).toBeNull();
    }
    for (const q of ['Why did line 3 of my list fail?', 'Can a customer say "call me Ana"?', 'I texted them yesterday, will it show here?']) {
      expect(NOT_YET_PASSING.some((p) => p.text === q), q).toBe(true);
    }
  });

  it('no guide fits: the fixed sentence, never a guess; a model that fails: the fixed failure', async () => {
    expect((await answerHelp(scripted(null, 'x'), 'What is the meaning of life?', topicsFor(null), 'en')).answer.kind).toBe('unknown');
    expect((await answerHelp(scripted('nonsense', 'x'), 'Hm?', topicsFor(null), 'en')).answer.kind).toBe('unknown');
    const broken: AdvisorModel = { recognise: async () => { throw new Error('down'); }, phrase: async () => { throw new Error('down'); } };
    expect((await answerHelp(broken, 'How?', topicsFor(null), 'en')).answer.kind).toBe('failed');
  });

  it('the topics are the page\'s guides first, then every other guide, in English, with the lines as the page shows them', () => {
    const ts = topicsFor('/app/settings/channels', 'ar');
    expect(ts.slice(0, 2).map((x) => x.id)).toEqual(['channels', 'whatsapp']);
    expect(ts.length).toBe(Object.keys(GUIDES).length);
    expect(ts[0]!.lines[0]).toBe(t('en', 'help.g.channels.1'));
    expect(ts[0]!.shown?.[0]).toBe(t('ar', 'help.g.channels.1'));
  });

  it('help.g.channels.2 names exactly what completes the channels step, as setup.ts decides it (BUYER_CHANNELS)', () => {
    // How the guides name each channel. A channel added to BUYER_CHANNELS without a word here fails, and so does the line.
    const WORD: Record<string, string> = { whatsapp: 'WhatsApp', instagram: 'Instagram', messenger: 'Messenger', email: 'e-mail', telegram: 'Telegram', tiktok: 'TikTok' };
    for (const c of BUYER_CHANNELS) expect(WORD[c], c).toBeDefined();
    const listed = Object.entries(WORD).filter(([, w]) => t('en', 'help.g.channels.1').includes(w)).map(([c]) => c);
    expect(listed.sort()).toEqual(Object.keys(WORD).sort());
    const [completes, rest] = t('en', 'help.g.channels.2').split('completes that setup step');
    expect(rest, 'the line says what completes the step').toBeDefined();
    const notThese = rest!.split('.')[0]!;
    expect(notThese).toMatch(/\bdoes not\b/);
    for (const c of listed) {
      const counts = (BUYER_CHANNELS as readonly string[]).includes(c);
      expect(completes!.includes(WORD[c]!), `${c} named as completing`).toBe(counts);
      expect(notThese.includes(WORD[c]!), `${c} named as not completing`).toBe(!counts);
    }
    // Only English has the line; a translation added later must be held here too.
    for (const l of LOCALES) expect(t(l, 'help.g.channels.2'), l).toBe(t('en', 'help.g.channels.2'));
  });
});

describe('Block 6.1 · the page, by who reads it', () => {
  it('the owner and a team member get the box and Write to us; an accountant reads the guides only', () => {
    for (const role of ['owner', 'staff'] as const) {
      const html = renderHelp('en', { from: '/app/inbox', role, canAsk: true, canWrite: true });
      expect(html).toContain('action="/app/help/ask"');
      expect(html).toContain('action="/app/help/write"');
      expect(html).toContain(t('en', 'help.write.lede'));
      for (const f of HELP_MAIL_FIELDS) expect(html).toContain(t('en', helpNoticeKey(f)));
      expect(html).toContain('within one working day');
      expect(buttonsAndDoors(html), role).toEqual([]);
    }
    const books = renderHelp('en', { from: '/app/books', role: 'accountant', canAsk: true, canWrite: true });
    expect(books).not.toContain('<form');
    expect(books).toContain(t('en', 'help.g.books.title'));
  });

  it('the guides, the videos and the doors are drawn; it is the card the sheet lifts', () => {
    const html = renderHelp('en', { from: '/app/settings/channels', role: 'owner', canAsk: true, canWrite: true });
    expect(html).toContain('data-card-body');
    expect(html).toContain(t('en', 'help.g.channels.title'));
    expect(html).toContain('href="/app/settings/channels"');
    expect(html).toContain('src="/assets/guide/channels.en.webm"');
    expect(html).toContain('href="/app/settings/channels"');
  });

  it('in Arabic every figure is isolated', () => {
    for (const from of ['/app/assistant/practice', '/app/settings/business/data', '/app/settings/channels']) {
      const html = renderHelp('ar', { from, role: 'owner', canAsk: true, canWrite: true });
      expect(unisolatedFigures(html), from).toEqual([]);
    }
  });
});

describe('Block 6.1 · the routes: metered, limited, and writing only what was typed', () => {
  const mk = (o: { viewer?: HelpViewer | null; allowanceUsed?: boolean; model?: AdvisorModel | null; write?: HelpIO['write'] }) => {
    const spent: AdvisorSpent[] = [];
    const flashes: string[] = [];
    let clock = Date.parse('2026-11-10T09:00:00Z');
    const app = Fastify({ logger: false });
    app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_r, body, done) => done(null, Object.fromEntries(new URLSearchParams(body as string))));
    const viewer = o.viewer === undefined ? { businessId: BIZ, personId: 'p-1', role: 'owner' as const } : o.viewer;
    const io: HelpIO = {
      viewer: () => viewer, locale: () => 'en', page: (_r: FastifyRequest, p) => `<html>${p.bodyHtml}</html>`,
      model: o.model === undefined ? {
        recognise: async () => ({ pick: { id: 'setup', period: null, customer: null, product: null, reference: null }, usage: { inputTokens: 10, outputTokens: 1 } }),
        phrase: async () => ({ text: t('en', 'help.g.setup.1'), usage: { inputTokens: 20, outputTokens: 2 } }),
      } : o.model,
      allowanceUsed: async () => o.allowanceUsed ?? false,
      spent: async (_b, s) => { spent.push(s); },
      write: o.write === undefined ? async () => 'sent' : o.write,
      flashTo: (reply, path, key) => { flashes.push(`${path} ${key}`); return reply.redirect(path); },
      takeFlash: () => null,
      now: () => clock,
    };
    helpRoutes(app, io);
    return { app, spent, flashes, tick: (ms: number) => { clock += ms; } };
  };
  const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

  it('asks the allowance first: used up, nothing is asked and nothing written', async () => {
    const calls: string[] = [];
    const { app, spent } = mk({ allowanceUsed: true, model: { recognise: async () => { calls.push('r'); throw new Error(); }, phrase: async () => { calls.push('p'); throw new Error(); } } });
    const r = await app.inject({ method: 'POST', url: '/app/help/ask', headers: FORM, payload: 'q=How%20do%20I%20start%3F&from=/app' });
    expect(r.body).toContain(t('en', 'help.ask.allowance'));
    expect(calls).toEqual([]);
    expect(spent).toEqual([]);
  });

  it('answered: what it used is recorded once', async () => {
    const { app, spent } = mk({});
    const r = await app.inject({ method: 'POST', url: '/app/help/ask', headers: FORM, payload: 'q=How%20do%20I%20start%3F&from=/app/inbox' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain(esc(t('en', 'help.g.setup.1')));
    expect(spent).toEqual([{ llmCalls: 2, inputTokens: 30, outputTokens: 3, cachedInputTokens: 0 }]);
  });

  it('Write to us: the notice lists exactly what the mail carries — one list, HELP_MAIL_FIELDS', () => {
    const html = renderHelp('en', { from: '/app/inbox', role: 'owner', canAsk: true, canWrite: true });
    const notice = [...html.match(/<ul class="help-sends">([\s\S]*?)<\/ul>/)![1]!.matchAll(/<li[^>]*>([^<]*)<\/li>/g)].map((m) => m[1]);
    expect(notice).toEqual(HELP_MAIL_FIELDS.map((f) => t('en', helpNoticeKey(f))));
    for (const role of ['owner', 'staff'] as const) {
      const req = { words: 'Where do I add a second number?', page: '/app/settings/channels', workspaceId: BIZ, role };
      const fields = helpMailFields('en', req);
      expect(Object.keys(fields)).toEqual([...HELP_MAIL_FIELDS]);
      const mail = helpMail('en', req);
      const fixed = new Set([t('en', 'help.mail.intro'), t('en', 'help.mail.answer'), '']);
      // Every line of the mail is a field or a fixed line; every field is in it, once.
      expect(mail.text.split('\n').filter((l) => !fixed.has(l))).toEqual(HELP_MAIL_FIELDS.map((f) => fields[f]));
      expect(mail.subject).toBe(t('en', 'help.mail.subject', { id: BIZ }));
      expect(fields.role).toContain(t('en', role === 'owner' ? 'help.role.owner' : 'help.role.staff'));
    }
    // A refused page is said as none.
    expect(helpMailFields('en', { words: 'x', page: null, workspaceId: BIZ, role: 'owner' }).page).toBe(t('en', 'help.mail.page', { page: '—' }));
  });

  it('Write to us: the words, the page and who asked — three an hour', async () => {
    const sent: unknown[] = [];
    const { app, flashes, tick } = mk({ viewer: { businessId: BIZ, personId: 'p-9', role: 'staff' }, write: async (b, w) => { sent.push({ b, ...w }); return 'sent'; } });
    const post = (words: string, from = '/app/products') => app.inject({ method: 'POST', url: '/app/help/write', headers: FORM, payload: new URLSearchParams({ words, from }).toString() });
    for (let i = 0; i < 3; i++) await post(`Where are my products? ${i}`);
    await post('a fourth');
    expect(sent).toEqual([0, 1, 2].map((i) => ({ b: BIZ, words: `Where are my products? ${i}`, page: '/app/products', role: 'staff' })));
    expect(flashes.slice(-1)[0]).toBe('/app/help/page?from=/app/products#write help.write.limit');
    tick(61 * 60 * 1000);
    await post('after an hour');
    expect(sent.length).toBe(4);
    await post('x', '//evil.example');
    expect((sent[4] as { page: unknown }).page).toBeNull();
    expect(flashes.slice(-1)[0]).toBe('/app/help/page#write help.write.sent');
  });

  it('ten a day, whatever the hours', async () => {
    let n = 0;
    const { app, flashes, tick } = mk({ write: async () => { n++; return 'sent'; } });
    for (let i = 0; i < 12; i++) {
      await app.inject({ method: 'POST', url: '/app/help/write', headers: FORM, payload: `words=w${i}` });
      tick(2 * 60 * 60 * 1000);
    }
    expect(n).toBe(10);
    expect(flashes.slice(-1)[0]).toContain('help.write.limit');
  });

  it('an accountant may neither ask nor write; a stranger goes to the door', async () => {
    let wrote = 0;
    const { app, spent } = mk({ viewer: { businessId: BIZ, personId: 'a-1', role: 'accountant' }, write: async () => { wrote++; return 'sent'; } });
    expect((await app.inject({ method: 'POST', url: '/app/help/ask', headers: FORM, payload: 'q=hi' })).statusCode).toBe(302);
    expect((await app.inject({ method: 'POST', url: '/app/help/write', headers: FORM, payload: 'words=hi' })).statusCode).toBe(302);
    expect(wrote).toBe(0); expect(spent).toEqual([]);
    const out = mk({ viewer: null });
    const r = await out.app.inject({ method: 'GET', url: '/app/help/page' });
    expect(r.headers.location).toBe('/login');
  });
});
