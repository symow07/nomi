/**
 * My factory (Nomi Phase E) — the owner's place for the things that are ABOUT
 * their business: who they are, what they sell, what they promise, and where
 * buyers reach them. Daily work lives in Today / Buyers / 小雅; nothing here
 * is an operation.
 *
 * This module OWNS NO DATA. It composes the existing read models —
 * `loadBusinessProfile` (M11.1), `loadProductList` (M9.5), the catalog port's
 * `claimsPolicy`/`pricingPolicy` (the guard's own allowlist), and
 * `loadChannels` (M9.4) — into one calm page. No new table, no new SQL for
 * anything an existing loader already answers, no second settings system.
 *
 * The deep surfaces (/app/settings, /app/products, /app/knowledge,
 * /app/channels) stay exactly as they are and are linked, not replaced.
 */
import { sql } from 'kysely';
import type { Db } from '../../db/client.js';
import { withTenantTx } from '../../db/client.js';
import { tenantRepos } from '../../db/repos.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { LOCALE_LABEL, type Locale } from '../../core/owner/i18n/locale.js';
import { t, EMPLOYEE_NAME, claimName, type MessageKey } from '../../core/owner/i18n/messages.js';
import { formatUsd } from '../../core/owner/i18n/format.js';
import { esc, deeper } from './layout.js';
import { loadBusinessProfile, type BusinessProfile } from './settings.js';
import { loadProductList } from './products.js';
import { loadChannels, type ChannelView } from './channels.js';
import { loadOnboarding, STEP_LINK, type OnboardingStep } from './onboarding.js';
import { loadPilotReadiness } from './pilot.js';

/**
 * What the factory still needs. Phase F: there is now exactly ONE derivation of
 * that in the product — `loadOnboarding`'s four live EXISTS checks. This page
 * composes it; it does not re-decide it. `settings.ts` used to keep a third
 * answer (a per-field checklist) and `onboarding.ts` had a fourth (an unrouted
 * renderer); both are gone.
 */
export type FactoryStep = OnboardingStep;

export type FactoryPromises = {
  /** Certification/compliance claims the owner authorised (claims_policy). */
  readonly certs: readonly string[];
  /**
   * The price rules that ACTUALLY APPLY. `repos.pricingPolicy(productId)` lets a
   * per-product row win over the business-wide one, and `turn.ts` always asks
   * per product — so reading only the business-wide row (as this page first did)
   * reported numbers no quote has ever used.
   *
   * Only what the guard enforces is stated: `quote.ts` clamps the price at the
   * floor and the discount at the ceiling. `humanRequiredAbovePct` is NOT a gate
   * — it lands in the quote audit and never decides draft-vs-send — so it is not
   * presented to the owner as a rule.
   */
  readonly floorLowUsd: number | null;
  readonly floorHighUsd: number | null;
  readonly ceilingPct: number | null;
  /** true when different products carry different ceilings. */
  readonly ceilingVaries: boolean;
};

/** Getting ready to go live — a summary of the EXISTING pilot readiness model. */
export type FactoryReadiness = {
  readonly prepared: number;      // real counts, never a grade
  readonly preparedTotal: number;
  readonly confirmed: number;
  readonly confirmedTotal: number;
  readonly rehearsed: boolean;
  readonly live: boolean;
};

export type FactoryView = {
  readonly profile: BusinessProfile;
  readonly products: {
    readonly total: number;
    readonly needPrice: number;
    readonly names: readonly string[];   // a handful, for recognition only
  };
  readonly promises: FactoryPromises;
  readonly connection: {
    readonly channel: ChannelView;
    readonly ownerPhone: string | null;
  };
  /** null = the factory is set up. A complete factory feels complete. */
  readonly nextStep: FactoryStep | null;
  readonly readiness: FactoryReadiness;
};

