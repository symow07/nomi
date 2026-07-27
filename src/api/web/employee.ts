import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { CAPABILITY_ZH } from '../../core/owner/vocabulary.js';
import { NEVER_ALLOWED_ZH } from '../../core/owner/jobSheet.js';
import { formatDateZh } from '../../core/owner/format.js';
import { promotionDecision } from '../../core/trust/evidence.js';
import { loadCapabilityEvidence, NON_PROMOTABLE } from '../../pipeline/capability.js';
import { esc } from './layout.js';

/**
 * M9.6 — Employee Profile / 工作档案. A personnel file, not a settings page.
 * A VIEW over the EXISTING trust data (autonomy_policy, capability_events,
 * spot_checks, drafts-as-training) + the M5 promotion logic. No new trust
 * system, no invented metrics — anything with no data shows an empty state.
 */

const CAP_NAME = (c: string): string => CAPABILITY_ZH[c] ?? c;

export type CapabilityRow = { readonly capability: string; readonly nameZh: string; readonly mode: 'auto' | 'draft'; readonly promotable: boolean };
export type GrowthEvent = { readonly icon: string; readonly textZh: string; readonly at: Date };

export type EmployeeProfile = {
  readonly name: string;
  readonly hireDate: Date | null;
  readonly stageZh: string;              // 试用期 / 正式接待
  readonly roleZh: string;
  readonly canDo: readonly string[];     // auto capabilities
  readonly needConfirm: readonly string[]; // draft capabilities (excl. confirm_order)
  readonly cannotDo: readonly string[];  // confirm_order + hard limits
  readonly capabilities: readonly CapabilityRow[]; // for the action controls
  readonly growth: readonly GrowthEvent[];
  readonly promoted: boolean;
  readonly nextStepZh: string | null;
  readonly conditions: readonly { readonly label: string; readonly met: boolean }[];
};

export async function loadEmployee(db: Db, businessIdRaw: string, fallbackName: string): Promise<EmployeeProfile> {
  const bid = parseBusinessId(businessIdRaw);
  const empty: EmployeeProfile = {
    name: fallbackName, hireDate: null, stageZh: '试用期', roleZh: '客户接待',
    canDo: [], needConfirm: [], cannotDo: ['确认订单', ...NEVER_ALLOWED_ZH.slice(0, 3)],
    capabilities: [], growth: [], promoted: false, nextStepZh: '正式接待', conditions: [],
  };
  if (!bid.ok) return empty;

  return withTenantTx(db, bid.value, async (tx) => {
    const onboard = (await sql<{ employee_name: string | null; signup_at: Date | null }>`
      select employee_name, signup_at from onboarding_state where business_id = ${bid.value}`.execute(tx)).rows[0];
    const name = onboard?.employee_name ?? fallbackName;

    const caps = (await sql<{ capability: string; mode: string }>`
      select capability, mode from autonomy_policy where business_id = ${bid.value}
       order by capability`.execute(tx)).rows;

    const capabilities: CapabilityRow[] = [];
    for (const c of caps) {
      const mode = c.mode === 'auto' ? 'auto' : 'draft';
      let promotable = false;
      if (mode === 'draft' && !NON_PROMOTABLE.includes(c.capability)) {
        promotable = promotionDecision(await loadCapabilityEvidence(tx, c.capability)).eligible;
      }
      capabilities.push({ capability: c.capability, nameZh: CAP_NAME(c.capability), mode, promotable });
    }

    const canDo = capabilities.filter((c) => c.mode === 'auto').map((c) => c.nameZh);
    const needConfirm = capabilities.filter((c) => c.mode === 'draft' && c.capability !== 'confirm_order').map((c) => c.nameZh);
    const cannotDo = ['确认订单', ...NEVER_ALLOWED_ZH.slice(0, 3)];

    // Growth timeline — merge existing signals, owner language, most recent 8.
    const events = (await sql<{ icon: string; text_zh: string; at: Date }>`
      (select case when action = 'promote' then '⭐' else '⚠️' end as icon,
              case when action = 'promote' then '「' || capability || '」晋升'
                   else '「' || capability || '」收回' end as text_zh, at
         from capability_events where business_id = ${bid.value})
      union all
      (select case when verdict = 'correct' then '✓' else '⚠️' end,
              case when verdict = 'correct' then '抽查通过'
                   when verdict = 'needs_improvement' then '抽查后有修改'
                   else '抽查发现问题' end, answered_at
         from spot_checks where business_id = ${bid.value} and answered_at is not null)
      union all
      (select '⭐', '学会一次修正（' || capability || '）', decided_at
         from drafts where business_id = ${bid.value} and status = 'edited' and decided_at is not null)
      order by at desc limit 8
    `.execute(tx)).rows.map((r) => ({
      // Translate capability codes inside the text to owner names.
      icon: r.icon,
      textZh: r.text_zh.replace(/「([a-z_]+)」/g, (_m, c: string) => `「${CAP_NAME(c)}」`)
                       .replace(/（([a-z_]+)）/g, (_m, c: string) => `（${CAP_NAME(c)}）`),
      at: r.at,
    }));

    // Promotion / stage from real counts (no invented score).
    const passed = (await sql<{ n: number }>`select count(*)::int as n from spot_checks where verdict='correct'`.execute(tx)).rows[0]!.n;
    const learned = (await sql<{ n: number }>`select count(*)::int as n from drafts where status='edited'`.execute(tx)).rows[0]!.n;
    const promoted = canDo.length > 0;

    return {
      name, hireDate: onboard?.signup_at ?? null,
      stageZh: promoted ? '正式接待（部分）' : '试用期', roleZh: '客户接待',
      canDo, needConfirm, cannotDo, capabilities, growth: events, promoted,
      nextStepZh: promoted ? null : '正式接待',
      conditions: promoted ? [] : [
        { label: '通过一次抽查', met: passed > 0 },
        { label: '学会一次修正', met: learned > 0 },
      ],
    };
  });
}

