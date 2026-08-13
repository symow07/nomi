import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  asksForSample, sampleAnswerContext, validateSamplePolicy, type SamplePolicy,
} from '../../src/core/commerce/samples.js';
import { usd } from '../../src/core/types/money.js';
import { guardNumerals } from '../../src/core/safety/numerals.js';
import { renderSamples, type SamplesView } from '../../src/api/web/settings.js';
import { renderConversationDetail, type ConversationDetail } from '../../src/api/web/inbox.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { emptyState } from './fixtures.js';

/**
 * M45 — "Can you send a sample?"
 *
 * The second question in nearly every Yiwu conversation, and until now the
 * product had no answer at all. That does not mean a language model has none:
 * asked with nothing behind it, it answers anyway. "Samples are free, we just
 * charge the courier" is plausible, helpful, invented, and expensive every
 * time a buyer holds her to it.
 *
 * So the facts are hers — what a sample costs and whether it comes off the
 * first order — and the enforcement is the one already here: the numerals a
 * reply may contain come from rows she wrote, so a price she has not stated
 * cannot be said. There is no default sample policy anywhere in this codebase.
 */

const stated = new Date('2026-08-01T00:00:00Z');
const policy = (over: Partial<SamplePolicy> = {}): SamplePolicy =>
  ({ price: usd(30), creditedOnFirstOrder: true, statedAt: stated, ...over });

describe('M45 · she states it, or nothing is said', () => {
  it('a stated policy produces the sentence AND the numeral that may appear in it', () => {
    const c = sampleAnswerContext(policy());
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.note).toContain('30');
    expect(c.note).toContain('comes off the first order');
    expect(c.allow).toEqual([30]);
  });

  it('UNSTATED REFUSES — there is no default policy to fall back on', () => {
    const c = sampleAnswerContext(null);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.error.kind).toBe('no_sample_policy');
  });

  it('THE ENFORCEMENT: an unstated price cannot survive the numeral guard', () => {
    // This is why the milestone needs no guard of its own. The allow-set grows
    // only from `sampleAnswerContext`, and it refuses when she has said nothing.
    const reply = 'Yes — a sample costs $30 and comes off your first order.';
    const state = emptyState();
    const withPolicy = sampleAnswerContext(policy());
    const without = sampleAnswerContext(null);

    expect(guardNumerals({
      reply, quote: null, state, clientText: '',
      allow: withPolicy.ok ? [...withPolicy.allow] : [],
    }).ok).toBe(true);

    expect(guardNumerals({
      reply, quote: null, state, clientText: '',
      allow: without.ok ? [...without.allow] : [],
    }).ok).toBe(false);
  });

  it('FREE is an answer; unstated is not the same thing', () => {
    const free = sampleAnswerContext(policy({ price: usd(0) }));
    expect(free.ok).toBe(true);
    if (!free.ok) return;
    expect(free.note).toBe('Samples are free.');
    // Nothing to allow: "0" in a reply is never a price a buyer needs to read,
    // and allowing it would widen the guard for nothing.
    expect(free.allow).toEqual([]);
  });

  it('credited and not-credited are different promises', () => {
    const yes = sampleAnswerContext(policy({ creditedOnFirstOrder: true }));
    const no = sampleAnswerContext(policy({ creditedOnFirstOrder: false }));
    if (!yes.ok || !no.ok) throw new Error('unreachable');
    expect(yes.note).toContain('comes off the first order');
    expect(no.note).not.toContain('comes off');
  });
});

describe('M45 · what she typed', () => {
  it('accepts a price, and accepts zero', () => {
    for (const [raw, amount] of [['30', 30], ['0', 0], ['2.50', 2.5]] as const) {
      const r = validateSamplePolicy({ price: raw, creditedOnFirstOrder: false, currency: 'USD', now: stated });
      expect(r.ok, raw).toBe(true);
      if (r.ok) expect(r.value.price.amount).toBe(amount);
    }
  });

  it('refuses blank, non-numeric and negative', () => {
    for (const [raw, code] of [['', 'price_missing'], ['  ', 'price_missing'],
      ['free', 'not_a_number'], ['-5', 'negative']] as const) {
      const r = validateSamplePolicy({ price: raw, creditedOnFirstOrder: false, currency: 'USD', now: stated });
      expect(r.ok, raw).toBe(false);
      if (!r.ok) expect(r.error, raw).toBe(code);
    }
  });

  it('holds no opinion about what a sample should cost', () => {
    // A $200 sample of a machined part is ordinary. A ceiling here would be
    // this module knowing something about her goods that it does not know.
    expect(validateSamplePolicy({ price: '200', creditedOnFirstOrder: false, currency: 'USD', now: stated }).ok)
      .toBe(true);
  });
});

