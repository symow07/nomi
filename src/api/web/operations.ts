import { loadAssistantStop } from '../../db/assistantStop.js';
import { loadKillSwitches } from '../../db/opsFlags.js';
import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId, type BusinessId } from '../../core/types/ids.js';
import { ownershipOf } from '../../core/conversation/ownership.js';
import { loadKnowledgeOps, type Range } from './knowledge-insights.js';
import { loadChannels } from './channels.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { t, assistantName, setupState } from './say.js';
import { STEP_LINK } from './onboarding.js';
import { countRefusals } from './refusals.js';
import { checkBudget } from '../../core/budget.js';
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
    /**
     * 0076 — buyers who asked, in a message, for their data to be deleted, and
     * are waiting for the owner's decision. Leads the list: it is a request the
     * owner answers to, and it does not go away by handing a conversation back.
     * Absent (a snapshot built before 0076) is none.
     */
    readonly deletionAsks?: number;
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
  readonly channel: {
    readonly status: string;
    /** WhatsApp's provider — what the number runs on, 'disabled' without one. */
    readonly provider: string;
    /**
     * Whether messages are being sent and received here at all. Absent, it is
     * read off `provider`, which was the whole answer until a Page could be
     * connected without a number (2026-09-17).
     */
    readonly live?: boolean;
  };
  /**
   * G19 — the ceiling she is approaching, on the surface she watches.
   *
   * `checkBudget` has returned `soft_warn` since M51.2 and nobody read it: the
   * send gate asks only whether the verdict is `pause`, so the one warning that
   * exists to arrive BEFORE the stop arrived nowhere. Null until the day's use
   * passes her soft-warn percentage; `stops` is what her own setting does at
   * 100%, so the sentence she reads is her rule, not a general fact.
   */
  readonly budget: { readonly pctUsed: number; readonly stops: boolean } | null;
  /** True when any attention bucket is non-zero — the "you have work" signal. */
  readonly hasAttention: boolean;
  /** 0070 — when the owner stopped the assistant on every channel; null or absent = answering. */
  readonly assistantStoppedAt?: Date | null;
  /** 0071 — ops has paused sending (the kill switch); absent = not paused. */
  readonly opsSilenced?: boolean;
};

/**
 * Explicit priority order for the future UI — NO urgency scoring. Each entry is
 * a concern the owner acts on, most-important first. `ownerHandling` and
 * `activity` are context, not demands, so they are not in this list. A real-time
 * "buyer waiting" concern has no honest source until Meta and is omitted rather
 * than invented.
 */
export const ATTENTION_PRIORITY =
  ['blockedMessages', 'deletionAsks', 'handoffs', 'pendingApprovals', 'ownerHandling', 'openGaps'] as const;
export type AttentionKind = (typeof ATTENTION_PRIORITY)[number];

const EMPTY = (range: Range, provider: string, live = provider !== 'disabled'): OperationsSnapshot => ({
  range,
  attention: { pendingApprovals: 0, handoffs: 0, ownerHandling: 0, blockedMessages: 0, deletionAsks: 0 },
  activity: { handled: 0, draftsCreated: 0, corrections: 0 },
  knowledge: { openGaps: 0, recentCorrections: 0, recentlyTaught: 0 },
  channel: { status: 'not_connected', provider, live },
  budget: null,
  hasAttention: false,
});

/**
 * G19 — one rule, in `core/budget.ts`, asked here the way the send gate asks it.
 * Anything below her soft-warn line is silence: a warning she sees every day is
 * a warning she stops reading.
 */
const budgetOf = (r: {
  daily_llm_calls: number; daily_tokens: string; soft_warn_pct: number; on_exceeded: string;
  used_calls: number; used_tokens: string;
} | null): OperationsSnapshot['budget'] => {
  if (!r) return null;
  const verdict = checkBudget(
    { llmCalls: Number(r.used_calls), tokens: Number(r.used_tokens) },
    {
      dailyLlmCalls: Number(r.daily_llm_calls), dailyTokens: Number(r.daily_tokens),
      softWarnPct: Number(r.soft_warn_pct), onExceeded: r.on_exceeded === 'pause' ? 'pause' : 'throttle',
    },
  );
  const stops = r.on_exceeded === 'pause';
  if (verdict.kind === 'soft_warn') return { pctUsed: verdict.pctUsed, stops };
  // Past the ceiling: still worth saying, and the percentage is hers, not a cap.
  if (verdict.kind === 'pause' || verdict.kind === 'throttle') return { pctUsed: 100, stops };
  return null;
};

