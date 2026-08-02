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

/** ── Today — the owner's daily surface (Nomi Phase B) ─────────────────────
 * Answers one question: "what needs me today?" It consumes ONLY the read models
 * passed in — it queries nothing, derives no rate, and interprets nothing.
 *
 * Designed for a phone held in one hand: the attention items are full-width
 * tappable rows with the action on them, not a grid of stat tiles you then have
 * to go hunting from. A quiet day is a designed state, not an empty one.
 */

/** What the owner may still need to do, in the M16.2a priority order. */
const ATTENTION_ROW: Record<AttentionKind, { readonly label: MessageKey; readonly href: string }> = {
  handoffs:         { label: 'ops.card.waiting',   href: '/app/inbox' },
  pendingApprovals: { label: 'ops.card.approvals', href: '/app/inbox?filter=pending' },
  openGaps:         { label: 'knowledge.ops.gaps', href: '/app/knowledge' },
};

const attentionCount = (s: OperationsSnapshot, k: AttentionKind): number =>
  k === 'openGaps' ? s.knowledge.openGaps : s.attention[k];

/**
 * The takeover observation. Structurally typed on purpose: pilot.ts already
 * imports from this module, so importing PilotFeedback back would be circular.
 */
export type TakeoverObservation = {
  /** DISTINCT conversations a human stepped into. A real count, never a rate. */
  readonly conversationsNeedingYou: number;
  /** Stored problem-signal kinds with real counts. Only kinds that occurred. */
  readonly reasons: readonly { readonly kind: string; readonly count: number }[];
};

const countLine = (value: number, label: string): string =>
  `<div class="tline"><span class="tnum">${value}</span><span class="tlabel">${esc(label)}</span></div>`;

