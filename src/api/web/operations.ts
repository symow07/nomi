import { zoneOf } from '../../db/zone.js';
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
import { t, tn, assistantName, setupState } from './say.js';
import { STEP_LINK } from './onboarding.js';
import { countRefusals } from './refusals.js';
import { checkBudget } from '../../core/budget.js';
import { esc, deeper } from './layout.js';
import { renderNeedsLines, renderLastDay, renderComingUp, renderSending, toCalendar, type TodayData } from './today.js';
import * as show from './values.js';


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
    /**
     * 0080 — orders customers said yes to, waiting for the owner's tap. Leads
     * the list: nothing was confirmed or sent until the owner decides. Absent
     * (a snapshot built before 0080) is none.
     */
    readonly ordersWaiting?: number;
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
  ['ordersWaiting', 'blockedMessages', 'deletionAsks', 'handoffs', 'pendingApprovals', 'ownerHandling', 'openGaps'] as const;
export type AttentionKind = (typeof ATTENTION_PRIORITY)[number];

const EMPTY = (range: Range, provider: string, live = provider !== 'disabled'): OperationsSnapshot => ({
  range,
  attention: { pendingApprovals: 0, handoffs: 0, ownerHandling: 0, blockedMessages: 0, deletionAsks: 0, ordersWaiting: 0 },
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
  /** 0080 — orders customers said yes to, waiting for the owner's tap. */
  readonly ordersWaiting: number;
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
      const q = (await sql<{ pending: number; deletion_asks: number; orders: number }>`
        select
          (select count(*)::int from drafts where business_id = ${B} and status = 'pending') as pending,
          (select count(*)::int from deletion_asks where business_id = ${B} and state = 'waiting') as deletion_asks,
          (select count(*)::int from order_proposals where business_id = ${B} and state = 'pending') as orders
      `.execute(tx)).rows[0]!;
      return { handoffs, ownerHandling, pending: q.pending, deletionAsks: q.deletion_asks, ordersWaiting: q.orders };
    }),
    // M22 — counted by the database over persisted canceled rows, through the
    // SAME predicate that lists them, so the number and the list agree.
    countRefusals(db, B),
  ]);
  return {
    pendingApprovals: counts.pending, handoffs: counts.handoffs, ownerHandling: counts.ownerHandling,
    blockedMessages, deletionAsks: counts.deletionAsks, ordersWaiting: counts.ordersWaiting,
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
      // TZ — the period starts in the workspace's own zone.
    const zone = await zoneOf(tx, B);
    const cutoff = (await sql<{ c: Date }>`
        select (date_trunc(${unit}, now() at time zone ${zone}) at time zone ${zone}) as c
      `.execute(tx)).rows[0]!.c;
      return (await sql<{ handled: number; drafts: number; corrections: number }>`
        select
          (select count(distinct conversation_id)::int from turns where business_id = ${B} and created_at >= ${cutoff}
             and decision->'action'->>'kind' is distinct from 'held') as handled,
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
         and u.day = (now() at time zone 'UTC')::date   -- T7: the ledger's day is UTC for writer and readers
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
                + attention.ownerHandling + attention.blockedMessages + attention.deletionAsks + attention.ordersWaiting > 0,   // see needsOwnerAttention
    assistantStoppedAt: stop.stoppedAt,
    opsSilenced,
  };
}

/** ── Today — the owner's daily surface ─────────────────────────────────────
 * Answers one question: "what needs me today?" — by time since the design
 * pass (2026-09-29): who needs you now, the last 24 hours, what is coming up
 * (`today.ts`). It consumes ONLY the read models passed in — it queries
 * nothing, derives no rate, and interprets nothing.
 */

const attentionCount = (s: OperationsSnapshot, k: AttentionKind): number =>
  k === 'openGaps' ? s.knowledge.openGaps : s.attention[k] ?? 0;

/** True only when nothing anywhere needs the owner — including her own threads. */
export const needsOwnerAttention = (s: OperationsSnapshot): boolean =>
  ATTENTION_PRIORITY.some((k) => attentionCount(s, k) > 0);


export function renderOperationsHome(
  s: OperationsSnapshot, locale: Locale, today: TodayData,
  /** "Worth your attention" — the insight lines, bare, joined to the first block. */
  lead = '',
): string {
  const name = assistantName(locale);
  const live = s.channel.live ?? s.channel.provider !== 'disabled';

  // 0070 — stopped on every channel. Said first, with the two ways forward
  // (who is waiting; where Start is), and the calm line is not shown: it
  // would be false.
  const stopped = s.assistantStoppedAt
    ? `<section class="block">
        <h2>${esc(t(locale, 'today.stopped.title', { name }))}</h2>
        <p class="muted">${esc(t(locale, 'today.stopped.body', { name }))}</p>
        <div class="doors">${deeper('/app/inbox?filter=pending', t(locale, 'today.stopped.waiting'))}${deeper('/app/factory', t(locale, 'today.stopped.start', { name }))}</div>
      </section>`
    : '';
  // 0071 — ops paused sending: the same honesty, in the words ops uses.
  const silenced = s.opsSilenced
    ? `<section class="block">
        <h2>${esc(t(locale, 'today.silenced.title', { name }))}</h2>
        <p class="muted">${esc(t(locale, 'today.silenced.body', { name }))}</p>
        <div class="doors">${deeper('/app/inbox?filter=pending', t(locale, 'today.stopped.waiting'))}</div>
      </section>`
    : '';

  // 1 · WHO NEEDS YOU NOW — the Buyers list's own "Needs you", the first few
  //     by name, each a door to the newest message; then what else needs a
  //     look, each a sentence with its count. Nothing: the fact, stated.
  const blocked = s.attention.blockedMessages;
  const gaps = s.knowledge.openGaps;
  const asks = s.attention.deletionAsks ?? 0;
  const more = [
    today.needs.total > today.needs.rows.length
      ? deeper('/app/inbox?filter=pending', tn(locale, 'today.needs.all', today.needs.total)) : '',
    blocked > 0 ? deeper('/app/inbox?filter=blocked', tn(locale, 'today.blocked', blocked)) : '',
    // 0076 — a deletion request waits as its own thing, with its own list.
    asks > 0 ? deeper('/app/inbox?filter=deletion', tn(locale, 'today.deletion', asks)) : '',
    gaps > 0 ? deeper('/app/knowledge', tn(locale, 'today.gaps', gaps, { name })) : '',
  ].filter(Boolean).join('');
  // M22 — one message that never reached a customer, or one deletion request
  // waiting, is enough to contradict "no one is waiting".
  const quietNow = today.needs.total === 0 && blocked === 0 && asks === 0;
  const heading = quietNow ? t(locale, 'today.needs.none')
    : today.needs.total > 0 ? tn(locale, 'nav.needsYou', today.needs.total) : t(locale, 'ops.attention.title');
  const now = `<section class="block today-now" aria-labelledby="today-now">
    <h2 id="today-now">${esc(heading)}</h2>
    ${today.needs.rows.length ? `<ul class="tlines">${renderNeedsLines(today, locale)}</ul>` : ''}
    ${more ? `<div class="doors">${more}</div>` : ''}
    ${lead ? `<div class="today-worth">${lead}</div>` : ''}
    ${quietNow && !s.assistantStoppedAt && !s.opsSilenced && !live
      // M22 (F-01) — a quiet day with nobody able to reach her is not calm: nothing
      // has been achieved, and the way forward is stated rather than implied.
      ? `<p class="muted">${esc(t(locale, 'today.calm.notLive.title', { name }))}</p>${deeper('/app/factory', t(locale, 'today.calm.notLive.go'))}`
      : ''}
  </section>`;

  // 0080 — an order a customer said yes to waits for the owner's tap. The
  // e-mail always says so; this browser can too, if the owner asks it. Hidden
  // until the page's script finds a browser that can (liveScript.ts).
  const tellMe = `<div class="block" data-notify hidden>
    <button type="button" class="btn ghost" data-notify-ask hidden>${esc(t(locale, 'live.notify.ask'))}</button>
    <p class="caption muted" data-notify-on hidden>${esc(t(locale, 'live.notify.on'))}</p>
  </div>`;

  // 2 · THE LAST 24 HOURS — what the assistant did (its ✦) and what you did,
  //     each a door to the list it counts. CC-05: the door to Results stays,
  //     whatever the day held.
  const lastDay = `<section class="block today-last" aria-labelledby="today-last">
    <h2 id="today-last">${esc(t(locale, 'today.last.title'))}</h2>
    ${renderLastDay(today, locale)}
    ${deeper('/app/analytics', t(locale, 'today.results.link'))}
  </section>`;

  // 3 · COMING UP — the calendar's next dated things.
  const coming = `<section class="block today-coming" aria-labelledby="today-coming">
    <h2 id="today-coming">${esc(t(locale, 'today.coming.title'))}</h2>
    ${renderComingUp(today, locale)}
    ${toCalendar(locale)}
  </section>`;

  // G19 — the ceiling she set, before it stops her rather than after. A
  // notice, never attention.
  const budget = s.budget
    ? `<section class="block"><p class="muted">${esc(t(locale, 'today.budget.near', { name, pct: s.budget.pctUsed }))} ${
        esc(t(locale, s.budget.stops ? 'today.budget.thenStops' : 'today.budget.thenKeeps', { name }))}</p></section>`
    : '';

  // Sending (only where messaging is live: a channel connected to an
  // installation that cannot send is not "on"), and Setup while it is
  // unfinished — one line each, at the foot.
  const setup = setupState();
  const finishSetup = setup && setup.next !== null
    ? `<p class="today-foot setup"><span class="muted">${esc(t(locale, 'today.setup.line', { done: setup.done, total: setup.total }))}</span> ${
        deeper(STEP_LINK[setup.next], t(locale, `factory.next.${setup.next}` as MessageKey, { name }))}</p>`
    : '';
  const notLive = !live ? `<p class="block muted notlive">${esc(t(locale, 'ops.system.notLive'))}</p>` : '';

  return `<h1 class="page">${esc(t(locale, 'ops.title'))} <span class="muted today-date">· ${esc(show.dayLong(locale, today.now))}</span></h1>
  ${silenced}
  ${stopped}
  ${now}
  ${lastDay}
  ${coming}
  ${budget}
  ${live ? renderSending(today, locale, Boolean(s.assistantStoppedAt || s.opsSilenced)) : ''}
  ${finishSetup}
  ${notLive}
  ${tellMe}`;
}
