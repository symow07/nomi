import { loadReady, readyDone, readyTotal, readyComplete } from './ready.js';
import { zoneOf } from '../../db/zone.js';
import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { parseLocale, type Locale } from '../../core/owner/i18n/locale.js';
import { defaultAssistantName, validateAssistant, NAME_MAX } from '../../core/owner/assistants.js';
import { renameMainAssistant } from '../../db/assistants.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { t } from './say.js';

import { runAll } from '../../trust/harness.js';
import { SCENARIOS } from '../../trust/scenarios.js';
import { type RehearsalReport } from '../../trust/factoryRehearsal.js';
import type { TemplateState } from '../../core/channel/window.js';
import { loadOperationsSnapshot, type OperationsSnapshot, type Range } from './operations.js';
import { type DeploymentInfo } from './deployment.js';
import { type MetaReadiness } from '../../core/channel/metaReadiness.js';
import { templateReadiness, TEMPLATE_ENTRY_POINT } from '../../core/channel/templateReadiness.js';
import { esc, deeper, todoMark } from './layout.js';
import { menuRow, menuGroup } from './settings.js';
import { anyConnected, connectedChannels } from '../../db/connectedChannels.js';
import { flashBanner, type Flash } from './flash.js';
import { OWNER_VIEW, type Viewer } from '../../core/conversation/people.js';
import { PROBLEM_SIGNAL_KINDS } from '../../core/scoring/signals.js';
import * as show from './values.js';

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
export type AttestKey = 'backup_tested' | 'secrets_rotated' | 'owner_ready' | 'claims_reviewed'
  | 'assistant_named';

const ATTEST_COL: Record<AttestKey, string> = {
  backup_tested: 'backup_tested_at', secrets_rotated: 'secrets_rotated_at',
  owner_ready: 'owner_ready_at', claims_reviewed: 'claims_reviewed_at',
  assistant_named: 'assistant_named_at',
};

export type PilotReadiness = {
  readonly detected: Record<DetectedKey, boolean>;
  readonly attest: {
    readonly backupTestedAt: Date | null; readonly secretsRotatedAt: Date | null;
    readonly ownerReadyAt: Date | null;
    /** When the owner confirmed what buyers will call her assistant. */
    readonly assistantNamedAt: Date | null;
  };
  readonly validation: { readonly at: Date | null; readonly pass: number | null; readonly total: number | null };
  /**
   * When the scheduled backup last restored cleanly in its own drill
   * (`backup_runs`, 0069). Checked for the owner, so "Backup tested" no longer
   * needs a tick by hand; the hand-made attestation still counts where it was
   * made before the job existed.
   */
  readonly backupVerifiedAt: Date | null;
  readonly readyToLaunch: boolean;   // everything but the channel (that's what launch turns on)
  /**
   * G6 — a workspace that signed itself up. Its Getting ready shows only what
   * applies: "Ready for customers" (the Practice checklist) in place of the
   * installation's facts (backup, secrets) and the old fixed-scenario check.
   */
  readonly selfServe?: boolean;
  /** G6 — the Practice checklist, for a self-serve workspace: seen of total, and whether complete. */
  readonly ready?: { readonly done: number; readonly total: number; readonly complete: boolean } | null;
  /**
   * What the box is pre-filled with: her stored name, or — before any row
   * exists — the one the signup locale would give her. A suggestion, not a
   * decision; `assistantNamedAt` records the decision.
   */
  readonly assistantName: string;
};

