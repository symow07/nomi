import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { t } from './say.js';
import { formatDate } from '../../core/owner/i18n/format.js';
import { runAll } from '../../trust/harness.js';
import { SCENARIOS } from '../../trust/scenarios.js';
import { type RehearsalReport } from '../../trust/factoryRehearsal.js';
import type { TemplateState } from '../../core/channel/window.js';
import { loadOperationsSnapshot, type OperationsSnapshot, type Range } from './operations.js';
import { type DeploymentInfo } from './deployment.js';
import { type MetaReadiness } from '../../core/channel/metaReadiness.js';
import { templateReadiness, TEMPLATE_ENTRY_POINT } from '../../core/channel/templateReadiness.js';
import { esc, deeper } from './layout.js';
import { PROBLEM_SIGNAL_KINDS } from '../../core/scoring/signals.js';

/**
 * M15.1 — Pilot Readiness Hub. Extends the M11.2 onboarding into a single
 * operational checklist for taking one factory to "ready employee".
 *
 * DETECTED items are live-derived from real data (profile/products/knowledge/
 * claims/channel + the sandbox validation result). OWNER-CONFIRMED items are
 * timestamped attestations for facts the app cannot observe (backup tested,
 * secrets rotated, owner ready). The UI keeps the two clearly apart:
 * "Verified by system" vs "Confirmed by owner". No scores, no percentages.
 */

export type DetectedKey =
  | 'profile' | 'products' | 'priceRules' | 'knowledge' | 'claims' | 'sandbox' | 'channel';
export type AttestKey = 'backup_tested' | 'secrets_rotated' | 'owner_ready' | 'claims_reviewed';

const ATTEST_COL: Record<AttestKey, string> = {
  backup_tested: 'backup_tested_at', secrets_rotated: 'secrets_rotated_at',
  owner_ready: 'owner_ready_at', claims_reviewed: 'claims_reviewed_at',
};

export type PilotReadiness = {
  readonly detected: Record<DetectedKey, boolean>;
  readonly attest: { readonly backupTestedAt: Date | null; readonly secretsRotatedAt: Date | null; readonly ownerReadyAt: Date | null };
  readonly validation: { readonly at: Date | null; readonly pass: number | null; readonly total: number | null };
  readonly readyToLaunch: boolean;   // everything but the channel (that's what launch turns on)
};

export async function loadPilotReadiness(db: Db, businessIdRaw: string): Promise<PilotReadiness> {
  const empty: PilotReadiness = {
    detected: { profile: false, products: false, priceRules: false, knowledge: false, claims: false, sandbox: false, channel: false },
    attest: { backupTestedAt: null, secretsRotatedAt: null, ownerReadyAt: null },
    validation: { at: null, pass: null, total: null },
    readyToLaunch: false,
  };
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return empty;
  const B = bid.value;

  return withTenantTx(db, B, async (tx) => {
    const r = (await sql<{
      profile: boolean; products: boolean; price_rules: boolean; knowledge: boolean; claims: boolean; channel: boolean;
      backup_tested_at: Date | null; secrets_rotated_at: Date | null; owner_ready_at: Date | null;
      last_validation_at: Date | null; last_validation_pass: number | null; last_validation_total: number | null;
    }>`
      with os as (select * from onboarding_state where business_id = ${B})
      select
        coalesce((select (description is not null and location is not null and (contact_email is not null or contact_phone is not null)) from businesses where id = ${B}), false) as profile,
        exists(select 1 from products where business_id = ${B} and is_active and price_usd_per_unit is not null) as products,
        -- M29 — has a HUMAN stated what she may never go below? A row is only
        -- ever written by savePriceRules; the importer used to fabricate one per
        -- product (floor = list price, no discount authority), so this check
        -- would have read true on a factory whose rules nobody had written.
        exists(select 1 from pricing_policy where business_id = ${B}) as price_rules,
        exists(select 1 from product_knowledge where business_id = ${B} and status = 'active' and source in ('owner_confirmed','owner_corrected')) as knowledge,
        (exists(select 1 from claims_policy where business_id = ${B} and allowed) or (select claims_reviewed_at from os) is not null) as claims,
        -- Same predicate as loadOnboarding: connected AND holding an active
        -- credential. The two derivations had already drifted — a rotated
        -- credential left readiness saying "connected" while My factory's next
        -- step said "connect WhatsApp", on the same page.
        exists(select 1 from channels ch
                 join channel_credentials cc on cc.business_id = ch.business_id
                   and cc.channel = 'whatsapp' and cc.is_active
                where ch.business_id = ${B} and ch.kind = 'whatsapp' and ch.status = 'connected') as channel,
        (select backup_tested_at from os) as backup_tested_at,
        (select secrets_rotated_at from os) as secrets_rotated_at,
        (select owner_ready_at from os) as owner_ready_at,
        (select last_validation_at from os) as last_validation_at,
        (select last_validation_pass from os) as last_validation_pass,
        (select last_validation_total from os) as last_validation_total
    `.execute(tx)).rows[0]!;

    const sandbox = r.last_validation_at !== null && r.last_validation_pass !== null
      && r.last_validation_total !== null && r.last_validation_pass === r.last_validation_total;

    const detected = { profile: r.profile, products: r.products, priceRules: r.price_rules,
      knowledge: r.knowledge, claims: r.claims, sandbox, channel: r.channel };
    const attest = { backupTestedAt: r.backup_tested_at, secretsRotatedAt: r.secrets_rotated_at, ownerReadyAt: r.owner_ready_at };
    const readyToLaunch = detected.profile && detected.products && detected.priceRules
      && detected.knowledge && detected.claims && detected.sandbox
      && !!attest.backupTestedAt && !!attest.secretsRotatedAt && !!attest.ownerReadyAt;

    return {
      detected, attest,
      validation: { at: r.last_validation_at, pass: r.last_validation_pass, total: r.last_validation_total },
      readyToLaunch,
    };
  });
}

