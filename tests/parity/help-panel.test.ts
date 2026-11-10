import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyRequest } from 'fastify';
import { registerWebApp } from '../../src/api/web/app.js';
import { shell, helpDoor } from '../../src/api/web/layout.js';
import { guideFileAt, hasVideo } from '../../src/api/web/guide.js';
import { GUIDES, KB_SOURCES, helpFor, pageFrom, guideLines, guideTitle, guideDoor, FROM_MAX, type GuideId } from '../../src/api/web/helpTopics.js';
import { renderHelp, helpRoutes, topicsFor, type HelpIO, type HelpViewer } from '../../src/api/web/helpPanel.js';
import { answerHelp, namesAFeature, notYetIn, NOT_YET } from '../../src/advisor/help.js';
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

describe('Block 6.1 · the help question: grounded on the guides, never inventing a feature', () => {
  const usage = { inputTokens: 100, outputTokens: 20 };
  const scripted = (pick: string | null, text: string | null, log: string[] = []): AdvisorModel => ({
    recognise: async ({ entries }) => { log.push(`recognise:${entries.length}`); return { pick: pick ? { id: pick, period: null, customer: null, product: null, reference: null } : null, usage }; },
    phrase: async ({ facts }) => { log.push(`phrase:${facts.length}`); return { text, usage }; },
  });

  it('an answer worded from the guide stands, and both calls are counted', async () => {
    const r = await answerHelp(scripted('practice', 'In Practice you write as a customer and nothing reaches anyone.'), 'How do I test replies?', topicsFor('/app/assistant/practice'), 'en');
    expect(r.answer.kind).toBe('answer');
    expect(r.spent).toEqual({ llmCalls: 2, inputTokens: 200, outputTokens: 40, cachedInputTokens: 0 });
  });

  it('a model that invents a feature is refused: the guide\'s own lines are the answer', async () => {
    for (const invented of [
      'Yes — Nomi posts your products to Shopify every night.',
      'Practice can also send a broadcast to all your customers.',
      'You can connect Zapier from Practice.',
      'In Practice, 75 messages a day are free.',
    ]) {
      const r = await answerHelp(scripted('practice', invented), 'Can Practice do more?', topicsFor('/app/assistant/practice'), 'en');
      expect(r.answer.kind, invented).toBe('guide');
      if (r.answer.kind === 'guide') expect(r.answer.topic.id).toBe('practice');
    }
  });

  it('a question about something Nomi does not do is "not yet", and the model is not asked', async () => {
    for (const q of ['Can Nomi answer my WeChat?', 'Does it reply to SMS?', '能连小红书吗', 'Can the assistant make phone calls to customers?', 'Do you sync with Google Calendar?', 'Can I sell on Amazon with this?']) {
      const log: string[] = [];
      const r = await answerHelp(scripted('setup', 'Yes, of course.', log), q, topicsFor(null), 'en');
      expect(r.answer.kind, q).toBe('notYet');
      expect(log, q).toEqual([]);
      expect(r.spent.llmCalls).toBe(0);
    }
    // Words that merely look like one are not refused.
    for (const q of ['How do I reply to text on WhatsApp?', 'Where is the calendar?', 'Which line of my price list failed?']) expect(notYetIn(q), q).toBeNull();
    expect(NOT_YET.length).toBeGreaterThan(5);
  });

  it('no guide fits: the fixed sentence, never a guess; a model that fails: the fixed failure', async () => {
    expect((await answerHelp(scripted(null, 'x'), 'What is the meaning of life?', topicsFor(null), 'en')).answer.kind).toBe('unknown');
    expect((await answerHelp(scripted('nonsense', 'x'), 'Hm?', topicsFor(null), 'en')).answer.kind).toBe('unknown');
    const broken: AdvisorModel = { recognise: async () => { throw new Error('down'); }, phrase: async () => { throw new Error('down'); } };
    expect((await answerHelp(broken, 'How?', topicsFor(null), 'en')).answer.kind).toBe('failed');
  });

  it('the feature check names what the guide does not', () => {
    expect(namesAFeature('Connect it on WhatsApp.', ['WhatsApp, Instagram and Messenger.'])).toEqual([]);
    expect(namesAFeature('Connect it on Shopify.', ['WhatsApp, Instagram and Messenger.'])).toEqual(['shopify']);
  });

  it('the topics are the page\'s guides first, then every other guide, in English', () => {
    const ts = topicsFor('/app/settings/channels');
    expect(ts.slice(0, 2).map((x) => x.id)).toEqual(['channels', 'whatsapp']);
    expect(ts.length).toBe(Object.keys(GUIDES).length);
    expect(ts[0]!.lines[0]).toBe(t('en', 'help.g.channels.1'));
  });
});

describe('Block 6.1 · the page, by who reads it', () => {
  it('the owner and a team member get the box and Write to us; an accountant reads the guides only', () => {
    for (const role of ['owner', 'staff'] as const) {
      const html = renderHelp('en', { from: '/app/inbox', role, canAsk: true, canWrite: true });
      expect(html).toContain('action="/app/help/ask"');
      expect(html).toContain('action="/app/help/write"');
      expect(html).toContain(t('en', 'help.write.lede'));
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
        phrase: async () => ({ text: 'Getting started lists five steps.', usage: { inputTokens: 20, outputTokens: 2 } }),
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
    expect(r.body).toContain('Getting started lists five steps.');
    expect(spent).toEqual([{ llmCalls: 2, inputTokens: 30, outputTokens: 3, cachedInputTokens: 0 }]);
  });

  it('Write to us: the words, the page, the workspace and the person — three an hour', async () => {
    const sent: unknown[] = [];
    const { app, flashes, tick } = mk({ viewer: { businessId: BIZ, personId: 'p-9', role: 'staff' }, write: async (b, w) => { sent.push({ b, ...w }); return 'sent'; } });
    const post = (words: string, from = '/app/products') => app.inject({ method: 'POST', url: '/app/help/write', headers: FORM, payload: new URLSearchParams({ words, from }).toString() });
    for (let i = 0; i < 3; i++) await post(`Where are my products? ${i}`);
    await post('a fourth');
    expect(sent).toEqual([0, 1, 2].map((i) => ({ b: BIZ, words: `Where are my products? ${i}`, page: '/app/products', personId: 'p-9', role: 'staff' })));
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
