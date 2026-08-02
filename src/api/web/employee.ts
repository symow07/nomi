import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { promotionDecision } from '../../core/trust/evidence.js';
import { loadCapabilityEvidence, NON_PROMOTABLE } from '../../pipeline/capability.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { t, capabilityName, EMPLOYEE_NAME, type MessageKey } from '../../core/owner/i18n/messages.js';
import { formatDate } from '../../core/owner/i18n/format.js';
import { esc, deeper } from './layout.js';

/**
 * M9.6 + ADR-0008 — Employee Profile. A VIEW over the existing trust data
 * (autonomy_policy, capability_events, spot_checks, drafts-as-training) + the M5
 * promotion logic. The read model is language-NEUTRAL — capability codes, event
 * kinds, condition codes, a raw hire date; renderEmployee localizes. The employee
 * name is a per-locale product constant. No invented metrics.
 */

type Stage = 'probation' | 'partial';
type GrowthKind = 'promote' | 'revoke' | 'spotcheck_pass' | 'spotcheck_improve' | 'spotcheck_issue' | 'learned_edit';
type ConditionCode = 'passed_spotcheck' | 'learned_correction';

const NEVER_ALLOWED: readonly MessageKey[] = ['neverAllowed.promise_stock', 'neverAllowed.change_payment', 'neverAllowed.promise_leadtime'];

export type CapabilityRow = { readonly capability: string; readonly mode: 'auto' | 'draft'; readonly promotable: boolean };
export type GrowthEvent = { readonly kind: GrowthKind; readonly capability: string | null; readonly at: Date };

export type EmployeeProfile = {
  readonly hireDate: Date | null;
  /**
   * Nomi Phase C — how many things she has been taught that are still current:
   * active knowledge the OWNER confirmed or corrected (seeded samples excluded,
   * because nobody taught those). Part of who she is, so it lives on her
   * profile. A real COUNT — never a mastery or coverage figure.
   */
  readonly knows: number;
  readonly stage: Stage;
  readonly canDo: readonly string[];       // auto capability codes
  readonly needConfirm: readonly string[]; // draft capability codes (excl. confirm_order)
  readonly capabilities: readonly CapabilityRow[];
  readonly growth: readonly GrowthEvent[];
  readonly promoted: boolean;
  readonly conditions: readonly { readonly cond: ConditionCode; readonly met: boolean }[];
};

export async function loadEmployee(db: Db, businessIdRaw: string): Promise<EmployeeProfile> {
  const bid = parseBusinessId(businessIdRaw);
  const empty: EmployeeProfile = {
    hireDate: null, knows: 0, stage: 'probation', canDo: [], needConfirm: [], capabilities: [],
    growth: [], promoted: false, conditions: [],
  };
  if (!bid.ok) return empty;

  return withTenantTx(db, bid.value, async (tx) => {
    const onboard = (await sql<{ signup_at: Date | null }>`
      select signup_at from onboarding_state where business_id = ${bid.value}`.execute(tx)).rows[0];

    const knows = (await sql<{ n: number }>`
      select count(*)::int as n from product_knowledge
       where business_id = ${bid.value} and status = 'active'
         and source in ('owner_confirmed', 'owner_corrected')`.execute(tx)).rows[0]!.n;

    const caps = (await sql<{ capability: string; mode: string }>`
      select capability, mode from autonomy_policy where business_id = ${bid.value} order by capability`.execute(tx)).rows;

    const capabilities: CapabilityRow[] = [];
    for (const c of caps) {
      const mode = c.mode === 'auto' ? 'auto' : 'draft';
      let promotable = false;
      if (mode === 'draft' && !NON_PROMOTABLE.includes(c.capability)) {
        promotable = promotionDecision(await loadCapabilityEvidence(tx, c.capability)).eligible;
      }
      capabilities.push({ capability: c.capability, mode, promotable });
    }

    const canDo = capabilities.filter((c) => c.mode === 'auto').map((c) => c.capability);
    const needConfirm = capabilities.filter((c) => c.mode === 'draft' && c.capability !== 'confirm_order').map((c) => c.capability);

    // Growth timeline — neutral event kinds; the renderer localizes. Most recent 8.
    const growth = (await sql<{ kind: string; capability: string | null; at: Date }>`
      (select case when action = 'promote' then 'promote' else 'revoke' end as kind, capability, at
         from capability_events where business_id = ${bid.value})
      union all
      (select case when verdict = 'correct' then 'spotcheck_pass'
                   when verdict = 'needs_improvement' then 'spotcheck_improve'
                   else 'spotcheck_issue' end, null::text, answered_at
         from spot_checks where business_id = ${bid.value} and answered_at is not null)
      union all
      (select 'learned_edit', capability, decided_at
         from drafts where business_id = ${bid.value} and status = 'edited' and decided_at is not null)
      order by at desc limit 8
    `.execute(tx)).rows.map((r): GrowthEvent => ({ kind: r.kind as GrowthKind, capability: r.capability, at: r.at }));

    const passed = (await sql<{ n: number }>`select count(*)::int as n from spot_checks where verdict='correct'`.execute(tx)).rows[0]!.n;
    const learned = (await sql<{ n: number }>`select count(*)::int as n from drafts where status='edited'`.execute(tx)).rows[0]!.n;
    const promoted = canDo.length > 0;

    return {
      hireDate: onboard?.signup_at ?? null,
      knows,
      stage: promoted ? 'partial' : 'probation',
      canDo, needConfirm, capabilities, growth, promoted,
      conditions: promoted ? [] : [
        { cond: 'passed_spotcheck', met: passed > 0 },
        { cond: 'learned_correction', met: learned > 0 },
      ],
    };
  });
}

