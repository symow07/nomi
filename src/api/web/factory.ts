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
import type { Db } from '../../db/client.js';
import { withTenantTx } from '../../db/client.js';
import { tenantRepos } from '../../db/repos.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { LOCALE_LABEL, type Locale } from '../../core/owner/i18n/locale.js';
import { t, EMPLOYEE_NAME, claimName, type MessageKey } from '../../core/owner/i18n/messages.js';
import { formatUsd } from '../../core/owner/i18n/format.js';
import { esc } from './layout.js';
import { loadBusinessProfile, type BusinessProfile } from './settings.js';
import { loadProductList } from './products.js';
import { loadChannels, type ChannelView } from './channels.js';

/** What the factory still needs, derived live — never stored, never a wizard. */
export type FactoryStep = 'introduce' | 'products' | 'connect';

export type FactoryPromises = {
  /** Certification/compliance claims the owner authorised (claims_policy). */
  readonly certs: readonly string[];
  /** The owner's own price rules, business-wide. Absent when none is set. */
  readonly floorPriceUsd: number | null;
  /**
   * Named for what the guard DOES, so the page cannot mix them up again:
   * `quote.ts` settles alone up to `humanRequiredAbovePct` (ownAuthorityPct),
   * escalates above it, and clamps at `maxDiscountPct` (ceilingPct). The
   * ceiling is the HIGHER of the two.
   */
  readonly ownAuthorityPct: number | null;
  readonly ceilingPct: number | null;
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
};

/**
 * The owner's promises: the claims guard's OWN allowlist, read through the
 * catalog port the guard uses. Nothing is re-derived and nothing is inferred —
 * a claim the owner never authorised is simply absent (default-deny).
 */
async function loadPromises(db: Db, businessIdRaw: string): Promise<FactoryPromises> {
  const bid = parseBusinessId(businessIdRaw);
  const none: FactoryPromises = { certs: [], floorPriceUsd: null, ownAuthorityPct: null, ceilingPct: null };
  if (!bid.ok) return none;

  return withTenantTx(db, bid.value, async (tx) => {
    const repos = tenantRepos(tx, bid.value);
    const [claims, policy] = await Promise.all([
      repos.catalog.claimsPolicy(),
      repos.catalog.pricingPolicy(null),      // business-wide rule, if the owner has one
    ]);
    return {
      certs: claims
        .filter((c) => c.allowed && (c.kind === 'certification' || c.kind === 'compliance'))
        .map((c) => c.claimKey),
      floorPriceUsd: policy?.floorPriceUsd ?? null,
      ownAuthorityPct: policy?.humanRequiredAbovePct ?? null,
      ceilingPct: policy?.maxDiscountPct ?? null,
    };
  });
}

export async function loadFactory(
  db: Db, businessIdRaw: string, messagingEnabled: boolean,
): Promise<FactoryView> {
  const [profile, products, promises, channels] = await Promise.all([
    loadBusinessProfile(db, businessIdRaw),
    loadProductList(db, businessIdRaw),
    loadPromises(db, businessIdRaw),
    loadChannels(db, businessIdRaw, messagingEnabled),
  ]);

  // One next step, in the order an owner would actually do it. Introducing the
  // factory comes first because everything she says leans on it.
  const sold = products.filter((p) => p.isActive);
  const introduced = profile.name.trim() !== '' && (profile.description !== null || profile.location !== null);
  const nextStep: FactoryStep | null =
    !introduced ? 'introduce'
      : sold.length === 0 ? 'products'
        : !channels.whatsapp.connected ? 'connect'
          : null;

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
    nextStep,
  };
}

/** ── Renderer (pure, mobile-first, localized, escaped) ────────────────────── */

const NEXT_HREF: Record<FactoryStep, string> = {
  introduce: '/app/settings',
  products: '/app/products',
  connect: '/app/channels',
};

/** A fact the owner told her. Absent facts are simply not shown. */
const fact = (label: string, value: string | null): string =>
  value ? `<div class="frow"><span class="flabel">${esc(label)}</span><bdi class="fval">${esc(value)}</bdi></div>` : '';

const section = (title: string, question: string, body: string, href: string, more: string): string =>
  `<section class="fblock">
    <div class="fhead"><h2>${esc(title)}</h2><p class="fq">${esc(question)}</p></div>
    ${body}
    <a class="fmore" href="${href}">${esc(more)}<span class="fgo" aria-hidden="true">›</span></a>
  </section>`;

