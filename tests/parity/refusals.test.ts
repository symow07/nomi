import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { REFUSAL_REASONS, type Refusal } from '../../src/api/web/refusals.js';
import { gateOutbound, GATE_REFUSALS, type GateRefusal } from '../../src/core/channel/sendGate.js';
import type { SendPlan } from '../../src/core/channel/window.js';
import { renderConversationDetail, renderInboxList, type ConversationDetail, type InboxList } from '../../src/api/web/inbox.js';
import { renderOperationsHome, ATTENTION_PRIORITY, type OperationsSnapshot } from '../../src/api/web/operations.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';

/**
 * M22 — a refusal is not a failure of the employee. A SILENT refusal is a
 * failure of the product.
 *
 * Every one of these existed and worked before this milestone: the gate
 * refused, the row was canceled, the reason was written down. What is on trial
 * here is whether the owner is ever TOLD — and whether what she is told is
 * true, complete, and actionable in her own language.
 */

const NOW = new Date('2026-08-05T10:00:00Z');

/**
 * `indexOf` returns -1 for a missing marker and `slice(-1)` is a one-character
 * string that contains nothing — which has quietly turned real assertions into
 * decoration twice in this repo. Every slice-by-marker here goes through this.
 */
function at(haystack: string, marker: string): number {
  const i = haystack.indexOf(marker);
  expect(i, `marker not present: ${marker}`).toBeGreaterThan(-1);
  return i;
}
const between = (h: string, a: string, b: string): string => h.slice(at(h, a), at(h, b));

const refusal = (reason: Refusal['reason'], over: Partial<Refusal> = {}): Refusal => ({
  outboundId: 'o-1', conversationId: 'c-1', buyer: 'Ahmed',
  reason, at: new Date('2026-08-05T08:00:00Z'), origin: 'employee', ...over,
});

const detail = (refusals: readonly Refusal[]): ConversationDetail => ({
  conversationId: 'c-1', buyer: 'Ahmed', country: 'AE', status: 'awaiting',
  product: { name: 'Canvas tote', nameZh: null }, quantity: 5000, quote: null, order: null,
  messages: [{ direction: 'inbound', text: 'what is your price?', at: NOW }],
  pendingDraft: null, ownership: 'AI', refusals, handoffReasons: [], unheardReason: null,
  lastHumanAction: null, knowledgeUsed: [], rate: null, leadTimeBlocked: null, sampleAsked: null, proof: { quoteId: null, token: null },
});

const snapshot = (blockedMessages: number): OperationsSnapshot => ({
  range: 'today',
  attention: { pendingApprovals: 0, handoffs: 0, ownerHandling: 0, blockedMessages },
  activity: { handled: 0, draftsCreated: 0, corrections: 0 },
  knowledge: { openGaps: 0, recentCorrections: 0, recentlyTaught: 0 },
  channel: { status: 'connected', provider: 'meta' },
  hasAttention: blockedMessages > 0,
});

// ── coverage: every refusal the gate can produce is explainable ──────────────

describe('M22 · every refusal the gate can produce reaches the owner', () => {
  /**
   * The gate's own list, READ rather than restated. This used to be a second
   * copy of the union that had to be edited in step with it; M34.6 made the
   * gate export `GATE_REFUSALS` and derive its type from it, so this test now
   * checks coverage instead of checking that someone updated two lists.
   */
  const GATE_REASONS: readonly GateRefusal[] = GATE_REFUSALS;

  it('the refusal vocabulary IS the gate’s, plus the two the send path adds', () => {
    /**
     * M42 — this assertion is now nearly tautological, and saying so is the
     * point. `REFUSAL_REASONS` used to be a hand-written copy of the gate's
     * list and this test existed to catch the drift; it caught it twice. The
     * list is now spread from `GATE_REFUSALS`, so there is nothing left to
     * drift, and what remains here is the narrower claim that the surface adds
     * exactly two reasons and no third crept in unexplained:
     *
     *   window_needs_owner  allowed only via a template, and none is approved
     *   media_unsupported   an image row on a connection that cannot carry one
     *
     * Neither is a second gate: both are the send path reporting that it could
     * not carry out a decision the gate already made. The test that still has
     * teeth is the coverage one below — every reason needs owner copy.
     */
    for (const r of GATE_REASONS) expect(REFUSAL_REASONS, r).toContain(r);
    expect(REFUSAL_REASONS.filter((r) => !(GATE_REASONS as readonly string[]).includes(r)))
      .toEqual(['window_needs_owner', 'media_unsupported']);
  });

  it('each one answers what happened, why, and what to do — in all three locales', () => {
    for (const locale of LOCALES) {
      for (const reason of REFUSAL_REASONS) {
        for (const part of ['what', 'why', 'do'] as const) {
          const s = t(locale, `refused.${part}.${reason}` as MessageKey, { name: 'Lily' });
          expect(s.length, `${locale}/${part}/${reason} is empty`).toBeGreaterThan(4);
          expect(s, `${locale}/${part}/${reason} left a placeholder`).not.toContain('{');
        }
      }
    }
  });

  it('the three sentences are actually different — not one sentence repeated', () => {
    for (const reason of REFUSAL_REASONS) {
      const [what, why, todo] = (['what', 'why', 'do'] as const)
        .map((p) => t('en', `refused.${p}.${reason}` as MessageKey, { name: 'Lily' }));
      expect(new Set([what, why, todo]).size, reason).toBe(3);
    }
  });

  it('every "what can I do" names an action, never just restates the problem', () => {
    // A refusal the owner cannot act on is a complaint. Each of these must
    // contain a verb she can carry out today.
    const ACTIONABLE = /reply|message|add|start|leave|hand|wait|clears|tomorrow|yourself|ready|done|send/i;
    for (const reason of REFUSAL_REASONS) {
      const todo = t('en', `refused.do.${reason}` as MessageKey, { name: 'Lily' });
      expect(ACTIONABLE.test(todo), `${reason}: "${todo}"`).toBe(true);
    }
  });
});

