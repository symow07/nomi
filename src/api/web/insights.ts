import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { promotionDecision } from '../../core/trust/evidence.js';
import { loadCapabilityEvidence, NON_PROMOTABLE } from '../../pipeline/capability.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { t, capabilityName, EMPLOYEE_NAME, type MessageKey } from '../../core/owner/i18n/messages.js';
import { biggestChange, MONTH_DRIVERS, type MonthDriver } from '../../core/insights/changed.js';
import { esc } from './layout.js';

/**
 * M34.10 — insights, not counts.
 *
 * PORTED FROM core/insights/daily.ts, which was written in M7, tested, and
 * reached by nothing. The module is deleted; the RULE it existed to carry is
 * kept, and it is the whole point of this file:
 *
 *   AN INSIGHT THAT DOES NOT TELL THE OWNER WHAT TO TAP DOES NOT RENDER.
 *
 * That is enforced by the TYPE — every Insight carries a mandatory action — and
 * by a test, because a rule that lives only in a type is a rule the next
 * `as never` walks through. It is what would have stopped /app/analytics
 * becoming four counts with nothing to do about them, which is exactly what the
 * live page had become while a better implementation sat unwired.
 *
 * WHAT DID NOT COME ACROSS. The M7 module's sibling, `questions.ts`, ranked its
 * drivers by percentage — "询盘多了67%", "报价成单率升到23%". The product banned
 * percentages and conversion rates afterwards, and the ranking mechanism WAS the
 * percentage, so there was nothing left to port. This half needed none: every
 * number below is a count of rows or a dollar figure the owner already agreed
 * to, and the ordering is by severity, fixed in code.
 *
 * Three locales, like everything the owner reads. The M7 original was zh-only,
 * which is the other reason it could not simply be wired.
 */

/** The at-most-three findings, most urgent first. */
export const MAX_INSIGHTS = 3;

/** Every action is a real route. A label with nowhere to go is not an action. */
export type InsightAction =
  | { readonly kind: 'review_drafts'; readonly href: '/app/inbox' }
  | { readonly kind: 'follow_up'; readonly href: string; readonly buyer: string }
  | { readonly kind: 'consider_promotion'; readonly href: '/app/employee'; readonly capability: string }
  | { readonly kind: 'fix_catalog'; readonly href: '/app/products' }
  /** M51.5 — a change in the month is a change in HER BUYERS. That is where
   *  it is visible one conversation at a time, so that is where it points. */
  | { readonly kind: 'seeBuyers'; readonly href: '/app/conversations' };

export type Insight = {
  /** Language-NEUTRAL: the renderer localizes. Params are counts and names. */
  readonly key: MessageKey;
  readonly params: Record<string, string | number>;
  /** Structurally mandatory. There is no Insight without somewhere to go. */
  readonly action: InsightAction;
};

export type InsightsData = {
  /** At most MAX_INSIGHTS things to DO, most urgent first. */
  readonly insights: readonly Insight[];
  /**
   * G19 — what CHANGED this month, kept out of the three.
   *
   * It used to be pushed onto the same list and then cut by `slice(0, 3)`: on
   * exactly the busy month it exists to explain, three things to do crowded it
   * out, so the owner saw it only when little was happening. It is a different
   * kind of thing — something to know, not something to do — and it now has its
   * own place instead of competing for theirs. Null when nothing moved.
   */
  readonly monthChange: Insight | null;
};

