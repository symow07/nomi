import { describe, it, expect } from 'vitest';
import { messages, t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { BANNED_OWNER_TERMS } from '../../src/core/owner/vocabulary.js';
import { renderOperationsHome, type OperationsSnapshot } from '../../src/api/web/operations.js';
import type { TodayData } from '../../src/api/web/today.js';
import { renderConversationDetail, needsWhy, type ConversationDetail } from '../../src/api/web/inbox.js';
import { renderOwnerAlert, operatorSubjectKey, OPERATOR_ALERT_KINDS, goesByMail } from '../../src/pipeline/notify.js';
import { heartbeatTick } from '../../src/worker/heartbeat.js';
import { withAssistantName } from '../../src/api/web/say.js';
import { SIGNAL_SAMPLES, PROBLEM_SIGNAL_KINDS, TRIGGER_REASONS, toTriggerReason, computeScores } from '../../src/core/scoring/signals.js';

/**
 * BILLING RESILIENCE (2026-10-04) — what the owner and the operator read when
 * the model provider refuses for billing, in all five languages:
 *
 *   · Today and the conversation page say it plainly while it lasts: replies
 *     wait because Nomi's OWN service account ran out of credit, nothing was
 *     sent, Nomi's team has been told, nothing to pay — and say nothing once
 *     it answers again;
 *   · a conversation handed over for it carries the reason on its card and in
 *     the Inbox, after the provider answers again too;
 *   · the operator's alerts name the provider, its own words, the escalation
 *     and the figures; the owner's pages never show a figure or the words.
 */

const NAME = 'Lily';
const NOW = new Date('2026-10-04T08:00:00Z');

const snapshot = (refusing: boolean): OperationsSnapshot => ({
  range: 'today',
  attention: { pendingApprovals: 0, handoffs: 1, ownerHandling: 0, blockedMessages: 0, deletionAsks: 0, ordersWaiting: 0 },
  hasAttention: true,
  activity: { handled: 0, draftsCreated: 0, corrections: 0 },
  knowledge: { openGaps: 0, recentCorrections: 0, recentlyTaught: 0 },
  channel: { provider: 'meta', status: 'connected', live: true },
  budget: null,
  ...(refusing ? { providerRefusing: true } : {}),
});
const today = (): TodayData => ({
  now: NOW,
  needs: { total: 0, rows: [] },
  handled: { total: 0, people: [] },
  tally: { orders: 0, quotes: 0, afterHours: 0 },
  sending: ['instagram'],
});

const detail = (o: Partial<ConversationDetail>): ConversationDetail => ({
  conversationId: 'c1', buyer: 'Ahmed', country: 'AE', status: 'awaiting',
  product: { name: null, nameZh: null }, quantity: null, quote: null, order: null,
  messages: [{ direction: 'inbound', text: 'Do you have it in blue?', at: NOW }],
  pendingDraft: null, ownership: 'WAITING_HUMAN', refusals: [], uncertainSends: [], handoffReasons: [], unheardReason: null,
  lastHumanAction: null, knowledgeUsed: [], rate: null, leadTimeBlocked: null, sampleAsked: null, proof: { quoteId: null, token: null },
  assistantName: NAME,
  ...o,
} as ConversationDetail);

const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, '’').replace(/\s+/g, ' ');
const has = (html: string, s: string): boolean => text(html).includes(s.replace(/\s+/g, ' '));
const say = (l: Locale, k: MessageKey, p?: Record<string, string | number>) => t(l, k, p);

const OWNER_KEYS: readonly MessageKey[] = [
  'takeover.reason.provider_billing', 'providerBilling.title', 'providerBilling.what', 'providerBilling.why', 'providerBilling.do',
  'today.providerBilling.title', 'today.providerBilling.body', 'conv.providerBilling',
];
const OPERATOR_KEYS = (Object.keys(messages.en) as MessageKey[])
  .filter((k) => /^notify\.provider_(refusing|answering|balance)/.test(k));

/** Whole-word for Latin terms, substring for CJK — the M1 rule's own matcher. */
const containsBanned = (s: string, banned: string): boolean => {
  const needle = banned.toLowerCase();
  const lower = s.toLowerCase();
  return /^[a-z ]+$/.test(needle) ? new RegExp(`\\b${needle}\\b`).test(lower) : lower.includes(needle);
};

