import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { ownershipOf } from '../../core/conversation/ownership.js';
import { loadKnowledgeOps, type Range } from './knowledge-insights.js';
import { loadChannels } from './channels.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { t, EMPLOYEE_NAME, type MessageKey } from '../../core/owner/i18n/messages.js';
import { esc } from './layout.js';

/**
 * M16.2a — the Operations read model. A READ-ONLY composition layer that answers
 * "what needs my attention today?" from data other systems already own. It
 * writes nothing, invents nothing, and duplicates no existing loader:
 *   - knowledge gaps/activity → REUSE loadKnowledgeOps (M14)
 *   - channel status          → REUSE loadChannels (M9.4)
 *   - ownership mapping        → REUSE ownershipOf (M16.1)
 * The remaining numbers are plain COUNT(*) over the real queue tables (drafts,
 * conversations, turns). No scores, no percentages, no confidence, no ranking.
 */

export type { Range } from './knowledge-insights.js';
const RANGE_UNIT: Record<Range, 'day' | 'week' | 'month'> = { today: 'day', week: 'week', month: 'month' };

export type OperationsSnapshot = {
  readonly range: Range;
  /** What needs the owner: a human is waiting, drafts await approval, plus
   *  in-progress takeovers (context, not a demand). */
  readonly attention: {
    readonly pendingApprovals: number;   // drafts awaiting the owner
    readonly handoffs: number;           // conversations WAITING_HUMAN (unclaimed)
    readonly ownerHandling: number;      // conversations the owner already controls
  };
  /** What the employee did in the range. */
  readonly activity: {
    readonly handled: number;            // conversations with a processed turn
    readonly draftsCreated: number;
    readonly corrections: number;        // drafts the owner edited before sending
  };
  /** Knowledge health — straight from M14, not recomputed. */
  readonly knowledge: {
    readonly openGaps: number;
    readonly recentCorrections: number;
    readonly recentlyTaught: number;
  };
  readonly channel: { readonly status: string; readonly provider: string };
  /** True when any attention bucket is non-zero — the "you have work" signal. */
  readonly hasAttention: boolean;
};

/**
 * Explicit priority order for the future UI — NO urgency scoring. Each entry is
 * a concern the owner acts on, most-important first. `ownerHandling` and
 * `activity` are context, not demands, so they are not in this list. A real-time
 * "buyer waiting" concern has no honest source until Meta and is omitted rather
 * than invented.
 */
export const ATTENTION_PRIORITY = ['handoffs', 'pendingApprovals', 'openGaps'] as const;
export type AttentionKind = (typeof ATTENTION_PRIORITY)[number];

const EMPTY = (range: Range, provider: string): OperationsSnapshot => ({
  range,
  attention: { pendingApprovals: 0, handoffs: 0, ownerHandling: 0 },
  activity: { handled: 0, draftsCreated: 0, corrections: 0 },
  knowledge: { openGaps: 0, recentCorrections: 0, recentlyTaught: 0 },
  channel: { status: 'not_connected', provider },
  hasAttention: false,
});

export async function loadOperationsSnapshot(
  db: Db, businessIdRaw: string, range: Range, provider = 'disabled',
): Promise<OperationsSnapshot> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return EMPTY(range, provider);
  const B = bid.value;
  const unit = RANGE_UNIT[range];

  // Compose the existing loaders (their own RLS-scoped txns) — no duplicated SQL.
  const [ops, channels, counts] = await Promise.all([
    loadKnowledgeOps(db, businessIdRaw, range),
    loadChannels(db, businessIdRaw, provider !== 'disabled'),
    withTenantTx(db, B, async (tx) => {
      const cutoff = (await sql<{ c: Date }>`
        select (date_trunc(${unit}, now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai') as c
      `.execute(tx)).rows[0]!.c;

      // Ownership counts: map assigned_to through ownershipOf (M16.1) — never
      // hard-code the sentinel semantics in SQL.
      const own = (await sql<{ assigned_to: string | null; n: number }>`
        select assigned_to, count(*)::int as n from conversations
         where business_id = ${B} and is_active group by assigned_to
      `.execute(tx)).rows;
      let handoffs = 0, ownerHandling = 0;
      for (const r of own) {
        const o = ownershipOf(r.assigned_to);
        if (o === 'WAITING_HUMAN') handoffs += r.n;
        else if (o === 'OWNER_CONTROLLED') ownerHandling += r.n;
      }

      const q = (await sql<{ pending: number; handled: number; drafts: number; corrections: number }>`
        select
          (select count(*)::int from drafts where business_id = ${B} and status = 'pending') as pending,
          (select count(distinct conversation_id)::int from turns where business_id = ${B} and created_at >= ${cutoff}) as handled,
          (select count(*)::int from drafts where business_id = ${B} and created_at >= ${cutoff}) as drafts,
          (select count(*)::int from drafts where business_id = ${B} and status = 'edited' and decided_at >= ${cutoff}) as corrections
      `.execute(tx)).rows[0]!;
      return { handoffs, ownerHandling, ...q };
    }),
  ]);

  const attention = { pendingApprovals: counts.pending, handoffs: counts.handoffs, ownerHandling: counts.ownerHandling };
  return {
    range,
    attention,
    activity: { handled: counts.handled, draftsCreated: counts.drafts, corrections: counts.corrections },
    knowledge: {
      openGaps: ops.gaps.length,                    // M14 derived gaps
      recentCorrections: ops.report.answersCorrected, // M14 (owner_corrected in range)
      recentlyTaught: ops.report.factsAdded,          // M14 (owner_confirmed in range)
    },
    channel: { status: channels.whatsapp.status, provider },
    hasAttention: attention.pendingApprovals + attention.handoffs + attention.ownerHandling > 0,
  };
}

