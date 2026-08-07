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
import { formatUsd, formatDate } from '../../core/owner/i18n/format.js';
import { esc, deeper } from './layout.js';
import { productName } from './inbox.js';
import { loadBusinessProfile, type BusinessProfile } from './settings.js';
import { loadProductList } from './products.js';
import { loadChannels, type ChannelView } from './channels.js';
import { loadOnboarding, STEP_LINK, type OnboardingStep } from './onboarding.js';
import { activationPreconditions, activationState, type ActivationRefusal } from '../../channels/activation.js';
import type { ChannelLifecycle } from '../../core/channel/lifecycle.js';
import { listAllowlist } from '../../channels/allowlist.js';
import {
  rehearseFactory, PROBE_CAP,
  type FactoryFixture, type FactoryProduct, type FindingReason, type RehearsalReport,
} from '../../trust/factoryRehearsal.js';

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
  readonly canActivate: boolean;
  /** Stored blockers, in the order the gate reports them. Never scored. */
  readonly blockers: readonly ActivationRefusal[];
  /** Who may receive a message once she is live. Real allowlist rows. */
  readonly recipients: readonly { readonly phone: string; readonly label: string | null }[];
  /**
   * M20.3.1 — the ONE channel-state answer. Both the connection section and
   * this one render from it, so the page cannot contradict itself.
   */
  readonly lifecycle: ChannelLifecycle;
  /** The owner has actually turned messaging on AND it can carry a message. */
  readonly live: boolean;
  /** Who turned it on and when — straight from the row activate() wrote. */
  readonly activatedAt: Date | null;
  readonly activatedBy: string | null;
};