/**
 * M16.2d — the Pilot Operations Runbook. A READ-ONLY composition that answers
 * the operator's whole-lifecycle questions (before / during / after) by reusing
 * existing read models — it duplicates no SQL and writes nothing:
 *   - before-launch readiness → loadPilotReadiness (M15)
 *   - during-pilot operations → loadOperationsSnapshot (M16.2a, which itself
 *     reuses loadKnowledgeOps + loadChannels)
 *   - rehearsal progress      → DERIVED from existing events, no progress table:
 *       takeover/ownerReply/resume ← the sandbox tenant's conversation_events
 *       knowledgeCorrection        ← the pilot tenant has an owner-corrected fact
 *       validationPassed           ← M15's stored validation, all scenarios pass
 * Everything is ✓/○ + real counts + timestamps. No scores, no percentages.
 */
export type RehearsalStep = 'takeover' | 'ownerReply' | 'resume' | 'knowledgeCorrection' | 'validationPassed';
export const REHEARSAL_STEPS: readonly RehearsalStep[] =
  ['takeover', 'ownerReply', 'resume', 'knowledgeCorrection', 'validationPassed'];

/**
 * M17.4 — the one operational health fact an owner can act on: messages that
 * were accepted for sending but have not gone out. A plain COUNT of queued
 * outbound rows older than STUCK_AFTER_MINUTES, plus how long the oldest has
 * waited. Deliberately on the runbook, NOT the Operations Home — the Home
 * answers "what needs my attention today?", not "how is the plumbing?".
 */
export const STUCK_AFTER_MINUTES = 15;

export type Reliability = {
  readonly stuckOutbound: number;
  readonly oldestQueuedAt: Date | null;
};

export type PilotRunbook = {
  readonly readiness: PilotReadiness;       // before launch (M15)
  readonly operations: OperationsSnapshot;  // during pilot (M16.2a)
  readonly rehearsal: {
    readonly available: boolean;                       // a sandbox tenant exists to practice in
    readonly done: Record<RehearsalStep, boolean>;
    readonly completed: number;
    readonly total: number;
  };
  readonly reliability: Reliability;        // M17.4
};

export async function loadPilotRunbook(
  db: Db, businessIdRaw: string,
  opts: { sandboxBusinessId?: string | undefined; provider?: string | undefined; range?: Range | undefined } = {},
): Promise<PilotRunbook> {
  const provider = opts.provider ?? 'disabled';
  const range: Range = opts.range ?? 'week';

  const [readiness, operations] = await Promise.all([
    loadPilotReadiness(db, businessIdRaw),
    loadOperationsSnapshot(db, businessIdRaw, range, provider),
  ]);

  const v = readiness.validation;
  const validationPassed = v.pass !== null && v.total !== null && v.total > 0 && v.pass === v.total;

  // Knowledge correction practiced — the pilot tenant has an owner-corrected
  // fact (all-time). A single exists() — not a duplicate of M14's gap SQL.
  const bid = parseBusinessId(businessIdRaw);
  const knowledgeCorrection = bid.ok
    ? await withTenantTx(db, bid.value, async (tx) => (await sql<{ e: boolean }>`
        select exists(select 1 from product_knowledge where business_id = ${bid.value} and source = 'owner_corrected') as e
      `.execute(tx)).rows[0]!.e)
    : false;

  // Sandbox rehearsal signals — the SANDBOX tenant's own events, read-only.
  const sb = opts.sandboxBusinessId ? parseBusinessId(opts.sandboxBusinessId) : null;
  const available = !!(sb && sb.ok);
  const sbx = sb && sb.ok
    ? await withTenantTx(db, sb.value, async (tx) => (await sql<{ takeover: boolean; owner_reply: boolean; resume: boolean }>`
        select
          exists(select 1 from conversation_events where business_id = ${sb.value} and type = 'takeover')   as takeover,
          exists(select 1 from conversation_events where business_id = ${sb.value} and type = 'owner_reply') as owner_reply,
          exists(select 1 from conversation_events where business_id = ${sb.value} and type = 'resume_ai')   as resume
      `.execute(tx)).rows[0]!)
    : { takeover: false, owner_reply: false, resume: false };

  // M17.4: stuck outbound — accepted for sending but still queued. One honest
  // COUNT over the existing table; no new storage, no threshold guessing beyond
  // the documented STUCK_AFTER_MINUTES.
  const reliability: Reliability = bid.ok
    ? await withTenantTx(db, bid.value, async (tx) => {
        const r = (await sql<{ n: number; oldest: Date | null }>`
          select count(*)::int as n, min(created_at) as oldest
            from outbound_messages
           where business_id = ${bid.value} and status = 'queued'
             and created_at < now() - (${STUCK_AFTER_MINUTES} || ' minutes')::interval
        `.execute(tx)).rows[0]!;
        return { stuckOutbound: r.n, oldestQueuedAt: r.oldest };
      })
    : { stuckOutbound: 0, oldestQueuedAt: null };

  const done: Record<RehearsalStep, boolean> = {
    takeover: sbx.takeover, ownerReply: sbx.owner_reply, resume: sbx.resume,
    knowledgeCorrection, validationPassed,
  };
  const completed = REHEARSAL_STEPS.filter((s) => done[s]).length;
  return {
    readiness, operations,
    rehearsal: { available, done, completed, total: REHEARSAL_STEPS.length },
    reliability,
  };
}

