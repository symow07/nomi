import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { ownershipOf } from '../../core/conversation/ownership.js';
import { loadKnowledgeOps, type Range } from './knowledge-insights.js';
import { loadChannels } from './channels.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { t, EMPLOYEE_NAME, type MessageKey } from '../../core/owner/i18n/messages.js';
import { countRefusals } from './refusals.js';
import { esc, deeper } from './layout.js';

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
    /**
     * M22 — messages that did not reach a buyer. A real count of canceled
     * outbound rows (countRefusals), not a rate and not a health signal. It
     * leads the list because it is the only concern here the owner has no
     * other way to discover: a handoff at least sits visibly in the inbox,
     * while a refused message left a buyer waiting on a reply nobody sent.
     */
    readonly blockedMessages: number;
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
export const ATTENTION_PRIORITY =
  ['blockedMessages', 'handoffs', 'pendingApprovals', 'ownerHandling', 'openGaps'] as const;
export type AttentionKind = (typeof ATTENTION_PRIORITY)[number];

const EMPTY = (range: Range, provider: string): OperationsSnapshot => ({
  range,
  attention: { pendingApprovals: 0, handoffs: 0, ownerHandling: 0, blockedMessages: 0 },
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
  const [ops, channels, counts, blockedMessages] = await Promise.all([
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
    // M22 — counted by the database over persisted canceled rows, through the
    // SAME predicate that lists them, so the number and the list agree.
    countRefusals(db, businessIdRaw),
  ]);

  const attention = {
    pendingApprovals: counts.pending, handoffs: counts.handoffs,
    ownerHandling: counts.ownerHandling, blockedMessages,
  };
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
    hasAttention: attention.pendingApprovals + attention.handoffs
                + attention.ownerHandling + attention.blockedMessages > 0,   // see needsOwnerAttention
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
  // M22 — a buyer who was never replied to. Leads the list; the link goes to
  // the conversations it happened in, where the reason and the fix are stated.
  blockedMessages:  { label: 'ops.card.blocked',   href: '/app/inbox?filter=blocked' },
  handoffs:         { label: 'ops.card.waiting',   href: '/app/inbox' },
  pendingApprovals: { label: 'ops.card.approvals', href: '/app/inbox?filter=pending' },
  // A conversation the owner took over is waiting on the OWNER to type. It was
  // computed here from the start but never shown, so Today could say "you're all
  // caught up" while a buyer waited on her personally.
  ownerHandling:    { label: 'ops.card.yours',     href: '/app/inbox?filter=all' },
  openGaps:         { label: 'knowledge.ops.gaps', href: '/app/knowledge' },
};

const attentionCount = (s: OperationsSnapshot, k: AttentionKind): number =>
  k === 'openGaps' ? s.knowledge.openGaps : s.attention[k];

/** True only when nothing anywhere needs the owner — including her own threads. */
export const needsOwnerAttention = (s: OperationsSnapshot): boolean =>
  ATTENTION_PRIORITY.some((k) => attentionCount(s, k) > 0);

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
        <span class="go need-go" aria-hidden="true">›</span>
      </a>`;
    }).join('');

  // M22 (F-01) — a quiet day has two very different causes, and saying the
  // wrong one is a lie the owner cannot check. "{name} is looking after your
  // buyers" was shown unconditionally, including on a factory where messaging
  // was switched off and she was looking after nobody. The signal is the same
  // one `notLive` below already uses — no second derivation of channel state,
  // and nothing here re-answers the M20.3 lifecycle question.
  const live = s.channel.provider !== 'disabled';
  const attention = needsOwnerAttention(s)
    ? `<section class="block"><h2>${esc(t(locale, 'ops.attention.title'))}</h2>
        <div class="needs">${rows}</div></section>`
    : live
    // M35.5 — when nothing needs her, this IS the page: a rule, one sentence,
    // and air. Not a card among cards. Saying less is the whole argument, and it
    // was buried under three sections of zeroes.
    //
    // NOTE for whoever edits the stylesheet below: CSS comments SHIP. They are
    // scanned for banned owner vocabulary exactly like visible copy, and two of
    // them here tripped that rule while this was being written. Explanations
    // belong in TypeScript comments like this one, which never reach a browser.
    ? `<section class="calm-page">
        <div class="calm-rule" aria-hidden="true"></div>
        <p class="calm-say">${esc(t(locale, 'today.calm.body', { name }))}</p>
      </section>`
    // Not a ✓: nothing has been achieved. Nobody can reach her yet, and the
    // way forward is stated instead of implied.
    // Not a ✓ and not calm: nothing has been achieved, nobody can reach her,
    // and the way forward is stated rather than implied.
    : `<section class="calm-page off">
        <div class="calm-rule" aria-hidden="true"></div>
        <p class="calm-say">${esc(t(locale, 'today.calm.notLive.title', { name }))}</p>
        ${deeper('/app/factory', t(locale, 'today.calm.notLive.go'))}
      </section>`;

  // 2 · How often you stepped in — two real counts as a fraction, never a rate.
  //     The denominator is only shown when it is honest (needed ≤ handled).
  let stepIn = '';
  // M22 (F-01) — "You did not need to step in" on a factory where nothing
  // happened at all reads as a good outcome. It is not an outcome; it is an
  // absence. With nothing handled and nothing needed, the section says nothing.
  if (takeover && !(takeover.conversationsNeedingYou === 0 && s.activity.handled === 0)) {
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
      ? `<p class="quiet">${esc(t(locale, 'today.learning.quiet'))}</p>
         ${deeper('/app/knowledge', t(locale, 'her.teach.go'))}`
      : `<div class="counts">
          ${countLine(k.recentlyTaught, t(locale, 'knowledge.report.facts'))}
          ${countLine(k.recentCorrections, t(locale, 'knowledge.report.corrected'))}
          ${countLine(k.openGaps, t(locale, 'knowledge.ops.gaps'))}
         </div>
         ${deeper('/app/knowledge', t(locale, 'ops.open'))}`}
  </section>`;

  // 4 · What she did — plain counts. No comparison, no ranking, no percentage.
  //
  // M35.5 — AND A QUIET BRANCH, which `stepIn` and `learning` above already
  // had. Three zeros and a link into a grid of more zeros is the page inventing
  // a reason to exist: on a day nothing happened, nothing happened is the whole
  // answer, and saying it in three rows makes it smaller rather than clearer.
  const a = s.activity;
  const didNothing = a.handled === 0 && a.draftsCreated === 0 && a.corrections === 0;
  const activity = didNothing ? '' : `<section class="block">
    <h2>${esc(t(locale, 'ops.activity.title', { name }))}</h2>
    <div class="counts">
      ${countLine(a.handled, t(locale, 'ops.activity.handled'))}
      ${countLine(a.draftsCreated, t(locale, 'ops.activity.drafts'))}
      ${countLine(a.corrections, t(locale, 'ops.activity.corrections'))}
    </div>
    ${deeper('/app/analytics', t(locale, 'today.results.link'))}
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
    /* .block is the shell's now — Today is where the pattern came from. */
    /* Not-live is neutral, not celebratory: no tick, no green. */
    /* Needs you: full-width tappable rows — one thumb, no hunting. */
    .needs { display:flex; flex-direction:column; gap:var(--space-8); }
    a.need { display:flex; align-items:center; gap:var(--space-12); background:var(--color-surface);
             border:1px solid var(--color-border); border-radius:12px; padding:16px 18px; }
    a.need:hover, a.need:focus-visible { border-color:var(--color-jade-line); }
    .need-n { font-size:var(--font-size-display); font-weight:700; color:var(--color-ink); min-width:1.6em;
              font-variant-numeric:tabular-nums; }
    .need-l { flex:1; font-size:var(--font-size-small); color:var(--color-ink); }
    .need-go { color:var(--color-ink-secondary); font-size:var(--font-size-base); }
    /* M35.5 — the calm state IS the page: a rule, one sentence, air. */
    .calm-page { padding:var(--space-32) 0 var(--space-48); }
    .calm-rule { height:2px; width:3.5rem; background:var(--color-jade);
                 border-radius:2px; margin-bottom:var(--space-24); }
    /* M49 — the PRODUCT reporting that nothing needs her. Not her voice: the
       serif is for what a person says, and this sentence is about her. Size and
       a rule carry the calm; the family does not have to. */
    .calm-say { font-size:var(--font-size-title);
                line-height:1.45; color:var(--color-ink); margin:0; max-width:var(--measure-prose); }
    /* Not live is not an achievement: the rule is quiet, not jade. */
    .calm-page.off .calm-rule { background:var(--color-border); }
    /* Plain count lines — no tiles, no grid, no colour coding. */
    .counts { display:flex; flex-direction:column; gap:var(--space-4); }
    .tline { display:flex; align-items:baseline; gap:var(--space-12); padding:7px 0;
             border-bottom:1px solid var(--color-border); }
    .tline:last-child { border-bottom:0; }
    .tnum { font-size:var(--font-size-base); font-weight:700; color:var(--color-ink); min-width:2.2em;
            font-variant-numeric:tabular-nums; }
    .tlabel { color:var(--color-ink-secondary); font-size:var(--font-size-small); }
    .stepline { font-size:var(--font-size-base); color:var(--color-ink); margin:0 0 var(--space-8); }
    .sub { font-size:var(--font-size-caption); letter-spacing:0;
           color:var(--color-ink-secondary); margin:var(--space-16) 0 var(--space-8); font-weight:600; }
    .quiet { color:var(--color-ink-secondary); margin:0; }
    .notlive { color:var(--color-ink-secondary); font-size:var(--font-size-caption); margin:var(--space-24) 0 0;
               padding-top:16px; border-top:1px solid var(--color-border); }
    @media (max-width:560px) {
      .need-n { font-size:var(--font-size-numeral); }
      a.need { padding:15px 16px; }
    }
  </style>`;
}