/** ── Renderer (pure, mobile-first, owner language) ──────────────────────── */

const list = (title: string, mark: string, items: readonly string[], cls: string): string =>
  items.length
    ? `<div class="dgroup"><div class="dtitle">${esc(title)}</div>${items.map((i) => `<div class="ditem ${cls}">${mark} ${esc(i)}</div>`).join('')}</div>`
    : `<div class="dgroup"><div class="dtitle">${esc(title)}</div><div class="ditem muted">暂无</div></div>`;

export function renderEmployee(e: EmployeeProfile, flash: string | null): string {
  const card = `<div class="card emp">
    <div class="emp-h"><span class="ava">👩‍💼</span>
      <div><div class="emp-name">${esc(e.name)}</div>
        <div class="muted">${esc(e.stageZh)} · ${esc(e.roleZh)}</div></div></div>
    ${e.hireDate ? `<div class="muted" style="margin-top:8px">入职：${esc(formatDateZh(e.hireDate))}</div>` : ''}
  </div>`;

  const duties = `<div class="card"><h2>工作职责</h2>
    ${list('现在可以', '✓', e.canDo, 'ok')}
    ${list('需要确认', '⚠️', e.needConfirm, 'warn')}
    ${list('暂不能', '✗', e.cannotDo, 'no')}
  </div>`;

  const growth = `<div class="card"><h2>成长记录</h2>
    ${e.growth.length
      ? `<ul class="growth">${e.growth.map((g) => `<li>${g.icon} ${esc(g.textZh)}<span class="muted"> · ${esc(formatDateZh(g.at))}</span></li>`).join('')}</ul>`
      : `<div class="muted empty">还在起步，改她的稿、抽查她的活，都会记在这里。</div>`}
  </div>`;

  const promo = `<div class="card"><h2>晋升状态</h2>
    <div class="pstage"><span class="muted">当前</span> <b>${esc(e.stageZh)}</b></div>
    ${e.nextStepZh ? `<div class="pstage"><span class="muted">下一步</span> <b>${esc(e.nextStepZh)}</b></div>` : `<div class="muted">已经在正式接待客户了。</div>`}
    ${e.conditions.length ? `<div class="conds">${e.conditions.map((c) =>
      `<div class="cond ${c.met ? 'met' : ''}">${c.met ? '✓' : '○'} ${esc(c.label)}</div>`).join('')}</div>` : ''}
  </div>`;

  // Owner actions — reuse the capability service (promote where eligible, revoke on granted).
  const grantable = e.capabilities.filter((c) => c.mode === 'draft' && c.promotable);
  const revocable = e.capabilities.filter((c) => c.mode === 'auto');
  const actions = (grantable.length || revocable.length)
    ? `<div class="card"><h2>放权与收回</h2>
        ${revocable.map((c) => `<form method="post" action="/app/employee/capability/${esc(c.capability)}/revoke" class="actrow">
            <span>「${esc(c.nameZh)}」已放权</span><button class="btn danger">收回</button></form>`).join('')}
        ${grantable.map((c) => `<form method="post" action="/app/employee/capability/${esc(c.capability)}/promote" class="actrow">
            <span>「${esc(c.nameZh)}」达到放权标准 ⭐</span><button class="btn send">放权</button></form>`).join('')}
        <p class="muted" style="font-size:12px">放权后这类事她自己做，随时可以收回。确认订单永远等你。</p>
      </div>`
    : `<div class="card"><h2>放权与收回</h2><div class="muted empty">还没有可以放权或收回的职责。她做得多、抽查过了，这里会出现「放权」。</div></div>`;

  return `<h1 class="page">员工档案</h1>
    ${flash ? `<div class="flash" role="status">${esc(flash)}</div>` : ''}
    ${card}${duties}${growth}${promo}${actions}${EMP_STYLE}`;
}

const EMP_STYLE = `<style>
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
  .btn { padding:8px 16px; border:0; border-radius:8px; background:#2a313c; color:#fff; font-size:14px; font-weight:600; cursor:pointer; }
  .btn.send { background:#2563eb; } .btn.danger { background:#3a2020; color:#f8b4b4; }
  .flash { background:#0f2e1c; color:#4ade80; border-radius:10px; padding:10px 14px; margin-bottom:14px; font-size:14px; }
  .empty { padding:16px; text-align:center; }
  button:focus-visible { outline:2px solid #60a5fa; outline-offset:2px; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.8px; color:#8b929c; }
</style>`;