/**
 * M17.6 — the pilot feedback loop: "what actually happened, and what keeps
 * happening?" Derived entirely from data the system already stores —
 * conversation_signals (why a human was needed) and conversation_events (what
 * the owner did). Counts and timestamps ONLY: no score, no rating, no judgement
 * of how well the employee performed. Recurring issues are simply the reasons
 * that occurred most often, in plain descending count order.
 */
export type FeedbackItem = {
  readonly kind: string;
  readonly count: number;
  readonly lastAt: Date | null;
};

export type PilotFeedback = {
  readonly range: Range;
  /** Why buyers needed a human, most frequent first — the recurring issues. */
  readonly handoffReasons: readonly FeedbackItem[];
  /** What the owner did: takeover / owner_reply / resume_ai / draft_resolved. */
  readonly ownerActions: readonly FeedbackItem[];
  /**
   * Nomi Phase B — DISTINCT conversations where a human actually stepped in:
   * the owner took the conversation over, or replied as themselves. Approving a
   * draft is NOT stepping in — under draft-first every reply is approved, so
   * counting those would say "12 of 12" every day and mean nothing. This counts
   * the exceptions, which is the whole point: predictable work is hers, the
   * exceptions are yours. A real COUNT(DISTINCT …), never a rate.
   */
  readonly conversationsNeedingYou: number;
  readonly lastActivityAt: Date | null;
  readonly hasActivity: boolean;
};

const FEEDBACK_ACTIONS = ['takeover', 'owner_reply', 'resume_ai', 'draft_resolved'] as const;

export async function loadPilotFeedback(
  db: Db, businessIdRaw: string, range: Range = 'month',
): Promise<PilotFeedback> {
  const empty: PilotFeedback = {
    range, handoffReasons: [], ownerActions: [], conversationsNeedingYou: 0,
    lastActivityAt: null, hasActivity: false,
  };
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return empty;
  const B = bid.value;
  const unit = range === 'today' ? 'day' : range;

  return withTenantTx(db, B, async (tx) => {
    const cutoff = (await sql<{ c: Date }>`
      select (date_trunc(${unit}, now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai') as c
    `.execute(tx)).rows[0]!.c;

    // Recurring issues: the stored PROBLEM signals, grouped. No classifier.
    // G2c — the kinds come from core. This list was a hand copy that never
    // learned 'audio_unheard', so a voice note she could not hear gated the
    // close and was missing from the one summary of why she was needed.
    const reasons = (await sql<{ kind: string; n: number; last_at: Date }>`
      select kind, count(*)::int as n, max(created_at) as last_at
        from conversation_signals
       where business_id = ${B} and created_at >= ${cutoff}
         and kind = any(${[...PROBLEM_SIGNAL_KINDS]}::text[])
       group by kind order by n desc, kind asc
    `.execute(tx)).rows;

    const actions = (await sql<{ type: string; n: number; last_at: Date }>`
      select type, count(*)::int as n, max(created_at) as last_at
        from conversation_events
       where business_id = ${B} and created_at >= ${cutoff}
         and type in ('takeover','owner_reply','resume_ai','draft_resolved')
       group by type order by n desc, type asc
    `.execute(tx)).rows;

    // Distinct conversations a human actually stepped into (see the type note).
    const needing = (await sql<{ n: number }>`
      select count(distinct conversation_id)::int as n
        from conversation_events
       where business_id = ${B} and created_at >= ${cutoff}
         and type in ('takeover', 'owner_reply')
    `.execute(tx)).rows[0]!.n;

    const handoffReasons = reasons.map((r): FeedbackItem => ({ kind: r.kind, count: r.n, lastAt: r.last_at }));
    const ownerActions = actions.map((r): FeedbackItem => ({ kind: r.type, count: r.n, lastAt: r.last_at }));
    const stamps = [...handoffReasons, ...ownerActions]
      .map((i) => i.lastAt).filter((d): d is Date => d !== null);
    const lastActivityAt = stamps.length
      ? stamps.reduce((a, b) => (a > b ? a : b))
      : null;

    return {
      range, handoffReasons, ownerActions, conversationsNeedingYou: needing, lastActivityAt,
      hasActivity: handoffReasons.length > 0 || ownerActions.length > 0,
    };
  });
}

