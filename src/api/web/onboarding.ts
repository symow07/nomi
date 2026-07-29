import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { t, EMPLOYEE_NAME, type MessageKey } from '../../core/owner/i18n/messages.js';
import { esc } from './layout.js';

/**
 * M11.2 — Guided Owner Onboarding. A LIVE read model: each step is "done" only
 * because the underlying business data exists (read fresh every request). No
 * duplicate progress store — onboarding_state is never read or written here.
 * The page only reads and DEEP-LINKS to the existing page that completes each
 * step; it re-implements nothing. Honest ✓/○ checklist — no percentage, no fake
 * completion (a step that has no real data simply reads as not done).
 */

export type OnboardingStep = 'profile' | 'products' | 'channels' | 'first_success';
const STEPS: readonly OnboardingStep[] = ['profile', 'products', 'channels', 'first_success'];
const LINK: Record<OnboardingStep, string> = {
  profile: '/app/settings', products: '/app/products', channels: '/app/channels', first_success: '/app/inbox',
};

export type OnboardingData = {
  readonly steps: readonly { readonly step: OnboardingStep; readonly done: boolean }[];
  readonly allDone: boolean;
  readonly nextStep: OnboardingStep | null;
};

export async function loadOnboarding(db: Db, businessIdRaw: string): Promise<OnboardingData> {
  const bid = parseBusinessId(businessIdRaw);
  const build = (m: Record<OnboardingStep, boolean>): OnboardingData => {
    const steps = STEPS.map((s) => ({ step: s, done: m[s] }));
    return { steps, allDone: steps.every((s) => s.done), nextStep: steps.find((s) => !s.done)?.step ?? null };
  };
  if (!bid.ok) return build({ profile: false, products: false, channels: false, first_success: false });

  return withTenantTx(db, bid.value, async (tx) => {
    // One round-trip; each figure is a live EXISTS over real rows. Explicit
    // business_id filters keep it tenant-safe regardless of a table's RLS, and
    // Step 4 joins conversations so an approved draft must belong to a real one.
    const r = (await sql<{
      profile_done: boolean; products_done: boolean; channels_done: boolean; first_success_done: boolean;
    }>`
      select
        coalesce((select (description is not null and location is not null
                          and (contact_email is not null or contact_phone is not null))
                    from businesses where id = ${bid.value}), false) as profile_done,
        exists(select 1 from products
                where business_id = ${bid.value} and is_active and price_usd_per_unit is not null) as products_done,
        exists(select 1 from channels ch
                 join channel_credentials cc on cc.business_id = ch.business_id
                   and cc.channel = 'whatsapp' and cc.is_active
                where ch.business_id = ${bid.value} and ch.kind = 'whatsapp' and ch.status = 'connected') as channels_done,
        exists(select 1 from drafts d
                 join conversations c on c.id = d.conversation_id and c.business_id = ${bid.value}
                where d.business_id = ${bid.value} and d.status in ('approved','edited') and d.decided_at is not null) as first_success_done
    `.execute(tx)).rows[0]!;
    return build({
      profile: r.profile_done, products: r.products_done, channels: r.channels_done, first_success: r.first_success_done,
    });
  });
}

/** ── Renderer (pure, mobile-first, localized, deep links only) ────────────── */

export function renderOnboarding(d: OnboardingData, locale: Locale): string {
  const items = d.steps.map((s) => {
    const isNext = !d.allDone && d.nextStep === s.step;
    return `<li class="ob ${s.done ? 'done' : ''} ${isNext ? 'next' : ''}">
      <span class="mark">${s.done ? '✓' : '○'}</span>
      <div class="ob-b">
        <div class="ob-t">${esc(t(locale, `onboarding.step.${s.step}.title` as MessageKey))}${isNext ? ` <span class="here">${esc(t(locale, 'onboarding.startHere'))}</span>` : ''}</div>
        <div class="muted ob-h">${esc(t(locale, `onboarding.step.${s.step}.hint` as MessageKey))}</div>
      </div>
      ${s.done ? '' : `<a class="btn send" href="${LINK[s.step]}">${esc(t(locale, `onboarding.step.${s.step}.cta` as MessageKey))}</a>`}
    </li>`;
  }).join('');

  return `<h1 class="page">${esc(t(locale, 'onboarding.title'))}</h1>
    ${d.allDone ? `<div class="card ok-card"><div class="ok">✓ ${esc(t(locale, 'onboarding.allSet', { name: EMPLOYEE_NAME[locale] }))}</div></div>` : ''}
    <div class="card"><ul class="oblist">${items}</ul></div>
    ${ONBOARDING_STYLE}`;
}

const ONBOARDING_STYLE = `<style>
  .oblist { list-style:none; padding:0; margin:0; }
  .ob { display:flex; align-items:center; gap:14px; padding:14px 0; border-bottom:1px solid #1c2026; }
  .ob:last-child { border-bottom:none; }
  .ob .mark { width:26px; height:26px; flex:0 0 26px; border-radius:999px; display:flex; align-items:center; justify-content:center;
    background:#1b2027; color:#8b929c; font-size:14px; }
  .ob.done .mark { background:#0f2e1c; color:#4ade80; }
  .ob.next .mark { background:#1b2430; color:#60a5fa; }
  .ob-b { flex:1; min-width:0; }
  .ob-t { font-size:15px; font-weight:600; } .ob.done .ob-t { color:#8b929c; font-weight:500; }
  .ob-h { font-size:13px; margin-top:3px; }
  .here { display:inline-block; margin-inline-start:8px; font-size:11px; font-weight:600; color:#60a5fa; background:#111a26; border-radius:999px; padding:2px 8px; }
  .ok-card { background:#0f2419; border-color:#1c4a33; text-align:center; } .ok { color:#4ade80; font-size:17px; font-weight:700; }
  .btn { padding:8px 16px; border:0; border-radius:9px; background:#2a313c; color:#fff; font-size:14px; font-weight:600; text-decoration:none; white-space:nowrap; }
  .btn.send { background:#2563eb; } .btn.send:hover { background:#1d4ed8; }
  a.btn:focus-visible { outline:2px solid #60a5fa; outline-offset:2px; }
  @media (max-width:560px) { .ob { flex-wrap:wrap; } .btn { margin-inline-start:40px; } }
</style>`;