export type FactoryView = {
  readonly profile: BusinessProfile;
  readonly products: {
    readonly total: number;
    readonly needPrice: number;
    /** A handful, for recognition only — localized at render time. */
    readonly names: readonly { readonly name: string | null; readonly nameZh: string | null }[];
  };
  readonly promises: FactoryPromises;
  readonly connection: {
    readonly channel: ChannelView;
    readonly ownerPhone: string | null;
  };
  /** null = the factory is set up. A complete factory feels complete. */
  readonly nextStep: FactoryStep | null;
  readonly readiness: FactoryReadiness;
  /**
   * M20.5 — what she cannot answer yet, derived from this factory's own rows.
   * Advisory ONLY: nothing here reaches `readiness`, and `activationPreconditions`
   * has never heard of it. null when the business id could not be resolved.
   */
  readonly rehearsal: RehearsalReport | null;
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

/**
 * M20.5 — the rows the factory rehearsal runs on. READ ONLY: one SELECT, inside
 * the same tenant transaction as everything else on this page, and nothing in
 * the rehearsal path can write (see `src/trust/factoryRehearsal.ts`).
 *
 * The cap is a page-load budget, not a priority system and not a stored rank:
 * `products × probes` turns run in-process on every render, so an owner with two
 * hundred products would pay for two hundred of them. Products a buyer has
 * actually been quoted come first — `quotes` is a real row, not a score — and
 * the rest follow the product list's own ordering.
 */
async function loadFactoryFixture(db: Db, businessIdRaw: string): Promise<FactoryFixture | null> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return null;

  type Row = {
    id: string; sku: string; name: string; moq: number; unit: string; lead_time_days: number | null;
    tiers: { minQty: number; maxQty: number | null; unitPriceUsd: number }[];
    policy: { floorPriceUsd: number; maxDiscountPct: number; humanRequiredAbovePct: number } | null;
    knowledge: { kind: string; label: string; content: string; source: string }[];
  };

  return withTenantTx(db, bid.value, async (tx) => {
    const [picked, claims, total] = await Promise.all([
      sql<Row>`
        with picked as (
          select p.id, p.sku, p.name, p.moq, p.unit, p.lead_time_days
            from products p
           where p.business_id = ${bid.value} and p.is_active
           order by (exists (select 1 from quotes q where q.product_id = p.id)) desc,
                    p.updated_at desc
           limit ${PROBE_CAP}
        )
        select k.id, k.sku, k.name, k.moq, k.unit, k.lead_time_days,
          coalesce((select json_agg(json_build_object(
                      'minQty', t.min_qty, 'maxQty', t.max_qty, 'unitPriceUsd', t.unit_price_usd)
                      order by t.min_qty)
                      from price_tiers t where t.product_id = k.id), '[]'::json) as tiers,
          -- The policy the QUOTE ENGINE would use: the per-product row wins, and
          -- the business-wide row is the fallback (repos.pricingPolicy, M9.5).
          coalesce(
            (select json_build_object('floorPriceUsd', pp.floor_price_usd,
                                      'maxDiscountPct', pp.max_discount_pct,
                                      'humanRequiredAbovePct', pp.human_required_above_pct)
               from pricing_policy pp
              where pp.business_id = ${bid.value} and pp.product_id = k.id),
            (select json_build_object('floorPriceUsd', pp.floor_price_usd,
                                      'maxDiscountPct', pp.max_discount_pct,
                                      'humanRequiredAbovePct', pp.human_required_above_pct)
               from pricing_policy pp
              where pp.business_id = ${bid.value} and pp.product_id is null)
          ) as policy,
          coalesce((select json_agg(json_build_object(
                      'kind', kn.kind, 'label', kn.label, 'content', kn.content, 'source', kn.source)
                      order by kn.created_at)
                      from product_knowledge kn
                     where kn.product_id = k.id and kn.status = 'active'), '[]'::json) as knowledge
          from picked k
      `.execute(tx).then((r) => r.rows),
      tenantRepos(tx, bid.value).catalog.claimsPolicy(),
      sql<{ n: number }>`
        select count(*)::int as n from products where business_id = ${bid.value} and is_active
      `.execute(tx).then((r) => Number(r.rows[0]?.n ?? 0)),
    ]);

    const products: FactoryProduct[] = picked.map((r) => ({
      id: r.id,
      sku: r.sku,
      name: r.name,
      moq: Number(r.moq),
      unit: r.unit,
      leadTimeDays: r.lead_time_days === null ? null : Number(r.lead_time_days),
      tiers: (r.tiers ?? []).map((t) => ({
        minQty: Number(t.minQty),
        maxQty: t.maxQty === null ? null : Number(t.maxQty),
        unitPriceUsd: Number(t.unitPriceUsd),
      })),
      policy: r.policy === null ? null : {
        floorPriceUsd: Number(r.policy.floorPriceUsd),
        maxDiscountPct: Number(r.policy.maxDiscountPct),
        humanRequiredAbovePct: Number(r.policy.humanRequiredAbovePct),
      },
      knowledge: (r.knowledge ?? []).map((k) => ({
        kind: k.kind as FactoryProduct['knowledge'][number]['kind'],
        label: k.label,
        content: k.content,
        source: k.source as FactoryProduct['knowledge'][number]['source'],
      })),
    }));

    return { products, allowedClaims: claims, productsTotal: total };
  });
}

/**
 * Run the rehearsal for a business. Exported because the OPERATOR surface
 * (/app/onboarding) needs the violations with their evidence, while the owner's
 * page needs only the findings — one derivation, read two ways.
 */
export async function loadFactoryRehearsal(db: Db, businessIdRaw: string): Promise<RehearsalReport | null> {
  const fixture = await loadFactoryFixture(db, businessIdRaw);
  return fixture === null ? null : rehearseFactory(fixture);
}

