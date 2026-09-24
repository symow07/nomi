import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { detectClaims } from '../../core/safety/claims.js';
import type { KnowledgeKind, KnowledgeSource } from '../../core/types/knowledge.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { t } from './say.js';
import { formatRelative } from '../../core/owner/i18n/format.js';
import { esc } from './layout.js';

/**
 * M14 — Factory Intelligence Operations, READ MODELS ONLY.
 *
 * Every number is a COUNT of real rows/events — no invented metrics, no scores.
 * Gaps are DERIVED (an anti-join of turns against knowledge_used events), never
 * stored. Reasons are classified deterministically from the stored decision +
 * the buyer's own words — no model inference. All queries run inside a tenant
 * transaction, so RLS scopes them; the explicit business_id predicate is
 * belt-and-braces.
 */

export type Range = 'today' | 'week' | 'month';
const RANGE_UNIT: Record<Range, 'day' | 'week' | 'month'> = { today: 'day', week: 'week', month: 'month' };
export const parseRange = (r: string | undefined): Range => (r === 'today' || r === 'month' ? r : 'week');

/** Deterministic — no inference. Order = most actionable first. */
export type GapReason =
  | 'claim_requires_authorization'
  | 'no_product_match'
  | 'product_not_confirmed'
  | 'product_known_no_knowledge';

export type Gap = {
  readonly question: string;
  readonly reason: GapReason;
  readonly productId: string | null;
  readonly count: number;
  readonly lastAt: Date;
};

export type ActivityItem = {
  readonly id: string; readonly productId: string | null;
  readonly kind: KnowledgeKind; readonly label: string;
  readonly change: 'taught' | 'corrected' | 'archived';
  readonly at: Date;
};

export type KnowledgeOps = {
  readonly range: Range;
  readonly hasActivity: boolean;
  readonly report: {
    readonly factsAdded: number; readonly answersCorrected: number;
    readonly certsAuthorized: number; readonly archived: number;
    readonly commonRequests: readonly { readonly question: string; readonly count: number }[];
  };
  readonly gaps: readonly Gap[];
  readonly activity: readonly ActivityItem[];
};

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').trim();

function classify(question: string, productId: string | null, confirmed: boolean | null, authorizedCerts: ReadonlySet<string>): GapReason {
  const claims = detectClaims(question).filter((c) => c.kind === 'certification' || c.kind === 'compliance');
  if (claims.some((c) => !authorizedCerts.has(c.claimKey))) return 'claim_requires_authorization';
  if (!productId) return 'no_product_match';
  if (confirmed === false) return 'product_not_confirmed';
  return 'product_known_no_knowledge';
}