/** Record an owner attestation (timestamp). Whitelisted column — never user input. */
export async function attest(db: Db, businessIdRaw: string, which: AttestKey): Promise<{ ok: boolean }> {
  const bid = parseBusinessId(businessIdRaw);
  const col = ATTEST_COL[which];
  if (!bid.ok || !col) return { ok: false };
  await withTenantTx(db, bid.value, (tx) => sql`
    insert into onboarding_state (business_id, ${sql.raw(col)}) values (${bid.value}, now())
    on conflict (business_id) do update set ${sql.raw(col)} = now(), updated_at = now()
  `.execute(tx));
  return { ok: true };
}

/**
 * Replay the M12.1 golden scenarios through the REAL engine (the promoted
 * harness — the same computeTurn/commitTurn the sandbox uses) and record the
 * summary. No per-scenario history yet.
 */
export async function runValidation(db: Db, businessIdRaw: string): Promise<{ pass: number; total: number }> {
  const bid = parseBusinessId(businessIdRaw);
  const report = await runAll(SCENARIOS);
  if (bid.ok) {
    await withTenantTx(db, bid.value, (tx) => sql`
      insert into onboarding_state (business_id, last_validation_at, last_validation_pass, last_validation_total)
      values (${bid.value}, now(), ${report.passed}, ${report.total})
      on conflict (business_id) do update set
        last_validation_at = now(), last_validation_pass = ${report.passed},
        last_validation_total = ${report.total}, updated_at = now()
    `.execute(tx));
  }
  return { pass: report.passed, total: report.total };
}

// ── renderer (pure, localized, escaped) ──────────────────────────────────────

const DETECTED_LINK: Record<DetectedKey, string> = {
  profile: '/app/settings', products: '/app/products', priceRules: '/app/factory/prices',
  knowledge: '/app/knowledge', claims: '/app/knowledge', sandbox: '/app/sandbox',
  channel: '/app/channels',
};

function detectedRow(key: DetectedKey, done: boolean, locale: Locale): string {
  const label = esc(t(locale, `pilot.item.${key}` as MessageKey));
  if (done) {
    return `<div class="pr done"><span class="mk">✓</span> <span class="lbl">${label}</span>
      <span class="badge sys">${esc(t(locale, 'pilot.verifiedBySystem'))}</span></div>`;
  }
  const extra = key === 'claims'
    ? `<form method="post" action="/app/onboarding/attest" class="inline"><input type="hidden" name="which" value="claims_reviewed" /><button class="btn ghost" type="submit">${esc(t(locale, 'pilot.claims.none'))}</button></form>`
    : '';
  return `<div class="pr todo"><span class="mk">○</span> <span class="lbl">${label}</span>
    <div class="pr-b"><span class="muted">${esc(t(locale, `pilot.blocker.${key}` as MessageKey))}</span>
      <a class="btn" href="${DETECTED_LINK[key]}">${esc(t(locale, 'pilot.open'))}</a>${extra}</div></div>`;
}

function attestRow(key: 'backup_tested' | 'secrets_rotated' | 'owner_ready', at: Date | null, locale: Locale): string {
  const label = esc(t(locale, `pilot.attest.${key}` as MessageKey));
  if (at) {
    return `<div class="pr done"><span class="mk">✓</span> <span class="lbl">${label}</span>
      <span class="badge owner">${esc(t(locale, 'pilot.confirmedByOwner'))} · ${esc(formatDate(locale, at))}</span></div>`;
  }
  return `<div class="pr todo"><span class="mk">○</span> <span class="lbl">${label}</span>
    <form method="post" action="/app/onboarding/attest" class="inline">
      <input type="hidden" name="which" value="${key}" />
      <button class="btn" type="submit">${esc(t(locale, 'pilot.attest.confirm'))}</button>
    </form></div>`;
}