export async function loadInsights(db: Db, businessIdRaw: string): Promise<InsightsData> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { insights: [], monthChange: null };

  return withTenantTx(db, bid.value, async (tx) => {
    const out: Insight[] = [];

    // 1. A buyer who was quoted and went quiet. The most expensive silence in
    //    the product: the work is done and the deal is dying of nothing.
    const quoted = (await sql<{ buyer: string; conversation_id: string; total_usd: string | null }>`
      select coalesce(cl.display_name, 'Buyer') as buyer, c.id as conversation_id, q.total_usd
        from quotes q
        join conversations c on c.id = q.conversation_id
        join clients cl on cl.id = c.client_id
       where q.business_id = ${bid.value}
         and c.is_active
         and not exists (
           select 1 from messages m
            where m.conversation_id = c.id and m.direction = 'inbound' and m.sent_at > q.created_at
         )
         and q.created_at < now() - interval '2 days'
       order by q.total_usd desc nulls last limit 1`.execute(tx)).rows[0];
    if (quoted) {
      out.push({
        key: 'insight.quotedNoReply',
        params: { buyer: quoted.buyer },
        action: { kind: 'follow_up', href: `/app/inbox/${encodeURIComponent(quoted.conversation_id)}`, buyer: quoted.buyer },
      });
    }

    // 2. Drafts waiting. She has done the work and cannot send it.
    const waiting = (await sql<{ n: number }>`
      select count(*)::int as n from drafts
       where business_id = ${bid.value} and status = 'pending'`.execute(tx)).rows[0]!.n;
    if (waiting > 0) {
      out.push({
        key: 'insight.draftsWaiting',
        params: { count: waiting },
        action: { kind: 'review_drafts', href: '/app/inbox' },
      });
    }

    // 3. A capability that has earned promotion. Only reachable at all since
    //    M34.7 gave spot checks a producer.
    const caps = (await sql<{ capability: string }>`
      select capability from autonomy_policy
       where business_id = ${bid.value} and mode = 'draft' order by capability`.execute(tx)).rows;
    for (const c of caps) {
      if (NON_PROMOTABLE.includes(c.capability)) continue;
      if (!promotionDecision(await loadCapabilityEvidence(tx, c.capability)).eligible) continue;
      out.push({
        key: 'insight.promotionReady',
        params: { cap: c.capability },
        action: { kind: 'consider_promotion', href: '/app/employee', capability: c.capability },
      });
      break;   // one at a time; a list of promotions is a chore, not an insight
    }

    // 4. Products she cannot quote. M29: absence is not a default, so a product
    //    with no stated price is a product she must refuse on.
    const noPrice = (await sql<{ n: number }>`
      select count(*)::int as n from products p
       where p.business_id = ${bid.value} and p.is_active
         and not exists (select 1 from price_tiers pt where pt.product_id = p.id)`.execute(tx)).rows[0]!.n;
    if (noPrice > 0) {
      out.push({
        key: 'insight.productsNoPrice',
        params: { count: noPrice },
        action: { kind: 'fix_catalog', href: '/app/products' },
      });
    }

    /**
     * 5. M51.5 — WHY DID THIS MONTH CHANGE?
     *
     * Last, and deliberately: the four above are things to DO, and this is
     * something to KNOW. It appears only when there is something to say, and
     * it says it as two counts — never a rate, which is the whole reason its
     * first implementation was deleted rather than wired.
     *
     * A month boundary in HER timezone: "this month" for a Yiwu factory is not
     * this month in UTC, and a driver that moved because of a date line is a
     * fact about our servers rather than about her business.
     */
    const months = (await sql<{
      driver: string; from_count: number; to_count: number;
    }>`
      with bounds as (
        select date_trunc('month', (now() at time zone 'Asia/Shanghai')) as this_start,
               date_trunc('month', (now() at time zone 'Asia/Shanghai') - interval '1 month') as last_start
      ),
      inquiries as (
        select 'inquiries' as driver,
               count(*) filter (where m.sent_at >= (b.last_start at time zone 'Asia/Shanghai')
                                  and m.sent_at <  (b.this_start at time zone 'Asia/Shanghai'))::int as from_count,
               count(*) filter (where m.sent_at >= (b.this_start at time zone 'Asia/Shanghai'))::int as to_count
          from messages m
          join conversations c on c.id = m.conversation_id
          cross join bounds b
         where c.business_id = ${bid.value} and m.direction = 'inbound'
      ),
      quoted as (
        select 'quotes' as driver,
               count(*) filter (where q.created_at >= (b.last_start at time zone 'Asia/Shanghai')
                                  and q.created_at <  (b.this_start at time zone 'Asia/Shanghai'))::int as from_count,
               count(*) filter (where q.created_at >= (b.this_start at time zone 'Asia/Shanghai'))::int as to_count
          from quotes q cross join bounds b
         where q.business_id = ${bid.value}
      ),
      ordered as (
        select 'orders' as driver,
               count(*) filter (where o.created_at >= (b.last_start at time zone 'Asia/Shanghai')
                                  and o.created_at <  (b.this_start at time zone 'Asia/Shanghai'))::int as from_count,
               count(*) filter (where o.created_at >= (b.this_start at time zone 'Asia/Shanghai'))::int as to_count
          from orders o cross join bounds b
         where o.business_id = ${bid.value}
      )
      select * from inquiries union all select * from quoted union all select * from ordered
    `.execute(tx)).rows;

    const counts = Object.fromEntries(MONTH_DRIVERS.map((d) => {
      const row = months.find((r) => r.driver === d);
      return [d, { from: Number(row?.from_count ?? 0), to: Number(row?.to_count ?? 0) }];
    })) as Record<MonthDriver, { from: number; to: number }>;

    const changed = biggestChange(counts);
    const monthChange: Insight | null = changed
      ? {
          key: `insight.monthChange.${changed.driver}.${changed.change > 0 ? 'up' : 'down'}` as MessageKey,
          params: { from: changed.from, to: changed.to },
          action: { kind: 'seeBuyers', href: '/app/conversations' },
        }
      : null;

    return { insights: out.slice(0, MAX_INSIGHTS), monthChange };
  });
}

/** ── Renderer (pure, localized) ───────────────────────────────────────────── */

export function renderInsights(d: InsightsData, locale: Locale): string {
  if (d.insights.length === 0 && !d.monthChange) return '';
  const name = EMPLOYEE_NAME[locale];
  const row = (i: Insight): string => {
    const line = t(locale, i.key, { ...i.params, name, ...(i.params['cap'] !== undefined
      ? { cap: capabilityName(locale, String(i.params['cap'])) } : {}) });
    const label = t(locale, `insight.action.${i.action.kind}` as MessageKey);
    return `<div class="insight">
      <div class="iline">${esc(line)}</div>
      <a class="btn" href="${esc(i.action.href)}">${esc(label)}</a>
    </div>`;
  };
  return `<div class="block insights"><h2>${esc(t(locale, 'insight.title'))}</h2>
    ${d.insights.map(row).join('')}
    ${d.monthChange ? row(d.monthChange) : ''}
  </div>${INSIGHT_STYLE}`;
}

const INSIGHT_STYLE = `<style>
  .insight { display:flex; align-items:center; justify-content:space-between; gap:var(--space-12);
             padding:10px 0; border-bottom:1px solid var(--color-border); }
  .insight:last-child { border-bottom:0; }
  .iline { flex:1; }
  .insight .btn { flex:none; }
</style>`;
