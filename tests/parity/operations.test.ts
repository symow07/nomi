import { describe, it, expect } from 'vitest';
import { ATTENTION_PRIORITY, needsOwnerAttention, renderOperationsHome, type OperationsSnapshot } from '../../src/api/web/operations.js';
import { NOTHING_TODAY, type TodayData } from '../../src/api/web/today.js';
import type { ConversationSummary } from '../../src/api/web/inbox.js';
import { ownershipOf, WAITING_HUMAN_AGENT, OWNER_AGENT } from '../../src/core/conversation/ownership.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, tn, ASSISTANT_FALLBACK } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';

/**
 * M16.2a — the Operations snapshot is a neutral, honest shape. These pure tests
 * pin down that it invents nothing (no scores/percentages/confidence/rankings)
 * and that the ownership mapping the read model relies on is the M16.1 one.
 */

const sample = (): OperationsSnapshot => ({
  range: 'week',
  attention: { pendingApprovals: 2, handoffs: 1, ownerHandling: 1, blockedMessages: 0 },
  activity: { handled: 5, draftsCreated: 4, corrections: 1 },
  knowledge: { openGaps: 3, recentCorrections: 1, recentlyTaught: 2 },
  channel: { status: 'not_connected', provider: 'disabled' }, budget: null,
  hasAttention: true,
});

