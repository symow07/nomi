import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  questionsFor, parseAnswer, linesFor, tickedLines, nextQuestion, figuresIn, hasNoCatalogue,
  CATALOGUE_QUESTIONS, SERVICE_QUESTIONS, ALL_QUESTIONS, type SellingState, type Answer, type Question,
} from '../../src/core/owner/howYouSell.js';
import { renderHub, renderQuestion, renderConfirm, type QuestionView } from '../../src/api/web/howYouSell.js';
import { renderSetup } from '../../src/api/web/settings.js';
import { renderFactory, renderBusinessScreen } from '../../src/api/web/factory.js';
import { SET_UP } from './business-view.js';
import { profileOf } from '../../src/core/owner/sellingStyle.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/api/web/say.js';
import type { MessageKey } from '../../src/core/owner/i18n/messages.js';

/**
 * HS (0096) — "How you sell", pure: which questions a business is asked, how
 * an answer is read, and the lines it would write — drawn only for what would
 * change, each its own tick, a word-for-word answer with its figures and
 * promises named. The writes and the turn that answers from them are proved
 * over Postgres in tests/integration/how-you-sell.test.ts.
 */

const STATE: SellingState = {
  quantityFirst: false,
  products: [{ id: 'p1', name: 'Rose lip oil', moq: null }, { id: 'p2', name: 'Silk scrunchie', moq: 2 }],
  allowed: new Set(['guarantee:refund']),
  terms: null, workingHours: null, closures: [], words: new Set(['cheap']), told: {},
};
const SHOP = { profile: profileOf('brand'), pricesToOwner: false };
const MAKER = { profile: profileOf('manufacturer'), pricesToOwner: false };
const AGENCY = { profile: profileOf('agency'), pricesToOwner: false };
const answer = (q: Question, body: Record<string, unknown>, ctx = SHOP): Answer => {
  const r = parseAnswer(q, body, ctx);
  if (!r.ok) throw new Error(`${q}: ${JSON.stringify(r.errors)}`);
  return r.answer;
};

describe('HS · who is asked what', () => {
  it('a business with a catalogue: price, minimum, returns, delivery, payment, certifications, hours, words', () => {
    expect(questionsFor(SHOP.profile, false)).toEqual(CATALOGUE_QUESTIONS);
    expect(questionsFor(MAKER.profile, false)).toEqual(CATALOGUE_QUESTIONS);
  });
  it('no catalogue — services, an agency, or prices that go to the owner: what, where, how long, payment, next step, hours, words', () => {
    expect(questionsFor(AGENCY.profile, false)).toEqual(SERVICE_QUESTIONS);
    expect(questionsFor(SHOP.profile, true)).toEqual(SERVICE_QUESTIONS);
    expect(hasNoCatalogue(SHOP.profile, false)).toBe(false);
    expect(SERVICE_QUESTIONS).not.toContain('minimum');
    expect(SERVICE_QUESTIONS).not.toContain('certifications');
    expect(SERVICE_QUESTIONS).not.toContain('delivery');
  });
  it('the migration\'s list is the code\'s list', () => {
    // CK (0110) redefined the list with 'product_claims'; 0096 is never edited.
    const sql = readFileSync(new URL('../../migrations/0110_category_claims.sql', import.meta.url), 'utf8');
    for (const q of ALL_QUESTIONS) expect(sql).toContain(`'${q}'`);
  });
  it('the next question skips what is done, and wraps to one left behind', () => {
    expect(nextQuestion(CATALOGUE_QUESTIONS, 'price', new Set(['price']))).toBe('minimum');
    expect(nextQuestion(CATALOGUE_QUESTIONS, 'words', new Set(['words', 'hours']))).toBe('price');
    expect(nextQuestion(CATALOGUE_QUESTIONS, 'words', new Set(CATALOGUE_QUESTIONS))).toBeNull();
  });
});