export function renderPilotReadiness(d: PilotReadiness, locale: Locale, flash: string | null): string {
  const flashHtml = flash ? `<div class="flash" role="status">${esc(flash)}</div>` : '';
  const detectedOrder: DetectedKey[] = ['profile', 'products', 'priceRules', 'knowledge', 'claims', 'sandbox', 'channel'];
  const setup = detectedOrder.map((k) => detectedRow(k, d.detected[k], locale)).join('');

  const v = d.validation;
  const valLine = v.at && v.pass !== null && v.total !== null
    ? `${esc(t(locale, 'pilot.validate.result', { pass: v.pass, total: v.total, date: formatDate(locale, v.at) }))}`
    : esc(t(locale, 'pilot.validate.never'));
  const validate = `<div class="pr ${d.detected.sandbox ? 'done' : 'todo'}">
      <span class="mk">${d.detected.sandbox ? '✓' : '○'}</span>
      <span class="lbl">${esc(t(locale, 'pilot.item.sandbox'))}</span>
      <div class="pr-b"><span class="muted">${valLine}</span>
        <form method="post" action="/app/onboarding/validate" class="inline"><button class="btn" type="submit">${esc(t(locale, 'pilot.validate'))}</button></form></div>
    </div>`;

  const attests = [
    attestRow('backup_tested', d.attest.backupTestedAt, locale),
    attestRow('secrets_rotated', d.attest.secretsRotatedAt, locale),
    attestRow('owner_ready', d.attest.ownerReadyAt, locale),
  ].join('');

  const verdict = d.readyToLaunch
    ? `<div class="verdict ok">🎉 ${esc(t(locale, 'pilot.allReady'))}</div>`
    : `<div class="verdict">${esc(t(locale, 'pilot.notReady'))}</div>`;

  return `
    <h1 class="page">${esc(t(locale, 'pilot.title'))}</h1>
    <p class="muted">${esc(t(locale, 'pilot.intro'))}</p>
    ${flashHtml}
    <div class="block"><h2>${esc(t(locale, 'pilot.setup'))}</h2>${setup}</div>
    <div class="block"><h2>${esc(t(locale, 'pilot.prelaunch'))}</h2>
      ${validate}
      ${attests}
    </div>
    ${verdict}
    ${PILOT_STYLE}`;
}

// ── M16.2d runbook renderer — Before launch (M15) + During / Practice / After ─
// Reuses renderPilotReadiness for "before launch", then appends the derived
// sections. ✓ / ○ and real counts only — no scores, percentages, or grades.

function rbCount(label: MessageKey, n: number, href: string | null, locale: Locale): string {
  const link = href ? ` <a class="rblink" href="${href}">${esc(t(locale, 'pilot.open'))}</a>` : '';
  return `<div class="rbrow"><span class="lbl">${esc(t(locale, label))}</span><b class="n">${n}</b>${link}</div>`;
}

function duringSection(ops: OperationsSnapshot, locale: Locale): string {
  const quiet = !ops.hasAttention
    && ops.activity.handled === 0 && ops.activity.draftsCreated === 0 && ops.activity.corrections === 0
    && ops.knowledge.openGaps === 0 && ops.knowledge.recentCorrections === 0 && ops.knowledge.recentlyTaught === 0;
  const body = quiet
    ? `<div class="empty muted">${esc(t(locale, 'runbook.during.quiet'))}
        <div>${deeper('/app/sandbox', t(locale, 'factory.ready.practice'))}</div></div>`
    : `<h3 class="rbsub">${esc(t(locale, 'ops.attention.title'))}</h3>
      ${rbCount('ops.card.waiting', ops.attention.handoffs, '/app/inbox', locale)}
      ${rbCount('ops.card.approvals', ops.attention.pendingApprovals, '/app/inbox?filter=pending', locale)}
      ${rbCount('knowledge.ops.gaps', ops.knowledge.openGaps, '/app/knowledge', locale)}
      <h3 class="rbsub">${esc(t(locale, 'runbook.during.activity'))}</h3>
      ${rbCount('ops.activity.handled', ops.activity.handled, '/app/analytics', locale)}
      ${rbCount('ops.activity.drafts', ops.activity.draftsCreated, '/app/inbox', locale)}
      ${rbCount('ops.activity.corrections', ops.activity.corrections, '/app/knowledge', locale)}
      <h3 class="rbsub">${esc(t(locale, 'nav.knowledge'))}</h3>
      ${rbCount('knowledge.report.corrected', ops.knowledge.recentCorrections, null, locale)}
      ${rbCount('knowledge.report.facts', ops.knowledge.recentlyTaught, '/app/knowledge', locale)}`;
  return `<div class="block"><h2>${esc(t(locale, 'runbook.during.title'))}</h2>${body}</div>`;
}

