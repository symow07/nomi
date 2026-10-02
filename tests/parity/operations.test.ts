import { describe, it, expect } from 'vitest';
import { ATTENTION_PRIORITY, needsOwnerAttention, renderOperationsHome, type OperationsSnapshot } from '../../src/api/web/operations.js';
import { NOTHING_TODAY, type TodayData } from '../../src/api/web/today.js';
import type { ConversationSummary } from '../../src/api/web/inbox.js';
import { ownershipOf, WAITING_HUMAN_AGENT, OWNER_AGENT } from '../../src/core/conversation/ownership.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, tn, ASSISTANT_FALLBACK } from '../../src/core/owner/i18n/messages.js';

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
  ] },
  last24: { answered: 14, sent: 5, handed: 2, yourself: 1 },
  comingUp: [],
  sending: ['instagram', 'messenger'],
};
const live = (s: OperationsSnapshot): OperationsSnapshot => ({ ...s, channel: { status: 'connected', provider: 'meta', live: true } });

/**
 * THE DESIGN PASS (§4) — Today by time: who needs you now, the last 24
 * hours, what is coming up. One heading each; every line a door; figures in
 * sentences through the plural rules, never tiles. The sections it replaced
 * (the counts grid, "How often you stepped in", "What she is learning") are
 * gone on purpose: Results holds the history, Knowledge the teaching.
 */
describe('Today, by time (render)', () => {
  it('who needs you: counted in a sentence, then each person by name — the Buyers row\'s own reason, a door to the newest message', () => {
    const html = renderOperationsHome(live(populated), 'en', busy);
    expect(html).toContain(`<h2 id="today-now">${tn('en', 'nav.needsYou', 7)}</h2>`);
    expect(html).toContain('href="/app/inbox/c-1#latest"');
    expect(html).toContain('<bdi>Maya Rahman</bdi>');
    expect(html).toContain(t('en', 'buyers.badge.review', { name: ASSISTANT_FALLBACK.en }).slice(0, 6));
    expect(html).toContain(t('en', 'takeover.reason.human_requested'));   // the stored reason, never inferred
    // Phase 4 — Buyers' own row: ○ for whoever waits for the owner, ● for one the owner holds.
    expect(html).toMatch(/class="crow is-needs[^"]*"[\s\S]*?<span class="cr-mark" aria-hidden="true">○<\/span>/);
    expect(html).toMatch(/class="crow is-yours[^"]*"[\s\S]*?<span class="cr-mark" aria-hidden="true">●<\/span>/);
    expect(html).toContain(`<span class="sr">${t('en', 'buyers.group.yours')}</span>`);
    // in the list's own order
    expect(html.indexOf('Maya Rahman')).toBeLessThan(html.indexOf('Omar Haddad'));
    // more than it names: one door to all of them, with the count
    expect(html).toContain(`href="/app/inbox?filter=pending">${tn('en', 'today.needs.all', 7)}`);
    // knowledge gaps: a counted sentence and a door
    expect(html).toContain(`href="/app/knowledge">${tn('en', 'today.gaps', 3, { name: ASSISTANT_FALLBACK.en }).slice(0, 2)}`);
    expect(html).not.toContain('class="stat need"');   // no tiles
  });

  it('the last 24 hours: what the assistant did (its ✦) and what you did, each a door; zeros unsaid', () => {
    const html = renderOperationsHome(live(populated), 'en', busy);
    expect(html).toContain(t('en', 'today.last.title'));
    expect(html).toMatch(/<span class="as" aria-hidden="true">✦<\/span> [^<]*14/);
    expect(html).toContain(tn('en', 'today.last.yourself', 1));
    const quiet = renderOperationsHome(live(populated), 'en', { ...busy, last24: { answered: 0, sent: 0, handed: 0, yourself: 0 } });
    expect(quiet).toContain(t('en', 'today.last.none'));
    // CC-05 — the way into Results stays, whatever the day held.
    expect(quiet).toContain('href="/app/analytics"');
  });

  it('coming up: the calendar\'s next things, or the fact that there are none — and a door to the calendar', () => {
    const html = renderOperationsHome(live(emptyFactory), 'en', NOTHING_TODAY(NOW));
    expect(html).toContain(t('en', 'today.coming.none'));
    expect(html).toContain('href="/app/calendar"');
  });

  it('nobody waiting: the fact, stated — no calm-page speech, no grid of zeros', () => {
    const html = renderOperationsHome(live(emptyFactory), 'en', NOTHING_TODAY(NOW));
    expect(html).toContain(`<h2 id="today-now">${t('en', 'today.needs.none')}</h2>`);
    expect(html).not.toContain(t('en', 'ops.activity.title'));
  });

  it('M22 (F-01) · a quiet day with messaging OFF says nobody can reach the assistant, with the way forward', () => {
    const html = renderOperationsHome(emptyFactory, 'en', NOTHING_TODAY(NOW));
    expect(html).toContain(t('en', 'today.calm.notLive.title'));
    expect(html).toContain('href="/app/business"');
    expect(html).toContain('Messaging is not active yet');
    expect(html).toMatch(/class="[^"]*\bnotlive\b[^"]*"/);
  });

  it('sending: the channels customers reach, on — or paused while stopped or silenced', () => {
    const on = renderOperationsHome(live(emptyFactory), 'en', busy);
    expect(on).toContain(`${t('en', 'today.sending')}</span> Instagram <span class="dot ok" aria-hidden="true">✓</span> ${t('en', 'today.sending.on')}`);
    const stopped = renderOperationsHome({ ...live(emptyFactory), assistantStoppedAt: NOW }, 'en', busy);
    expect(stopped).toContain(`<span class="dot warn" aria-hidden="true">○</span> ${t('en', 'today.sending.paused')}`);
    expect(renderOperationsHome(live(emptyFactory), 'en', { ...busy, sending: [] })).not.toContain(t('en', 'today.sending'));
    // A channel connected to an installation that cannot send is not "on":
    // the page says messaging is not active instead (found in the screenshots).
    const off = renderOperationsHome(emptyFactory, 'en', busy);
    expect(off).not.toContain(t('en', 'today.sending'));
    expect(off).toContain('Messaging is not active yet');
  });

  it('the date is today\'s, in the business\'s timezone, beside the title', () => {
    expect(renderOperationsHome(live(emptyFactory), 'en', busy)).toContain('Today <span class="muted today-date">· Tuesday, September 29</span>');
  });

  it('zh + ar render in their own language; the arrows are the shell\'s, mirrored', () => {
    const zh = renderOperationsHome(live(populated), 'zh', busy);
    expect(zh).toContain(tn('zh', 'nav.needsYou', 7));
    expect(zh).toContain(t('zh', 'today.last.title'));
    const ar = renderOperationsHome(live(populated), 'ar', busy);
    expect(ar).toContain(t('ar', 'today.coming.title'));
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
