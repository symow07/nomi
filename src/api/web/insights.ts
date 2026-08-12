import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { promotionDecision } from '../../core/trust/evidence.js';
import { loadCapabilityEvidence, NON_PROMOTABLE } from '../../pipeline/capability.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { t, capabilityName, EMPLOYEE_NAME, type MessageKey } from '../../core/owner/i18n/messages.js';
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
  | { readonly kind: 'fix_catalog'; readonly href: '/app/products' };

export type Insight = {
  /** Language-NEUTRAL: the renderer localizes. Params are counts and names. */
  readonly key: MessageKey;
  readonly params: Record<string, string | number>;
  /** Structurally mandatory. There is no Insight without somewhere to go. */
  readonly action: InsightAction;
};

export type InsightsData = { readonly insights: readonly Insight[] };

export async function loadInsights(db: Db, businessIdRaw: string): Promise<InsightsData> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { insights: [] };

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

    return { insights: out.slice(0, MAX_INSIGHTS) };
  });
}

/** ── Renderer (pure, localized) ───────────────────────────────────────────── */

export function renderInsights(d: InsightsData, locale: Locale): string {
  if (d.insights.length === 0) return '';
  const name = EMPLOYEE_NAME[locale];
  return `<div class="block insights"><h2>${esc(t(locale, 'insight.title'))}</h2>
    ${d.insights.map((i) => {
      const line = t(locale, i.key, { ...i.params, name, ...(i.params['cap'] !== undefined
        ? { cap: capabilityName(locale, String(i.params['cap'])) } : {}) });
      const label = t(locale, `insight.action.${i.action.kind}` as MessageKey);
      return `<div class="insight">
        <div class="iline">${esc(line)}</div>
        <a class="btn" href="${esc(i.action.href)}">${esc(label)}</a>
      </div>`;
    }).join('')}
  </div>${INSIGHT_STYLE}`;
}

const INSIGHT_STYLE = `<style>
  .insight { display:flex; align-items:center; justify-content:space-between; gap:12px;
             padding:10px 0; border-bottom:1px solid var(--color-border); }
  .insight:last-child { border-bottom:0; }
  .iline { flex:1; }
  .insight .btn { flex:none; }
</style>`;