/** ── Renderer (pure, mobile-first, localized) ─────────────────────────────── */

const GROWTH_ICON: Record<GrowthKind, string> = {
  promote: '⭐', revoke: '⚠️', spotcheck_pass: '✓', spotcheck_improve: '⚠️', spotcheck_issue: '⚠️', learned_edit: '⭐',
};

const list = (title: string, mark: string, items: readonly string[], cls: string, emptyLabel: string): string =>
  items.length
    ? `<div class="dgroup"><div class="dtitle">${esc(title)}</div>${items.map((i) => `<div class="ditem ${cls}">${mark} ${esc(i)}</div>`).join('')}</div>`
    : `<div class="dgroup"><div class="dtitle">${esc(title)}</div><div class="ditem muted">${esc(emptyLabel)}</div></div>`;

/**
 * Nomi Phase C — the rest of "who is she today?", composed by the route from
 * read models that already exist (M13/M14 knowledge, the operations snapshot,
 * the pilot feedback loop). Structurally typed so this module imports nothing
 * new and cannot create a cycle. Counts only; no rate, no score.
 */
export type HerContext = {
  readonly taughtRecently: number;      // facts added in range (M14)
  readonly corrected: number;           // answers you corrected in range (M14)
  readonly handled: number;             // conversations she handled (M16.2a)
  readonly draftsPrepared: number;
  readonly neededYou: number;           // DISTINCT conversations a human stepped into
  readonly gaps: readonly { readonly question: string; readonly count: number }[];
};

const countRow = (value: number, label: string): string =>
  `<div class="hrow"><span class="hnum">${value}</span><span class="hlabel">${esc(label)}</span></div>`;

/** 1 · What does she know? Her learning, in her terms — never a "database". */
function knowsSection(e: EmployeeProfile, c: HerContext | undefined, locale: Locale): string {
  if (e.knows === 0 && (!c || (c.taughtRecently === 0 && c.corrected === 0))) {
    return `<div class="card"><h2>${esc(t(locale, 'her.knows.title'))}</h2>
      <p class="muted empty-p">${esc(t(locale, 'her.knows.none'))}</p>
      <a class="btn" href="/app/knowledge">${esc(t(locale, 'knowledge.teach'))}</a></div>`;
  }
  return `<div class="card"><h2>${esc(t(locale, 'her.knows.title'))}</h2>
    <div class="hrows">
      ${countRow(e.knows, t(locale, 'her.knows.count'))}
      ${c ? countRow(c.taughtRecently, t(locale, 'her.knows.recent')) : ''}
      ${c ? countRow(c.corrected, t(locale, 'her.knows.corrected')) : ''}
    </div>
    ${deeper('/app/knowledge', t(locale, 'ops.open'))}</div>`;
}

/** 3 · What did she do recently? Real counts, no rate. */
function recentSection(c: HerContext | undefined, locale: Locale): string {
  if (!c) return '';
  const quiet = c.handled === 0 && c.draftsPrepared === 0 && c.neededYou === 0;
  return `<div class="card"><h2>${esc(t(locale, 'her.recent.title'))}</h2>
    ${quiet ? `<p class="muted empty-p">${esc(t(locale, 'her.recent.quiet'))} ${esc(t(locale, 'her.recent.noneWhy'))}</p>`
      : `<div class="hrows">
          ${countRow(c.handled, t(locale, 'ops.activity.handled'))}
          ${countRow(c.draftsPrepared, t(locale, 'ops.activity.drafts'))}
          ${countRow(c.neededYou, t(locale, 'her.recent.needed'))}
         </div>`}</div>`;
}