/**
 * The owner's promises: the claims guard's OWN allowlist, read through the
 * catalog port the guard uses. Nothing is re-derived and nothing is inferred —
 * a claim the owner never authorised is simply absent (default-deny).
 */
async function loadPromises(db: Db, businessIdRaw: string): Promise<FactoryPromises> {
  const bid = parseBusinessId(businessIdRaw);
  const none: FactoryPromises = {
    certs: [], floorLowUsd: null, floorHighUsd: null, ceilingPct: null, ceilingVaries: false,
  };
  if (!bid.ok) return none;

  return withTenantTx(db, bid.value, async (tx) => {
    const repos = tenantRepos(tx, bid.value);
    const [claims, rows] = await Promise.all([
      repos.catalog.claimsPolicy(),
      // Every rule the guard could reach, not just the fallback. A per-product
      // row wins, so when any exists the business-wide row is never consulted.
      sql<{ floor: string; ceiling: string; product_id: string | null }>`
        select floor_price_usd as floor, max_discount_pct as ceiling, product_id
          from pricing_policy where business_id = ${bid.value}
      `.execute(tx).then((r) => r.rows),
    ]);
    const perProduct = rows.filter((r) => r.product_id !== null);
    const applies = perProduct.length > 0 ? perProduct : rows;
    const floors = applies.map((r) => Number(r.floor));
    const ceilings = [...new Set(applies.map((r) => Number(r.ceiling)))];
    return {
      certs: claims
        .filter((c) => c.allowed && (c.kind === 'certification' || c.kind === 'compliance'))
        .map((c) => c.claimKey),
      floorLowUsd: floors.length ? Math.min(...floors) : null,
      floorHighUsd: floors.length ? Math.max(...floors) : null,
      ceilingPct: ceilings.length ? Math.min(...ceilings) : null,
      ceilingVaries: ceilings.length > 1,
    };
  });
}

export async function loadFactory(
  db: Db, businessIdRaw: string, messagingEnabled: boolean,
): Promise<FactoryView> {
  const [profile, products, promises, channels, setup, pilot] = await Promise.all([
    loadBusinessProfile(db, businessIdRaw),
    loadProductList(db, businessIdRaw),
    loadPromises(db, businessIdRaw),
    loadChannels(db, businessIdRaw, messagingEnabled),
    loadOnboarding(db, businessIdRaw),
    loadPilotReadiness(db, businessIdRaw),
  ]);
  const sold = products.filter((p) => p.isActive);
  const detected = Object.values(pilot.detected);
  return {
    profile,
    products: {
      // What you SELL — a deactivated product is not on offer, so it is neither
      // counted nor reported as missing a price.
      total: sold.length,
      needPrice: sold.filter((p) => !p.learned).length,
      names: sold.slice(0, 4).map((p) => p.name),
    },
    promises,
    connection: { channel: channels.whatsapp, ownerPhone: channels.ownerPhone },
    // The ONE setup derivation — not this module's own opinion of "introduced".
    nextStep: setup.nextStep,
    readiness: {
      prepared: detected.filter(Boolean).length,
      preparedTotal: detected.length,
      confirmed: [pilot.attest.backupTestedAt, pilot.attest.secretsRotatedAt, pilot.attest.ownerReadyAt]
        .filter((x) => x !== null).length,
      confirmedTotal: 3,
      rehearsed: pilot.detected.sandbox,
      live: channels.whatsapp.connected && messagingEnabled,
    },
  };
}

/** ── Renderer (pure, mobile-first, localized, escaped) ────────────────────── */

/** A fact the owner told her. Absent facts are simply not shown. */
const fact = (label: string, value: string | null): string =>
  value ? `<div class="frow"><span class="flabel">${esc(label)}</span><bdi class="fval">${esc(value)}</bdi></div>` : '';

const section = (title: string, question: string, body: string, href: string, more: string): string =>
  `<section class="fblock">
    <div class="fhead"><h2>${esc(title)}</h2><p class="fq">${esc(question)}</p></div>
    ${body}
    ${deeper(href, more)}
  </section>`;