export async function loadPilotReadiness(db: Db, businessIdRaw: string): Promise<PilotReadiness> {
  const empty: PilotReadiness = {
    detected: { profile: false, products: false, priceRules: false, knowledge: false, claims: false, sandbox: false, channel: false },
    attest: { backupTestedAt: null, secretsRotatedAt: null, ownerReadyAt: null, assistantNamedAt: null },
    validation: { at: null, pass: null, total: null },
    backupVerifiedAt: null,
    readyToLaunch: false,
    selfServe: false, ready: null,
    assistantName: defaultAssistantName('en'),
  };
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return empty;
  const B = bid.value;
  // G6 — the checklist, read before the transaction below (it opens its own).
  const selfServe = await withTenantTx(db, B, async (tx) => (await sql<{ s: boolean }>`
    select signed_up_at is not null as s from businesses where id = ${B}`.execute(tx)).rows[0]?.s ?? false);
  const rv = selfServe ? await loadReady(db, B) : null;
  const ready = rv ? { done: readyDone(rv), total: readyTotal(rv), complete: readyComplete(rv) } : null;

  return withTenantTx(db, B, async (tx) => {
    const r = (await sql<{
      profile: boolean; products: boolean; price_rules: boolean; knowledge: boolean; claims: boolean;
      backup_tested_at: Date | null; secrets_rotated_at: Date | null; owner_ready_at: Date | null;
      assistant_named_at: Date | null; backup_verified_at: Date | null;
      assistant_name: string | null; owner_locale: string | null;
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
        (select backup_tested_at from os) as backup_tested_at,
        (select secrets_rotated_at from os) as secrets_rotated_at,
        (select owner_ready_at from os) as owner_ready_at,
        (select assistant_named_at from os) as assistant_named_at,
        -- Installation-wide, not tenant data: the newest scheduled backup that
        -- restored cleanly in its drill (0069).
        (select uploaded_at from backup_runs where drill_passed order by uploaded_at desc limit 1) as backup_verified_at,
        -- The name the box shows. The assistants table is the one source for
        -- it since A5; the locale default only fills a box nobody answered yet.
        (select a.name from assistants a
          where a.business_id = ${B} and a.is_default and a.archived_at is null limit 1) as assistant_name,
        (select owner_locale from businesses where id = ${B}) as owner_locale,
        (select last_validation_at from os) as last_validation_at,
        (select last_validation_pass from os) as last_validation_pass,
        (select last_validation_total from os) as last_validation_total
    `.execute(tx)).rows[0]!;

    // Same answer as Setup's channels step (`connectedChannels`): the two had
    // drifted once already — a rotated credential left readiness saying
    // "connected" while My factory's next step said "connect WhatsApp". Phase
    // 4b: any place a buyer writes counts, not WhatsApp alone.
    const channel = anyConnected(await connectedChannels(tx, B));

    const sandbox = r.last_validation_at !== null && r.last_validation_pass !== null
      && r.last_validation_total !== null && r.last_validation_pass === r.last_validation_total;

    const detected = { profile: r.profile, products: r.products, priceRules: r.price_rules,
      knowledge: r.knowledge, claims: r.claims, sandbox, channel };
    const attest = { backupTestedAt: r.backup_tested_at, secretsRotatedAt: r.secrets_rotated_at,
      ownerReadyAt: r.owner_ready_at, assistantNamedAt: r.assistant_named_at };
    const backupVerifiedAt = r.backup_verified_at;
    // G6 — a self-serve workspace answers for what is its own: the Practice
    // checklist stands where the installation's facts and the fixed-scenario
    // check stood. A workspace the operator made is held to them as before.
    const readyToLaunch = detected.profile && detected.products && detected.priceRules
      && detected.knowledge && detected.claims
      && (ready
        ? ready.complete
        : detected.sandbox && (!!attest.backupTestedAt || !!backupVerifiedAt) && !!attest.secretsRotatedAt)
      && !!attest.ownerReadyAt && !!attest.assistantNamedAt;

    return {
      detected, attest,
      validation: { at: r.last_validation_at, pass: r.last_validation_pass, total: r.last_validation_total },
      backupVerifiedAt,
      readyToLaunch,
      selfServe, ready,
      assistantName: r.assistant_name ?? defaultAssistantName(parseLocale(r.owner_locale ?? 'en') ?? 'en'),
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
  /** Phase 9 (V1-125) — replies that ever went out; absent, unknown (read as some). */
  readonly sent?: number;
};

export type PilotRunbook = {
  readonly readiness: PilotReadiness;       // before launch (M15)
  readonly operations: OperationsSnapshot;  // during pilot (M16.2a)
  readonly rehearsal: {
    readonly available: boolean;                       // the workspace has practised (its copy exists)
    readonly done: Record<RehearsalStep, boolean>;
    readonly completed: number;
    readonly total: number;
  };
  readonly reliability: Reliability;        // M17.4
};

export async function loadPilotRunbook(
  db: Db, businessIdRaw: string,
  opts: { practiceBusinessId?: string | null | undefined; provider?: string | undefined; range?: Range | undefined } = {},
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

  // Rehearsal signals — the workspace's own practice copy's events, read-only
  // (P3; before, one shared sandbox's, whoever had rehearsed there).
  const sb = opts.practiceBusinessId ? parseBusinessId(opts.practiceBusinessId) : null;
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
        const r = (await sql<{ n: number; oldest: Date | null; sent: number }>`
          select count(*) filter (where status = 'queued' and created_at < now() - (${STUCK_AFTER_MINUTES} || ' minutes')::interval)::int as n,
                 min(created_at) filter (where status = 'queued' and created_at < now() - (${STUCK_AFTER_MINUTES} || ' minutes')::interval) as oldest,
                 count(*) filter (where status in ('sent', 'delivered', 'read'))::int as sent
            from outbound_messages
           where business_id = ${bid.value}
        `.execute(tx)).rows[0]!;
        return { stuckOutbound: r.n, oldestQueuedAt: r.oldest, sent: r.sent };
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
    // TZ — the period starts in the workspace's own zone.
    const zone = await zoneOf(tx, B);
    const cutoff = (await sql<{ c: Date }>`
      select (date_trunc(${unit}, now() at time zone ${zone}) at time zone ${zone}) as c
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

/** The two ways the one field she is asked for can be wrong. */
export type NameProblem = 'name_missing' | 'name_long';

/**
 * The assistant-name step: the name she settled on, and the attestation that
 * she settled on it, written together. Refused rather than trimmed to fit —
 * what a buyer reads should be what the owner typed.
 */
export async function nameAssistant(
  db: Db, businessIdRaw: string, raw: string, actor: string,
): Promise<{ ok: true } | { ok: false; problem: NameProblem }> {
  const bid = parseBusinessId(businessIdRaw);
  // Only the name is asked for, so only the name can be wrong: the role is
  // fixed and the note is empty, which is why the other two problems this
  // validator can report are unreachable here and have no sentence.
  const v = validateAssistant({ name: raw, role: 'sales', note: '', channels: [] });
  if (!v.ok) return { ok: false, problem: v.problem === 'name_long' ? 'name_long' : 'name_missing' };
  if (!bid.ok) return { ok: false, problem: 'name_missing' };
  await withTenantTx(db, bid.value, async (tx) => {
    await renameMainAssistant(tx, bid.value, v.value.name, actor);
    await sql`
      insert into onboarding_state (business_id, assistant_named_at) values (${bid.value}, now())
      on conflict (business_id) do update set assistant_named_at = now(), updated_at = now()
    `.execute(tx);
  });
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

/**
 * Phase 9 (today-onboarding-new-11) — a row's mark: ✓ done, or ○ still to do.
 * The warmth run's re-audit (w4-today-setup-06): an item of this checklist is
 * the owner's chore, not a customer waiting, so its ○ is the to-do mark in the
 * secondary ink (`todoMark`, `.dot.todo`), never magenta.
 */
const mk = (done: boolean): string => done ? '<span class="mk">✓</span>' : '<span class="mk dot todo">○</span>';

const DETECTED_LINK: Record<DetectedKey, string> = {
  profile: '/app/settings/profile', products: '/app/products', priceRules: '/app/business/prices',
  knowledge: '/app/knowledge', claims: '/app/knowledge', sandbox: '/app/sandbox',
  channel: '/app/channels',
};

function detectedRow(key: DetectedKey, done: boolean, locale: Locale, viewer: Viewer = OWNER_VIEW): string {
  const label = esc(t(locale, `pilot.item.${key}` as MessageKey));
  if (done) {
    return `<div class="pr done">${mk(true)} <span class="lbl">${label}</span>
      <span class="badge sys">${esc(t(locale, 'pilot.verifiedBySystem'))}</span></div>`;
  }
  const extra = key === 'claims' && viewer.isOwner
    ? `<form method="post" action="/app/onboarding/attest" class="inline"><input type="hidden" name="which" value="claims_reviewed" /><button class="btn" type="submit">${esc(t(locale, 'pilot.claims.none'))}</button></form>`
    : '';
  return `<div class="pr todo">${mk(false)} <span class="lbl">${label}</span>
    <div class="pr-b"><span class="muted">${esc(t(locale, `pilot.blocker.${key}` as MessageKey))}</span>
      ${(key === 'priceRules' && !viewer.isOwner) ? '' : deeper(DETECTED_LINK[key], t(locale, 'pilot.open'))}${extra}</div></div>`;
}

/**
 * Phase 9 — the installation's own chores (a backup that restores, keys
 * changed since the build) are a condition for going live, but they are not
 * the owner's to do or to vouch for. The gate is unchanged (readyToLaunch and
 * activation still ask for both); the operator stamps them with
 * `tools/installation-checks.mjs`, and the owner reads one row that says Nomi
 * does it, with no button. A scheduled backup's passed drill counts as tested.
 */
function nomiChecksRow(d: PilotReadiness, locale: Locale): string {
  const backup = d.backupVerifiedAt ?? d.attest.backupTestedAt;
  const keys = d.attest.secretsRotatedAt;
  const label = esc(t(locale, 'pilot.nomiChecks'));
  if (backup && keys) {
    const at = backup > keys ? backup : keys;
    return `<div class="pr done">${mk(true)} <span class="lbl">${label}</span>
      <span class="badge sys">${esc(t(locale, 'pilot.verifiedBySystem'))} · ${esc(show.date(locale, at))}</span></div>`;
  }
  // Phase 9 (w4-today-setup-06) — not the owner's to do: a dash, as Ready marks what is not theirs, never a ○.
  return `<div class="pr todo"><span class="mk">—</span> <span class="lbl">${label}</span>
    <div class="pr-b"><span class="muted">${esc(t(locale, 'pilot.nomiChecks.todo'))}</span></div></div>`;
}

function attestRow(
  key: 'owner_ready', at: Date | null, locale: Locale, viewer: Viewer = OWNER_VIEW,
): string {
  const label = esc(t(locale, `pilot.attest.${key}` as MessageKey));
  if (at) {
    return `<div class="pr done">${mk(true)} <span class="lbl">${label}</span>
      <span class="badge owner">${esc(t(locale, 'pilot.confirmedByOwner'))} · ${esc(show.date(locale, at))}</span></div>`;
  }
  // Phase 4 — each answer here is a condition for going live: the owner's.
  if (!viewer.isOwner) return `<div class="pr todo">${mk(false)} <span class="lbl">${label}</span>
    <div class="pr-b"><span class="muted">${esc(t(locale, 'staff.ownerDecides'))}</span></div></div>`;
  return `<div class="pr todo">${mk(false)} <span class="lbl">${label}</span>
    <form method="post" action="/app/onboarding/attest" class="inline">
      <input type="hidden" name="which" value="${key}" />
      <button class="btn" type="submit">${esc(t(locale, 'pilot.attest.confirm'))}</button>
    </form></div>`;
}

/**
 * The one confirmation that carries an answer with it.
 *
 * The other four attestations are a fact the app cannot observe, so a button is
 * the whole of them. This one is a decision — what a BUYER will call her, since
 * she signs off with it — and a button alone would make the locale default into
 * the answer by silence. So the box is pre-filled with the suggestion and she
 * confirms or changes it; either way a person chose. Once confirmed the row
 * reads like the others, with the name she settled on.
 */
function assistantNameRow(d: PilotReadiness, locale: Locale, viewer: Viewer = OWNER_VIEW): string {
  const label = esc(t(locale, 'pilot.attest.assistant_named'));
  if (d.attest.assistantNamedAt) {
    return `<div class="pr done" id="name">${mk(true)} <span class="lbl">${label} · ${esc(d.assistantName)}</span>
      <span class="badge owner">${esc(t(locale, 'pilot.confirmedByOwner'))} · ${esc(show.date(locale, d.attest.assistantNamedAt))}</span></div>`;
  }
  if (!viewer.isOwner) return `<div class="pr todo" id="name">${mk(false)} <span class="lbl">${label}</span>
    <div class="pr-b"><span class="muted">${esc(t(locale, 'staff.ownerDecides'))}</span></div></div>`;
  // Phase 9 (V1-133, V1-134) — the name row is laid out one way in every language: its
  // label, the line under it, then the field with Confirm beside it.
  // Phase 9 (V1-134) — the form's class is its own: the price list's `.pr-name`,
  // defined later in the sheet, wrapped Confirm under the field.
  return `<div class="pr todo under" id="name">${mk(false)} <span class="lbl">${label}</span>
    <div class="pr-b"><span class="muted">${esc(t(locale, 'pilot.assistant.hint'))}</span>
      <form method="post" action="/app/onboarding/assistant-name" class="pr-nameform">
        <input type="text" name="name" maxlength="${NAME_MAX}" required
               value="${esc(d.assistantName)}" aria-label="${label}" />
        <button class="btn" type="submit">${esc(t(locale, 'pilot.attest.confirm'))}</button>
      </form></div></div>`;
}

export function renderPilotReadiness(
  d: PilotReadiness, locale: Locale, flash: Flash | null, viewer: Viewer = OWNER_VIEW,
): string {
  const flashHtml = flashBanner(flash);
  // G6 — the fixed-scenario check is not a self-serve workspace's: "Ready for customers" stands for it.
  const detectedOrder: DetectedKey[] = d.ready
    ? ['profile', 'products', 'priceRules', 'knowledge', 'claims', 'channel']
    // Phase 9 (V1-123) — the practice check is listed once, under the final checks, with its button.
    : ['profile', 'products', 'priceRules', 'knowledge', 'claims', 'channel'];
  const setup = detectedOrder.map((k) => detectedRow(k, d.detected[k], locale, viewer)).join('');

  const v = d.validation;
  const valLine = v.at && v.pass !== null && v.total !== null
    ? `${esc(t(locale, 'pilot.validate.result', { pass: v.pass, total: v.total, date: show.date(locale, v.at) }))}`
    : esc(t(locale, 'pilot.validate.never'));
  const validate = `<div class="pr ${d.detected.sandbox ? 'done' : 'todo'}">
      ${mk(d.detected.sandbox)}
      <span class="lbl">${esc(t(locale, 'pilot.item.sandbox'))}</span>
      <div class="pr-b"><span class="muted">${valLine}</span>
        ${viewer.isOwner ? `<form method="post" action="/app/onboarding/validate" class="inline"><button class="btn" type="submit">${esc(t(locale, 'pilot.validate'))}</button></form>` : ''}</div>
    </div>`;

  // G6 — for a workspace that signed itself up, only what applies to it:
  // "Ready for customers" stands for the fixed-scenario check, and the
  // installation's own facts (backup, secrets) are the operator's.
  if (d.ready) {
    const r = d.ready;
    const readyRow = `<div class="pr ${r.complete ? 'done' : 'todo'}">${mk(r.complete)}
      <span class="lbl">${esc(t(locale, 'pilot.item.ready'))}</span>
      <div class="pr-b"><span class="muted">${esc(t(locale, 'pilot.ready.count', { done: r.done, total: r.total }))}</span>
        ${deeper('/app/ready', t(locale, 'pilot.item.ready'))}</div></div>`;
    const verdict = d.readyToLaunch
      ? `<p class="verdict ok">✓ ${esc(t(locale, 'pilot.allReady'))}</p>`
      : `<p class="verdict">${todoMark()} ${esc(t(locale, 'pilot.notReady'))}</p>`;
    return `
    <h1 class="page">${esc(t(locale, 'pilot.title'))}</h1>
    <p class="muted">${esc(t(locale, 'pilot.intro'))}</p>
    ${verdict}
    ${flashHtml}
    <div class="block"><h2>${esc(t(locale, 'pilot.setup'))}</h2>${setup}</div>
    <div class="block"><h2>${esc(t(locale, 'pilot.prelaunch'))}</h2>
      ${readyRow}
      ${assistantNameRow(d, locale, viewer)}
      ${attestRow('owner_ready', d.attest.ownerReadyAt, locale, viewer)}
    </div>
    `;
  }

  const attests = [
    assistantNameRow(d, locale, viewer),
    nomiChecksRow(d, locale),
    attestRow('owner_ready', d.attest.ownerReadyAt, locale, viewer),
  ].join('');

  // Phase 9 (V1-130) — a state line, not a box that looks pressable.
  const verdict = d.readyToLaunch
    ? `<p class="verdict ok">✓ ${esc(t(locale, 'pilot.allReady'))}</p>`
    : `<p class="verdict">${todoMark()} ${esc(t(locale, 'pilot.notReady'))}</p>`;

  // Phase 9 (w4-today-setup-19) — where the page stands is said under its
  // intro, the first thing read, not above the next section's rule.
  return `
    <h1 class="page">${esc(t(locale, 'pilot.title'))}</h1>
    <p class="muted">${esc(t(locale, 'pilot.intro'))}</p>
    ${verdict}
    ${flashHtml}
    <div class="block"><h2>${esc(t(locale, 'pilot.setup'))}</h2>${setup}</div>
    <div class="block"><h2>${esc(t(locale, 'pilot.prelaunch'))}</h2>
      ${validate}
      ${attests}
      ${/* G6 — every workspace can read its own evidence; only a self-serve one is held to it here. */ ''}${deeper('/app/ready', t(locale, 'pilot.item.ready'))}
    </div>
    `;
}

// ── M16.2d runbook renderer — Before launch (M15) + During / Practice / After ─
// Reuses renderPilotReadiness for "before launch", then appends the derived
// sections. ✓ / ○ and real counts only — no scores, percentages, or grades.

function rbCount(label: MessageKey, n: number, href: string | null, locale: Locale): string {
  return `<div class="rbrow"><span class="lbl">${esc(t(locale, label))}</span><b class="n">${n}</b>${href ? deeper(href, t(locale, 'pilot.open'), 'rbgo') : ''}</div>`;
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
  // Phase 9 — on its own screen, headed "How it is going": this block is the week.
  return `<div class="block"><h2>${esc(t(locale, 'runbook.during.week'))}</h2>${body}</div>`;
}

/**
 * Phase 9 (V1-124, w4-today-setup-17, -18, V1-120) — what to try in Practice,
 * as ONE list: each item is a task, worded as a task ("Take over the
 * conversation"), with its mark beside it — ✓ once Practice has seen it.
 * The three steps nothing can observe (write as a customer, see the draft,
 * approve or edit it) are the sentence that opens the list; the standard test
 * conversations are an item only where they are a condition (a workspace
 * the operator made, not one that signed itself up).
 */
export const practiceTasks = (rb: Pick<PilotRunbook, 'rehearsal' | 'readiness'>): readonly { readonly step: RehearsalStep; readonly label: MessageKey; readonly done: boolean }[] =>
  ([
    ['takeover', 'runbook.step.takeover'], ['ownerReply', 'runbook.step.reply'], ['resume', 'runbook.step.resume'],
    ['knowledgeCorrection', 'runbook.step.teach'],
    ...(rb.readiness.selfServe ? [] : [['validationPassed', 'pilot.validate']] as const),
  ] as const).map(([step, label]) => ({ step, label, done: rb.rehearsal.done[step] }));

function practiceSection(rb: Pick<PilotRunbook, 'rehearsal' | 'readiness'>, locale: Locale): string {
  const rows = practiceTasks(rb).map((x) =>
    `<div class="pr ${x.done ? 'done' : 'todo'}">${mk(x.done)} <span class="lbl">${esc(t(locale, x.label))}</span></div>`).join('');
  return `<p class="muted">${esc(t(locale, 'runbook.practice.how'))}</p>
    <div class="block">${rows}</div>
    ${deeper('/app/sandbox', t(locale, 'runbook.practice.open'))}`;
}

function afterSection(locale: Locale): string {
  const link = (label: MessageKey, href: string) =>
    `<div class="pr"><span class="lbl">${esc(t(locale, label))}</span>${deeper(href, t(locale, 'pilot.open'), 'rbgo')}</div>`;
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
      ${item.lastAt ? `<span class="muted rbwhen">${esc(show.date(locale, item.lastAt))}</span>` : ''}</div>`;
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
    ${row('runbook.deploy.since', show.date(locale, d.startedAt))}
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
      ${mk(done)}
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
    <p class="verdict${m.live ? ' ok' : ''}">${m.live ? '✓' : todoMark()} ${esc(t(locale, m.live ? 'meta.live' : 'meta.notLive'))}</p>
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
    ${mk(r.canReopenWindow)}
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
      ${r.sent === 0 ? `<p class="muted">${esc(t(locale, 'ops.health.none'))}</p>` : `<div class="ok">✓ ${esc(t(locale, 'ops.health.ok'))}</div>`}</div>`;
  }
  return `<div class="block"><h2>${esc(t(locale, 'ops.health.title'))}</h2>
    <div class="rbrow"><span class="lbl">${esc(t(locale, 'ops.health.stuck'))}</span><b class="n">${r.stuckOutbound}</b>
      ${deeper('/app/channels', t(locale, 'pilot.open'), 'rbgo')}</div>
    ${r.oldestQueuedAt ? `<div class="rbrow"><span class="lbl">${esc(t(locale, 'ops.health.oldest'))}</span><b class="n">${esc(show.date(locale, r.oldestQueuedAt))}</b></div>` : ''}
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

/**
 * THE WARMTH RUN, PHASE 9 (w4-today-setup-15) — the two screens a tap under
 * the checklist. The checklist is the owner's chores and nothing else; what
 * to try in Practice, and how things are going (this week's counts, whether
 * replies go out, what happened, what to look at afterwards), are a row each.
 */
export type PilotScreen = 'practice' | 'activity';
export const PILOT_SCREENS: readonly PilotScreen[] = ['practice', 'activity'];
export const PILOT_SCREEN_PATH: Readonly<Record<PilotScreen, string>> = {
  practice: '/app/onboarding/practice', activity: '/app/onboarding/activity',
};
const SCREEN_TITLE: Readonly<Record<PilotScreen, MessageKey>> = {
  practice: 'runbook.practice.title', activity: 'runbook.during.title',
};

/**
 * Getting ready — the owner's checklist (audit F2), then a short menu: what to
 * try in Practice (with how much of it Practice has seen) and how it is going.
 * The machine room that used to be appended here (the WhatsApp credentials,
 * the engine's own checks, the build) is `renderPilotTechnical`, by its
 * address only (F4, V1-139).
 */
export function renderPilotRunbook(
  rb: PilotRunbook, locale: Locale, flash: Flash | null, _feedback?: PilotFeedback,
  viewer: Viewer = OWNER_VIEW,
): string {
  const tasks = practiceTasks(rb);
  const seen = tasks.filter((x) => x.done).length;
  return renderPilotReadiness(rb.readiness, locale, flash, viewer)
    + menuGroup('more', null, [
      menuRow({ href: PILOT_SCREEN_PATH.practice, icon: 'play', label: t(locale, SCREEN_TITLE.practice),
        value: seen === tasks.length ? t(locale, 'setup.state.done') : t(locale, 'runbook.practice.count', { done: seen, total: tasks.length }),
        tone: seen === tasks.length ? 'ok' : 'warn' }),
      menuRow({ href: PILOT_SCREEN_PATH.activity, icon: 'history', label: t(locale, SCREEN_TITLE.activity) }),
    ]);
}

/** One of the two screens under the checklist; the shell draws the way back to it (`BACK_TO`). */
export function renderPilotScreen(
  which: PilotScreen, rb: PilotRunbook, locale: Locale, feedback?: PilotFeedback,
): string {
  const head = `<h1 class="page">${esc(t(locale, SCREEN_TITLE[which]))}</h1>`;
  if (which === 'practice') return head + practiceSection(rb, locale);
  return head
    + duringSection(rb.operations, locale)
    + healthSection(rb.reliability, locale)
    + (feedback ? feedbackSection(feedback, locale) : '')
    + afterSection(locale);
}

/**
 * `/app/onboarding/technical` — the machine room, owner-only (the route's
 * guard is the one that switches messaging on). What whoever runs the
 * installation reads: which WhatsApp credentials are set and well-formed (never
 * their values), whether a reply can reopen a closed day, an engine defect on
 * this business's real rows, and which build is running. Each section is
 * omitted when not supplied, as before the split.
 */
export function renderPilotTechnical(
  locale: Locale,
  o: {
    readonly deployment?: DeploymentInfo; readonly meta?: MetaReadiness;
    readonly rehearsal?: RehearsalReport | null;
    readonly templateState?: TemplateState; readonly unauthoredPriceRules?: number;
  } = {},
): string {
  // Phase 9 (w4-today-setup-20) — the way back is the shell's, above the heading as everywhere (`BACK_TO`).
  return `<h1 class="page">${esc(t(locale, 'pilot.technical.title'))}</h1>
    <p class="muted">${esc(t(locale, 'pilot.technical.intro'))}</p>`
    + (o.meta ? metaSection(o.meta, locale, o.templateState ?? 'none') : '')
    + (o.rehearsal ? engineSection(o.rehearsal, locale) : '')
    + (o.deployment ? deploymentSection(o.deployment, locale, o.unauthoredPriceRules ?? 0) : '');
}