describe('the words exist in five languages, and are the owner’s words', () => {
  it('every key, every language, translated (not the English left in place)', () => {
    expect(OPERATOR_KEYS.length).toBe(15);
    for (const k of [...OWNER_KEYS, ...OPERATOR_KEYS]) {
      for (const l of LOCALES) {
        expect(messages[l][k], `${l} ${k}`).toBeTruthy();
        if (l !== 'en') expect(messages[l][k], `${l} ${k} is the English`).not.toBe(messages.en[k]);
      }
    }
  });

  it('no software talk: not "AI", not "model", not "API", not "credits API"', () => {
    for (const k of [...OWNER_KEYS, ...OPERATOR_KEYS]) {
      for (const l of LOCALES) {
        for (const banned of [...BANNED_OWNER_TERMS, 'credits api']) {
          expect(containsBanned(messages[l][k], banned), `"${banned}" in ${l} ${k}`).toBe(false);
        }
      }
    }
  });

  it('it is Nomi’s account, not the owner’s: every language says Nomi, and that nothing is to be paid', () => {
    for (const l of LOCALES) {
      for (const k of ['today.providerBilling.body', 'providerBilling.why', 'conv.providerBilling'] as const) {
        expect(messages[l][k], `${l} ${k}`).toContain('Nomi');
      }
    }
  });
});

describe('Today says it while it lasts, and not after', () => {
  for (const l of LOCALES) {
    it(`${l}: refusing — the plain sentence, the door to who waits; answering — nothing`, () => {
      const on = withAssistantName(NAME, () => renderOperationsHome(snapshot(true), l, today()));
      expect(on).toContain('id="provider-billing"');
      expect(has(on, say(l, 'today.providerBilling.title', { name: NAME }))).toBe(true);
      expect(has(on, say(l, 'today.providerBilling.body', { name: NAME }))).toBe(true);
      expect(on).toContain('/app/inbox?filter=pending');
      const off = withAssistantName(NAME, () => renderOperationsHome(snapshot(false), l, today()));
      expect(off).not.toContain('provider-billing');
      expect(text(off)).not.toContain(text(say(l, 'today.providerBilling.body', { name: NAME })).trim().slice(0, 30));
    });
  }

  it('while refusing, Today never says the assistant is taking care of things', () => {
    const calm = { ...today(), needs: { total: 0, rows: [] } };
    const quiet = { ...snapshot(false), hasAttention: false, attention: { ...snapshot(false).attention, handoffs: 0 } };
    // The control: the same calm day, answering, says the assistant is taking care of things…
    expect(renderOperationsHome(quiet, 'en', calm)).toContain('tw-calm-line');
    // …and refusing, it does not.
    expect(renderOperationsHome({ ...quiet, providerRefusing: true }, 'en', calm)).not.toContain('tw-calm-line');
  });
});

describe('the conversation page', () => {
  for (const l of LOCALES) {
    it(`${l}: handed over for it — the card says what, why and what to do, and stays after it answers again`, () => {
      for (const refusing of [true, false]) {
        const html = withAssistantName(NAME, () => renderConversationDetail(detail({ handoffReasons: ['provider_billing'], providerRefusing: refusing }), l, NOW, null));
        expect(html).toContain('id="provider-billing"');
        expect((html.match(/id="provider-billing"/g) ?? []).length).toBe(1);   // the card, not the card and the note
        expect(text(html)).toContain(text(say(l, 'providerBilling.title')).trim());
        expect(text(html)).toContain(text(say(l, 'providerBilling.what', { name: NAME })).trim());
        expect(text(html)).toContain(text(say(l, 'providerBilling.why')).trim());
        expect(text(html)).toContain(text(say(l, 'providerBilling.do')).trim());
        // …and the take-over card names the reason, as the Inbox does.
        expect(text(html)).toContain(text(say(l, 'takeover.reason.provider_billing')).trim());
      }
    });

    it(`${l}: a conversation it has not touched says it in one line while it lasts, and nothing after`, () => {
      const on = withAssistantName(NAME, () => renderConversationDetail(detail({ ownership: 'AI', providerRefusing: true }), l, NOW, null));
      expect(on).toContain('id="provider-billing"');
      expect(text(on)).toContain(text(say(l, 'conv.providerBilling', { name: NAME })).trim());
      const off = withAssistantName(NAME, () => renderConversationDetail(detail({ ownership: 'AI' }), l, NOW, null));
      expect(off).not.toContain('provider-billing');
    });
  }
});

describe('the Inbox’s reason', () => {
  for (const l of LOCALES) {
    it(`${l}: a customer handed over for it is waiting for "${messages[l]['takeover.reason.provider_billing']}"`, () => {
      expect(needsWhy(l, {
        orderWaiting: false, deletionWaiting: false, ownership: 'WAITING_HUMAN', handoffReason: 'provider_billing',
        awaitingReview: false, answeredBy: null,
      })).toBe(messages[l]['takeover.reason.provider_billing']);
    });
  }
});

describe('the reason is a hand-off reason like the others', () => {
  it('a problem signal that hands off on its own, with its own trigger reason', () => {
    expect(PROBLEM_SIGNAL_KINDS).toContain('provider_billing');
    expect(TRIGGER_REASONS).toContain('provider_billing');
    expect(toTriggerReason(SIGNAL_SAMPLES.provider_billing)).toBe('provider_billing');
    expect(computeScores([SIGNAL_SAMPLES.provider_billing]).problem).toBe(100);
  });
});