export async function loadKnowledgeOps(db: Db, businessIdRaw: string, range: Range): Promise<KnowledgeOps> {
  const empty: KnowledgeOps = {
    range, hasActivity: false,
    report: { factsAdded: 0, answersCorrected: 0, certsAuthorized: 0, archived: 0, commonRequests: [] },
    gaps: [], activity: [],
  };
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return empty;
  const B = bid.value;
  const unit = RANGE_UNIT[range];

  return withTenantTx(db, B, async (tx) => {
    const cutoff = (await sql<{ c: Date }>`
      select (date_trunc(${unit}, now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai') as c
    `.execute(tx)).rows[0]!.c;

    // ── learning report (plain counts) ──────────────────────────────────────
    const r = (await sql<{ facts: number; corrected: number; certs: number; archived: number }>`
      select
        (select count(*)::int from product_knowledge where business_id=${B} and source='owner_confirmed' and status='active' and created_at>=${cutoff}) as facts,
        (select count(*)::int from product_knowledge where business_id=${B} and source='owner_corrected' and created_at>=${cutoff}) as corrected,
        (select count(*)::int from claims_policy      where business_id=${B} and allowed and created_at>=${cutoff}) as certs,
        (select count(*)::int from product_knowledge where business_id=${B} and status='archived' and updated_at>=${cutoff}) as archived
    `.execute(tx)).rows[0]!;

    const commonRequests = (await sql<{ question: string; n: number }>`
      select (array_agg(input->>'text' order by created_at desc))[1] as question, count(*)::int as n
        from turns
       where business_id=${B} and created_at>=${cutoff} and coalesce(input->>'text','') <> ''
       group by lower(regexp_replace(trim(input->>'text'), '\\s+', ' ', 'g'))
       order by n desc, max(created_at) desc
       limit 5
    `.execute(tx)).rows.map((x) => ({ question: x.question, count: x.n }));

    // ── recent activity ─────────────────────────────────────────────────────
    const activity = (await sql<{ id: string; product_id: string | null; kind: string; label: string; source: string; status: string; ts: Date }>`
      select id, product_id, kind, label, source, status, greatest(created_at, updated_at) as ts
        from product_knowledge
       where business_id=${B} and source <> 'system_seed' and (created_at>=${cutoff} or updated_at>=${cutoff})
       order by ts desc limit 20
    `.execute(tx)).rows.map((x): ActivityItem => ({
      id: x.id, productId: x.product_id, kind: x.kind as KnowledgeKind, label: x.label,
      change: x.status === 'archived' ? 'archived' : (x.source as KnowledgeSource) === 'owner_corrected' ? 'corrected' : 'taught',
      at: x.ts,
    }));

    // ── gaps: turns that answered WITHOUT taught knowledge (derived) ─────────
    const authorized = new Set((await sql<{ claim_key: string }>`
      select claim_key from claims_policy where business_id=${B} and kind in ('certification','compliance') and allowed
    `.execute(tx)).rows.map((x) => x.claim_key));

    const gapRows = (await sql<{ question: string; product_id: string | null; confirmed: boolean | null; created_at: Date }>`
      select t.input->>'text' as question,
             t.decision->'product'->>'productId' as product_id,
             (t.decision->'product'->>'confirmedByClient')::boolean as confirmed,
             t.created_at
        from turns t
       where t.business_id=${B} and t.created_at>=${cutoff}
         and t.decision->'action'->>'kind' = 'generate_reply'
         and coalesce(t.input->>'text','') <> ''
         and t.message_id not in (
           select payload->>'messageId' from conversation_events
            where business_id=${B} and type='knowledge_used' and payload->>'messageId' is not null
         )
       order by t.created_at desc limit 300
    `.execute(tx)).rows;

    const groups = new Map<string, Gap & { question: string }>();
    for (const row of gapRows) {
      const reason = classify(row.question, row.product_id, row.confirmed, authorized);
      const key = norm(row.question);
      const g = groups.get(key);
      if (!g) {
        groups.set(key, { question: row.question, reason, productId: row.product_id, count: 1, lastAt: row.created_at });
      } else {
        (g as { count: number }).count += 1;
        if (row.created_at > g.lastAt) Object.assign(g, { question: row.question, reason, productId: row.product_id, lastAt: row.created_at });
      }
    }
    const gaps = [...groups.values()]
      .sort((a, b) => b.count - a.count || b.lastAt.getTime() - a.lastAt.getTime())
      .slice(0, 12);

    const hasActivity = r.facts + r.corrected + r.certs + r.archived + gaps.length + activity.length + commonRequests.length > 0;
    return {
      range, hasActivity,
      report: { factsAdded: r.facts, answersCorrected: r.corrected, certsAuthorized: r.certs, archived: r.archived, commonRequests },
      gaps, activity,
    };
  });
}

// ── per-knowledge-row usage facts (for the product page) ─────────────────────

export type UsageFact = {
  readonly usedCount: number;
  readonly lastUsedAt: Date | null;
  readonly correctionCount: number;   // prior archived versions of this topic
  readonly source: KnowledgeSource;
};

export function renderUsageFact(f: UsageFact | undefined, locale: Locale, now: Date): string {
  if (!f) return '';
  const parts = [
    `${esc(t(locale, 'knowledge.usage.used'))} ${f.usedCount}`,
    f.lastUsedAt ? `${esc(t(locale, 'knowledge.usage.lastUsed'))} ${esc(formatRelative(locale, f.lastUsedAt, now))}` : esc(t(locale, 'knowledge.usage.never')),
    f.correctionCount > 0 ? `${esc(t(locale, 'knowledge.usage.revised', { n: f.correctionCount }))}` : '',
    esc(t(locale, `knowledge.source.${f.source}` as MessageKey)),
  ].filter(Boolean);
  return `<div class="usage muted">${parts.join(' · ')}</div>`;
}

// ── ops overview renderer (pure, localized, escaped) ─────────────────────────

const reasonLabel = (l: Locale, r: GapReason) => t(l, `knowledge.gap.reason.${r}` as MessageKey);