describe('HS · answers read, and refused whole', () => {
  it('every field\'s problem at once', () => {
    expect(parseAnswer('minimum', { mode: 'same', qty: '0' }, SHOP)).toEqual({ ok: false, errors: { qty: 'qty' } });
    expect(parseAnswer('payment', { told: '' }, SHOP)).toEqual({ ok: false, errors: { told: 'required' } });
    // A maker states trade terms: the delivery term from the guard's own list.
    expect(parseAnswer('payment', { payment: '30% deposit', incoterm: 'XYZ' }, MAKER)).toEqual({ ok: false, errors: { incoterm: 'incoterm_invalid' } });
    expect(parseAnswer('hours', { 'closure0.label': 'Eid', 'closure0.from': '2027-03-23', 'closure0.to': '2027-03-20' }, SHOP))
      .toEqual({ ok: false, errors: { closure0: 'ends_before_starts' } });
    expect(parseAnswer('words', { terms: '' }, SHOP)).toEqual({ ok: false, errors: { terms: 'required' } });
    expect(parseAnswer('offered', { told: 'x'.repeat(1001) }, AGENCY)).toEqual({ ok: false, errors: { told: 'too_long' } });
  });
  it('words: one per line, the same word once', () => {
    expect(answer('words', { terms: 'cheap\nCheap\n  knock-off \n' })).toEqual({ q: 'words', terms: ['cheap', 'knock-off'] });
  });
});

describe('HS · the lines: only what would change, each its own tick', () => {
  it('price first already in force: nothing to change', () => {
    expect(linesFor(answer('price', { quantityFirst: 'no' }), STATE)).toEqual([]);
    expect(linesFor(answer('price', { quantityFirst: 'yes' }), STATE)).toEqual([{ key: 'quantity_first', kind: 'quantity_first', to: true }]);
  });
  it('the same minimum for everything: one line per product it would change', () => {
    const lines = linesFor(answer('minimum', { mode: 'same', qty: '2' }), STATE);
    expect(lines).toEqual([{ key: 'minimum:p1', kind: 'minimum', productId: 'p1', product: 'Rose lip oil', from: null, to: 2 }]);
    expect(linesFor(answer('minimum', { mode: 'depends' }), STATE)).toEqual([]);
    expect(linesFor(answer('minimum', { mode: 'none' }), STATE).map((l) => l.key)).toEqual(['minimum:p2']);
  });
  it('returns: a switch line for each promise that changes, and the answer customers get word for word', () => {
    const lines = linesFor(answer('returns', { 'offer:returns': 'on', 'offer:refund': 'on', told: 'Free returns within 14 days, and a full refund.' }), STATE);
    expect(lines.map((l) => l.key)).toEqual(['promise:returns', 'told:returns']);
    const told = lines.find((l) => l.kind === 'told')!;
    expect(told).toMatchObject({ figures: ['14'], promises: [{ claim: 'refund', allowed: true }, { claim: 'returns', allowed: true }] });
  });
  it('a promise in the words she has not allowed is named: that answer is not sent until she does', () => {
    const lines = linesFor(answer('delivery', { told: 'Free shipping on every order, 3–5 days.' }), STATE);
    const told = lines.find((l) => l.kind === 'told')!;
    expect(told).toMatchObject({ figures: ['3', '5'], promises: [{ claim: 'free_shipping', allowed: false }] });
  });
  it('the same answer again changes nothing', () => {
    const said = 'Card or cash on delivery.';
    expect(linesFor(answer('payment', { told: said }), { ...STATE, told: { payment: said } })).toEqual([]);
  });
  it('a word already forbidden is not added twice; a closure already saved is not saved twice', () => {
    expect(linesFor(answer('words', { terms: 'Cheap\nfake' }), STATE).map((l) => l.key)).toEqual(['word:fake']);
    const closures = [{ label: 'Eid', from: '2027-03-20', to: '2027-03-23' }];
    expect(linesFor(answer('hours', { 'closure0.label': 'Eid', 'closure0.from': '2027-03-20', 'closure0.to': '2027-03-23' }), { ...STATE, closures })).toEqual([]);
  });
  it('certifications: only the switches that change', () => {
    expect(linesFor(answer('certifications', { 'cert:CE': 'on' }, MAKER), STATE).map((l) => l.key)).toEqual(['cert:CE']);
  });
  it('only ticked lines are taken, and a key the lines do not hold is ignored', () => {
    const lines = linesFor(answer('words', { terms: 'fake\nknock-off' }), STATE);
    expect(tickedLines(lines, { 'line:word:fake': 'on', 'line:word:invented': 'on' }).map((l) => l.key)).toEqual(['word:fake']);
  });
  it('figures as written', () => {
    expect(figuresIn('Ships in 2 days; $5 under 50.')).toEqual(['2', '5', '50']);
  });
});