export function renderOperationsHome(
  s: OperationsSnapshot, locale: Locale, takeover?: TakeoverObservation,
): string {
  const name = EMPLOYEE_NAME[locale];

  // 1 · Needs your attention — one tappable row per real concern, in priority
  //     order. Nothing to do ⇒ a calm state that says so and stops.
  const rows = ATTENTION_PRIORITY
    .filter((k) => attentionCount(s, k) > 0)
    .map((k) => {
      const { label, href } = ATTENTION_ROW[k];
      return `<a class="need" href="${href}">
        <span class="need-n">${attentionCount(s, k)}</span>
        <span class="need-l">${esc(t(locale, label))}</span>
        <span class="need-go" aria-hidden="true">›</span>
      </a>`;
    }).join('');

  const attention = rows
    ? `<section class="block"><h2>${esc(t(locale, 'ops.attention.title'))}</h2>
        <div class="needs">${rows}</div></section>`
    : `<section class="block calm">
        <div class="calm-mark" aria-hidden="true">✓</div>
        <div>
          <h2 class="calm-h">${esc(t(locale, 'ops.attention.allClear'))}</h2>
          <p class="calm-b">${esc(t(locale, 'today.calm.body', { name }))}</p>
        </div>
      </section>`;

  // 2 · How often you stepped in — two real counts as a fraction, never a rate.
  //     The denominator is only shown when it is honest (needed ≤ handled).
  let stepIn = '';
  if (takeover) {
    const needed = takeover.conversationsNeedingYou;
    const handled = s.activity.handled;
    const sentence = needed === 0
      ? t(locale, 'today.stepIn.none')
      : (handled >= needed && handled > 0)
        ? t(locale, 'today.stepIn.count', { needed, handled })
        : t(locale, 'today.stepIn.only', { needed });
    const why = takeover.reasons.length
      ? `<h3 class="sub">${esc(t(locale, 'today.stepIn.why'))}</h3>
         <div class="counts">${takeover.reasons.map((r) =>
           countLine(r.count, t(locale, `takeover.reason.${r.kind}` as MessageKey))).join('')}</div>`
      : '';
    stepIn = `<section class="block"><h2>${esc(t(locale, 'today.stepIn.title'))}</h2>
      <p class="stepline">${esc(sentence)}</p>${why}</section>`;
  }

  // 3 · What she is learning — straight from M14, her words not a score.
  const k = s.knowledge;
  const learningQuiet = k.recentlyTaught === 0 && k.recentCorrections === 0 && k.openGaps === 0;
  const learning = `<section class="block">
    <h2>${esc(t(locale, 'today.learning.title', { name }))}</h2>
    ${learningQuiet
      ? `<p class="quiet">${esc(t(locale, 'today.learning.quiet'))}</p>`
      : `<div class="counts">
          ${countLine(k.recentlyTaught, t(locale, 'knowledge.report.facts'))}
          ${countLine(k.recentCorrections, t(locale, 'knowledge.report.corrected'))}
          ${countLine(k.openGaps, t(locale, 'knowledge.ops.gaps'))}
         </div>
         <a class="more" href="/app/knowledge">${esc(t(locale, 'ops.open'))} ›</a>`}
  </section>`;

  // 4 · What she did — plain counts. No comparison, no ranking, no percentage.
  const a = s.activity;
  const activity = `<section class="block">
    <h2>${esc(t(locale, 'ops.activity.title', { name }))}</h2>
    <div class="counts">
      ${countLine(a.handled, t(locale, 'ops.activity.handled'))}
      ${countLine(a.draftsCreated, t(locale, 'ops.activity.drafts'))}
      ${countLine(a.corrections, t(locale, 'ops.activity.corrections'))}
    </div>
  </section>`;

  // Messaging state is only worth an owner's attention when it is NOT live.
  const notLive = s.channel.provider === 'disabled'
    ? `<p class="notlive">${esc(t(locale, 'ops.system.notLive'))}</p>` : '';

  return `<h1 class="page">${esc(t(locale, 'ops.title'))}</h1>
  ${attention}
  ${stepIn}
  ${learning}
  ${activity}
  ${notLive}
  <style>
    .block { padding:22px 0; border-top:1px solid #23272e; }
    .block:first-of-type { border-top:0; padding-top:6px; }
    .block h2 { font-size:13px; text-transform:uppercase; letter-spacing:.8px;
                color:#8b929c; margin:0 0 14px; font-weight:600; }
    /* Needs you: full-width tappable rows — one thumb, no hunting. */
    .needs { display:flex; flex-direction:column; gap:10px; }
    a.need { display:flex; align-items:center; gap:14px; background:#14171c;
             border:1px solid #2b313a; border-radius:12px; padding:16px 18px; }
    a.need:hover, a.need:focus-visible { border-color:#3d7a63; }
    .need-n { font-size:26px; font-weight:700; color:#fff; min-width:1.6em;
              font-variant-numeric:tabular-nums; }
    .need-l { flex:1; font-size:16px; color:#e6e8eb; }
    .need-go { color:#6b7280; font-size:20px; }
    [dir="rtl"] .need-go { transform:scaleX(-1); }
    /* Calm state: a destination, not a void. */
    .calm { display:flex; gap:16px; align-items:flex-start; }
    .calm-mark { color:#4ade80; font-size:26px; line-height:1.2; }
    .calm-h { font-size:19px; text-transform:none; letter-spacing:0; color:#e6e8eb; margin:0 0 6px; }
    .calm-b { color:#8b929c; margin:0; font-size:15px; }
    /* Plain count lines — no tiles, no grid, no colour coding. */
    .counts { display:flex; flex-direction:column; gap:2px; }
    .tline { display:flex; align-items:baseline; gap:12px; padding:7px 0;
             border-bottom:1px solid #1c2026; }
    .tline:last-child { border-bottom:0; }
    .tnum { font-size:17px; font-weight:700; color:#fff; min-width:2.2em;
            font-variant-numeric:tabular-nums; }
    .tlabel { color:#b9c0c9; font-size:15px; }
    .stepline { font-size:17px; color:#e6e8eb; margin:0 0 6px; }
    .sub { font-size:12px; text-transform:uppercase; letter-spacing:.7px;
           color:#8b929c; margin:16px 0 8px; font-weight:600; }
    .quiet { color:#8b929c; margin:0; }
    .more { display:inline-block; margin-top:12px; color:#60a5fa; font-size:14px; }
    .notlive { color:#8b929c; font-size:13px; margin:22px 0 0;
               padding-top:16px; border-top:1px solid #23272e; }
    a:focus-visible { outline:2px solid #60a5fa; outline-offset:2px; }
    @media (max-width:560px) {
      .need-n { font-size:23px; }
      a.need { padding:15px 16px; }
    }
  </style>`;
}