/**
 * CC-26 — the counts Today's "Needs your attention" rows are drawn from, read
 * in ONE place: the page draws them, and the live line asks for them again to
 * tell whether they changed while Today was open (`src/api/web/live.ts`). A
 * second copy would be a second answer to the same question — the line would
 * speak up for a change the page could never show, or miss one it would.
 *
 * Plain counts over the queue tables, as they always were: drafts waiting for
 * the owner, conversations waiting for a person or held by one (through the
 * ONE ownership model, never the sentinels in SQL), buyers' deletion requests
 * waiting, and messages refused in the last week (`countRefusals`, the list's
 * own predicate).
 */
export type AttentionCounts = {
  readonly pendingApprovals: number;
  readonly handoffs: number;
  readonly ownerHandling: number;
  readonly blockedMessages: number;
  readonly deletionAsks: number;
};

export async function readAttention(db: Db, B: BusinessId): Promise<AttentionCounts> {
  const [counts, blockedMessages] = await Promise.all([
    withTenantTx(db, B, async (tx) => {
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
      const q = (await sql<{ pending: number; deletion_asks: number }>`
        select
          (select count(*)::int from drafts where business_id = ${B} and status = 'pending') as pending,
          (select count(*)::int from deletion_asks where business_id = ${B} and state = 'waiting') as deletion_asks
      `.execute(tx)).rows[0]!;
      return { handoffs, ownerHandling, pending: q.pending, deletionAsks: q.deletion_asks };
    }),
    // M22 — counted by the database over persisted canceled rows, through the
    // SAME predicate that lists them, so the number and the list agree.
    countRefusals(db, B),
  ]);
  return {
    pendingApprovals: counts.pending, handoffs: counts.handoffs, ownerHandling: counts.ownerHandling,
    blockedMessages, deletionAsks: counts.deletionAsks,
  };
}