export async function loadFactory(
  db: Db, businessIdRaw: string, messagingEnabled: boolean,
): Promise<FactoryView> {
  const bid = parseBusinessId(businessIdRaw);
  const [profile, products, promises, channels, setup, pre, state, recipients, rehearsal] = await Promise.all([
    loadBusinessProfile(db, businessIdRaw),
    loadProductList(db, businessIdRaw),
    loadPromises(db, businessIdRaw),
    loadChannels(db, businessIdRaw, messagingEnabled),
    loadOnboarding(db, businessIdRaw),
    // M20.2 — the ONE activation derivation. `activationPreconditions` already
    // composes pilot readiness, the allowlist count, the channel and the schema
    // check; asking IT means this page and the activate action cannot disagree.
    bid.ok ? activationPreconditions(db, bid.value, { providerConfigured: messagingEnabled }) : null,
    bid.ok ? activationState(db, bid.value) : null,
    bid.ok ? listAllowlist(db, bid.value) : [],
    // M20.5 — advisory, and deliberately NOT an input to `pre`. If this threw
    // or hung it would take the whole page with it, which is why it reads rows
    // the page already trusts and runs pure code over them.
    loadFactoryRehearsal(db, businessIdRaw),
  ]);
  const sold = products.filter((p) => p.isActive);
  return {
    profile,
    products: {
      // What you SELL — a deactivated product is not on offer, so it is neither
      // counted nor reported as missing a price.
      total: sold.length,
      needPrice: sold.filter((p) => !p.learned).length,
      names: sold.slice(0, 4).map((p) => ({ name: p.name, nameZh: p.nameZh })),
    },
    promises,
    connection: { channel: channels.whatsapp, ownerPhone: channels.ownerPhone },
    // The ONE setup derivation — not this module's own opinion of "introduced".
    nextStep: setup.nextStep,
    readiness: {
      // No preconditions resolved (unknown business) is NOT "ready".
      canActivate: pre !== null && pre.blockers.length === 0,
      blockers: pre?.blockers ?? [],
      lifecycle: pre?.lifecycle ?? 'not_connected',
      recipients: recipients.map((r) => ({ phone: r.phone, label: r.label })),
      // Live means the owner turned it ON — not merely that the channel is
      // connected. That distinction is the whole of M20.1.
      live: pre?.lifecycle === 'active',
      activatedAt: state?.activatedAt ?? null,
      activatedBy: state?.activatedBy ?? null,
    },
    rehearsal,
  };
}

/** ── Renderer (pure, mobile-first, localized, escaped) ────────────────────── */

/**
 * Where each blocker is actually fixed. Every blocker now has a real surface —
 * `no_allowlist` gained one in M20.4, in the same section this page renders — so
 * none of them states a requirement without offering the way to meet it.
 */
const BLOCKER_FIX: Record<ActivationRefusal, string | null> = {
  schema_stale: '/app/onboarding',
  not_ready: '/app/onboarding',
  secrets_not_rotated: '/app/onboarding',
  no_channel: '/app/channels',
  no_allowlist: null,
};

/**
 * M20.5 — where each kind of gap is actually closed. A finding that cannot be
 * acted on is a complaint, so every one of these points at a real screen.
 */
const FINDING_FIX: Record<FindingReason, string> = {
  no_price: '/app/products',
  no_price_at_moq: '/app/products',
  floor_above_price: '/app/products',
  nothing_taught: '/app/knowledge',
  answer_withheld: '/app/knowledge',
  claim_not_authorised: '/app/knowledge',
};

/**
 * The rehearsal, in the owner's words. It leads with the LIST, never a tally:
 * "three findings" is a grade, "she cannot quote the canvas tote" is a task.
 * An empty list says exactly what was checked and nothing more — a factory that
 * has taught her nothing still gets findings, so silence here is earned.
 */