describe('HS · the pages, in every language', () => {
  const view = (q: Question, over: Partial<QuestionView> = {}): QuestionView => ({
    facts: { kind: 'brand', profile: profileOf('brand'), pricesToOwner: false, zone: 'Asia/Dubai' },
    order: CATALOGUE_QUESTIONS, progress: {}, q, state: STATE, ...over,
  });
  for (const locale of LOCALES) {
    const l = locale as Locale;
    it(`${l} · the hub, every question and the confirm page: no raw keys, the right forms`, () => {
      const hub = renderHub({ facts: view('price').facts, order: CATALOGUE_QUESTIONS, progress: {} }, l, null);
      expect(hub, l).not.toMatch(/\bhs\.[a-zA-Z_.]+/);
      // Phase 7 — opened from My business › How you sell, a menu of the same name:
      // the page is named for what it holds, and leads back to that menu.
      expect(hub, l).toContain(`<div class="dhead"><a class="back" href="/app/business/how-you-sell"><span class="go" aria-hidden="true">‹</span>${t(l, 'factory.sellhow.title')}</a></div>`);
      expect(hub, l).toContain(`<h1 class="page">${t(l, 'hs.questions.title')}</h1>`);
      for (const q of CATALOGUE_QUESTIONS) expect(hub, `${l} ${q}`).toContain(`href="/app/business/selling/${q}"`);
      for (const q of [...CATALOGUE_QUESTIONS, ...SERVICE_QUESTIONS]) {
        const html = renderQuestion(view(q, q === 'offered' || q === 'area' || q === 'duration' || q === 'next_step'
          ? { order: SERVICE_QUESTIONS, facts: { kind: 'agency', profile: 'services', pricesToOwner: false, zone: 'UTC' } } : {}), l, null);
        expect(html, `${l} ${q}`).not.toMatch(/\b(hs|selling|claim)\.[a-zA-Z_.]+/);
        expect(html, `${l} ${q}`).toContain(`action="/app/business/selling/${q}"`);
        expect(html, `${l} ${q}`).toContain(`action="/app/business/selling/${q}/skip"`);
      }
      const draft = answer('returns', { 'offer:returns': 'on', told: 'Free returns within 14 days.' });
      const confirm = renderConfirm(view('returns', { progress: { returns: { state: 'draft', answer: draft } } }), l, null)!;
      expect(confirm, l).not.toMatch(/\b(hs|claim)\.[a-zA-Z_.]+/);
      expect(confirm, l).toContain('name="line:promise:returns"');
      expect(confirm, l).toContain('name="line:told:returns"');
      expect(confirm, l).not.toMatch(/name="line:[^"]+" checked/);   // nothing ticked for her
      expect(confirm, l).toContain('Free returns within 14 days.');
    });
  }
  it('a confirm page with no draft is no page; with nothing to change it says so', () => {
    expect(renderConfirm(view('price'), 'en', null)).toBeNull();
    const same = renderConfirm(view('price', { progress: { price: { state: 'draft', answer: { q: 'price', quantityFirst: false } } } }), 'en', null)!;
    expect(same).toContain('Nothing to change');
  });
  it('a maker\'s payment question is trade terms; a shop\'s is words', () => {
    const maker = renderQuestion(view('payment', { facts: { kind: 'manufacturer', profile: 'bulk', pricesToOwner: false, zone: 'UTC' } }), 'en', null);
    expect(maker).toContain('name="incoterm"');
    expect(renderQuestion(view('payment'), 'en', null)).toContain('name="told"');
  });
  it('Phase 9 · the maker\'s delivery terms are the terms page\'s: each with what it means, no DDU for a new workspace', () => {
    for (const l of LOCALES) {
      const maker = renderQuestion(view('payment', { facts: { kind: 'manufacturer', profile: 'bulk', pricesToOwner: false, zone: 'UTC' } }), l, null);
      expect(maker, l).toContain(`>FOB — ${t(l, 'terms.incoterm.FOB' as MessageKey)}</option>`);
      expect(maker, l).not.toContain('value="DDU"');
    }
  });
  it('phase 7 · My business › How you sell shows the owner the door and where she is; staff do not see it; Setup does not hold it', () => {
    const owner = renderBusinessScreen('how', SET_UP, 'en');
    expect(owner).toContain('href="/app/business/selling"');
    expect(owner).toContain('3 of 8 answered');
    expect(renderFactory(SET_UP, 'en')).toContain('3 of 8 answered');      // the menu's row says it too
    expect(renderBusinessScreen('how', { ...SET_UP, menu: { ...SET_UP.menu!, howYouSell: null } }, 'en', null, { isOwner: false }))
      .not.toContain('href="/app/business/selling"');
    expect(renderSetup({ people: 1 }, 'en', null)).not.toContain('href="/app/business/selling"');
  });
  it('every route is the owner\'s (rule 11)', () => {
    const app = readFileSync(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    // Phase 9 — the hub draws its own tab title ("How you sell"), so it calls the same gate directly.
    expect(app).toMatch(/app\.get\(HS_BASE, async \(req, reply\) => \{\s*const s = await ownerOnly\(req, reply, 'price_rules'/);
    for (const route of ['`${HS_BASE}/:q`', '`${HS_BASE}/:q/confirm`', '`${HS_BASE}/:q/skip`']) {
      const at = app.indexOf(`app.post(${route}`);
      expect(at, route).toBeGreaterThan(0);
      expect(app.slice(at, at + 300), route).toMatch(/ownerOnly\(req, reply, 'price_rules'/);
    }
  });
});

/* ── Phase 9 · B5 — the hub and a question, as the re-audit read them ───── */

describe('Phase 9 · B5 · How you sell', () => {
  const css = readFileSync(new URL('../../src/api/web/layout.ts', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
  const MAKER_FACTS = { kind: 'manufacturer' as const, profile: profileOf('manufacturer'), pricesToOwner: false, zone: 'UTC' };
  // The page isolates each figure in Arabic; the words are compared without the marks.
  const bare = (html: string) => html.replace(/[\u2066-\u2069]/g, '');
  const hub = (l: Locale, progress: QuestionView['progress'] = {}) =>
    bare(renderHub({ facts: MAKER_FACTS, order: CATALOGUE_QUESTIONS, progress }, l, null));
  const q = (l: Locale, over: Partial<QuestionView> = {}) => bare(renderQuestion({
    facts: MAKER_FACTS, order: CATALOGUE_QUESTIONS, progress: {}, q: 'price', state: { ...STATE, quantityFirst: true }, ...over }, l, null));

  it('V1-405 · V1-410 · w4-business-assistant-22 · menu rows: each says where it stands, in plain words; answered in the done colour; a count says how far', () => {
    for (const l of LOCALES) {
      const html = hub(l);
      expect(html, l).toContain(bare(t(l, 'hs.count', { done: '0', total: '9' })));
      // every question is a row with its door and its state — never the waiting colour for a setting
      expect(html.match(/<a class="srow sr-menu" href="\/app\/business\/selling\/[a-z_]+">/g), l).toHaveLength(9);
      expect(html.split(`<span class="sr-value"><bdi>${t(l, 'hs.state.open')}</bdi></span>`).length - 1, l).toBe(9);
      expect(html, l).not.toContain('sr-value warn');
      const some = hub(l, { price: { state: 'answered', answer: { q: 'price', quantityFirst: true } } });
      expect(some, l).toContain(`<span class="sr-value ok"><bdi>${t(l, 'hs.state.answered')}</bdi></span>`);
    }
  });

  it('V1-406 · the tab says the page’s own name', () => {
    expect(app).toMatch(/title: t\(locale, 'hs\.title'\), active: 'factory', bodyHtml: v \? renderHub/);
  });

  it('V1-407 · every row is a question', () => {
    for (const l of LOCALES) for (const k of CATALOGUE_QUESTIONS.filter((x) => x !== 'price')) {
      expect(t(l, `hs.q.${k}` as MessageKey), `${l} ${k}`).toMatch(/[?？؟]$/);
    }
  });

  it('V1-408 · the same facts go by the same name: words to avoid are the words the assistant must never use', () => {
    expect(t('en', 'hs.q.words')).toContain('must your assistant never use');
    expect(t('en', 'forbidden.title')).toBe('Words your assistant must never use');
  });

  it('V1-409 · the way in is the page’s one filled button and names the question it opens', () => {
    for (const l of LOCALES) {
      const html = hub(l);
      expect(html.split('class="btn send"').length - 1, l).toBe(1);
      expect(html, l).toContain(`<form method="get" action="/app/business/selling/price" class="hs-start"><button class="btn send" type="submit">${bare(t(l, 'hs.start', { i: '1', n: '9' }))}</button></form>`);
    }
  });

  it('V1-411 · missed-06 · the rows are the menu card; the back link is at the top, as on a question', () => {
    expect(hub('en')).toContain('<div class="sgroup"><ul class="scard">');
    for (const l of LOCALES) {
      const html = hub(l);
      expect(html.indexOf('class="back"'), l).toBeLessThan(html.indexOf('<h1'));
    }
  });

  it('V1-412 · an unanswered question starts with nothing chosen, and says what is in force', () => {
    for (const l of LOCALES) {
      const html = q(l);
      expect(html, l).not.toMatch(/name="quantityFirst" value="(yes|no)" checked/);
      expect(html, l).toContain(t(l, 'hs.price.now.yes'));
      expect(html, l).toContain('name="quantityFirst" value="yes" required');
      // answered, it keeps what she chose
      const answered = q(l, { progress: { price: { state: 'answered', answer: { q: 'price', quantityFirst: true } } } });
      expect(answered, l).toMatch(/name="quantityFirst" value="yes" checked/);
    }
    expect(renderQuestion({ facts: MAKER_FACTS, order: CATALOGUE_QUESTIONS, progress: {}, q: 'minimum',
      state: { ...STATE, products: [{ id: 'p1', name: 'Tote', moq: null }] } as SellingState }, 'en', null)).not.toMatch(/name="mode" value="[a-z]+" checked/);
  });

  it('V1-413 · Next and Later sit in one row; Later needs no choice', () => {
    for (const l of LOCALES) {
      const html = q(l);
      expect(html, l).toContain(`<div class="acts hs-acts"><button class="btn send" type="submit">${t(l, 'hs.next')}</button>`);
      expect(html, l).toContain('formaction="/app/business/selling/price/skip" formnovalidate');
    }
  });

  it('V1-414 · missed-08 · the lede is a sentence that adds something; the Arabic question reads naturally', () => {
    for (const l of LOCALES) expect(t(l, 'hs.lede.price'), l).not.toBe(t(l, 'selling.quantityFirst.q'));
    expect(t('en', 'hs.lede.price')).toMatch(/^Choose /);
    expect(t('ar', 'selling.quantityFirst.q')).not.toContain('هل يُسأل عن الكمية أولًا في ردود');
  });

  it('V1-415 · the page says where it is in the list', () => {
    for (const l of LOCALES) expect(q(l), l).toContain(`<p class="muted hs-pos">${bare(t(l, 'hs.position', { i: '1', n: '9' }))}</p>`);
  });

  it('the Arabic questions write no detached «لـ» before the name', () => {
    for (const k of ['hs.offers', 'hs.lede.returns', 'hs.line.promise.on', 'hs.line.cert.on', 'hs.line.attr.on', 'hs.line.attr.off', 'hs.line.promiseNotAllowed'] as const) {
      expect(t('ar', k), k).not.toMatch(/لـ ?(مساعدك|:)/);
    }
  });

  // The identity system (2026-10-04) — a checked control is the brand, the product's own colour, never the browser's blue.
  it('V1-416 · a chosen radio is in the product’s own colour', () => {
    expect(css).toMatch(/input\[type="radio"\], input\[type="checkbox"\] \{ accent-color:var\(--color-brand\); \}/);
  });

  it('missed-07 · no dash leads the usual choice; lines are balanced so no character is left alone', () => {
    for (const k of ['selling.usual.retail', 'selling.usual.bulk', 'selling.usual.services'] as const) {
      for (const l of LOCALES) expect(t(l, k), `${l} ${k}`).not.toMatch(/^[—–-]/);
    }
    expect(q('zh')).toContain('class="muted small hs-usual"');
    expect(css).toMatch(/\.hs-usual \{ display:block; \}/);
    expect(css).toMatch(/\.hs-choices \.pcheck span, \.hs-hint \{ text-wrap:pretty; \}/);
  });
});