export async function loadOperationsSnapshot(
  db: Db, businessIdRaw: string, range: Range, provider = 'disabled',
  /** Whether anything is sent or received here; WhatsApp's presence, by default. */
  live: boolean = provider !== 'disabled',
): Promise<OperationsSnapshot> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return EMPTY(range, provider, live);
  const B = bid.value;
  const unit = RANGE_UNIT[range];

  // Compose the existing loaders (their own RLS-scoped txns) — no duplicated SQL.
  const [ops, channels, attention, counts, budgetRow, stop, opsSilenced] = await Promise.all([
    loadKnowledgeOps(db, businessIdRaw, range),
    loadChannels(db, businessIdRaw, provider !== 'disabled'),
    // CC-26 — what needs her, from the one reader the live line asks too.
    readAttention(db, B),
    withTenantTx(db, B, async (tx) => {
      const cutoff = (await sql<{ c: Date }>`
        select (date_trunc(${unit}, now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai') as c
      `.execute(tx)).rows[0]!.c;
      return (await sql<{ handled: number; drafts: number; corrections: number }>`
        select
          (select count(distinct conversation_id)::int from turns where business_id = ${B} and created_at >= ${cutoff}) as handled,
          (select count(*)::int from drafts where business_id = ${B} and created_at >= ${cutoff}) as drafts,
          (select count(*)::int from drafts where business_id = ${B} and status = 'edited' and decided_at >= ${cutoff}) as corrections
      `.execute(tx)).rows[0]!;
    }),
    // G19 — the same numbers the send gate reads, judged by the same function.
    // Absence of a budget row is "she has set no ceiling", never "stop".
    withTenantTx(db, B, async (tx) => (await sql<{
      daily_llm_calls: number; daily_tokens: string; soft_warn_pct: number; on_exceeded: string;
      used_calls: number; used_tokens: string;
    }>`
      select b.daily_llm_calls, b.daily_tokens, b.soft_warn_pct, b.on_exceeded,
             coalesce(u.llm_calls, 0) as used_calls,
             coalesce(u.input_tokens, 0) + coalesce(u.output_tokens, 0) as used_tokens
        from tenant_budgets b
        left join usage_ledger u
          on u.business_id = b.business_id
         and u.day = (now() at time zone 'Asia/Shanghai')::date
       where b.business_id = ${B}
       limit 1
    `.execute(tx)).rows[0] ?? null),
    // 0070 — the owner's Stop, on every channel.
    loadAssistantStop(db, B),
    // 0071 — whether ops has paused sending.
    withTenantTx(db, B, (tx) => loadKillSwitches(tx, B)).then((k) => k.globalSilence),
  ]);

  return {
    range,
    attention,
    activity: { handled: counts.handled, draftsCreated: counts.drafts, corrections: counts.corrections },
    knowledge: {
      openGaps: ops.gaps.length,                    // M14 derived gaps
      recentCorrections: ops.report.answersCorrected, // M14 (owner_corrected in range)
      recentlyTaught: ops.report.factsAdded,          // M14 (owner_confirmed in range)
    },
    channel: { status: channels.whatsapp.status, provider, live },
    budget: budgetOf(budgetRow),
    hasAttention: attention.pendingApprovals + attention.handoffs
                + attention.ownerHandling + attention.blockedMessages + attention.deletionAsks > 0,   // see needsOwnerAttention
    assistantStoppedAt: stop.stoppedAt,
    opsSilenced,
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
  // 0076 — a buyer asked for their data to be deleted and the owner has not
  // decided. Right under the message that never arrived (the one concern with
  // no other way to be found), above every ordinary hand-off; to the Buyers
  // tab that lists only them — a door every reader may open (Your data is the
  // owner's alone).
  deletionAsks:     { label: 'ops.card.deletionAsks', href: '/app/inbox?filter=deletion' },
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
  k === 'openGaps' ? s.knowledge.openGaps : s.attention[k] ?? 0;

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
  `<div class="stat"><span class="v">${value}</span><span class="l">${esc(label)}</span></div>`;

export function renderOperationsHome(
  s: OperationsSnapshot, locale: Locale, takeover?: TakeoverObservation,
  /** What sits under the title before the day's counts — Today's insight rows. */
  lead = '',
): string {
  const name = assistantName(locale);

  // 1 · Needs your attention — one tappable row per real concern, in priority
  //     order. Nothing to do ⇒ a calm state that says so and stops.
  const rows = ATTENTION_PRIORITY
    .filter((k) => attentionCount(s, k) > 0)
    .map((k) => {
      const { label, href } = ATTENTION_ROW[k];
      return `<a class="stat need" href="${href}">
        <span class="v">${attentionCount(s, k)}</span>
        <span class="l grow">${esc(t(locale, label))}</span>
        <span class="go" aria-hidden="true">›</span>
      </a>`;
    }).join('');

  // M22 (F-01) — a quiet day has two very different causes, and saying the
  // wrong one is a lie the owner cannot check. "{name} is looking after your
  // buyers" was shown unconditionally, including on a factory where messaging
  // was switched off and she was looking after nobody. The signal is the same
  // one `notLive` below already uses — no second derivation of channel state,
  // and nothing here re-answers the M20.3 lifecycle question.
  const live = s.channel.live ?? s.channel.provider !== 'disabled';
  // 0070 — stopped on every channel. Said first, with the two ways forward
  // (who is waiting; where Start is), and the calm line that says the
  // assistant is looking after buyers is not shown: it would be false.
  const stopped = s.assistantStoppedAt
    ? `<section class="block">
        <h2>${esc(t(locale, 'today.stopped.title', { name }))}</h2>
        <p class="muted">${esc(t(locale, 'today.stopped.body', { name }))}</p>
        <div class="doors">${deeper('/app/inbox?filter=pending', t(locale, 'today.stopped.waiting'))}${deeper('/app/factory', t(locale, 'today.stopped.start', { name }))}</div>
      </section>`
    : '';
  // 0071 — ops paused sending: the same honesty, in the words ops uses when a
  // message is refused for it (refused.*.silenced).
  const silenced = s.opsSilenced
    ? `<section class="block">
        <h2>${esc(t(locale, 'today.silenced.title', { name }))}</h2>
        <p class="muted">${esc(t(locale, 'today.silenced.body', { name }))}</p>
        <div class="doors">${deeper('/app/inbox?filter=pending', t(locale, 'today.stopped.waiting'))}</div>
      </section>`
    : '';
  const attention = needsOwnerAttention(s)
    ? `<section class="block"><h2>${esc(t(locale, 'ops.attention.title'))}</h2>
        <div class="stats">${rows}</div></section>`
    : s.assistantStoppedAt || s.opsSilenced ? ''
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

  // D — while setup is unfinished, Today says so and names the next step: the
  // same five steps the Setup entry counts, the same door My business opens.
  // Not attention (nothing is waiting on anyone) and not a checklist — one
  // count and one door, and it is gone the day the last step is done.
  const setup = setupState();
  const finishSetup = setup && setup.next !== null
    ? `<section class="block setup">
        <h2>${esc(t(locale, 'today.setup.title'))}</h2>
        <p class="muted">${esc(t(locale, 'nav.setup.progress', { done: setup.done, total: setup.total }))}</p>
        ${deeper(STEP_LINK[setup.next], t(locale, `factory.next.${setup.next}` as MessageKey, { name }))}
      </section>`
    : '';

  // G19 — the ceiling she set, before it stops her rather than after.
  // `checkBudget` has said `soft_warn` since M51.2 and nothing read it. It is a
  // notice, not a demand: it sits under the attention rows and never counts as
  // attention, so a quiet day stays quiet.
  const budget = s.budget
    ? `<section class="block"><p class="muted">${esc(t(locale, 'today.budget.near', { name, pct: s.budget.pctUsed }))} ${
        esc(t(locale, s.budget.stops ? 'today.budget.thenStops' : 'today.budget.thenKeeps', { name }))}</p></section>`
    : '';

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
         <div class="stats">${takeover.reasons.map((r) =>
           countLine(r.count, t(locale, `takeover.reason.${r.kind}` as MessageKey))).join('')}</div>`
      : '';
    stepIn = `<section class="block"><h2>${esc(t(locale, 'today.stepIn.title'))}</h2>
      <p>${esc(sentence)}</p>${why}</section>`;
  }

  // 3 · What she is learning — straight from M14, her words not a score.
  const k = s.knowledge;
  const learningQuiet = k.recentlyTaught === 0 && k.recentCorrections === 0 && k.openGaps === 0;
  const learning = `<section class="block">
    <h2>${esc(t(locale, 'today.learning.title', { name }))}</h2>
    ${learningQuiet
      ? `<p class="muted small">${esc(t(locale, 'today.learning.quiet'))}</p>
         ${deeper('/app/knowledge', t(locale, 'her.teach.go'))}`
      : `<div class="stats">
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
  //
  // CC-05 — THE LINK CAME OUT OF THE BRANCH. The quiet branch is right and
  // stays: three zeros and a grid of more zeros is the page inventing a reason
  // to exist. But the only door to Results was INSIDE it, so a new owner — and
  // any quiet week — had no way into a whole page except typing the URL. The
  // counts go quiet; the way in does not.
  const activity = didNothing ? '' : `<section class="block">
    <h2>${esc(t(locale, 'ops.activity.title', { name }))}</h2>
    <div class="stats">
      ${countLine(a.handled, t(locale, 'ops.activity.handled'))}
      ${countLine(a.draftsCreated, t(locale, 'ops.activity.drafts'))}
      ${countLine(a.corrections, t(locale, 'ops.activity.corrections'))}
    </div>
  </section>`;
  const toResults = `<section class="block">${deeper('/app/analytics', t(locale, 'today.results.link'))}</section>`;

  // Messaging state is only worth an owner's attention when it is NOT live.
  const notLive = !(s.channel.live ?? s.channel.provider !== 'disabled')
    ? `<p class="block muted notlive">${esc(t(locale, 'ops.system.notLive'))}</p>` : '';

  return `<h1 class="page">${esc(t(locale, 'ops.title'))}</h1>${lead}
  ${silenced}
  ${stopped}
  ${attention}
  ${finishSetup}
  ${budget}
  ${stepIn}
  ${learning}
  ${activity}
  ${toResults}
  ${notLive}`;
}