/** 4 · What still needs teaching? Each item leads to the EXISTING teach flow. */
function teachSection(c: HerContext | undefined, locale: Locale): string {
  if (!c) return '';
  if (c.gaps.length === 0) {
    // Phase F: "she answered everything you taught" is only TRUE once she has
    // answered something. On a new account this rendered a green ✓ for work
    // that never happened — a fabricated success on the trust surface itself.
    const pristine = c.handled === 0;
    return `<div class="card"><h2>${esc(t(locale, 'her.teach.title'))}</h2>
      <p class="muted empty-p">${pristine ? '' : '✓ '}${esc(t(locale, pristine ? 'her.teach.unasked' : 'her.teach.none'))}</p>
      ${pristine ? `<a class="btn send" href="/app/knowledge">${esc(t(locale, 'her.teach.go'))}</a>` : ''}</div>`;
  }
  return `<div class="card"><h2>${esc(t(locale, 'her.teach.title'))}</h2>
    <div class="gaps">${c.gaps.map((g) => `
      <a class="gap" href="/app/knowledge?teach=${encodeURIComponent(g.question)}">
        <span class="gq">${esc(g.question)}</span>
        <span class="gmeta muted">${esc(t(locale, 'her.teach.asked', { count: g.count }))}</span>
        <span class="gact">${esc(t(locale, 'her.teach.go'))}<span class="go" aria-hidden="true">›</span></span>
      </a>`).join('')}</div></div>`;
}

export function renderEmployee(
  e: EmployeeProfile, locale: Locale, flash: string | null, ctx?: HerContext,
): string {
  const name = EMPLOYEE_NAME[locale];
  const capName = (c: string) => capabilityName(locale, c);
  const stageLabel = t(locale, `employee.stage.${e.stage}` as MessageKey);

  const card = `<div class="card emp">
    <div class="emp-h"><span class="ava">👩‍💼</span>
      <div><div class="emp-name">${esc(name)}</div>
        <div class="muted">${esc(stageLabel)} · ${esc(t(locale, 'employee.role.reception'))}</div></div></div>
    ${e.hireDate ? `<div class="muted" style="margin-top:8px">${esc(t(locale, 'employee.hired'))}：${esc(formatDate(locale, e.hireDate))}</div>` : ''}
  </div>`;

  // 2 · What can she handle? Permission and trust boundaries — never a measure
  //     of how good she is. Promotion LOGIC is untouched; only the framing.
  const cannotDo = [capName('confirm_order'), ...NEVER_ALLOWED.map((k) => t(locale, k))];
  const duties = `<div class="card"><h2>${esc(t(locale, 'her.handles.title'))}</h2>
    ${e.canDo.length === 0 && e.needConfirm.length === 0
      ? `<p class="muted empty-p">${esc(t(locale, 'her.handles.none'))}</p>` : ''}
    ${list(t(locale, 'her.handles.alone'), '✓', e.canDo.map(capName), 'ok', t(locale, 'employee.duties.none'))}
    ${list(t(locale, 'her.handles.waits'), '○', e.needConfirm.map(capName), 'warn', t(locale, 'employee.duties.none'))}
    ${list(t(locale, 'her.handles.always'), '○', cannotDo, 'no', t(locale, 'employee.duties.none'))}
  </div>`;

  const growth = `<div class="card"><h2>${esc(t(locale, 'employee.growth.title'))}</h2>
    ${e.growth.length
      ? `<ul class="growth">${e.growth.map((g) => {
          const text = t(locale, `employee.growth.${g.kind}` as MessageKey, g.capability ? { cap: capName(g.capability) } : {});
          return `<li>${GROWTH_ICON[g.kind]} ${esc(text)}<span class="muted"> · ${esc(formatDate(locale, g.at))}</span></li>`;
        }).join('')}</ul>`
      : `<div class="muted empty">${esc(t(locale, 'employee.growth.empty'))}</div>`}
  </div>`;

  const promo = `<div class="card"><h2>${esc(t(locale, 'employee.promo.title'))}</h2>
    <div class="pstage"><span class="muted">${esc(t(locale, 'employee.promo.current'))}</span> <b>${esc(stageLabel)}</b></div>
    ${e.promoted
      ? `<div class="muted">${esc(t(locale, 'employee.promo.done'))}</div>`
      : `<div class="pstage"><span class="muted">${esc(t(locale, 'employee.promo.next'))}</span> <b>${esc(t(locale, 'employee.stage.partial'))}</b></div>`}
    ${e.conditions.length ? `<div class="conds">${e.conditions.map((c) =>
      `<div class="cond ${c.met ? 'met' : ''}">${c.met ? '✓' : '○'} ${esc(t(locale, `employee.promo.cond.${c.cond}` as MessageKey))}</div>`).join('')}</div>` : ''}
  </div>`;

  const grantable = e.capabilities.filter((c) => c.mode === 'draft' && c.promotable);
  const revocable = e.capabilities.filter((c) => c.mode === 'auto');
  const actions = (grantable.length || revocable.length)
    ? `<div class="card"><h2>${esc(t(locale, 'employee.actions.title'))}</h2>
        ${revocable.map((c) => `<form method="post" action="/app/employee/capability/${esc(c.capability)}/revoke" class="actrow">
            <span>${esc(t(locale, 'employee.actions.granted', { cap: capName(c.capability) }))}</span><button class="btn danger">${esc(t(locale, 'employee.actions.revoke'))}</button></form>`).join('')}
        ${grantable.map((c) => `<form method="post" action="/app/employee/capability/${esc(c.capability)}/promote" class="actrow">
            <span>${esc(t(locale, 'employee.actions.eligible', { cap: capName(c.capability) }))}</span><button class="btn send">${esc(t(locale, 'employee.actions.grant'))}</button></form>`).join('')}
        <p class="muted" style="font-size:12px">${esc(t(locale, 'employee.actions.note'))}</p>
      </div>`
    : `<div class="card"><h2>${esc(t(locale, 'employee.actions.title'))}</h2><div class="muted empty">${esc(t(locale, 'employee.actions.empty'))}</div></div>`;

  // Order answers "who is she today?": who she is → what she knows → what she is
  // trusted with → what she did → what she still needs from you. Promotion and
  // growth sit last: they are the mechanics behind the relationship, not the
  // headline.
  return `<h1 class="page">${esc(name)}</h1>
    ${flash ? `<div class="flash" role="status">${esc(flash)}</div>` : ''}
    ${card}
    ${knowsSection(e, ctx, locale)}
    ${duties}
    ${recentSection(ctx, locale)}
    ${teachSection(ctx, locale)}
    ${growth}${promo}${actions}${EMP_STYLE}`;
}