function rehearsalBlock(r: RehearsalReport, locale: Locale, name: string): string {
  if (r.productsChecked === 0) return '';
  const scope = r.productsTotal > r.productsChecked
    ? t(locale, 'factory.rehearsal.scopeSome', { n: r.productsChecked, total: r.productsTotal })
    : t(locale, 'factory.rehearsal.scopeAll', { n: r.productsChecked });

  // Grouped by reason, not one line per product. A new factory has the same gap
  // on every product it sells; twelve identical sentences read as an indictment,
  // while one sentence over twelve names reads as a job to do. The names are all
  // there either way — the grouping changes the tone, not the information.
  const groups = new Map<FindingReason, string[]>();
  for (const f of r.findings) {
    const names = groups.get(f.reason);
    if (names) { if (f.productName) names.push(f.productName); }
    else groups.set(f.reason, f.productName ? [f.productName] : []);
  }

  const body = groups.size === 0
    ? `<p class="fok">${esc(t(locale, 'factory.rehearsal.none', { name }))}</p>`
    : [...groups].map(([reason, names]) => `<div class="fgap">
        <a class="blink" href="${FINDING_FIX[reason]}">${esc(t(locale, `factory.rehearsal.${reason}` as MessageKey, { name }))}</a>
        ${names.length ? `<p class="fnames">${names.map((n) => `<bdi>${esc(n)}</bdi>`).join(' · ')}</p>` : ''}
      </div>`).join('');

  return `<h3 class="sub3">${esc(t(locale, 'factory.rehearsal.title', { name }))}</h3>
    <p class="fdesc">${esc(t(locale, 'factory.rehearsal.lede', { name }))}</p>
    <div class="rehear">${body}</div>
    <p class="fdesc muted">${esc(scope)}</p>`;
}

/** A fact the owner told her. Absent facts are simply not shown. */
const fact = (label: string, value: string | null): string =>
  value ? `<div class="frow"><span class="flabel">${esc(label)}</span><bdi class="fval">${esc(value)}</bdi></div>` : '';

const section = (title: string, question: string, body: string, href: string, more: string): string =>
  `<section class="fblock">
    <div class="fhead"><h2>${esc(title)}</h2><p class="fq">${esc(question)}</p></div>
    ${body}
    ${deeper(href, more)}
  </section>`;