// ── the thing this milestone exists to prevent ───────────────────────────────

describe('M22 · a refusal can never render as a success', () => {
  it('no refusal sentence claims the message was sent', () => {
    // A sentence may MENTION sending — "nothing was sent" is the honest form.
    // What it may never do is assert delivery, so the negation is what is
    // checked, not the verb.
    const CLAIMS = [/\bwas sent\b/i, /\bwere sent\b/i, /\bdelivered\b/i,
                    /\breceived it\b/i, /on its way/i, /waiting to send/i];
    const NEGATED = /\bnot\b|\bnothing\b|\bno longer\b|\bnever\b|\bdid not\b|\bstopped\b/i;
    for (const reason of REFUSAL_REASONS) {
      for (const part of ['what', 'why', 'do'] as const) {
        const s = t('en', `refused.${part}.${reason}` as MessageKey, { name: 'Lily' });
        for (const claim of CLAIMS)
          expect(claim.test(s) && !NEGATED.test(s), `${reason}/${part}: "${s}"`).toBe(false);
      }
    }
  });

  it('the conversation shows the refusal, never a tick', () => {
    const html = renderConversationDetail(detail([refusal('window_closed')]), 'en', NOW, null);
    expect(html).toContain('WhatsApp no longer allows a reply to this buyer.');
    const card = between(html, 'card refused', 'takeover');
    expect(card).not.toContain('✓');
    expect(card).not.toContain('class="ok"');
  });

  it('a conversation with nothing refused shows no panel at all', () => {
    const html = renderConversationDetail(detail([]), 'en', NOW, null);
    expect(html).not.toContain('card refused');
    expect(html).not.toContain(t('en', 'refused.title'));
  });

  it('carries no score, rating or percentage', () => {
    const html = renderConversationDetail(detail(REFUSAL_REASONS.map((r) => refusal(r))), 'en', NOW, null);
    const card = between(html, 'card refused', 'takeover');
    expect(card).not.toMatch(/\d+\s?%/);
    for (const word of ['score', 'rating', 'grade', 'health', 'success rate'])
      expect(card.toLowerCase(), word).not.toContain(word);
  });
});

// ── Today ────────────────────────────────────────────────────────────────────

describe('M22 · Today reports it, with a real count', () => {
  it('leads the attention list — the owner has no other way to find it', () => {
    expect(ATTENTION_PRIORITY[0]).toBe('blockedMessages');
  });

  it('shows the count and links to the conversations it happened in', () => {
    const html = renderOperationsHome(snapshot(3), 'en');
    expect(html).toContain('>3<');
    expect(html).toContain('Did not reach the buyer');
    expect(html).toContain('href="/app/inbox?filter=blocked"');
  });

  it('zero refusals is silence, not a green tick about sending', () => {
    const html = renderOperationsHome(snapshot(0), 'en');
    expect(html).not.toContain('Did not reach the buyer');
    expect(html).not.toContain('href="/app/inbox?filter=blocked"');
  });

  it('a blocked message alone is enough to break "all clear"', () => {
    // Today used to say "you are all caught up" while a buyer waited on a reply
    // that was never sent. One refusal must be enough to contradict that.
    // M35.5 — the calm state is now one sentence rather than a heading plus a
    // body, so the assertion moved from the heading to the sentence. The RULE is
    // unchanged: one refusal must be enough to contradict "all is well".
    const calm = t('en', 'today.calm.body', { name: 'Lily' });
    expect(renderOperationsHome(snapshot(1), 'en')).not.toContain(calm);
    expect(renderOperationsHome(snapshot(0), 'en')).toContain(calm);
  });
});

// ── the inbox tab ────────────────────────────────────────────────────────────

const list = (over: Partial<InboxList> = {}): InboxList =>
  ({ filter: 'all', waitingCount: 0, blockedCount: 0, conversations: [], ...over });