function practiceSection(r: PilotRunbook['rehearsal'], locale: Locale): string {
  const steps = ['buyer', 'draft', 'approve', 'takeover', 'reply', 'resume', 'teach']
    .map((s) => `<li>${esc(t(locale, `runbook.step.${s}` as MessageKey))}</li>`).join('');
  const mark = (step: RehearsalStep, label: MessageKey) =>
    `<div class="pr ${r.done[step] ? 'done' : 'todo'}"><span class="mk">${r.done[step] ? '✓' : '○'}</span> <span class="lbl">${esc(t(locale, label))}</span></div>`;
  const progress = [
    mark('takeover', 'runbook.rehearse.takeover'),
    mark('ownerReply', 'runbook.rehearse.ownerReply'),
    mark('resume', 'runbook.rehearse.resume'),
    mark('knowledgeCorrection', 'runbook.rehearse.correction'),
    mark('validationPassed', 'runbook.rehearse.validation'),
  ].join('');
  return `<div class="block">
    <h2>${esc(t(locale, 'runbook.practice.title'))} · ${r.completed}/${r.total}</h2>
    <p class="muted">${esc(t(locale, 'runbook.practice.intro'))}</p>
    <ol class="rbsteps">${steps}</ol>
    ${progress}
    <a class="btn" href="/app/sandbox">${esc(t(locale, 'runbook.practice.open'))}</a>
  </div>`;
}

function afterSection(locale: Locale): string {
  const link = (label: MessageKey, href: string) =>
    `<div class="pr"><span class="lbl">${esc(t(locale, label))}</span><a class="btn ghost rblink" href="${href}">${esc(t(locale, 'pilot.open'))}</a></div>`;
  return `<div class="block">
    <h2>${esc(t(locale, 'runbook.after.title'))}</h2>
    <p class="muted">${esc(t(locale, 'runbook.after.intro'))}</p>
    ${link('runbook.after.promotion', '/app/employee')}
    ${link('runbook.after.autonomy', '/app/employee')}
    ${link('runbook.after.gaps', '/app/knowledge')}
  </div>`;
}

/**
 * M17.6 — what actually happened. Counts and dates from stored signals/events,
 * ordered by how often each occurred. No score, no rating, no verdict on how
 * well the employee did — the owner draws their own conclusion.
 */
function feedbackSection(f: PilotFeedback, locale: Locale): string {
  if (!f.hasActivity) {
    return `<div class="block"><h2>${esc(t(locale, 'feedback.title'))}</h2>
      <div class="empty muted">${esc(t(locale, 'feedback.none'))}
        <div>${deeper('/app/sandbox', t(locale, 'factory.ready.practice'))}</div></div></div>`;
  }
  const row = (label: string, item: FeedbackItem) =>
    `<div class="rbrow"><span class="lbl">${esc(label)}</span><b class="n">${item.count}</b>
      ${item.lastAt ? `<span class="muted rblink">${esc(formatDate(locale, item.lastAt))}</span>` : ''}</div>`;
  const reasons = f.handoffReasons.length
    ? `<h3 class="rbsub">${esc(t(locale, 'feedback.reasons'))}</h3>` +
      // reuse the M16.1 handoff wording — one vocabulary for one concept
      f.handoffReasons.map((i) => row(t(locale, `takeover.reason.${i.kind}` as MessageKey), i)).join('')
    : '';
  const actions = f.ownerActions.length
    ? `<h3 class="rbsub">${esc(t(locale, 'feedback.actions'))}</h3>` +
      f.ownerActions.map((i) => row(t(locale, `feedback.action.${i.kind}` as MessageKey), i)).join('')
    : '';
  return `<div class="block"><h2>${esc(t(locale, 'feedback.title'))}</h2>${reasons}${actions}</div>`;
}

/**
 * M17.1 — which build is running. Owner-authenticated only: the same facts are
 * deliberately NOT on /health, so a public probe cannot advertise the commit.
 * Anything the host does not report renders as "Not reported", never a guess.
 */
function deploymentSection(d: DeploymentInfo, locale: Locale, unauthoredPriceRules = 0): string {
  const unknown = t(locale, 'runbook.deploy.unknown');
  const row = (label: MessageKey, value: string) =>
    `<div class="rbrow"><span class="lbl">${esc(t(locale, label))}</span><b class="n mono">${esc(value)}</b></div>`;
  const version = d.commit ? (d.branch ? `${d.commit} · ${d.branch}` : d.commit) : unknown;
  const messaging = d.provider === 'disabled'
    ? t(locale, 'runbook.deploy.providerDisabled')
    : d.provider;
  return `<div class="block">
    <h2>${esc(t(locale, 'runbook.deploy.title'))}</h2>
    ${row('runbook.deploy.version', version)}
    ${row('runbook.deploy.environment', d.environment)}
    ${row('runbook.deploy.channelMode', messaging)}
    ${row('runbook.deploy.since', formatDate(locale, d.startedAt))}
    ${d.ownerCodeStable ? '' : `<div class="ev">
      <div class="ev-d">${esc(t(locale, 'runbook.deploy.codeUnstable'))}</div>
    </div>`}
    ${d.credentialKeyStable ? '' : `<div class="ev">
      <div class="ev-d">${esc(t(locale, 'runbook.deploy.credentialKeyUnstable'))}</div>
    </div>`}
    ${unauthoredPriceRules === 0 ? '' : `<div class="ev">
      <div class="ev-d">${esc(t(locale, 'runbook.deploy.unauthoredPriceRules', { n: unauthoredPriceRules }))}</div>
    </div>`}
  </div>`;
}