export function renderFactory(f: FactoryView, locale: Locale, flash: string | null = null): string {
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
        ? `<p class="fnames">${f.products.names
            .map((n) => productName(locale, n)).filter((n): n is string => n !== null)
            .map((n) => `<bdi>${esc(n)}</bdi>`).join(' · ')}${f.products.total > f.products.names.length ? ' …' : ''}</p>`
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
  // M20.3.1 — one lifecycle, four honest states. "Paused" and "never connected"
  // are different problems with different next steps, so they read differently.
  const lc = f.readiness.lifecycle;
  const c = f.connection.channel;
  const conn = `<span class="fconn-i" aria-hidden="true">📱</span>
      <div>
        <div class="fconn-t">WhatsApp</div>
        <div class="fconn-s">${esc(t(locale, `channel.state.${lc}` as MessageKey, { name }))}</div>
        <div class="fconn-h muted">${esc(t(locale, `channel.state.${lc}.hint` as MessageKey, { name }))}</div>
      </div>`;
  // M20.4 (F-06) — the allowlist lives here, where the blocker sends her. It
  // reuses pilot_allowlist and the existing add/archive services: no second
  // store, no permission system. (Kept OUT of the template — an HTML comment
  // ships to the owner's browser, and this one tripped the banned-vocabulary
  // guard by containing a word owners never see.)
  const reachBody = `
    ${lc === 'active' || lc === 'ready'
      ? `<div class="fconn on">${conn}</div>`
      : `<a class="fconn off" href="/app/channels">${conn}<span class="go" aria-hidden="true">›</span></a>`}
    ${lc !== 'not_connected' && c.displayId ? `<div class="facts">${fact(t(locale, 'channel.field.number'), c.displayId)}</div>` : ''}
    <h3 class="sub3">${esc(t(locale, 'allowlist.title', { name }))}</h3>
    <p class="fdesc">${esc(t(locale, 'allowlist.note', { name }))}</p>
    ${f.readiness.recipients.length === 0
      ? `<p class="fempty">${esc(t(locale, 'allowlist.none', { name }))}</p>`
      : `<ul class="fsteps">${f.readiness.recipients.map((r) => `
          <li class="done">✓ <bdi>${esc(r.label ?? r.phone)}</bdi>${r.label ? ` <span class="muted">${esc(r.phone)}</span>` : ''}
            <form method="post" action="/app/factory/allowlist/remove" class="inline rm">
              <input type="hidden" name="phone" value="${esc(r.phone)}" />
              <button class="btn ghost" type="submit"
                      onclick="return confirm(this.dataset.confirm)"
                      data-confirm="${esc(t(locale, 'allowlist.remove.confirm', { who: r.label ?? r.phone, name }))}"
              >${esc(t(locale, 'allowlist.remove'))}</button>
            </form></li>`).join('')}</ul>`}
    <form method="post" action="/app/factory/allowlist/add" class="alform">
      <label class="fld"><span class="muted">${esc(t(locale, 'allowlist.phone'))}</span>
        <input name="phone" inputmode="tel" placeholder="${esc(t(locale, 'settings.alerts.placeholder'))}" required /></label>
      <label class="fld"><span class="muted">${esc(t(locale, 'allowlist.label'))}</span>
        <input name="label" placeholder="${esc(t(locale, 'allowlist.label.ph'))}" /></label>
      <button class="btn send" type="submit">${esc(t(locale, 'allowlist.add'))}</button>
    </form>
    <p class="fdesc">${esc(t(locale, lc === 'active' ? 'factory.reach.nextConnected' : 'factory.reach.nextNot', { name }))}</p>
    ${f.connection.ownerPhone
      ? `<p class="fok">${esc(t(locale, 'factory.reach.alerts', { phone: f.connection.ownerPhone }))}</p>`
      : `<p class="fdesc">${esc(t(locale, 'factory.reach.noAlerts', { name }))}</p>`}`;

  // 5 · Can she be activated now? — answered by the SAME preconditions the
  //     activate action obeys. Either the list of blockers is empty, or it says
  //     exactly what is in the way and where to fix it. No score, no grade.
  const r = f.readiness;
  const recipientList = r.recipients.length
    ? `<ul class="fsteps">${r.recipients.slice(0, 8).map((x) =>
        `<li class="done">✓ <bdi>${esc(x.label ?? x.phone)}</bdi>${x.label ? ` <span class="muted">${esc(x.phone)}</span>` : ''}</li>`).join('')}
       </ul>${r.recipients.length > 8 ? `<p class="fdesc">${esc(t(locale, 'activation.recipients.more', { n: r.recipients.length - 8 }))}</p>` : ''}`
    : '';

  const blockerList = `<ul class="fsteps">${r.blockers.map((b) => {
    const href = BLOCKER_FIX[b];
    const line = esc(t(locale, `activation.blocker.${b}` as MessageKey, { name }));
    return `<li>○ ${href ? `<a class="blink" href="${href}">${line}</a>` : line}</li>`;
  }).join('')}</ul>`;

  // M20.3 — the decision itself. Confirmed, because it is the moment a real
  // buyer can first be reached; and reversible, because the stop control is
  // never further away than the start one was.
  const confirmBtn = (action: string, cls: string, label: string, question: string) =>
    `<form method="post" action="/app/factory/${action}" class="inline">
      <button class="btn ${cls}" type="submit"
              onclick="return confirm(this.dataset.confirm)"
              data-confirm="${esc(question)}">${esc(label)}</button>
    </form>`;

  const readyBody = r.live
    ? `<p class="fdesc">${esc(t(locale, 'factory.ready.live', { name }))}</p>
       ${r.activatedAt ? `<p class="fdesc">${esc(t(locale, 'activation.live.since', {
          when: formatDate(locale, r.activatedAt), who: r.activatedBy ?? '' }))}</p>` : ''}
       ${recipientList ? `<p class="fdesc fdesc-lead">${esc(t(locale, 'activation.recipients.title', { name }))}</p>${recipientList}` : ''}
       <p class="fnever">${esc(t(locale, 'activation.stop.what'))}</p>
       <div class="facts">${confirmBtn('deactivate', 'danger',
          t(locale, 'activation.action.deactivate'),
          t(locale, 'activation.action.deactivateConfirm', { name }))}</div>`
    : r.canActivate
      ? `<p class="fok">${esc(t(locale, 'activation.can', { name }))}</p>
         <p class="fdesc fdesc-lead">${esc(t(locale, 'activation.recipients.title', { name }))}</p>
         ${recipientList}
         <p class="fnever">${esc(t(locale, 'activation.stillDrafts', { name }))}</p>
         <div class="facts">${confirmBtn('activate', 'send',
            t(locale, 'activation.action.activate', { name }),
            t(locale, 'activation.action.confirm', { name }))}</div>
         <p class="fdesc">${esc(t(locale, 'factory.ready.note', { name }))}</p>
         ${deeper('/app/sandbox', t(locale, 'factory.ready.practice'))}`
      : `<p class="fdesc">${esc(t(locale, 'activation.cannot', { name }))}</p>
         ${blockerList}
         <p class="fdesc">${esc(t(locale, 'factory.ready.note', { name }))}</p>
         ${deeper('/app/sandbox', t(locale, 'factory.ready.practice'))}`;

  // M20.5 — appended AFTER the activation decision, never folded into it. These
  // are things she cannot answer yet; none of them is a reason to keep her off.
  const rehearsed = f.rehearsal ? rehearsalBlock(f.rehearsal, locale, name) : '';

  return `<h1 class="page">${esc(t(locale, 'nav.factory'))}</h1>
    ${flash ? `<div class="flash" role="status">${esc(flash)}</div>` : ''}
    <p class="lede">${esc(t(locale, 'factory.lede', { name }))}</p>
    ${next}
    ${section(t(locale, 'factory.about.title'), t(locale, 'factory.about.q'), aboutBody, '/app/settings', t(locale, 'factory.about.more'))}
    ${section(t(locale, 'factory.sell.title'), t(locale, 'factory.sell.q'), sellBody, '/app/products', t(locale, 'factory.sell.more'))}
    ${section(t(locale, 'factory.promise.title'), t(locale, 'factory.promise.q', { name }), promiseBody, '/app/knowledge', t(locale, 'factory.promise.more'))}
    ${section(t(locale, 'factory.reach.title'), t(locale, 'factory.reach.q'), reachBody, '/app/channels', t(locale, 'factory.reach.more'))}
    ${section(t(locale, 'factory.ready.title'), t(locale, 'factory.ready.q', { name }), readyBody + rehearsed, '/app/onboarding', t(locale, 'factory.ready.more'))}
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
  .sub3 { font-size:15px; font-weight:600; color:#e7eaee; margin:22px 0 4px; }
  /* Findings are a to-do list, not an alarm: same weight as any other step. */
  .rehear { margin-top:12px; display:flex; flex-direction:column; gap:14px; }
  .fgap .fnames { margin-top:3px; }
  .alform { display:flex; flex-direction:column; gap:10px; margin-top:14px; max-width:34ch; }
  .alform .fld { display:flex; flex-direction:column; gap:6px; font-size:14px; }
  .alform input { background:#0f1216; border:1px solid #2b313a; border-radius:10px;
    color:#fff; padding:10px 14px; font:inherit; }
  .rm { margin-inline-start:8px; }
  .blink { color:#60a5fa; }
  .fconn { display:flex; align-items:center; gap:13px; }
  .fconn-t { font-size:15px; color:#e7eaee; }
  .fconn-s { font-size:13px; color:#8b929c; }
  .fconn-h { font-size:13px; margin-top:2px; }
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