export function renderFactory(f: FactoryView, locale: Locale): string {
  const name = EMPLOYEE_NAME[locale];
  const p = f.profile;

  // A new factory gets ONE next step. A finished one gets nothing at all —
  // setup disappears rather than turning into a permanent checklist.
  const next = f.nextStep
    ? `<a class="fnext" href="${NEXT_HREF[f.nextStep]}">
        <span class="fnext-t">${esc(t(locale, `factory.next.${f.nextStep}` as MessageKey, { name }))}</span>
        <span class="fgo" aria-hidden="true">›</span>
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
  const own = f.promises.ownAuthorityPct;
  const ceil = f.promises.ceilingPct;
  const priceRules = [
    f.promises.floorPriceUsd !== null
      ? t(locale, 'factory.promise.floor', { price: formatUsd(f.promises.floorPriceUsd), name })
      : null,
    own !== null ? t(locale, 'factory.promise.alone', { own, name }) : null,
    // The band between her own authority and the ceiling: she still writes the
    // reply, but it waits for the owner. Only real when there IS a band.
    own !== null && ceil !== null && ceil > own
      ? t(locale, 'factory.promise.waits', { own, ceil, name }) : null,
    ceil !== null ? t(locale, 'factory.promise.ceiling', { ceil, name }) : null,
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
      : `<a class="fconn off" href="/app/channels">${conn}<span class="fgo" aria-hidden="true">›</span></a>`}
    ${c.connected && c.displayId ? `<div class="facts">${fact(t(locale, 'channel.field.number'), c.displayId)}</div>` : ''}
    <p class="fdesc">${esc(t(locale, c.connected ? 'factory.reach.nextConnected' : 'factory.reach.nextNot', { name }))}</p>
    ${f.connection.ownerPhone
      ? `<p class="fok">${esc(t(locale, 'factory.reach.alerts', { phone: f.connection.ownerPhone }))}</p>`
      : `<p class="fdesc">${esc(t(locale, 'factory.reach.noAlerts', { name }))}</p>`}`;

  return `<h1 class="page">${esc(t(locale, 'nav.factory'))}</h1>
    <p class="lede">${esc(t(locale, 'factory.lede', { name }))}</p>
    ${next}
    ${section(t(locale, 'factory.about.title'), t(locale, 'factory.about.q'), aboutBody, '/app/settings', t(locale, 'factory.about.more'))}
    ${section(t(locale, 'factory.sell.title'), t(locale, 'factory.sell.q'), sellBody, '/app/products', t(locale, 'factory.sell.more'))}
    ${section(t(locale, 'factory.promise.title'), t(locale, 'factory.promise.q', { name }), promiseBody, '/app/knowledge', t(locale, 'factory.promise.more'))}
    ${section(t(locale, 'factory.reach.title'), t(locale, 'factory.reach.q'), reachBody, '/app/channels', t(locale, 'factory.reach.more'))}
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

  .fconn { display:flex; align-items:center; gap:13px; }
  .fconn-t { font-size:15px; color:#e7eaee; }
  .fconn-s { font-size:13px; color:#8b929c; }
  .fconn-i { font-size:22px; }
  .fconn.on .fconn-s { color:#7fb894; }
  /* Not connected stops everything, so it looks like it and links to the fix. */
  .fconn.off { background:#181510; border:1px solid #8a7330; border-radius:14px; padding:14px 16px; }
  .fconn.off:hover, .fconn.off:focus-visible { border-color:#b39445; }
  .fconn.off .fconn-s { color:#e0b551; }
  .fconn.off .fgo { margin-inline-start:auto; }

  .fmore { display:inline-flex; align-items:center; gap:6px; margin-top:16px;
           padding:10px 0; font-size:14px; color:#8fb6a4; }
  .fmore:hover, .fmore:focus-visible { color:#b9d8c8; }
  .fgo { font-size:18px; color:#6f8f7e; }
  [dir="rtl"] .fgo { transform:scaleX(-1); display:inline-block; }

  a:focus-visible { outline:2px solid #60a5fa; outline-offset:2px; }

  @media (max-width:560px) {
    .frow { flex-direction:column; align-items:flex-start; gap:2px; }
    .flabel { min-width:0; font-size:13px; }
  }
</style>`;