describe('M45 · the request is detected deterministically', () => {
  it('catches the question in the three languages a buyer writes in', () => {
    for (const text of [
      'Can you send a sample first?', 'Do you have samples?', 'need a swatch',
      '可以先寄个样品吗', '打样多少钱', '样板有吗',
      'هل يمكن إرسال عينة؟', 'نريد عينات',
    ]) expect(asksForSample(text), text).toBe(true);
  });

  it('and does not fire on an ordinary message', () => {
    for (const text of ['Price for 5000 pcs?', '20000个多少钱', 'ما سعر 5000 قطعة؟']) {
      expect(asksForSample(text), text).toBe(false);
    }
  });

  it('it is NOT a model decision, and the code says why', async () => {
    // A model deciding this would make requests appear and disappear between
    // two identical messages — and this is what puts a row in her inbox.
    const src = await readFile(new URL('../../src/core/commerce/samples.ts', import.meta.url), 'utf8');
    expect(src).toContain('DETERMINISTIC, and deliberately so');
    expect(src).not.toMatch(/analyzer|replyWriter|client\.messages/);
  });
});

describe('M45 · the production path', () => {
  it('the turn asks HER policy and lets the guard do the rest', async () => {
    const turn = await readFile(new URL('../../src/pipeline/turn.ts', import.meta.url), 'utf8');
    expect(turn).toContain('const sampleRequested = asksForSample(req.text);');
    expect(turn).toContain('sampleAnswerContext(await tenant.catalog.samplePolicy())');
    expect(turn).toMatch(/numeralAllow = \[[\s\S]{0,200}sampleCtx\?\.ok \? sampleCtx\.allow : \[\]/);
  });

  it('the REQUEST is recorded whatever the reply turned out to be', async () => {
    // Whether Nomi could answer depends on the owner. That a buyer ASKED is a
    // fact about the buyer, and she needs to see it either way.
    const turn = await readFile(new URL('../../src/pipeline/turn.ts', import.meta.url), 'utf8');
    expect(turn).toMatch(/if \(r\.sampleRequested\) \{\s*\n\s*await tenant\.samples\.record\(/);
  });

  it('the model is given the sentence only when there is one', async () => {
    const llm = await readFile(new URL('../../src/llm/anthropic.ts', import.meta.url), 'utf8');
    expect(llm).toContain("...(sampleNote ? { sample_policy: sampleNote } : {})");
  });

  it('and NOTHING in the product carries a default sample policy', async () => {
    const { execSync } = await import('node:child_process');
    const hits = execSync(
      'grep -rniE "samples are (usually|normally|typically) free|default sample|free sample" src || true',
      { cwd: new URL('../../', import.meta.url).pathname, encoding: 'utf8' },
    ).split('\n').filter((l) => l.trim() !== '');
    expect(hits, `a sample policy we invented:\n${hits.join('\n')}`).toEqual([]);
  });
});

describe('M45 · the owner surfaces', () => {
  const view = (over: Partial<SamplesView> = {}): SamplesView => ({
    policy: policy(),
    waiting: [{
      id: 'r1', conversationId: 'c1', buyer: 'Ahmed',
      askedText: 'Can you send a sample first?', requestedAt: stated, address: null,
    }],
    ...over,
  });
  const now = new Date('2026-08-02T00:00:00Z');

  it('shows what she stated, and who is waiting', () => {
    const html = renderSamples(view(), 'en', null, now);
    expect(html).toContain('Ahmed');
    expect(html).toContain('Can you send a sample first?');
    expect(html).toContain('/app/settings/samples/r1/address');
    expect(html).toContain('/app/settings/samples/r1/handled');
    // and a way into the conversation it came from
    expect(html).toContain('/app/inbox/c1');
  });

  it('the ADDRESS box is hers to fill — nothing pre-fills it from the message', () => {
    const html = renderSamples(view(), 'en', null, now);
    const box = html.slice(html.indexOf('name="address"'));
    expect(box.slice(0, 200)).not.toContain('Can you send a sample first?');
  });

  it('both empty states say what happens, and name the next action', () => {
    for (const locale of LOCALES) {
      const html = renderSamples({ policy: null, waiting: [] }, locale, null, now);
      const visible = html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
      expect(visible, locale).toContain(t(locale, 'samples.empty'));
      expect(visible, locale).toContain(t(locale, 'samples.requests.empty'));
      expect(visible, locale).toContain(t(locale, 'samples.save'));
    }
  });

  it('free reads as FREE, not as a zero', () => {
    const html = renderSamples(view({ policy: policy({ price: usd(0) }) }), 'en', null, now);
    expect(html).toContain(t('en', 'samples.current.free'));
    expect(html).not.toContain('$0.00');
  });

  it('the CONVERSATION says a sample was asked for, and why she said nothing', () => {
    const unstated = renderConversationDetail(detail({ policyStated: false }), 'en', now, null);
    expect(unstated).toContain(t('en', 'samples.asked.title'));
    expect(unstated).toContain('/app/settings/samples');

    const known = renderConversationDetail(detail({ policyStated: true }), 'en', now, null);
    expect(known).toContain(t('en', 'samples.asked.title'));
    // Nothing to fix, so nothing is asked of her.
    expect(known).not.toContain(t('en', 'samples.asked.action'));

    const never = renderConversationDetail(detail(null), 'en', now, null);
    expect(never).not.toContain(t('en', 'samples.asked.title'));
  });

  it('is reachable from settings, and registered as routes', async () => {
    const settings = await readFile(new URL('../../src/api/web/settings.ts', import.meta.url), 'utf8');
    expect(settings).toContain("deeper('/app/settings/samples'");
    const app = await readFile(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    for (const r of ["app.get('/app/settings/samples'", "app.post('/app/settings/samples'",
      "app.post('/app/settings/samples/:id/address'", "app.post('/app/settings/samples/:id/handled'"]) {
      expect(app, r).toContain(r);
    }
  });

  it('every string exists in all three locales', () => {
    const KEYS: MessageKey[] = [
      'samples.title', 'samples.intro', 'samples.current.free', 'samples.current.paid',
      'samples.current.credited', 'samples.current.notCredited', 'samples.setOn',
      'samples.empty', 'samples.price.label', 'samples.credited.label', 'samples.save',
      'samples.flash.saved', 'samples.flash.price_missing', 'samples.flash.not_a_number',
      'samples.flash.negative', 'samples.flash.failed', 'samples.requests.title',
      'samples.requests.empty', 'samples.requests.asked', 'samples.requests.address.label',
      'samples.requests.address.placeholder', 'samples.requests.address.save',
      'samples.requests.handled', 'samples.requests.open', 'samples.asked.title',
      'samples.asked.unstated', 'samples.asked.action', 'samples.flash.address', 'samples.flash.done',
    ];
    for (const locale of LOCALES) {
      for (const k of KEYS) {
        const s = t(locale, k, { price: '$30', date: '1 Aug', when: 'Today 09:00' });
        expect(s.length, `${locale} ${k}`).toBeGreaterThan(1);
        expect(s, `${locale} ${k}`).not.toContain('{');
      }
    }
  });
});

function detail(sampleAsked: { policyStated: boolean } | null): ConversationDetail {
  return {
    conversationId: 'c1', buyer: 'Ahmed', country: 'AE', status: 'awaiting',
    product: { name: 'Vacuum cup', nameZh: '保温杯' }, quantity: 5000,
    quote: null, order: null,
    messages: [{ direction: 'inbound', text: 'Can you send a sample?', at: stated }],
    pendingDraft: null, ownership: 'AI', refusals: [], handoffReasons: [],
    unheardReason: null, lastHumanAction: null, knowledgeUsed: [], rate: null,
    leadTimeBlocked: null, sampleAsked,
    proof: { quoteId: null, token: null },
  };
}
