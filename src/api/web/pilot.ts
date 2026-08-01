import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../core/owner/i18n/messages.js';
import { formatDate } from '../../core/owner/i18n/format.js';
import { runAll } from '../../trust/harness.js';
import { SCENARIOS } from '../../trust/scenarios.js';
import { loadOperationsSnapshot, type OperationsSnapshot, type Range } from './operations.js';
import { type DeploymentInfo } from './deployment.js';
import { type MetaReadiness } from '../../core/channel/metaReadiness.js';
import { esc } from './layout.js';

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

export type DetectedKey = 'profile' | 'products' | 'knowledge' | 'claims' | 'sandbox' | 'channel';
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
    detected: { profile: false, products: false, knowledge: false, claims: false, sandbox: false, channel: false },
    attest: { backupTestedAt: null, secretsRotatedAt: null, ownerReadyAt: null },
    validation: { at: null, pass: null, total: null },
    readyToLaunch: false,
  };
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return empty;
  const B = bid.value;

  return withTenantTx(db, B, async (tx) => {
    const r = (await sql<{
      profile: boolean; products: boolean; knowledge: boolean; claims: boolean; channel: boolean;
      backup_tested_at: Date | null; secrets_rotated_at: Date | null; owner_ready_at: Date | null;
      last_validation_at: Date | null; last_validation_pass: number | null; last_validation_total: number | null;
    }>`
      with os as (select * from onboarding_state where business_id = ${B})
      select
        coalesce((select (description is not null and location is not null and (contact_email is not null or contact_phone is not null)) from businesses where id = ${B}), false) as profile,
        exists(select 1 from products where business_id = ${B} and is_active and price_usd_per_unit is not null) as products,
        exists(select 1 from product_knowledge where business_id = ${B} and status = 'active' and source in ('owner_confirmed','owner_corrected')) as knowledge,
        (exists(select 1 from claims_policy where business_id = ${B} and allowed) or (select claims_reviewed_at from os) is not null) as claims,
        exists(select 1 from channels where business_id = ${B} and kind = 'whatsapp' and status = 'connected') as channel,
        (select backup_tested_at from os) as backup_tested_at,
        (select secrets_rotated_at from os) as secrets_rotated_at,
        (select owner_ready_at from os) as owner_ready_at,
        (select last_validation_at from os) as last_validation_at,
        (select last_validation_pass from os) as last_validation_pass,
        (select last_validation_total from os) as last_validation_total
    `.execute(tx)).rows[0]!;

    const sandbox = r.last_validation_at !== null && r.last_validation_pass !== null
      && r.last_validation_total !== null && r.last_validation_pass === r.last_validation_total;

    const detected = { profile: r.profile, products: r.products, knowledge: r.knowledge, claims: r.claims, sandbox, channel: r.channel };
    const attest = { backupTestedAt: r.backup_tested_at, secretsRotatedAt: r.secrets_rotated_at, ownerReadyAt: r.owner_ready_at };
    const readyToLaunch = detected.profile && detected.products && detected.knowledge && detected.claims && detected.sandbox
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

export type PilotRunbook = {
  readonly readiness: PilotReadiness;       // before launch (M15)
  readonly operations: OperationsSnapshot;  // during pilot (M16.2a)
  readonly rehearsal: {
    readonly available: boolean;                       // a sandbox tenant exists to practice in
    readonly done: Record<RehearsalStep, boolean>;
    readonly completed: number;
    readonly total: number;
  };
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

  const done: Record<RehearsalStep, boolean> = {
    takeover: sbx.takeover, ownerReply: sbx.owner_reply, resume: sbx.resume,
    knowledgeCorrection, validationPassed,
  };
  const completed = REHEARSAL_STEPS.filter((s) => done[s]).length;
  return { readiness, operations, rehearsal: { available, done, completed, total: REHEARSAL_STEPS.length } };
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
  profile: '/app/settings', products: '/app/products', knowledge: '/app/knowledge',
  claims: '/app/knowledge', sandbox: '/app/sandbox', channel: '/app/channels',
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
  const detectedOrder: DetectedKey[] = ['profile', 'products', 'knowledge', 'claims', 'sandbox', 'channel'];
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
    <div class="card"><h2>${esc(t(locale, 'pilot.setup'))}</h2>${setup}</div>
    <div class="card"><h2>${esc(t(locale, 'pilot.prelaunch'))}</h2>
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
    ? `<div class="empty muted">${esc(t(locale, 'runbook.during.quiet'))}</div>`
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
  return `<div class="card"><h2>${esc(t(locale, 'runbook.during.title'))}</h2>${body}</div>`;
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
  return `<div class="card">
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
  return `<div class="card">
    <h2>${esc(t(locale, 'runbook.after.title'))}</h2>
    <p class="muted">${esc(t(locale, 'runbook.after.intro'))}</p>
    ${link('runbook.after.promotion', '/app/employee')}
    ${link('runbook.after.autonomy', '/app/employee')}
    ${link('runbook.after.gaps', '/app/knowledge')}
  </div>`;
}

/**
 * M17.1 — which build is running. Owner-authenticated only: the same facts are
 * deliberately NOT on /health, so a public probe cannot advertise the commit.
 * Anything the host does not report renders as "Not reported", never a guess.
 */
function deploymentSection(d: DeploymentInfo, locale: Locale): string {
  const unknown = t(locale, 'runbook.deploy.unknown');
  const row = (label: MessageKey, value: string) =>
    `<div class="rbrow"><span class="lbl">${esc(t(locale, label))}</span><b class="n mono">${esc(value)}</b></div>`;
  const version = d.commit ? (d.branch ? `${d.commit} · ${d.branch}` : d.commit) : unknown;
  const messaging = d.provider === 'disabled'
    ? t(locale, 'runbook.deploy.providerDisabled')
    : d.provider;
  return `<div class="card">
    <h2>${esc(t(locale, 'runbook.deploy.title'))}</h2>
    ${row('runbook.deploy.version', version)}
    ${row('runbook.deploy.environment', d.environment)}
    ${row('runbook.deploy.channelMode', messaging)}
    ${row('runbook.deploy.since', formatDate(locale, d.startedAt))}
  </div>`;
}

/**
 * M17.2 — WhatsApp go-live preparation. READ-ONLY: it reports what is still
 * missing and switches nothing on. Credential VALUES never appear here — only
 * whether each one is set and correctly shaped.
 */
function metaSection(m: MetaReadiness, locale: Locale): string {
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
  return `<div class="card">
    <h2>${esc(t(locale, 'meta.title'))}</h2>
    <p class="muted">${esc(t(locale, 'meta.intro'))}</p>
    ${rows}
    <div class="verdict ${m.live ? 'ok' : ''}">${esc(t(locale, m.live ? 'meta.live' : 'meta.notLive'))}</div>
    ${blockers ? `<ul class="rbsteps muted">${blockers}</ul>` : ''}
  </div>`;
}

export function renderPilotRunbook(
  rb: PilotRunbook, locale: Locale, flash: string | null,
  deployment?: DeploymentInfo, meta?: MetaReadiness,
): string {
  return renderPilotReadiness(rb.readiness, locale, flash)
    + duringSection(rb.operations, locale)
    + practiceSection(rb.rehearsal, locale)
    + afterSection(locale)
    + (meta ? metaSection(meta, locale) : '')
    + (deployment ? deploymentSection(deployment, locale) : '')
    + RUNBOOK_STYLE;
}

const RUNBOOK_STYLE = `<style>
  .rbsub { font-size:12px; text-transform:uppercase; letter-spacing:.6px; color:#8b929c; margin:16px 0 6px; }
  .rbrow { display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid #1b1f25; }
  .rbrow:last-child { border-bottom:0; }
  .rbrow .lbl { font-size:14px; } .rbrow .n { margin-inline-start:auto; font-size:16px; font-weight:700; color:#fff; }
  .rblink { font-size:13px; }
  .rbsteps { margin:6px 0 14px; padding-inline-start:20px; color:#c8ccd2; font-size:14px; }
  .rbsteps li { padding:2px 0; }
  .rbrow .mono { font:13px/1.4 "SF Mono", ui-monospace, Menlo, monospace; font-weight:600; unicode-bidi:plaintext; }
</style>`;

const PILOT_STYLE = `<style>
  .pr { display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:12px 0; border-bottom:1px solid #1b1f25; }
  .pr:last-child { border-bottom:0; }
  .pr .mk { font-size:18px; font-weight:700; } .pr.done .mk { color:#4ade80; } .pr.todo .mk { color:#8b929c; }
  .pr .lbl { font-size:15px; }
  .pr-b { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-inline-start:auto; }
  .badge { font-size:12px; padding:3px 10px; border-radius:999px; }
  .badge.sys { background:#0f2e1c; color:#4ade80; } .badge.owner { background:#13233a; color:#93c5fd; }
  .btn { padding:8px 16px; border:0; border-radius:9px; background:#2563eb; color:#fff; font-size:13px; font-weight:600; cursor:pointer; }
  .btn.ghost { background:transparent; border:1px solid #2b313a; color:#b9c0c9; }
  .inline { display:inline; }
  .verdict { margin-top:16px; padding:14px; border-radius:12px; background:#14171c; border:1px solid #23272e; text-align:center; font-weight:600; }
  .verdict.ok { background:#0f2e1c; color:#4ade80; border-color:#1f5a3a; }
  .flash { background:#0f2e1c; color:#4ade80; border-radius:10px; padding:10px 14px; margin-bottom:14px; }
  button:focus-visible, a:focus-visible { outline:2px solid #60a5fa; outline-offset:2px; }
</style>`;