/**
 * M17.2 — WhatsApp go-live preparation. READ-ONLY: it reports what is still
 * missing and switches nothing on. Credential VALUES never appear here — only
 * whether each one is set and correctly shaped.
 */
function metaSection(m: MetaReadiness, locale: Locale, templateState: TemplateState): string {
  const rows = m.credentials.map((c) => {
    const done = c.state === 'ok';
    return `<div class="pr ${done ? 'done' : 'todo'}">
      <span class="mk">${done ? '✓' : '○'}</span>
      <span class="lbl">${esc(t(locale, `meta.cred.${c.key}` as MessageKey))}</span>
      <div class="pr-b"><span class="muted">${esc(t(locale, `meta.state.${c.state}` as MessageKey))}</span></div>
    </div>`;
  }).join('');
  const blockers = m.blockers.map((b) =>
    `<li>${esc(t(locale, `meta.blocker.${b}` as MessageKey))}</li>`).join('');
  return `<div class="block">
    <h2>${esc(t(locale, 'meta.title'))}</h2>
    <p class="muted">${esc(t(locale, 'meta.intro'))}</p>
    ${rows}
    <div class="verdict ${m.live ? 'ok' : ''}">${esc(t(locale, m.live ? 'meta.live' : 'meta.notLive'))}</div>
    ${blockers ? `<ul class="rbsteps muted">${blockers}</ul>` : ''}
    ${templateRow(locale, templateState)}
  </div>`;
}

/**
 * M22 §B — re-engagement readiness, stated as its own line because it is its
 * own problem.
 *
 * Credentials are ours to configure; an approved template is Meta's to grant.
 * Folding them together would let a fully-credentialled installation read as
 * ready while every conversation older than a day was still unreachable. The
 * state comes from the same TemplateState the send path consumes — no second
 * source, and nothing here can approve anything.
 */
function templateRow(locale: Locale, state: TemplateState): string {
  // M25 — the REAL state, not the constant. Rendering `TEMPLATE_ENTRY_POINT`
  // here made the operator's own panel report a hardcoded value: the same
  // defect as the send path's, on the surface meant to reveal it.
  const r = templateReadiness(state);
  return `<div class="pr ${r.canReopenWindow ? 'done' : 'todo'}">
    <span class="mk">${r.canReopenWindow ? '✓' : '○'}</span>
    <span class="lbl">${esc(t(locale, 'meta.template.label'))}</span>
    <div class="pr-b"><span class="muted">${esc(t(locale,
      r.canReopenWindow ? 'meta.template.approved' : 'meta.template.none'))}</span></div>
  </div>`;
}

/**
 * M17.4 — delivery health. A real count and a real timestamp, with the one
 * action the owner can take. No score, no percentage, no infrastructure gauge.
 */
function healthSection(r: Reliability, locale: Locale): string {
  if (r.stuckOutbound === 0) {
    return `<div class="block"><h2>${esc(t(locale, 'ops.health.title'))}</h2>
      <div class="ok">✓ ${esc(t(locale, 'ops.health.ok'))}</div></div>`;
  }
  return `<div class="block"><h2>${esc(t(locale, 'ops.health.title'))}</h2>
    <div class="rbrow"><span class="lbl">${esc(t(locale, 'ops.health.stuck'))}</span><b class="n">${r.stuckOutbound}</b>
      <a class="rblink" href="/app/channels">${esc(t(locale, 'pilot.open'))}</a></div>
    ${r.oldestQueuedAt ? `<div class="rbrow"><span class="lbl">${esc(t(locale, 'ops.health.oldest'))}</span><b class="n">${esc(formatDate(locale, r.oldestQueuedAt))}</b></div>` : ''}
    <p class="muted">${esc(t(locale, 'ops.health.whatToDo'))}</p>
  </div>`;
}

/**
 * M20.5 — where an invariant that failed on REAL factory data surfaces.
 *
 * This is the operator's panel, next to the build version and the credential
 * shapes, and it is the only place these appear. The distinction it keeps is the
 * whole point of the split: a FINDING ("no price is set for the canvas tote") is
 * the owner's to fix and lives in My factory; a VIOLATION means the engine broke
 * its own promise on her rows — she cannot act on it, and showing it to her as a
 * task would be blaming her for our defect.
 *
 * Silence here is the normal state, so it says so rather than showing a tick.
 */