describe('M22 · the blocked filter appears only when it has something to say', () => {
  it('is absent when nothing was refused', () => {
    expect(renderInboxList(list(), 'en', NOW)).not.toContain('filter=blocked');
  });

  it('appears with its count once something was', () => {
    const html = renderInboxList(list({ blockedCount: 2 }), 'en', NOW);
    expect(html).toContain('filter=blocked');
    expect(html).toContain('Did not send (2)');
  });

  it('stays visible when the owner is standing on it, even at zero', () => {
    // Arriving from Today's link and finding no tab would read as a broken link.
    expect(renderInboxList(list({ filter: 'blocked' }), 'en', NOW)).toContain('filter=blocked');
  });

  it('its empty state states the fact, and is not an achievement', () => {
    const html = renderInboxList(list({ filter: 'blocked' }), 'en', NOW);
    expect(html).toContain(t('en', 'refused.none'));
    expect(html).not.toContain('✓');
  });

  it('reads in every locale without falling back to English', () => {
    for (const l of LOCALES) {
      const html = renderInboxList(list({ filter: 'blocked', blockedCount: 1 }), l as Locale, NOW);
      expect(html).toContain('filter=blocked');
      if (l !== 'en') expect(html).not.toContain('Did not send');
    }
  });
});

// ── the boundary this milestone must not cross ───────────────────────────────

/**
 * The three real SendPlan values. These were `{ action: 'send_free_form' } as
 * never` — a value the type does not have, which the cast hid: `gateOutbound`
 * falls through on anything it does not recognise, so the assertions passed
 * while testing a state that cannot occur.
 */
const OPEN: SendPlan = { action: 'send_free', ownerNoteZh: '可以直接回复' };
const CLOSED: SendPlan = { action: 'wait_for_buyer', ownerNoteZh: '暂时不能主动发送，客户回复后即可继续' };
const TEMPLATE: SendPlan = { action: 'send_template', ownerNoteZh: '需要使用已批准的消息，需要你确认后再联系' };

describe('M22 · gateOutbound remains the only authority', () => {
  it('the refusal read model makes no decision — it has no gate to call', async () => {
    const src = await readFile(new URL('../../src/api/web/refusals.ts', import.meta.url), 'utf8');
    // Comments NAME the gate on purpose — they explain why this defers to it.
    // What must be absent is an import of it or a call to it.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const forbidden of ['gateOutbound', 'sendGate', 'windowState', 'sendPlan', 'adapter', 'enqueueOutbound'])
      expect(code.includes(forbidden), `refusals.ts reaches ${forbidden}`).toBe(false);
    // It reads. It does not write.
    for (const write of ['insert into', 'update ', 'delete from'])
      expect(code.toLowerCase().includes(write), `refusals.ts writes: ${write}`).toBe(false);
  });

  it('exactly one module decides whether a message may be sent', async () => {
    const { readdir } = await import('node:fs/promises');
    const roots = ['src/api/web', 'src/outbound', 'src/db', 'src/channels'];
    const callers: string[] = [];
    for (const dir of roots) {
      const base = new URL(`../../${dir}/`, import.meta.url);
      for (const f of (await readdir(base)).filter((x) => x.endsWith('.ts'))) {
        const src = await readFile(new URL(f, base), 'utf8');
        if (/\bgateOutbound\s*\(/.test(src)) callers.push(`${dir}/${f}`);
      }
    }
    // The worker, and nothing else. M22 added a reader, not a second gate.
    expect(callers).toEqual(['src/outbound/worker.ts']);
  });

  it('the gate itself is unchanged by this milestone', () => {
    // Its six reasons, its fail-closed defaults, its order. Asserted here so a
    // refusal SURFACE can never quietly become a refusal RULE.
    expect(gateOutbound({ silenced: false, origin: 'employee', assignedTo: null, paused: false,
      windowPlan: OPEN }))
      .toEqual({ allow: false, reason: 'not_activated' });          // activation first
    expect(gateOutbound({ silenced: false, origin: 'employee', assignedTo: null, paused: false, activated: true,
      windowPlan: OPEN }))
      .toEqual({ allow: false, reason: 'not_allowlisted' });        // pilot mode assumed ON
    expect(gateOutbound({ silenced: false, origin: 'employee', assignedTo: 'someone', paused: false, activated: true,
      pilotMode: false, windowPlan: OPEN }))
      .toEqual({ allow: false, reason: 'handed_off' });
    expect(gateOutbound({ silenced: false, origin: 'employee', assignedTo: null, paused: false, activated: true,
      pilotMode: false, windowPlan: CLOSED }))
      .toEqual({ allow: false, reason: 'window_closed' });
    expect(gateOutbound({ silenced: false, origin: 'employee', assignedTo: null, paused: false, activated: true,
      pilotMode: false, windowPlan: TEMPLATE }))
      .toEqual({ allow: true, viaTemplate: true });
  });
});