describe('M16.2a · operations snapshot (pure)', () => {
  it('is a neutral shape — exactly the expected sections, all plain integers', () => {
    const s = sample();
    // G19 — `budget` joined them: her own ceiling, or null until she nears it.
    expect(Object.keys(s).sort()).toEqual(['activity', 'attention', 'budget', 'channel', 'hasAttention', 'knowledge', 'range']);
    for (const grp of [s.attention, s.activity, s.knowledge]) {
      for (const v of Object.values(grp)) expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('invents no metric — no score / percentage / confidence / ranking anywhere', () => {
    const blob = JSON.stringify(sample()).toLowerCase();
    for (const banned of ['score', 'percent', '%', 'confidence', 'rank', 'rating', 'weight']) {
      expect(blob.includes(banned), banned).toBe(false);
    }
  });

  it('attention priority is explicit and ordered — no urgency scoring', () => {
    // M22: a message that never reached a buyer comes first — it is the only
    // concern here the owner has no other way to find. A handoff at least sits
    // visibly in the inbox; a refused reply left a buyer waiting on nothing.
    // 0076: then a buyer who asked for their data to be deleted and is waiting
    // for the owner's decision — a request she answers to, which handing the
    // conversation back does not clear; above every ordinary hand-off.
    // Then a buyer waiting for a person, replies to review, the threads she
    // took over herself, and knowledge gaps.
    // 0080: and before all of them, an order a customer said yes to: nothing
    // is confirmed or sent until the owner decides it.
    expect(ATTENTION_PRIORITY).toEqual(
      ['ordersWaiting', 'blockedMessages', 'deletionAsks', 'handoffs', 'pendingApprovals', 'ownerHandling', 'openGaps']);
    expect(ATTENTION_PRIORITY).not.toContain('activity');
  });

  it('a conversation the owner took over is attention, not background', () => {
    // Today used to render "you're all caught up · Lily is looking after your
    // buyers" while the owner personally owed a buyer a reply.
    const s: OperationsSnapshot = { ...emptyFactory,
      attention: { pendingApprovals: 0, handoffs: 0, ownerHandling: 1, blockedMessages: 0 }, hasAttention: true };
    expect(needsOwnerAttention(s)).toBe(true);
  });

  it('calm means calm: nothing waiting, nothing drafted, nothing of the owner’s own', () => {
    expect(needsOwnerAttention(emptyFactory)).toBe(false);
  });

  it('ownership mapping is the M16.1 one (handoffs vs owner-handling)', () => {
    expect(ownershipOf(WAITING_HUMAN_AGENT)).toBe('WAITING_HUMAN');   // → handoffs
    expect(ownershipOf(OWNER_AGENT)).toBe('OWNER_CONTROLLED');        // → ownerHandling
    expect(ownershipOf(null)).toBe('AI');                            // → neither
    expect(ownershipOf('agent-9')).toBe('OWNER_CONTROLLED');         // any human id counts as handling
  });
});

/**
 * M16.2b — the Operations Home renderer. Consumes ONLY the snapshot (the read
 * model is the boundary). Counts only: no urgency score, no percentage, no
 * ranking, no interpretation. Localized (en/zh/ar); RTL is the shell's job.
 */

const populated: OperationsSnapshot = {
  range: 'today',
  attention: { pendingApprovals: 2, handoffs: 1, ownerHandling: 1, blockedMessages: 0 },
  activity: { handled: 5, draftsCreated: 4, corrections: 1 },
  knowledge: { openGaps: 3, recentCorrections: 1, recentlyTaught: 2 },
  channel: { status: 'not_connected', provider: 'disabled' }, budget: null,
  hasAttention: true,
};
const emptyFactory: OperationsSnapshot = {
  range: 'today',
  attention: { pendingApprovals: 0, handoffs: 0, ownerHandling: 0, blockedMessages: 0 },
  activity: { handled: 0, draftsCreated: 0, corrections: 0 },
  knowledge: { openGaps: 0, recentCorrections: 0, recentlyTaught: 0 },
  channel: { status: 'not_connected', provider: 'disabled' }, budget: null,
  hasAttention: false,
};

const NOW = new Date('2026-09-29T08:00:00Z');
const person = (o: Partial<ConversationSummary> & { conversationId: string; buyer: string }): ConversationSummary => ({
  country: null, status: 'awaiting', needsAction: true, ownership: 'AI', heldBy: null, awaitingReview: false,
  handoffReason: null, latestMessage: null, latestAt: new Date('2026-09-29T07:48:00Z'),
  product: { name: null, nameZh: null }, quantity: null, unitPrice: null, ...o,
});
const busy: TodayData = {
  now: NOW,
  needs: { total: 7, rows: [
    person({ conversationId: 'c-1', buyer: 'Maya Rahman', awaitingReview: true }),
    person({ conversationId: 'c-2', buyer: 'Omar Haddad', ownership: 'WAITING_HUMAN', handoffReason: 'human_requested' }),
    person({ conversationId: 'c-3', buyer: 'Li Wei', ownership: 'OWNER_CONTROLLED', heldBy: 'owner' }),
  ], faces: {
    'c-1': { clientId: '11111111-1111-4111-8111-111111111111', name: 'Maya Rahman', photo: null },
    'c-2': { clientId: '22222222-2222-4222-8222-222222222222', name: 'Omar Haddad', photo: 'abc123' },
    'c-3': { clientId: '33333333-3333-4333-8333-333333333333', name: 'Li Wei', photo: null },
  } },
  handled: { total: 14, people: [
    { conversationId: 'h-1', clientId: '44444444-4444-4444-8444-444444444444', name: 'Ana Souza', photo: null, word: 'confirmed' },
    { conversationId: 'h-2', clientId: '55555555-5555-4555-8555-555555555555', name: 'Chen Li', photo: null, word: 'answered' },
  ] },
  tally: { orders: 1, quotes: 3, afterHours: 2 },
  sending: ['instagram', 'messenger'],
};
const live = (s: OperationsSnapshot): OperationsSnapshot => ({ ...s, channel: { status: 'connected', provider: 'meta', live: true } });

/**
 * THE WARMTH RUN, phase 2 (2026-10-03) — Today in three zones: who waits for
 * you, what the assistant handled, the day's three figures. The design pass's
 * "by time" blocks are replaced on purpose: "The last 24 hours" became the
 * hero (what the assistant did, by face) and the three figures; "Coming up"
 * left Today — the calendar has its own place in the nav. The full structure,
 * in five languages and at 0, 2 and 200 customers, is `warmth-today.test.ts`;
 * what stays here is what this page has always had to say.
 */
describe('Today, in three zones (render)', () => {
  it('who waits: counted in the band\'s heading with ○, then each person by face and name — the Inbox\'s own reason, a door to the newest message', () => {
    const html = renderOperationsHome(live(populated), 'en', busy);
    // The owner's words: "N waiting for you", in the waiting signal's colour with its shape (was nav.needsYou).
    expect(html).toContain(`<h2 id="today-now" class="tw-head"><span class="tw-need"><span class="dot warn" aria-hidden="true">○</span> ${tn('en', 'today.waiting', 7)}</span></h2>`);
    expect(html).toContain('href="/app/inbox/c-1#latest"');
    expect(html).toContain('<bdi>Maya Rahman</bdi>');
    expect(html).toContain(t('en', 'buyers.badge.reviewShort'));
    expect(html).toContain(t('en', 'takeover.reason.human_requested'));   // the stored reason, never inferred
    // The warmth run — each face opens the customer's card (was: the Inbox's row mark ○/●).
    expect(html).toContain('href="/app/customers/11111111-1111-4111-8111-111111111111" data-card aria-label="Maya Rahman"');
    // A conversation the owner holds says so in words.
    expect(html).toContain(`<span class="tw-why"><bdi>${t('en', 'buyers.group.yours')}</bdi></span>`);
    // in the list's own order
    expect(html.indexOf('Maya Rahman')).toBeLessThan(html.indexOf('Omar Haddad'));
    // more than it names: one door to all of them, with the count
    expect(html).toContain(`href="/app/inbox?filter=pending">${tn('en', 'today.needs.all', 7)}`);
    // knowledge gaps: a counted sentence and a door
    expect(html).toContain(`href="/app/knowledge">${tn('en', 'today.gaps', 3, { name: ASSISTANT_FALLBACK.en }).slice(0, 2)}`);
    expect(html).not.toContain('class="stat need"');   // no tiles
  });

  it('what the assistant handled: the headline in its name, a face and a word each; the door to Results stays (CC-05)', () => {
    const html = renderOperationsHome(live(populated), 'en', busy);
    expect(html).toContain(tn('en', 'today.handled.title', 14));
    expect(html).toContain(`<span class="td-word">${t('en', 'today.word.confirmed')}</span>`);
    expect(html).toContain('href="/app/customers/44444444-4444-4444-8444-444444444444" data-card');
    const quiet = renderOperationsHome(live(populated), 'en', { ...busy, handled: { total: 0, people: [] } });
    expect(quiet).toContain(t('en', 'today.handled.none'));
    expect(quiet).not.toContain('class="td-row"');
    // CC-05 — the way into Results stays, whatever the day held.
    expect(quiet).toContain('href="/app/analytics"');
  });

  it('coming up has left Today: the calendar is its own place in the nav', () => {
    const html = renderOperationsHome(live(emptyFactory), 'en', NOTHING_TODAY(NOW));
    expect(html).not.toContain('today-coming');
    expect(html).not.toContain('today-last');
  });

  it('nobody waiting, messaging on: the calm, warm state — the fact stated, no grid of zeros', () => {
    const html = renderOperationsHome(live(emptyFactory), 'en', NOTHING_TODAY(NOW));
    // The owner's words: "you're all caught up", warm (was: "No one is waiting for you." as the heading).
    expect(html).toContain(`<h2 id="today-now" class="tw-head">${t('en', 'today.calm.title')}</h2>`);
    expect(html).toContain(t('en', 'today.needs.none'));
    expect(html).toContain(t('en', 'today.calm.care'));
    expect(html).not.toContain(t('en', 'ops.activity.title'));
  });

  it('M22 (F-01) · a quiet day with messaging OFF says nobody can reach the assistant, with the way forward — and never "all caught up"', () => {
    const html = renderOperationsHome(emptyFactory, 'en', NOTHING_TODAY(NOW));
    expect(html).toContain(t('en', 'today.calm.notLive.title'));
    expect(html).toContain('href="/app/business/ready"');
    expect(html).toContain(t('en', 'ops.system.notLive'));
    expect(html).toMatch(/class="[^"]*\bnotlive\b[^"]*"/);
    expect(html).toContain(`<h2 id="today-now" class="tw-head">${t('en', 'today.needs.none')}</h2>`);
    expect(html).not.toContain(t('en', 'today.calm.title'));
  });

  it('sending: the channels customers reach, on — or paused while stopped or silenced', () => {
    const on = renderOperationsHome(live(emptyFactory), 'en', busy);
    expect(on).toContain(`${t('en', 'today.sending')}</span> Instagram <span class="dot ok" aria-hidden="true">✓</span> ${t('en', 'today.sending.on')}`);
    const stopped = renderOperationsHome({ ...live(emptyFactory), assistantStoppedAt: NOW }, 'en', busy);
    expect(stopped).toContain(`<span class="dot warn" aria-hidden="true">○</span> ${t('en', 'today.sending.paused')}`);
    // Stopped: nothing may say the assistant is looking after anyone.
    expect(renderOperationsHome({ ...live(emptyFactory), assistantStoppedAt: NOW }, 'en', NOTHING_TODAY(NOW))).not.toContain(t('en', 'today.calm.care'));
    expect(renderOperationsHome(live(emptyFactory), 'en', { ...busy, sending: [] })).not.toContain(t('en', 'today.sending'));
    // A channel connected to an installation that cannot send is not "on":
    // the page says messaging is not active instead (found in the screenshots).
    const off = renderOperationsHome(emptyFactory, 'en', busy);
    expect(off).not.toContain(t('en', 'today.sending'));
    expect(off).toContain(t('en', 'ops.system.notLive'));
  });

  it('the date is today\'s, in the business\'s timezone, beside the title', () => {
    expect(renderOperationsHome(live(emptyFactory), 'en', busy)).toContain('Today <span class="muted today-date">· Tuesday, September 29</span>');
  });

  it('zh + ar render in their own language; the arrows are the shell\'s, mirrored', () => {
    const zh = renderOperationsHome(live(populated), 'zh', busy);
    expect(zh).toContain(tn('zh', 'today.waiting', 7));
    expect(zh).toContain(t('zh', 'today.tally.title'));
    const ar = renderOperationsHome(live(populated), 'ar', busy);
    expect(ar).toContain(t('ar', 'today.tally.title'));
    expect(ar).toContain('class="go"');
  });

  it('invents no metric — no score / percentage / ranking in any locale', () => {
    for (const l of LOCALES) {
      const html = (renderOperationsHome(populated, l, busy) + renderOperationsHome(emptyFactory, l, NOTHING_TODAY(NOW))).toLowerCase();
      for (const banned of ['score', 'confidence', 'percent', '%', 'ranking', 'rating', 'rate']) {
        expect(html.includes(banned), `${l}:${banned}`).toBe(false);
      }
    }
  });

  it('M17.4: infrastructure health stays OFF Today', () => {
    for (const l of LOCALES) {
      const html = renderOperationsHome(populated, l, busy);
      expect(html).not.toContain(t(l, 'ops.health.title'));
      const low = html.toLowerCase();
      for (const infra of ['queue', 'worker', 'uptime', 'latency', 'memory', 'cpu']) {
        expect(low.includes(infra), `${l}:"${infra}"`).toBe(false);
      }
    }
  });

  it('never leaks technical / employee-hiding vocabulary — in every locale', () => {
    const LATIN = ['ai', 'llm', 'model', 'token', 'api', 'webhook', 'database', 'confidence', 'automation', 'prompt'];
    const CJK = ['模型', '人工智能', '数据库', '置信度', '接口'];
    for (const l of LOCALES) {
      const html = (renderOperationsHome(populated, l, busy) + renderOperationsHome(emptyFactory, l, NOTHING_TODAY(NOW))).toLowerCase();
      for (const w of LATIN) expect(new RegExp(`\\b${w}\\b`).test(html), `${l}:${w}`).toBe(false);
      for (const w of CJK) expect(html.includes(w), `${l}:${w}`).toBe(false);
    }
  });

  it('mobile-first: no tables, and no breakpoint of its own — the shell holds the one', () => {
    const html = renderOperationsHome(populated, 'en', busy);
    expect(html).not.toContain('<table');
    expect(html).not.toContain('<style');
    expect(html).not.toContain('@media');
  });
});

describe('Phase 9 · Today claims nothing it cannot know (V1-088)', () => {
  // The warmth run — "The last 24 hours" and its "customers who wrote" line
  // are gone with the block. What V1-088 protected still holds: a customer who
  // wrote and waits is the band's, and the hero's quiet line speaks only of the
  // assistant's replies — never "nothing happened".
  it('a customer waiting is named in the band while the hero says only that the assistant has not replied yet, in every locale', () => {
    for (const l of LOCALES) {
      const html = renderOperationsHome(live(populated), l, { ...busy, handled: { total: 0, people: [] } });
      expect(html, l).toContain('<bdi>Maya Rahman</bdi>');
      expect(html, l).toContain(esc(t(l, 'today.handled.none')));
    }
  });
  it('"not live" says only what is true — nothing is sent — never that nothing is received', () => {
    expect(t('en', 'ops.system.notLive')).not.toMatch(/receiv/i);
  });
});