function engineSection(r: RehearsalReport, locale: Locale): string {
  if (r.violations.length === 0) {
    return `<div class="block">
      <h2>${esc(t(locale, 'runbook.engine.title'))}</h2>
      <p class="muted">${esc(t(locale, 'runbook.engine.ok', { n: r.probesRun }))}</p>
    </div>`;
  }
  return `<div class="block">
    <h2>${esc(t(locale, 'runbook.engine.title'))}</h2>
    <p class="muted">${esc(t(locale, 'runbook.engine.bad'))}</p>
    ${r.violations.map((v) => `<div class="ev">
      <div class="ev-h"><span class="mono">${esc(v.invariant)}</span> <span class="mono muted">${esc(v.probeId)}</span></div>
      <div class="ev-d">${esc(v.detail)}</div>
      <pre class="ev-p">in:  ${esc(v.fixture)}
out: ${esc(v.engine)}</pre>
    </div>`).join('')}
  </div>`;
}

export function renderPilotRunbook(
  rb: PilotRunbook, locale: Locale, flash: string | null,
  deployment?: DeploymentInfo, meta?: MetaReadiness, feedback?: PilotFeedback,
  rehearsal?: RehearsalReport | null,
  templateState: TemplateState = 'none',
  unauthoredPriceRules = 0,
): string {
  return renderPilotReadiness(rb.readiness, locale, flash)
    + duringSection(rb.operations, locale)
    + healthSection(rb.reliability, locale)
    + practiceSection(rb.rehearsal, locale)
    + afterSection(locale)
    + (feedback ? feedbackSection(feedback, locale) : '')
    + (meta ? metaSection(meta, locale, templateState) : '')
    + (rehearsal ? engineSection(rehearsal, locale) : '')
    + (deployment ? deploymentSection(deployment, locale, unauthoredPriceRules) : '')
    + RUNBOOK_STYLE;
}

const RUNBOOK_STYLE = `<style>
  .rbsub { font-size:var(--font-size-caption); letter-spacing:0; color:var(--color-ink-secondary); margin:var(--space-16) 0 var(--space-8); }
  .rbrow { display:flex; align-items:center; gap:var(--space-8); padding:8px 0; border-bottom:1px solid var(--color-paper-sunk); }
  .rbrow:last-child { border-bottom:0; }
  .rbrow .lbl { font-size:var(--font-size-note); } .rbrow .n { margin-inline-start:auto; font-size:var(--font-size-small); font-weight:700; color:var(--color-ink); }
  .rblink { font-size:var(--font-size-caption); }
  .rbsteps { margin:var(--space-8) 0 var(--space-16); padding-inline-start:20px; color:var(--color-ink-secondary); font-size:var(--font-size-note); }
  .rbsteps li { padding:2px 0; }
  .rbrow .mono { font:var(--font-size-caption)/1.4 "SF Mono", ui-monospace, Menlo, monospace; font-weight:600; unicode-bidi:plaintext; }
  /* Engine evidence: raw on purpose — it is read by whoever fixes the defect. */
  .ev { border:1px solid var(--color-warn-line); background:var(--color-warn-wash); border-radius:12px; padding:12px 14px; margin-top:var(--space-12); }
  .ev-h { display:flex; gap:var(--space-8); flex-wrap:wrap; }
  .ev-h .mono { font:var(--font-size-caption)/1.4 "SF Mono", ui-monospace, Menlo, monospace; font-weight:600; unicode-bidi:plaintext; }
  .ev-d { font-size:var(--font-size-caption); color:var(--color-warn); margin-top:var(--space-8); }
  .ev-p { font:var(--font-size-micro)/1.5 "SF Mono", ui-monospace, Menlo, monospace; color:var(--color-ink-secondary);
          margin:var(--space-8) 0 0; overflow-x:auto; unicode-bidi:plaintext; direction:ltr; text-align:start; }
</style>`;

const PILOT_STYLE = `<style>
  .pr { display:flex; align-items:center; gap:var(--space-8); flex-wrap:wrap; padding:12px 0; border-bottom:1px solid var(--color-paper-sunk); }
  .pr:last-child { border-bottom:0; }
  .pr .mk { font-size:var(--font-size-base); font-weight:700; } .pr.done .mk { color:var(--color-ok); } .pr.todo .mk { color:var(--color-ink-secondary); }
  .pr .lbl { font-size:var(--font-size-small); }
  .pr-b { display:flex; align-items:center; gap:var(--space-8); flex-wrap:wrap; margin-inline-start:auto; }
  .badge { font-size:var(--font-size-micro); padding:3px 10px; border-radius:999px; }
  .badge.sys { background:var(--color-jade-wash); color:var(--color-ok); } .badge.owner { background:var(--color-highlight-wash); color:var(--color-highlight); }
  .verdict { margin-top:var(--space-16); padding:14px; border-radius:12px; background:var(--color-surface); border:1px solid var(--color-border); text-align:center; font-weight:600; }
  .verdict.ok { background:var(--color-jade-wash); color:var(--color-ok); border-color:var(--color-jade-line); }
</style>`;