/** ── M16.2b — the Operations Home renderer ─────────────────────────────────
 * Consumes ONLY an OperationsSnapshot (the read model is the boundary): it
 * queries nothing and interprets nothing. Counts only — no urgency score, no
 * percentage, no ranking. Each card deep-links into the surface that owns the
 * work. Localized via t(); RTL and the shell are handled upstream.
 */

// Attention items, rendered in ATTENTION_PRIORITY order. Each maps to a real
// count and a deep link into the surface that owns it. `openGaps` reuses M14's
// wording ("Questions to answer") — no second label for the same concept.
const ATTENTION_CARD: Record<AttentionKind, { readonly label: MessageKey; readonly href: string }> = {
  handoffs:         { label: 'ops.card.waiting',   href: '/app/inbox' },
  pendingApprovals: { label: 'ops.card.approvals', href: '/app/inbox?filter=pending' },
  openGaps:         { label: 'knowledge.ops.gaps', href: '/app/knowledge' },
};

const attentionCount = (s: OperationsSnapshot, k: AttentionKind): number =>
  k === 'openGaps' ? s.knowledge.openGaps : s.attention[k];

const opsStat = (locale: Locale, value: number, label: MessageKey, href: string): string =>
  `<a class="opsstat" href="${href}"><div class="v">${value}</div><div class="l">${esc(t(locale, label))}</div></a>`;

export function renderOperationsHome(s: OperationsSnapshot, locale: Locale): string {
  const name = EMPLOYEE_NAME[locale];

  // 1 · Needs your attention — a card per non-zero concern, in priority order;
  //     otherwise the honest all-caught-up state. Counts only.
  const attnCards = ATTENTION_PRIORITY
    .filter((k) => attentionCount(s, k) > 0)
    .map((k) => opsStat(locale, attentionCount(s, k), ATTENTION_CARD[k].label, ATTENTION_CARD[k].href))
    .join('');
  const attention = `<div class="card">
    <h2>${esc(t(locale, 'ops.attention.title'))}</h2>
    ${attnCards
      ? `<div class="opsgrid">${attnCards}</div>`
      : `<div class="ok">✓ ${esc(t(locale, 'ops.attention.allClear'))}</div>`}
  </div>`;

  // 2 · What the employee did — plain facts, each linking to where it lives.
  //     No interpretation: no "improved", no "performance".
  const activity = `<div class="card">
    <h2>${esc(t(locale, 'ops.activity.title', { name }))}</h2>
    <div class="opsgrid">
      ${opsStat(locale, s.activity.handled,       'ops.activity.handled',      '/app/analytics')}
      ${opsStat(locale, s.activity.draftsCreated, 'ops.activity.drafts',       '/app/inbox')}
      ${opsStat(locale, s.activity.corrections,   'ops.activity.corrections',  '/app/knowledge')}
    </div>
  </div>`;

  // 3 · Knowledge improvement — straight from M14, its own wording. No
  //     "intelligence", no "learning score", no "quality score".
  const knowledge = `<div class="card">
    <h2>${esc(t(locale, 'nav.knowledge'))}</h2>
    <div class="opsgrid">
      ${opsStat(locale, s.knowledge.openGaps,          'knowledge.ops.gaps',         '/app/knowledge')}
      ${opsStat(locale, s.knowledge.recentCorrections, 'knowledge.report.corrected', '/app/knowledge')}
      ${opsStat(locale, s.knowledge.recentlyTaught,    'knowledge.report.facts',     '/app/knowledge')}
    </div>
  </div>`;

  // 4 · System status — honest; pre-Meta it never pretends messaging is live.
  const ok = s.channel.status === 'connected';
  const statusLabel = s.channel.status === 'not_connected'
    ? t(locale, 'ops.system.waiting')
    : t(locale, `channel.status.${s.channel.status}` as MessageKey);
  const system = `<div class="card">
    <h2>${esc(t(locale, 'ops.system.title'))}</h2>
    <div class="sysline">WhatsApp <span class="pill ${ok ? 'ok' : 'warn'}">${esc(statusLabel)}</span></div>
    ${s.channel.provider === 'disabled' ? `<p class="muted">${esc(t(locale, 'ops.system.notLive'))}</p>` : ''}
  </div>`;

  return `<h1 class="page">${esc(t(locale, 'ops.title'))}</h1>
  ${attention}
  ${activity}
  ${knowledge}
  ${system}
  <style>
    .opsgrid { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }
    a.opsstat { background:#0f1216; border:1px solid #23272e; border-radius:10px; padding:16px; text-align:center; display:block; }
    a.opsstat:hover { border-color:#2b6b46; }
    a.opsstat .v { font-size:28px; font-weight:700; color:#fff; }
    a.opsstat .l { font-size:12px; color:#8b929c; margin-top:4px; }
    .ok { color:#4ade80; font-size:16px; font-weight:600; }
    .sysline { font-size:15px; }
    @media (max-width:560px) { .opsgrid { grid-template-columns:1fr; } }
  </style>`;
}