describe('the operator’s alerts', () => {
  const since = new Date('2026-10-01T20:10:00Z');
  const refusal = (step: number) => ({ providerRefusal: { provider: 'DeepSeek', since, step, words: 'Insufficient Balance' }, zone: 'UTC' });

  it('are operator alerts: by e-mail always, never depending on WhatsApp', () => {
    for (const k of ['provider_refusing', 'provider_answering', 'provider_balance'] as const) {
      expect(OPERATOR_ALERT_KINDS).toContain(k);
      expect(goesByMail(k)).toBe(true);
    }
  });

  for (const l of LOCALES) {
    it(`${l}: the first refusal names the provider, when, its own words, and what to do`, () => {
      const s = renderOwnerAlert(l, 'provider_refusing', null, refusal(0));
      expect(s).toContain('DeepSeek');
      expect(s).toContain('Insufficient Balance');
      expect(s).not.toContain('{');
      expect(s).toContain(say(l, 'notify.provider_refusing.how'));
    });
    it(`${l}: a later step says it is still refusing, and for how long`, () => {
      const s = renderOwnerAlert(l, 'provider_refusing', null, refusal(2));
      expect(s.split('\n')[0]).not.toBe(renderOwnerAlert(l, 'provider_refusing', null, refusal(0)).split('\n')[0]);
      expect(s).not.toContain('{');
    });
    it(`${l}: the end names both times`, () => {
      const s = renderOwnerAlert(l, 'provider_answering', null, {
        providerRefusal: { provider: 'DeepSeek', since, step: 0, words: '', until: new Date('2026-10-01T23:28:00Z') }, zone: 'UTC',
      });
      expect(s).toContain('DeepSeek');
      expect(s).toMatch(/20:10/);
      expect(s).toMatch(/23:28/);
      expect(s).not.toContain('{');
    });
    it(`${l}: each balance step has its own sentence, with the figures`, () => {
      const heads = new Set<string>();
      for (const step of ['floor', 'days3', 'days1', 'unavailable']) {
        const s = renderOwnerAlert(l, 'provider_balance', null, {
          providerBalance: { provider: 'DeepSeek', step, currency: 'CNY', total: 7.21, floor: 10, daysLeft: 2.5, available: step !== 'unavailable' },
        });
        expect(s, `${l} ${step}`).toMatch(/7[.,]21/);     // each language writes its own decimal mark
        expect(s).not.toContain('{');
        heads.add(s.split('\n')[0]!);
      }
      expect(heads.size).toBe(4);
    });
  }

  it('the subject escalates: still refusing after the first; urgent when the balance no longer pays', () => {
    expect(operatorSubjectKey({ kind: 'provider_refusing', providerRefusal: { provider: 'x', since: '', step: 0, words: '' } })).toBe('notify.provider_refusing.subject');
    expect(operatorSubjectKey({ kind: 'provider_refusing', providerRefusal: { provider: 'x', since: '', step: 1, words: '' } })).toBe('notify.provider_refusing.subject.still');
    expect(operatorSubjectKey({ kind: 'provider_balance', providerBalance: { provider: 'x', step: 'unavailable', currency: 'CNY', total: 0, floor: null, daysLeft: null, available: false } }))
      .toBe('notify.provider_balance.subject.unavailable');
    expect(operatorSubjectKey({ kind: 'provider_balance', providerBalance: { provider: 'x', step: 'floor', currency: 'CNY', total: 1, floor: 10, daysLeft: null, available: true } }))
      .toBe('notify.provider_balance.subject');
    expect(operatorSubjectKey({ kind: 'backup_stale' })).toBe('notify.backup_stale.subject');
  });

  it('no owner page carries the provider’s words or a figure', () => {
    for (const l of LOCALES) {
      for (const k of OWNER_KEYS) {
        expect(messages[l][k]).not.toMatch(/\{(words|balance|floor|days|provider)\}/);
      }
    }
  });
});

describe('the heartbeat notices too', () => {
  it('while the provider refuses for billing, the check is pinged at /fail, and the log says why', async () => {
    const gets: string[] = [];
    const logs: string[] = [];
    const out = await heartbeatTick({
      url: 'https://hc-ping.com/1f2e3d4c-0000-4000-8000-000000000000',
      probeDb: async () => true, probeHttp: async () => true, probeModel: async () => false,
      fetch: async (url) => { gets.push(url); return { ok: true, status: 200 }; },
      log: (line) => logs.push(line),
    });
    expect(out).toBe('unhealthy');
    expect(gets).toEqual(['https://hc-ping.com/1f2e3d4c-0000-4000-8000-000000000000/fail']);
    expect(logs.join('\n')).toContain('the model provider refuses for billing');
  });
});