export function renderKnowledgeOps(ops: KnowledgeOps, locale: Locale, now: Date): string {
  const tab = (r: Range) =>
    `<a class="tab ${ops.range === r ? 'on' : ''}" href="/app/knowledge?range=${r}">${esc(t(locale, `knowledge.ops.range.${r}` as MessageKey))}</a>`;
  const tabs = `<div class="tabs">${tab('today')}${tab('week')}${tab('month')}</div>`;

  const stat = (labelKey: MessageKey, n: number) =>
    `<div class="stat"><div class="v">${n}</div><div class="l">${esc(t(locale, labelKey))}</div></div>`;
  const report = `<div class="block"><h2>${esc(t(locale, 'knowledge.ops.thisPeriod'))}</h2>
    <div class="stats">
      ${stat('knowledge.report.facts', ops.report.factsAdded)}
      ${stat('knowledge.report.corrected', ops.report.answersCorrected)}
      ${stat('knowledge.report.certs', ops.report.certsAuthorized)}
      ${stat('knowledge.report.archived', ops.report.archived)}
    </div>
    ${ops.report.commonRequests.length ? `<h3 class="sub">${esc(t(locale, 'knowledge.ops.commonRequests'))}</h3>
      <ul class="reqs">${ops.report.commonRequests.map((q) =>
        `<li><span class="q">${esc(q.question)}</span> <span class="muted">×${q.count}</span></li>`).join('')}</ul>` : ''}
  </div>`;

  const gapCard = (g: Gap) => {
    const teachHref = g.productId
      ? `/app/knowledge/${encodeURIComponent(g.productId)}?teach=${encodeURIComponent(g.question)}`
      : `/app/knowledge?teach=${encodeURIComponent(g.question)}`;
    const testHref = `/app/sandbox?ask=${encodeURIComponent(g.question)}`;
    return `<div class="gap">
      <div class="gq">${esc(g.question)}${g.count > 1 ? ` <span class="muted">×${g.count}</span>` : ''}</div>
      <div class="gmeta"><span class="pill reason">${esc(reasonLabel(locale, g.reason))}</span>
        <span class="muted">${esc(formatRelative(locale, g.lastAt, now))}</span></div>
      <div class="gacts"><a class="btn" href="${teachHref}">${esc(t(locale, 'knowledge.gap.teach'))}</a>
        <a class="btn ghost" href="${testHref}">${esc(t(locale, 'knowledge.gap.test'))}</a></div>
    </div>`;
  };
  const gaps = `<div class="block"><h2>${esc(t(locale, 'knowledge.ops.gaps'))}</h2>
    ${ops.gaps.length ? ops.gaps.map(gapCard).join('') : `<div class="empty muted">${esc(t(locale, 'knowledge.ops.noGaps'))}</div>`}
  </div>`;

  const activity = `<div class="block"><h2>${esc(t(locale, 'knowledge.ops.activity'))}</h2>
    ${ops.activity.length ? `<ul class="acts">${ops.activity.map((a) =>
      `<li><span class="pill ${a.change}">${esc(t(locale, `knowledge.activity.${a.change}` as MessageKey))}</span>
        <span>${esc(a.label)}</span> <span class="muted">${esc(formatRelative(locale, a.at, now))}</span></li>`).join('')}</ul>`
      : `<div class="empty muted">${esc(t(locale, 'knowledge.ops.noActivity'))}</div>`}
  </div>`;

  return `${tabs}${report}${gaps}${activity}${OPS_STYLE}`;
}

const OPS_STYLE = `<style>
  .stat .v { font-size:var(--font-size-display); font-weight:700; color:var(--color-ink); } .stat .l { font-size:var(--font-size-caption); color:var(--color-ink-secondary); margin-top:var(--space-4); }
  h3.sub { font-size:var(--font-size-caption); color:var(--color-ink-secondary); margin:var(--space-16) 0 var(--space-8); }
  .reqs { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--space-4); }
  .reqs .q { color:var(--color-ink); }
  .gap { border:1px solid var(--color-border); border-radius:12px; padding:14px; margin-bottom:var(--space-12); }
  .gq { font-size:var(--font-size-small); margin-bottom:var(--space-8); } .gmeta { display:flex; gap:var(--space-8); align-items:center; margin-bottom:var(--space-12); }
  .gacts { display:flex; gap:var(--space-8); }
  .pill.reason { background:var(--color-waiting-wash); color:var(--color-waiting); }
  .pill.taught { background:var(--color-jade-wash); color:var(--color-ok); } .pill.corrected { background:var(--color-highlight-wash); color:var(--color-highlight); } .pill.archived { background:var(--color-border); color:var(--color-ink-secondary); }
  .acts { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--space-8); }
  .acts li { display:flex; align-items:center; gap:var(--space-8); }
  .usage { font-size:var(--font-size-caption); margin-top:var(--space-8); }
  @media (max-width:560px) { }
</style>`;

/** Usage facts keyed by knowledge row id, for a product's active rows. */
export async function loadUsageFacts(db: Db, businessIdRaw: string, productId: string): Promise<Map<string, UsageFact>> {
  const bid = parseBusinessId(businessIdRaw);
  const out = new Map<string, UsageFact>();
  if (!bid.ok) return out;
  const B = bid.value;
  return withTenantTx(db, B, async (tx) => {
    const rows = (await sql<{ id: string; source: string; used: number; last_used: Date | null; corrections: number }>`
      select k.id, k.source,
             (select count(*)::int from conversation_events e
               where e.business_id=${B} and e.type='knowledge_used' and e.payload->'ids' ? k.id::text) as used,
             (select max(e.created_at) from conversation_events e
               where e.business_id=${B} and e.type='knowledge_used' and e.payload->'ids' ? k.id::text) as last_used,
             (select count(*)::int from product_knowledge o
               where o.business_id=${B} and o.status='archived'
                 and o.product_id is not distinct from k.product_id and o.label = k.label) as corrections
        from product_knowledge k
       where k.business_id=${B} and k.product_id=${productId} and k.status='active'
    `.execute(tx)).rows;
    for (const x of rows) {
      out.set(x.id, {
        usedCount: x.used, lastUsedAt: x.last_used, correctionCount: x.corrections, source: x.source as KnowledgeSource,
      });
    }
    return out;
  });
}