const EMP_STYLE = `<style>
  /* Phase C: plain count rows and tappable gap rows — no matrix, no dense table. */
  .hrows { display:flex; flex-direction:column; gap:2px; }
  .hrow { display:flex; align-items:baseline; gap:12px; padding:8px 0; border-bottom:1px solid #1c2026; }
  .hrow:last-child { border-bottom:0; }
  .hnum { font-size:17px; font-weight:700; color:#fff; min-width:2.2em; font-variant-numeric:tabular-nums; }
  .hlabel { color:#b9c0c9; font-size:15px; }
  .empty-p { margin:0 0 12px; }
  .gaps { display:flex; flex-direction:column; gap:10px; }
  a.gap { display:grid; grid-template-columns:1fr auto; gap:4px 12px; background:#0f1216;
          border:1px solid #2b313a; border-radius:12px; padding:14px 16px; }
  a.gap:hover, a.gap:focus-visible { border-color:#3d7a63; }
  .gq { font-size:15px; color:#e6e8eb; }
  .gmeta { font-size:12px; grid-column:1; }
  .gact { grid-row:1 / span 2; align-self:center; color:#60a5fa; font-size:14px; white-space:nowrap; }
  @media (max-width:560px) { a.gap { grid-template-columns:1fr; } .gact { grid-row:auto; text-align:start; } }
  .emp-h { display:flex; align-items:center; gap:14px; }
  .ava { width:44px; height:44px; border-radius:999px; background:#1b2430; display:flex; align-items:center; justify-content:center; font-size:22px; }
  .emp-name { font-size:19px; font-weight:700; }
  .dgroup { margin-bottom:14px; } .dtitle { font-weight:600; margin-bottom:8px; }
  .ditem { padding:8px 12px; border-radius:8px; margin-bottom:6px; font-size:14px; background:#0f1216; border:1px solid #23272e; }
  .ditem.ok { color:#4ade80; } .ditem.warn { color:#fbbf24; } .ditem.no { color:#8b929c; }
  .growth { list-style:none; padding:0; margin:0; } .growth li { padding:9px 0; border-bottom:1px solid #1c2026; font-size:14px; }
  .growth li:last-child { border-bottom:none; }
  .pstage { margin:6px 0; font-size:15px; } .conds { margin-top:12px; display:flex; flex-direction:column; gap:8px; }
  .cond { font-size:14px; color:#8b929c; } .cond.met { color:#4ade80; }
  .actrow { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 0; border-bottom:1px solid #1c2026; font-size:14px; }
  .actrow:last-of-type { border-bottom:none; }
</style>`;