export function renderFactory(f: FactoryView, locale: Locale): string {
  const name = EMPLOYEE_NAME[locale];
  const p = f.profile;

  // A new factory gets ONE next step. A finished one gets nothing at all —
  // setup disappears rather than turning into a permanent checklist.
  const next = f.nextStep
    ? `<a class="fnext" href="${STEP_LINK[f.nextStep]}">
        <span class="fnext-t">${esc(t(locale, `factory.next.${f.nextStep}` as MessageKey, { name }))}</span>
        <span class="go" aria-hidden="true">›</span>
      </a>`
    : '';

  // 1 · About your factory — what she can tell a buyer about you.
  const langs = p.languagesServed.length
    ? p.languagesServed
        .filter((l): l is Locale => l === 'en' || l === 'zh' || l === 'ar')
        .map((l) => LOCALE_LABEL[l]).join(' · ')
    : null;
  const aboutBody = p.name.trim() === ''
    ? `<p class="fempty">${esc(t(locale, 'factory.about.empty', { name }))}</p>`
    : `<div class="fname">${esc(p.name)}</div>
       ${p.description ? `<p class="fdesc">${esc(p.description)}</p>` : ''}
       <div class="facts">
         ${fact(t(locale, 'settings.field.location'), p.location)}
         ${fact(t(locale, 'settings.field.workingHours'), p.workingHours)}
         ${fact(t(locale, 'settings.field.contactEmail'), p.contactEmail)}
         ${fact(t(locale, 'settings.field.contactPhone'), p.contactPhone)}
         ${fact(t(locale, 'factory.about.languages'), langs)}
       </div>`;

  // 2 · What you sell — a count the owner can verify, not a catalogue dump.
  const sellBody = f.products.total === 0
    ? `<p class="fempty">${esc(t(locale, 'factory.sell.empty', { name }))}</p>`
    : `<div class="fcount">${f.products.total}<span class="fcount-l">${esc(t(locale, 'factory.sell.items'))}</span></div>
       ${f.products.names.length
        ? `<p class="fnames">${f.products.names.map((n) => `<bdi>${esc(n)}</bdi>`).join(' · ')}${f.products.total > f.products.names.length ? ' …' : ''}</p>`
        : ''}
       ${f.products.needPrice > 0
        ? `<p class="fwarn">${esc(t(locale, 'factory.sell.needPrice', { n: f.products.needPrice, name }))}</p>`
        : `<p class="fok">${esc(t(locale, 'factory.sell.allPriced', { name }))}</p>`}`;

  // 3 · What you promise buyers — the guard's allowlist in the owner's words.
  //     Everything not listed is refused; that rule is stated, never implied.
  // Only the two things the guard actually enforces, and only in the shape the
  // owner's own data takes: one floor, or a range across her products.
  const lo = f.promises.floorLowUsd;
  const hi = f.promises.floorHighUsd;
  const ceil = f.promises.ceilingPct;
  const priceRules = [
    lo !== null && hi !== null
      ? (lo === hi
        ? t(locale, 'factory.promise.floor', { price: formatUsd(lo), name })
        : t(locale, 'factory.promise.floorRange', { low: formatUsd(lo), high: formatUsd(hi), name }))
      : null,
    ceil !== null
      ? t(locale, f.promises.ceilingVaries ? 'factory.promise.ceilingVaries' : 'factory.promise.ceiling',
        { ceil, name })
      : null,
  ].filter((x): x is string => x !== null);

  const promiseBody = `
    ${f.promises.certs.length
      ? `<p class="fdesc fdesc-lead">${esc(t(locale, 'factory.promise.certsOn', { name }))}</p>
         <div class="fchips">${f.promises.certs.map((c) =>
           `<span class="fchip">${esc(claimName(locale, c))}</span>`).join('')}</div>`
      : `<p class="fempty">${esc(t(locale, 'factory.promise.none', { name }))}</p>`}
    ${priceRules.length ? `<ul class="frules">${priceRules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
    <p class="fnever">${esc(t(locale, 'factory.promise.never', { name }))}</p>`;

  // 4 · Where buyers reach you — connected or not, and what happens next.
  const c = f.connection.channel;
  const conn = `<span class="fconn-i" aria-hidden="true">📱</span>
      <div>
        <div class="fconn-t">WhatsApp</div>
        <div class="fconn-s">${esc(t(locale, c.connected ? 'factory.reach.connected' : 'factory.reach.notConnected'))}</div>
      </div>`;
  const reachBody = `
    ${c.connected
      ? `<div class="fconn on">${conn}</div>`
      : `<a class="fconn off" href="/app/channels">${conn}<span class="go" aria-hidden="true">›</span></a>`}
    ${c.connected && c.displayId ? `<div class="facts">${fact(t(locale, 'channel.field.number'), c.displayId)}</div>` : ''}
    <p class="fdesc">${esc(t(locale, c.connected ? 'factory.reach.nextConnected' : 'factory.reach.nextNot', { name }))}</p>
    ${f.connection.ownerPhone
      ? `<p class="fok">${esc(t(locale, 'factory.reach.alerts', { phone: f.connection.ownerPhone }))}</p>`
      : `<p class="fdesc">${esc(t(locale, 'factory.reach.noAlerts', { name }))}</p>`}`;

  // 5 · Getting ready to go live — a SUMMARY of the pilot readiness model that
  //     already exists. Real counts only; the full runbook is one tap away.
  const r = f.readiness;
  const readyBody = r.live
    ? `<p class="fdesc">${esc(t(locale, 'factory.ready.live', { name }))}</p>`
    : `<ul class="fsteps">
        <li class="${r.prepared === r.preparedTotal ? 'done' : ''}">${r.prepared === r.preparedTotal ? '✓' : '○'}
          ${esc(t(locale, 'factory.ready.prepared', { n: r.prepared, total: r.preparedTotal }))}</li>
        <li class="${r.rehearsed ? 'done' : ''}">${r.rehearsed ? '✓' : '○'}
          ${esc(t(locale, r.rehearsed ? 'factory.ready.rehearsed' : 'factory.ready.rehearse', { name }))}</li>
        <li class="${r.confirmed === r.confirmedTotal ? 'done' : ''}">${r.confirmed === r.confirmedTotal ? '✓' : '○'}
          ${esc(t(locale, 'factory.ready.confirmed', { n: r.confirmed, total: r.confirmedTotal }))}</li>
      </ul>
      <p class="fdesc">${esc(t(locale, 'factory.ready.note', { name }))}</p>
      ${deeper('/app/sandbox', t(locale, 'factory.ready.practice'))}`;
  return `<h1 class="page">${esc(t(locale, 'nav.factory'))}</h1>
    <p class="lede">${esc(t(locale, 'factory.lede', { name }))}</p>
    ${next}
    ${section(t(locale, 'factory.about.title'), t(locale, 'factory.about.q'), aboutBody, '/app/settings', t(locale, 'factory.about.more'))}
    ${section(t(locale, 'factory.sell.title'), t(locale, 'factory.sell.q'), sellBody, '/app/products', t(locale, 'factory.sell.more'))}
    ${section(t(locale, 'factory.promise.title'), t(locale, 'factory.promise.q', { name }), promiseBody, '/app/knowledge', t(locale, 'factory.promise.more'))}
    ${section(t(locale, 'factory.reach.title'), t(locale, 'factory.reach.q'), reachBody, '/app/channels', t(locale, 'factory.reach.more'))}
    ${section(t(locale, 'factory.ready.title'), t(locale, 'factory.ready.q', { name }), readyBody, '/app/onboarding', t(locale, 'factory.ready.more'))}
    ${FACTORY_STYLE}`;
}

const FACTORY_STYLE = `<style>
  .lede { color:#8b929c; margin:-6px 0 22px; font-size:15px; max-width:60ch; }

  /* The next step is a door, not a checklist row. It vanishes when done. */
  .fnext { display:flex; align-items:center; justify-content:space-between; gap:12px;
           background:#152119; border:1px solid #2c4636; border-radius:14px;
           padding:16px 18px; margin-bottom:26px; }
  .fnext:hover, .fnext:focus-visible { border-color:#3d7a63; }
  .fnext-t { color:#d8e3db; font-size:15px; }

  /* Sections are grouped decisions, not settings panels. */
  .fblock { border-top:1px solid #1e2229; padding:24px 0 26px; }
  .fblock:first-of-type { border-top:0; padding-top:0; }
  .fhead { margin-bottom:14px; }
  .fhead h2 { margin:0; font-size:17px; font-weight:600; color:#e7eaee; }
  .fq { margin:4px 0 0; font-size:13px; color:#8b929c; }

  .fname { font-size:19px; font-weight:600; color:#fff; }
  .fdesc { color:#a8afb8; font-size:14px; line-height:1.6; margin:8px 0 0; max-width:62ch; }
  .fdesc-lead { margin:0 0 12px; }
  .fempty { color:#a8afb8; font-size:14px; line-height:1.6; margin:0; max-width:62ch; }
  .facts { margin-top:14px; display:flex; flex-direction:column; gap:9px; }
  .frow { display:flex; gap:14px; font-size:14px; }
  .flabel { color:#8b929c; min-width:8.5em; }
  .fval { color:#d6dae0; }

  /* A product tally is never the loudest thing an owner reads. */
  .fcount { font-size:22px; font-weight:600; color:#fff; display:flex; align-items:baseline; gap:9px;
            font-variant-numeric:tabular-nums; }
  .fcount-l { font-size:14px; font-weight:400; color:#8b929c; }
  .fnames { color:#a8afb8; font-size:14px; line-height:1.6; margin:6px 0 0; }
  .fwarn { color:#e0b551; font-size:14px; margin:12px 0 0; }
  .fok { color:#7fb894; font-size:14px; margin:12px 0 0; }

  .fchips { display:flex; flex-wrap:wrap; gap:8px; }
  .fchip { font-size:13px; padding:6px 13px; border-radius:999px;
           background:#14231b; color:#8fc9a6; border:1px solid #274434; }
  .frules { margin:14px 0 0; padding-inline-start:18px; color:#d6dae0; font-size:14px; line-height:1.6; }
  /* The promise the whole product rests on — read it before the fine print. */
  .fnever { margin:16px 0 0; font-size:15px; line-height:1.6; color:#d8e3db; max-width:62ch;
            border-inline-start:2px solid #274434; padding-inline-start:14px; }
  .fsteps { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:10px; }
  .fsteps li { font-size:14px; color:#a8afb8; }
  .fsteps li.done { color:#d6dae0; }
  .fconn { display:flex; align-items:center; gap:13px; }
  .fconn-t { font-size:15px; color:#e7eaee; }
  .fconn-s { font-size:13px; color:#8b929c; }
  .fconn-i { font-size:22px; }
  .fconn.on .fconn-s { color:#7fb894; }
  /* Not connected stops everything, so it looks like it and links to the fix. */
  .fconn.off { background:#181510; border:1px solid #8a7330; border-radius:14px; padding:14px 16px; }
  .fconn.off:hover, .fconn.off:focus-visible { border-color:#b39445; }
  .fconn.off .fconn-s { color:#e0b551; }
  .fconn.off .go { margin-inline-start:auto; }
  .fblock .deeper { margin-top:8px; }
  @media (max-width:560px) {
    .frow { flex-direction:column; align-items:flex-start; gap:2px; }
    .flabel { min-width:0; font-size:13px; }
  }
</style>`;
