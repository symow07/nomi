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
 *
 * THE WARMTH RUN (2026-10-03), phase 7 — the page is a menu now, and each of
 * its sections a screen a level down (see "the menu" below).
 */
import { currencyOfCountry } from '../../core/owner/currencies.js';
import { sql } from 'kysely';
import { type Money, moneyFromRow } from '../../core/types/money.js';
import type { Db } from '../../db/client.js';
import { withTenantTx } from '../../db/client.js';
import { tenantRepos } from '../../db/repos.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { claimName, type MessageKey } from '../../core/owner/i18n/messages.js';
import { t, tn, assistantName } from './say.js';

import { esc, deeper, back, signalMark, todoMark } from './layout.js';
import { shape } from './marks.js';
import { flashBanner, type Flash } from './flash.js';
import { productName } from './inbox.js';
import {
  loadBusinessProfile, loadTerms, loadSamples, loadClosures, loadRates, menuRow, menuGroup, type BusinessProfile,
} from './settings.js';
import { loadBusinessKind } from './businessKind.js';
import { HS_BASE, loadHub } from './howYouSell.js';
import type { OwnerRate } from '../../core/commerce/exchange.js';
import { loadProductList } from './products.js';
import {
  loadChannels, phonePlaceholder, channelScreenHref, channelScreenTitle, channelsFoot, CHANNELS_HOME,
  type ChannelView, type InboundLink,
} from './channels.js';
import { anyConnected, connectedChannels, type ConnectedChannels } from '../../db/connectedChannels.js';
import { liveMailAccount } from '../../db/mailAccounts.js';
import { CHANNEL_REGISTRY, type OutreachChannel } from '../../core/channel/registry.js';
import { loadOnboarding, STEP_LINK, type OnboardingStep } from './onboarding.js';
import { activationPreconditions, activationState, type ActivationRefusal } from '../../channels/activation.js';
import { loadAssistantStop, type AssistantStop } from '../../db/assistantStop.js';
import { allowanceOf, allowanceRenewsAt, allowanceUsed } from '../../db/allowance.js';
import { loadKillSwitches } from '../../db/opsFlags.js';
import type { ChannelLifecycle } from '../../core/channel/lifecycle.js';
import { listAllowlist } from '../../channels/allowlist.js';
import { loadPriceRules, type PriceRulesView } from './priceRules.js';
import { certRows } from './knowledge.js';
import { OWNER_VIEW, actorName, type Person, type Viewer } from '../../core/conversation/people.js';
import { loadPeople } from './people.js';
import {
  rehearseFactory, PROBE_CAP,
  type FactoryFixture, type FactoryProduct, type FindingReason, type RehearsalReport,
} from '../../trust/factoryRehearsal.js';
import * as show from './values.js';

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
   * floor and the discount at the ceiling, and — since G7a — a discount past
   * her ask-first line waits for her (core/conversation/hold.ts). Before G7a
   * that line was stored and never read, so this page did not state it.
   *
   * Each figure is the one that makes the sentence true on EVERY product:
   * the lowest floor ("never below"), the highest ceiling ("never more than
   * … — less on some"), the highest ask line ("above … she asks — sooner on
   * some"). The ceiling used to be the lowest, which promised 8% while a
   * product on a 12% ceiling could be given 12%.
   */
  readonly floorLow: Money | null;
  readonly floorHigh: Money | null;
  readonly ceilingPct: number | null;
  /** true when different products carry different ceilings. */
  readonly ceilingVaries: boolean;
  /** G7a — the ask-first line; null when she has stated no price rules. */
  readonly askPct?: number | null;
  readonly askVaries?: boolean;
};

/**
 * Phase 4b — one of the places other than WhatsApp a buyer writes, as My
 * business shows it. The state is read from the same sources the Channels page
 * reads (`metaLinkStatus` through `InboundLink`, and the live mailbox), so the
 * two pages cannot disagree.
 */
export type ReachChannel = {
  readonly channel: 'instagram' | 'messenger' | 'email';
  readonly state: 'connected' | 'not_connected' | 'attention';
  /** The Page, the handle or the mailbox address it is connected as. */
  readonly as?: string;
};

/**
 * What this installation offers besides WhatsApp, built by the route from the
 * same facts `/app/channels` renders: the Instagram/Messenger links, and
 * whether a mailbox can be connected here at all.
 */
export type ReachOffer = {
  readonly inbound: ReadonlyMap<OutreachChannel, InboundLink>;
  readonly mailConnectable: boolean;
};

const NO_OFFER: ReachOffer = { inbound: new Map(), mailConnectable: false };

/** The rows for the channels other than WhatsApp. Pure: the offer and the mailbox are read by the caller. */
export function otherChannels(
  offer: ReachOffer,
  mail: { readonly address: string; readonly needsAttention: unknown } | null,
): readonly ReachChannel[] {
  const out: ReachChannel[] = [];
  for (const ch of ['instagram', 'messenger'] as const) {
    const link = offer.inbound.get(ch);
    // Shown where it can be connected HERE (connect.ts's rule), or where it already is.
    const here = CHANNEL_REGISTRY[ch].availableHere && link?.configured === true;
    if (!here && link?.connected !== true) continue;
    out.push({
      channel: ch,
      state: link?.connected ? (link.needsAttention ? 'attention' : 'connected') : 'not_connected',
      ...(link?.connected && link.connectedAs ? { as: link.connectedAs } : {}),
    });
  }
  if (mail || offer.mailConnectable) {
    out.push(mail
      ? { channel: 'email', state: mail.needsAttention ? 'attention' : 'connected', as: mail.address }
      : { channel: 'email', state: 'not_connected' });
  }
  return out;
}

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
  /** WA (0120) — replies only to the numbers on the list. Absent reads as on (fail-closed). */
  readonly pilotMode?: boolean;
  /** 0070 — the owner's Stop, on every channel. Absent reads as answering. */
  readonly assistantStop?: AssistantStop;
  /** 0071 — ops has paused sending (the kill switch). Absent reads as not paused. */
  readonly opsSilenced?: boolean;
  /**
   * G3 — today's allowance, always shown: how much is used (null: this
   * workspace has no cap), whether it is used up, and when it renews.
   */
  readonly allowance?: { readonly pctUsed: number | null; readonly used: boolean; readonly renewsAt: Date };
};

export type FactoryView = {
  readonly profile: BusinessProfile;
  readonly products: {
    readonly total: number;
    readonly needPrice: number;
    /** A handful, for recognition only — localized at render time. */
    readonly names: readonly { readonly name: string | null; readonly nameZh: string | null }[];
    /**
     * Phase 9 — every product's Chinese name by its name, so the rehearsal's
     * lists (which carry the name only) say the same names as "What you sell"
     * on a Chinese page. Absent: the names as they are.
     */
    readonly namesZh?: Readonly<Record<string, string>>;
  };
  readonly promises: FactoryPromises;
  readonly connection: {
    readonly channel: ChannelView;
    readonly ownerPhone: string | null;
    /**
     * Phase 4b (CC-11) — every OTHER place a buyer can write that this
     * installation offers, with its state. WhatsApp keeps its own block, because
     * only WhatsApp has an activation and a list of who may be messaged.
     * Absent reads as none offered.
     */
    readonly others?: readonly ReachChannel[];
    /** CC-15 — her sign-up country (ISO), for the phone example. */
    readonly country?: string | null;
    /** A2 — the channels she said she uses, in her order: the order they are shown. */
    readonly channelsUsed?: readonly string[];
    /**
     * w4-whole-11 — which places a customer writes are CONNECTED, by the one
     * definition Setup, Ready for customers and the guide read
     * (`connectedChannels`). Absent: read from the lifecycle, as before.
     */
    readonly connected?: ConnectedChannels;
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
  /** M29 — how much of her own price limits she has actually stated. */
  readonly prices: PriceRulesView;
  /** G9b — who works here, so "started by" names a person rather than an id. */
  readonly people?: readonly Person[];
  /** Phase 7 — what the menu's rows say they are set to, beyond what the page reads above; absent, those rows show no value. */
  readonly menu?: BusinessMenu;
};

/**
 * THE WARMTH RUN, phase 7 — what the menu's rows (and How you sell's) say they
 * are set to, read through the loaders the pages behind them already use:
 * nothing re-derived here, so a row and the page it opens cannot disagree.
 */
export type BusinessMenu = {
  /** The kind of business as stored (the tail of a `business.kind.*` key); null = not answered yet. */
  readonly kind: string | null;
  /** How many of How you sell's questions are answered; null for staff (the questions are the owner's). */
  readonly howYouSell: { readonly answered: number; readonly total: number } | null;
  /** V1-537 — the delivery term is null when the owner ships under none. */
  readonly terms: { readonly incoterm: string | null; readonly payment: string } | null;
  /** The sample price stated (amount 0 = free), null when nothing is stated; and how many customers wait for one. */
  readonly samples: { readonly price: Money | null; readonly waiting: number };
  /** The closure in force, or the next one to come; null when none is ahead. */
  readonly closure: { readonly label: string; readonly from: Date; readonly to: Date } | null;
  /** The rate in force; null when none is stated, or there is nothing to convert. */
  readonly rate: OwnerRate | null;
};

export async function loadBusinessMenu(db: Db, businessIdRaw: string, owner: boolean, now: Date = new Date()): Promise<BusinessMenu> {
  const [kind, hub, terms, samples, closures, rates] = await Promise.all([
    loadBusinessKind(db, businessIdRaw),
    owner ? loadHub(db, businessIdRaw) : Promise.resolve(null),
    loadTerms(db, businessIdRaw), loadSamples(db, businessIdRaw), loadClosures(db, businessIdRaw), loadRates(db, businessIdRaw),
  ]);
  // A closure's days are calendar days (closureDate): one that ends today is still in force.
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const ahead = closures.closures.find((c) => c.to.getTime() >= today) ?? null;
  return {
    kind: kind.kind,
    howYouSell: hub ? { answered: hub.order.filter((q) => hub.progress[q]?.state === 'answered').length, total: hub.order.length } : null,
    terms: terms.terms ? { incoterm: terms.terms.incoterm, payment: terms.terms.paymentTerms } : null,
    samples: { price: samples.policy?.price ?? null, waiting: samples.waiting.length },
    closure: ahead ? { label: ahead.label, from: ahead.from, to: ahead.to } : null,
    rate: rates.current,
  };
}

/**
 * The owner's promises: the claims guard's OWN allowlist, read through the
 * catalog port the guard uses. Nothing is re-derived and nothing is inferred —
 * a claim the owner never authorised is simply absent (default-deny).
 */
async function loadPromises(db: Db, businessIdRaw: string): Promise<FactoryPromises> {
  const bid = parseBusinessId(businessIdRaw);
  const none: FactoryPromises = {
    certs: [], floorLow: null, floorHigh: null, ceilingPct: null, ceilingVaries: false,
    askPct: null, askVaries: false,
  };
  if (!bid.ok) return none;

  return withTenantTx(db, bid.value, async (tx) => {
    const repos = tenantRepos(tx, bid.value);
    const [claims, rows] = await Promise.all([
      repos.catalog.claimsPolicy(),
      // Every rule the guard could reach, not just the fallback. A per-product
      // row wins, so when any exists the business-wide row is never consulted.
      sql<{ floor: string; ceiling: string; ask: string; product_id: string | null; currency: string }>`
        select floor_price_usd as floor, max_discount_pct as ceiling,
               human_required_above_pct as ask, product_id, currency
          from pricing_policy where business_id = ${bid.value}
      `.execute(tx).then((r) => r.rows),
    ]);
    const perProduct = rows.filter((r) => r.product_id !== null);
    const applies = perProduct.length > 0 ? perProduct : rows;
    /**
      * G18 — a range is only a range inside ONE currency.
      *
      * "She never quotes below $0.30" was built from every floor she has, as
      * though each were dollars. Two currencies would make that sentence a
      * number she never said, on the page where she checks what her employee
      * may promise. So the span is stated only when her floors agree on the
      * currency; otherwise she is told nothing here rather than told a mixture.
      */
     const byCurrency = new Map<string, number[]>();
     for (const r of applies) byCurrency.set(r.currency, [...(byCurrency.get(r.currency) ?? []), Number(r.floor)]);
     const onlyCurrency = byCurrency.size === 1 ? [...byCurrency.keys()][0]! : null;
     const floors = onlyCurrency ? byCurrency.get(onlyCurrency)! : [];
    const ceilings = [...new Set(applies.map((r) => Number(r.ceiling)))];
    const asks = [...new Set(applies.map((r) => Number(r.ask)))];
    return {
      certs: claims
        .filter((c) => c.allowed && (c.kind === 'certification' || c.kind === 'compliance'))
        .map((c) => c.claimKey),
      floorLow: floors.length && onlyCurrency ? moneyFromRow(Math.min(...floors), onlyCurrency) : null,
      floorHigh: floors.length && onlyCurrency ? moneyFromRow(Math.max(...floors), onlyCurrency) : null,
      ceilingPct: ceilings.length ? Math.max(...ceilings) : null,
      ceilingVaries: ceilings.length > 1,
      askPct: asks.length ? Math.max(...asks) : null,
      askVaries: asks.length > 1,
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
    id: string; sku: string; name: string; moq: number | null; unit: string; lead_time_days: number | null;
    tiers: { minQty: number; maxQty: number | null; unitPrice: number; currency: string }[];
    policy: { floorPrice: number; currency: string; maxDiscountPct: number; humanRequiredAbovePct: number } | null;
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
                      'minQty', t.min_qty, 'maxQty', t.max_qty,
                      'unitPrice', t.unit_price_usd, 'currency', t.currency)
                      order by t.min_qty)
                      from price_tiers t where t.product_id = k.id), '[]'::json) as tiers,
          -- The policy the QUOTE ENGINE would use: the per-product row wins, and
          -- the business-wide row is the fallback (repos.pricingPolicy, M9.5).
          coalesce(
            (select json_build_object('floorPrice', pp.floor_price_usd, 'currency', pp.currency,
                                      'maxDiscountPct', pp.max_discount_pct,
                                      'humanRequiredAbovePct', pp.human_required_above_pct)
               from pricing_policy pp
              where pp.business_id = ${bid.value} and pp.product_id = k.id),
            (select json_build_object('floorPrice', pp.floor_price_usd, 'currency', pp.currency,
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
      moq: r.moq === null ? null : Number(r.moq),
      unit: r.unit,
      leadTimeDays: r.lead_time_days === null ? null : Number(r.lead_time_days),
      // M43a — a tier the build cannot price is dropped, exactly as in the
      // repos: the rehearsal must show what the ENGINE would do, and the engine
      // never sees such a row.
      tiers: (r.tiers ?? []).flatMap((t) => {
        const unitPrice = moneyFromRow(Number(t.unitPrice), t.currency);
        return unitPrice === null ? [] : [{
          minQty: Number(t.minQty),
          maxQty: t.maxQty === null ? null : Number(t.maxQty),
          unitPrice,
        }];
      }),
      policy: (() => {
        if (r.policy === null) return null;
        const floorPrice = moneyFromRow(Number(r.policy.floorPrice), r.policy.currency);
        return floorPrice === null ? null : {
          floorPrice,
          maxDiscountPct: Number(r.policy.maxDiscountPct),
          humanRequiredAbovePct: Number(r.policy.humanRequiredAbovePct),
        };
      })(),
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
  /** Phase 4b — what else this installation offers; the route builds it as /app/channels does. */
  offer: ReachOffer = NO_OFFER,
  /**
   * Phase 7 — the rehearsal runs products × probes in process, and only the
   * going-live screen shows it: the menu and the other screens skip it.
   */
  o: { readonly rehearse?: boolean } = {},
): Promise<FactoryView> {
  const bid = parseBusinessId(businessIdRaw);
  const [profile, products, promises, channels, setup, pre, state, stop, opsSilenced, recipients, rehearsal, prices, people, mail, allowance, connected] = await Promise.all([
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
    // 0070 — the owner's Stop, on every channel.
    bid.ok ? loadAssistantStop(db, bid.value) : null,
    // 0071 — and whether ops has paused sending (the kill switch).
    bid.ok ? withTenantTx(db, bid.value, (tx) => loadKillSwitches(tx, bid.value)).then((k) => k.globalSilence) : false,
    bid.ok ? listAllowlist(db, bid.value) : [],
    // M20.5 — advisory, and deliberately NOT an input to `pre`. If this threw
    // or hung it would take the whole page with it, which is why it reads rows
    // the page already trusts and runs pure code over them.
    o.rehearse === false ? null : loadFactoryRehearsal(db, businessIdRaw),
    loadPriceRules(db, businessIdRaw),
    loadPeople(db, businessIdRaw),
    bid.ok ? withTenantTx(db, bid.value, (tx) => liveMailAccount(tx, bid.value)) : null,
    // G3 — the day's allowance, from the one reader the hold and the send gate ask.
    bid.ok ? withTenantTx(db, bid.value, (tx) => allowanceOf(tx)) : null,
    // w4-whole-11 — connected, by the one definition.
    bid.ok ? withTenantTx(db, bid.value, (tx) => connectedChannels(tx, bid.value)) : null,
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
      namesZh: Object.fromEntries(sold.filter((p) => p.name && p.nameZh).map((p) => [p.name, p.nameZh!])),
    },
    promises,
    connection: {
      channel: channels.whatsapp, ownerPhone: channels.ownerPhone,
      others: otherChannels(offer, mail), country: channels.country ?? null, channelsUsed: channels.channelsUsed ?? [],
      ...(connected ? { connected } : {}),
    },
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
      pilotMode: state?.pilotMode ?? true,
      assistantStop: stop ?? { stoppedAt: null, stoppedBy: null },
      opsSilenced,
      ...(allowance ? { allowance: {
        pctUsed: allowance.pctUsed, used: allowanceUsed(allowance), renewsAt: allowanceRenewsAt(new Date()),
      } } : {}),
    },
    rehearsal,
    prices,
    people,
  };
}


/** ── Renderer (pure, mobile-first, localized, escaped) ────────────────────── */

/**
 * THE WARMTH RUN (2026-10-03), phase 7 — THE SETTINGS MODEL. The owner: "My
 * business … is one long scroll of eight to ten sections of prose … Convert
 * it to the iPhone/Instagram settings pattern: a short, calm menu of rows,
 * each showing its current value, that you tap into."
 *
 * `renderFactory` is that menu now: two cards of rows, each row its shape, its
 * name, where it stands and the door. Every section the page used to hold is
 * a row, and its prose and controls moved one level down, unchanged in
 * substance: onto the page that already owned it (the profile, the kind of
 * business, the products, the price limits) or onto a screen of its own under
 * /app/business (`renderBusinessScreen`). Nothing was flattened to save a tap:
 * How you sell is a menu of its own, and who may be messaged is a level under
 * where customers reach you.
 *
 * TWO DOORS, ONE DATA — the business's facts are edited on ONE screen
 * (`BUSINESS_FACTS_PATH`) and its products on ONE list (`BUSINESS_PRODUCTS_PATH`).
 * The assistant's page links to these same addresses for what it can talk
 * about; neither page keeps a second copy of either.
 */
export const BUSINESS_FACTS_PATH = '/app/settings/profile';

/**
 * The profile is done once it holds what setting up asks of it (a name, a
 * description, a location and a way to be reached — db/setup.ts). One answer,
 * read by My business's row and by the assistant's "can talk about" row
 * (w4-business-assistant-31), so the two rows for it say one thing.
 */
export const profileFinished = (p: Pick<BusinessProfile, 'name' | 'description' | 'location' | 'contactEmail' | 'contactPhone'>): boolean =>
  p.name.trim() !== '' && Boolean(p.description) && Boolean(p.location) && Boolean(p.contactEmail || p.contactPhone);
export const BUSINESS_PRODUCTS_PATH = '/app/products';

export type BusinessScreen = 'channels' | 'allowlist' | 'ready' | 'promises' | 'how';
export const BUSINESS_SCREEN_PATH: Readonly<Record<BusinessScreen, string>> = {
  channels: '/app/business/channels', allowlist: '/app/business/allowlist', ready: '/app/business/ready',
  promises: '/app/business/promises', how: '/app/business/how-you-sell',
};

/**
 * Where each blocker is actually fixed. Every blocker has a real surface —
 * since phase 7 `no_allowlist` too: the list has a screen of its own, a level
 * under where customers reach you — so none of them states a requirement
 * without offering the way to meet it.
 */
const BLOCKER_FIX: Record<ActivationRefusal, string | null> = {
  schema_stale: '/app/onboarding',
  not_ready: '/app/onboarding',
  // Phase 9 — the operator's to do (tools/installation-checks.mjs): nothing for the owner to open.
  secrets_not_rotated: null,
  assistant_not_named: '/app/onboarding',
  no_channel: channelScreenHref('whatsapp'),
  no_allowlist: BUSINESS_SCREEN_PATH.allowlist,
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

/** Phase 9 — the door's words for each kind of gap: what the owner does there. */
const FINDING_DOOR: Record<FindingReason, MessageKey> = {
  no_price: 'factory.rehearsal.fix.prices',
  no_price_at_moq: 'factory.rehearsal.fix.prices',
  floor_above_price: 'factory.rehearsal.fix.prices',
  nothing_taught: 'factory.rehearsal.fix.teach',
  answer_withheld: 'factory.rehearsal.fix.teach',
  claim_not_authorised: 'factory.rehearsal.fix.claims',
};

/**
 * Phase 9 — a list of product names that never breaks inside a name or starts
 * a line with its separator: each name and the "·" after it are one unit, and
 * a line breaks only between units. In Arabic each Latin name stays whole
 * where it falls in the right-to-left line (V1-386), instead of its halves
 * landing at the two ends of two lines.
 */
const nameList = (names: readonly string[], more = false): string =>
  names.map((n, i) => `<span class="fitem"><bdi>${esc(n)}</bdi>${i < names.length - 1 ? ' ·' : more ? ' …' : ''}</span>`).join(' ');

/**
 * The rehearsal, in the owner's words. It leads with the LIST, never a tally:
 * "three findings" is a grade, "she cannot quote the canvas tote" is a task.
 * An empty list says exactly what was checked and nothing more — a factory that
 * has taught her nothing still gets findings, so silence here is earned.
 */
function rehearsalBlock(r: RehearsalReport, locale: Locale, name: string, namesZh: Readonly<Record<string, string>> = {}): string {
  if (r.productsChecked === 0) return '';
  // Phase 9 — under a list of gaps, "Checked all 12 of your products" told the
  // owner nothing; it is said where it qualifies something: beside "nothing
  // missing", or when only some of the products were checked.
  const scope = r.productsTotal > r.productsChecked
    ? t(locale, 'factory.rehearsal.scopeSome', { n: r.productsChecked, total: r.productsTotal })
    : r.findings.length === 0 ? t(locale, 'factory.rehearsal.scopeAll', { n: r.productsChecked }) : null;
  const shownName = (n: string) => productName(locale, { name: n, nameZh: namesZh[n] ?? null }) ?? n;

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
    // Phase 9 — the sentence is text, not an underlined link set larger than
    // the heading above it; the way to close the gap is its own door.
    : [...groups].map(([reason, names]) => `<div class="fgap">
        <p class="fgap-s">${esc(t(locale, `factory.rehearsal.${reason}` as MessageKey, { name }))}</p>
        ${names.length ? `<p class="fnames">${nameList(names.map(shownName))}</p>` : ''}
        ${deeper(FINDING_FIX[reason], t(locale, FINDING_DOOR[reason], { name }))}
      </div>`).join('');

  return `<h2 class="sub3" id="rehearsal">${esc(t(locale, 'factory.rehearsal.title', { name }))}</h2>
    <p class="fdesc">${esc(t(locale, 'factory.rehearsal.lede', { name }))}</p>
    <div class="rehear">${body}</div>
    ${scope ? `<p class="fdesc muted">${esc(scope)}</p>` : ''}`;
}

/** Phase 9 — a count's noun in the form its language gives that count ("12 منتجًا", "1 product"). */
const countNoun = (locale: Locale, base: string, n: number): string =>
  t(locale, `${base}.${new Intl.PluralRules(locale).select(n)}` as MessageKey);

/** "12 products" / "12个产品" / "١٢ منتجًا" — the count and its noun, as the language joins them. */
const productCount = (locale: Locale, n: number): string =>
  `${show.count(locale, n)}${locale === 'zh' ? '' : ' '}${countNoun(locale, 'factory.sell.items', n)}`;

/** A list of short values on one line ("WhatsApp · Instagram"), the same separator in every language. */
const inLine = (xs: readonly string[]): string => xs.join(' · ');

/**
 * Where WhatsApp and every other channel stand, read once for the menu, the
 * channels screen and going live — so the three can never disagree.
 */
function standing(f: FactoryView) {
  const r = f.readiness;
  const lc = r.lifecycle;
  const others = f.connection.others ?? [];
  const used = f.connection.channelsUsed ?? [];
  // 0070 — while stopped, no line may say the assistant is answering anyone.
  const stoppedAt = r.assistantStop?.stoppedAt ?? null;
  // 0071 — ops paused sending: the same lines are untrue, for another reason.
  const held = stoppedAt !== null || r.opsSilenced === true;
  const liveElsewhere = others.filter((o) => o.state === 'connected');
  // w4-whole-11 — WhatsApp connected by the one definition (`connectedChannels`),
  // whatever this installation's provider says; absent, by the lifecycle.
  const waWired = f.connection.connected?.whatsapp ?? (lc === 'active' || lc === 'ready');
  // …and nothing connected anywhere, by the same definition.
  const nothingConnected = f.connection.connected ? !anyConnected(f.connection.connected) : !waWired && liveElsewhere.length === 0;
  // M20.4 (F-06) / Phase 4b (CC-11) — the list of who may be messaged is
  // WhatsApp's alone (the pilot number's activation reads it): it appears only
  // under a WhatsApp that is, or was, connected — or that already holds numbers.
  const showAllowlist = lc !== 'not_connected' || r.recipients.length > 0;
  const waRelevant = r.live || lc !== 'not_connected' || waWired || r.recipients.length > 0 || used.includes('whatsapp');
  // In the order she named them at sign-up; the rest after, in the page's own order.
  const rank = (k: string, i: number): number => { const u = used.indexOf(k); return u === -1 ? used.length + i : u; };
  return { r, lc, others, used, stoppedAt, held, liveElsewhere, showAllowlist, waRelevant, rank, waWired, nothingConnected };
}

/* ── the menu ─────────────────────────────────────────────────────────────── */

export function renderFactory(
  f: FactoryView, locale: Locale, flash: Flash | null = null, viewer: Viewer = OWNER_VIEW,
): string {
  const name = assistantName(locale);
  const p = f.profile;
  const m = f.menu ?? null;
  const s = standing(f);

  // A new business gets ONE next step. A finished one gets nothing at all —
  // setup disappears rather than turning into a permanent checklist.
  // Phase 9 (w4-business-assistant-03) — never a second door to a row of this
  // menu (the profile, the products, where customers reach you): only the
  // steps no row here opens (the name, the first reply).
  const ROW_STEPS: readonly string[] = ['profile', 'products', 'channels'];
  const next = f.nextStep && !ROW_STEPS.includes(f.nextStep)
    ? deeper(STEP_LINK[f.nextStep], t(locale, `factory.next.${f.nextStep}` as MessageKey, { name }), 'next')
    : '';

  // The profile: done once it holds what setting up asks of it (a description,
  // a location and a way to be reached — db/setup.ts). The business's name is
  // the page's own header already; the row says where the profile stands.
  const unnamed = p.name.trim() === '';
  const unfinished = !profileFinished(p);
  const profile = menuRow({ href: BUSINESS_FACTS_PATH, icon: 'business', label: t(locale, 'settings.profile.title'),
    desc: unnamed ? t(locale, 'factory.about.empty', { name }) : null,
    value: t(locale, unfinished ? 'setup.state.toDo' : 'setup.state.done'), tone: unfinished ? undefined : 'ok' });

  // w4-whole-14 — the row is a short form of the page's own name ("What you do, your country and your website").
  const kind = menuRow({ href: '/app/settings/business', icon: 'kind', label: t(locale, 'business.row.kind'),
    value: m === null ? null : m.kind ? t(locale, `business.kind.${m.kind}` as MessageKey) : t(locale, 'setup.state.notAnswered') });

  // Where customers reach you: the channels answering, by name; a connection
  // that stopped waits for her; nothing connected waits for her too.
  const wa: ReachChannel['state'] = s.waWired ? 'connected' : s.lc === 'paused' ? 'attention' : 'not_connected';
  const all = [{ channel: 'whatsapp', state: wa }, ...s.others]
    .map((c, i) => ({ ...c, at: s.rank(c.channel, i) })).sort((a, b) => a.at - b.at);
  const answering = all.filter((c) => c.state === 'connected').map((c) => t(locale, `reach.channel.${c.channel}` as MessageKey));
  const needsHer = all.some((c) => c.state === 'attention');
  const reach = menuRow({ href: BUSINESS_SCREEN_PATH.channels, icon: 'reach', label: t(locale, 'factory.reach.title'),
    value: needsHer ? t(locale, 'connect.state.attention') : answering.length ? inLine(answering) : t(locale, 'setup.state.notConnected'),
    tone: needsHer ? 'warn' : answering.length ? 'ok' : undefined });

  // Going live: the same facts the screen's first line answers from.
  const r = s.r;
  const [liveKey, liveTone]: readonly [MessageKey, 'ok' | 'warn' | undefined] = s.held
    ? [r.opsSilenced ? 'business.live.paused' : 'business.live.stopped', 'warn']
    : r.live || s.liveElsewhere.length > 0 ? ['business.live.on', 'ok']
    : !s.waRelevant ? ['setup.state.notConnected', undefined]
    : r.canActivate ? ['business.live.ready', 'ok']
    : ['business.live.notYet', undefined];
  const live = menuRow({ href: BUSINESS_SCREEN_PATH.ready, icon: 'live', label: t(locale, 'business.row.live'),
    value: t(locale, liveKey), tone: liveTone });

  // What you sell: a count the owner can verify, and whether each can be quoted.
  const n = f.products.total;
  const products = menuRow({ href: BUSINESS_PRODUCTS_PATH, icon: 'products', label: t(locale, 'nav.products'),
    desc: n === 0 ? t(locale, 'factory.sell.empty', { name })
      : f.products.needPrice > 0 ? t(locale, 'factory.sell.needPrice', { n: f.products.needPrice, name })
      : t(locale, 'factory.sell.allPriced', { name }),
    value: n === 0 ? t(locale, 'business.value.noneYet') : productCount(locale, n) });

  // M29 — what she may never go below. Counts of real rows: how many priced
  // products still have no limit she stated. Never a score. G9a — the page is
  // the owner's: a sales assistant reads where it stands, with no door to a refusal.
  const pr = f.prices;
  const noLimits = pr.businessDefault === null && pr.products.every((x) => x.own === null);
  const prices = menuRow({ href: viewer.isOwner ? '/app/business/prices' : null, icon: 'prices', label: t(locale, 'factory.prices.title'),
    desc: noLimits ? t(locale, 'factory.prices.none', { name }) : null,
    value: noLimits ? t(locale, 'setup.value.notSetUp') : pr.unanswered > 0 ? tn(locale, 'business.value.withoutLimit', pr.unanswered) : t(locale, 'business.value.allSet'),
    tone: noLimits || pr.unanswered > 0 ? undefined : 'ok' });

  // What she promises: the certificates and claims by their names.
  const certs = f.promises.certs.map((c) => claimName(locale, c));
  const promises = menuRow({ href: BUSINESS_SCREEN_PATH.promises, icon: 'promise', label: t(locale, 'factory.promise.title'),
    value: certs.length ? inLine(certs) : t(locale, 'business.value.noneConfirmed') });

  // How you sell: where the questions stand (the owner's — rule 11).
  const hs = m?.howYouSell ?? null;
  const how = menuRow({ href: BUSINESS_SCREEN_PATH.how, icon: 'sell', label: t(locale, 'factory.sellhow.title'),
    value: hs ? t(locale, 'hs.progress', { done: hs.answered, total: hs.total }) : null,
    tone: hs && hs.answered >= hs.total ? 'ok' : undefined });

  return `<h1 class="page">${esc(t(locale, 'nav.factory'))}</h1>
    ${flashBanner(flash)}
    <p class="lede">${esc(t(locale, 'factory.lede', { name }))}</p>
    ${next}
    ${menuGroup('business', t(locale, 'business.group.main'), [profile, kind, reach, live])}
    ${menuGroup('selling', t(locale, 'factory.sell.title'), [products, prices, promises, how])}`;
}

/* ── the screens a level down ─────────────────────────────────────────────── */

/** Each screen starts with the way back to the menu it was opened from, then its name. */
const head = (locale: Locale, title: string, flash: Flash | null, to: { href: string; label: string } | null = null): string =>
  `${back(to?.href ?? '/app/business', to?.label ?? t(locale, 'nav.factory'))}
    <h1 class="page">${esc(title)}</h1>
    ${flashBanner(flash)}`;

export function renderBusinessScreen(
  screen: BusinessScreen, f: FactoryView, locale: Locale, flash: Flash | null = null, viewer: Viewer = OWNER_VIEW,
  /** KS6 — the operator's approval before the first connection, already rendered: first on the channels' home. */
  extras: { readonly approvalHtml?: string } = {},
): string {
  switch (screen) {
    case 'channels': return channelsScreen(f, locale, flash, viewer, extras.approvalHtml ?? '');
    case 'allowlist': return allowlistScreen(f, locale, flash, viewer);
    case 'ready': return readyScreen(f, locale, flash, viewer);
    case 'promises': return promisesScreen(f, locale, flash);
    case 'how': return howScreen(f, locale, flash, viewer);
  }
}

/**
 * Where customers reach you — the ONE home of the channels (phase 7), a menu
 * since phase 9 (w4-business-assistant-05, -07; w4-whole-15): a row for each
 * place a customer can write, in the order she named them at sign-up, each
 * with where it stands — connected by the one definition every page reads
 * (`connectedChannels`, w4-whole-11) — and the door to that channel's own
 * screen; under WhatsApp, who may be messaged; the number her alerts use;
 * and what is not available yet. The approval the first connection waits for
 * comes first, because every Connect waits on it.
 */
function channelsScreen(f: FactoryView, locale: Locale, flash: Flash | null, viewer: Viewer, approvalHtml: string): string {
  const name = assistantName(locale);
  const s = standing(f);
  const c = f.connection.channel;
  // M20.3.1 — one lifecycle, four honest states; and connected by the one
  // definition while this installation carries no WhatsApp message (wired).
  const wired = s.waWired && s.lc !== 'active' && s.lc !== 'ready';
  const elsewhere = s.others.some((o) => o.state === 'connected');
  const waHint = wired ? t(locale, 'golive.waNoProvider')
    : s.lc === 'not_connected' && elsewhere ? t(locale, 'factory.reach.other.notConnected', { name })
    : t(locale, `channel.state.${s.lc}.hint` as MessageKey, { name });
  const whatsapp = menuRow({ href: channelScreenHref('whatsapp'), icon: 'whatsapp', label: channelScreenTitle(locale, 'whatsapp'),
    descHtml: [s.waWired && c.displayId ? `<bdi>${esc(c.displayId)}</bdi>` : '', esc(waHint)].filter(Boolean).join(' · '),
    value: wired ? t(locale, 'connect.state.connected') : t(locale, `channel.state.${s.lc}` as MessageKey, { name }),
    // Phase 9 — the waiting signal is for a connection that stopped; a number
    // never connected waits on nothing, so it carries no state colour.
    tone: s.waWired ? 'ok' : s.lc === 'paused' ? 'warn' : undefined });

  // Instagram and Messenger: one Facebook Page connects both, so one row and one screen.
  const meta = (['instagram', 'messenger'] as const).map((ch) => s.others.find((o) => o.channel === ch)).filter((o): o is ReachChannel => o !== undefined);
  const metaOn = meta.filter((o) => o.state === 'connected');
  const metaAttention = meta.some((o) => o.state === 'attention');
  const metaAs = meta.find((o) => o.as)?.as ?? null;
  const metaRow = menuRow({ href: channelScreenHref('meta'), icon: 'meta', label: channelScreenTitle(locale, 'meta'),
    ...(metaAs ? { descHtml: `<bdi>${esc(metaAs)}</bdi>` } : {}),
    value: metaAttention ? t(locale, 'connect.state.attention')
      // both answering: Connected; one of them: its name
      : metaOn.length && metaOn.length === meta.length ? t(locale, 'connect.state.connected')
      : metaOn.length ? inLine(metaOn.map((o) => t(locale, `reach.channel.${o.channel}` as MessageKey)))
      : t(locale, meta.length ? 'connect.state.notConnected' : 'connect.state.notHere'),
    tone: metaAttention ? 'warn' : metaOn.length ? 'ok' : undefined });

  const mail = s.others.find((o) => o.channel === 'email');
  const email = menuRow({ href: channelScreenHref('email'), icon: 'email', label: channelScreenTitle(locale, 'email'),
    ...(mail?.as ? { descHtml: `<bdi>${esc(mail.as)}</bdi>` } : {}),
    value: t(locale, !mail ? 'connect.state.notHere' : mail.state === 'connected' ? 'connect.state.connected'
      : mail.state === 'attention' ? 'connect.state.attention' : 'connect.state.notConnected'),
    tone: mail?.state === 'connected' ? 'ok' : mail?.state === 'attention' ? 'warn' : undefined });

  const metaRank = Math.min(s.rank('instagram', 1), s.rank('messenger', 2));
  const rows = [{ at: s.rank('whatsapp', 0), html: whatsapp }, { at: metaRank, html: metaRow }, { at: s.rank('email', 3), html: email }]
    .sort((a, b) => a.at - b.at).map((b) => b.html);

  // WA (0120) — once WhatsApp is live, who may get a reply: the list only
  // (pilot mode, how going live always starts), or every customer who writes.
  const pilotOn = f.readiness.pilotMode ?? true;
  const listed = f.readiness.recipients.length;
  const allowlist = !s.showAllowlist ? '' : menuGroup('whatsapp', t(locale, 'reach.channel.whatsapp'), [menuRow({
    href: BUSINESS_SCREEN_PATH.allowlist, label: t(locale, 'allowlist.title', { name }),
    value: s.lc === 'active' && !pilotOn ? t(locale, 'business.value.everyone')
      : listed === 0 ? t(locale, 'business.value.nobody') : tn(locale, 'business.value.numbers', listed) })]);

  // The number her alerts use, as it stands (w4-business-assistant-06: where
  // each alert goes is Notifications', so nothing here says "you are alerted on").
  const alerts = menuGroup('alerts', null, [menuRow({ href: channelScreenHref('alerts'), icon: 'alerts', label: channelScreenTitle(locale, 'alerts'),
    value: f.connection.ownerPhone ?? t(locale, 'setup.value.notSetUp') })]);

  return `${head(locale, t(locale, 'factory.reach.title'), flash)}
    ${approvalHtml}
    ${menuGroup('channels', null, rows)}
    ${allowlist}
    ${alerts}
    ${channelsFoot(locale)}`;
}

/**
 * Who may be messaged on WhatsApp (M20.4, F-06), and — once WhatsApp is live —
 * whether only they get replies (WA, 0120). It reuses pilot_allowlist and the
 * existing add/archive services: no second store, no permission system.
 */
function allowlistScreen(f: FactoryView, locale: Locale, flash: Flash | null, viewer: Viewer): string {
  const name = assistantName(locale);
  const lc = f.readiness.lifecycle;
  const list = f.readiness.recipients.length === 0
    ? `<p class="fempty">${esc(t(locale, 'allowlist.none', { name }))}</p>`
    : `<ul class="fsteps">${f.readiness.recipients.map((r) => `
        <li class="done">${shape('ok')} <bdi>${esc(r.label ?? r.phone)}</bdi>${r.label ? ` <span class="muted">${esc(r.phone)}</span>` : ''}
          ${viewer.isOwner ? `<form method="post" action="/app/business/allowlist/remove" class="inline rm">
            <input type="hidden" name="phone" value="${esc(r.phone)}" />
            <button class="btn ghost" type="submit"
                    onclick="return confirm(this.dataset.confirm)"
                    data-confirm="${esc(t(locale, 'allowlist.remove.confirm', { who: r.label ?? r.phone, name }))}"
            >${esc(t(locale, 'allowlist.remove'))}</button>
          </form>` : ''}</li>`).join('')}</ul>`;
  const add = !viewer.isOwner ? `<p class="fdesc muted">${esc(t(locale, 'staff.ownerDecides'))}</p>` : `<form method="post" action="/app/business/allowlist/add" class="alform">
      <label class="fld"><span class="muted">${esc(t(locale, 'allowlist.phone'))}</span>
        <input name="phone" inputmode="tel" placeholder="${esc(phonePlaceholder(locale, f.connection.country))}" required /></label>
      <label class="fld"><span class="muted">${esc(t(locale, 'allowlist.label'))}</span>
        <input name="label" placeholder="${esc(t(locale, 'allowlist.label.ph'))}" /></label>
      <button class="btn send" type="submit">${esc(t(locale, 'allowlist.add'))}</button>
    </form>`;
  // D6 — the line under the list knows which of the three the number is in;
  // phase 7: the switch it speaks of is a screen away, so its door follows it.
  const nextLine = `<p class="fdesc">${esc(t(locale,
    lc === 'active' ? 'factory.reach.nextConnected' : lc === 'ready' ? 'factory.reach.nextReady' : 'factory.reach.nextNot', { name }))}</p>
    ${lc === 'ready' ? deeper(BUSINESS_SCREEN_PATH.ready, t(locale, 'business.row.live')) : ''}`;
  const pilotOn = f.readiness.pilotMode ?? true;
  const pilot = lc !== 'active' ? '' : `
    <h2 class="sub3">${esc(t(locale, 'pilot.mode.title'))}</h2>
    <p class="fdesc">${esc(t(locale, pilotOn ? 'pilot.mode.on' : 'pilot.mode.off', { name }))}</p>
    ${!viewer.isOwner ? '' : pilotOn
      ? `<form method="post" action="/app/business/pilot/end" class="inline"><button class="btn send" type="submit"
           onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale, 'pilot.mode.endConfirm', { name }))}">${esc(t(locale, 'pilot.mode.end'))}</button></form>`
      : `<form method="post" action="/app/business/pilot/resume" class="inline"><button class="btn" type="submit">${esc(t(locale, 'pilot.mode.resume'))}</button></form>`}`;
  return `${head(locale, t(locale, 'allowlist.title', { name }), flash, { href: BUSINESS_SCREEN_PATH.channels, label: t(locale, 'factory.reach.title') })}
    <section class="fblock">
      <p class="fdesc fdesc-lead">${esc(t(locale, 'allowlist.note', { name }))}</p>
      ${list}
      ${add}
      ${nextLine}
      ${pilot}
    </section>`;
}

/**
 * Before the assistant talks to real customers — answered by the SAME
 * preconditions the activate action obeys: either the list of blockers is
 * empty, or it says exactly what is in the way and where to fix it. No score,
 * no grade. The owner's Stop on every channel leads (0070): it is the one
 * switch that binds all of them, and it is never further away than the
 * channels it stops.
 */
function readyScreen(f: FactoryView, locale: Locale, flash: Flash | null, viewer: Viewer): string {
  const name = assistantName(locale);
  const s = standing(f);
  const r = s.r;
  const recipientList = r.recipients.length
    ? `<ul class="fsteps">${r.recipients.slice(0, 8).map((x) =>
        `<li class="done">${shape('ok')} <bdi>${esc(x.label ?? x.phone)}</bdi>${x.label ? ` <span class="muted">${esc(x.phone)}</span>` : ''}</li>`).join('')}
       </ul>${r.recipients.length > 8 ? `<p class="fdesc">${esc(t(locale, 'activation.recipients.more', { n: r.recipients.length - 8 }))}</p>` : ''}`
    : '';

  const blockerList = `<ul class="fsteps">${r.blockers.map((b) => {
    // w4-whole-11 — connected by the one definition, but this installation
    // carries no WhatsApp message: said as Nomi's team's, with no door.
    const wiredOnly = b === 'no_channel' && f.connection.connected?.whatsapp === true;
    const href = wiredOnly ? null : BLOCKER_FIX[b];
    const line = esc(wiredOnly ? t(locale, 'golive.waNoProvider') : t(locale, `activation.blocker.${b}` as MessageKey, { name }));
    return `<li>${shape('waiting')} ${href ? `<a class="blink" href="${href}">${line}</a>` : line}</li>`;
  }).join('')}</ul>`;

  // M20.3 — the decision itself. Confirmed, because it is the moment a real
  // buyer can first be reached; and reversible, because the stop control is
  // never further away than the start one was.
  // G9a — turning messaging on or off is hers: staff see the state, not the switch.
  const confirmBtn = (action: string, cls: string, label: string, question: string) => !viewer.isOwner
    ? `<p class="fdesc muted">${esc(t(locale, 'staff.ownerDecides'))}</p>`
    : `<form method="post" action="/app/business/${action}" class="inline">
      <button class="btn ${cls}" type="submit"
              onclick="return confirm(this.dataset.confirm)"
              data-confirm="${esc(question)}">${esc(label)}</button>
    </form>`;

  // Going live, per channel (2026-09-27). Activation is WhatsApp's alone: the
  // send gate reads a `channels` row for WhatsApp and treats every other
  // channel as live once connected (db/channels.ts, C4.a). So the switch sits
  // under WhatsApp's name and its Stop says what it stops, and each other
  // connected channel says it is already answering and how that is stopped.
  // Display only: nothing here changes what the gate decides.
  const elsewhereNames = s.liveElsewhere.length === 0 ? '' : new Intl.ListFormat(locale, { type: 'conjunction' })
    .format(s.liveElsewhere.map((o) => t(locale, `reach.channel.${o.channel}` as MessageKey)));
  const whatsappBody = r.live
    ? `${s.held ? '' : `<p class="fdesc">${esc(t(locale, 'factory.ready.live', { name }))}</p>`}
       ${r.activatedAt ? `<p class="fdesc">${esc(t(locale, 'activation.live.since', {
          when: show.date(locale, r.activatedAt),
          // G9b — a name, or "you" for the reader; never the id in the column.
          who: actorName(r.activatedBy, f.people ?? [], viewer, {
            you: t(locale, 'takeover.actor.you'), owner: t(locale, 'people.held.owner'), gone: t(locale, 'people.held.gone'),
          }) }))}</p>` : ''}
       ${recipientList ? `<p class="fdesc fdesc-lead">${esc(t(locale, 'activation.recipients.title', { name }))}</p>${recipientList}` : ''}
       <p class="fnever">${esc(t(locale, 'activation.stop.what'))}</p>
       <p class="fdesc">${esc(t(locale, 'activation.stop.differs', { name }))}</p>
       ${elsewhereNames && !s.held ? `<p class="fdesc">${esc(t(locale, 'golive.whatsappOnly', { channels: elsewhereNames }))}</p>` : ''}
       <div class="facts">${confirmBtn('deactivate', s.stoppedAt ? '' : 'danger',
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
  const elsewhereBody = s.liveElsewhere.length === 0 || s.held ? '' : `
       <p class="fok">${esc(t(locale, 'golive.other.live', { channels: elsewhereNames, name }))}</p>
       <p class="fdesc fdesc-lead">${esc(t(locale, 'golive.other.stopHow'))}</p>
       <div class="doors">${deeper('/app/employee', t(locale, 'golive.other.stopDrafts'))}${deeper(CHANNELS_HOME, t(locale, 'golive.other.stopDisconnect'))}</div>`;
  // 0070 — the owner's Stop, on EVERY channel, first: it is the one switch
  // that binds all of them, WhatsApp included, and it is never further away
  // than the channels it stops. Shown wherever something could be sent.
  const who = (id: string | null) => actorName(id, f.people ?? [], viewer, {
    you: t(locale, 'takeover.actor.you'), owner: t(locale, 'people.held.owner'), gone: t(locale, 'people.held.gone'),
  });
  const everyBody = s.stoppedAt
    ? `<p class="fwarn">${esc(t(locale, 'assistant.stop.stopped', { name }))}</p>
       <p class="fdesc">${esc(t(locale, 'assistant.stop.since', { when: show.date(locale, s.stoppedAt), who: who(r.assistantStop?.stoppedBy ?? null) }))}</p>
       <div class="doors">${deeper('/app/inbox?filter=pending', t(locale, 'assistant.stop.needsYou'))}</div>
       <div class="facts">${confirmBtn('start-assistant', 'send',
          t(locale, 'assistant.stop.action.start', { name }),
          t(locale, 'assistant.stop.action.startConfirm', { name }))}</div>
       <p class="fdesc">${esc(t(locale, 'assistant.stop.startNote', { name }))}</p>`
    : `<p class="fdesc">${esc(t(locale, 'assistant.stop.running', { name }))}</p>
       <div class="facts">${confirmBtn('stop-assistant', 'danger',
          t(locale, 'assistant.stop.action.stop', { name }),
          t(locale, 'assistant.stop.action.stopConfirm', { name }))}</div>`;
  // 0071 — ops paused sending: said here, above the owner's own switch, which
  // still works and is still hers.
  const silencedNote = r.opsSilenced
    ? `<p class="fwarn" data-golive="silenced">${esc(t(locale, 'assistant.silenced.note', { name }))}</p>` : '';
  const everyBlock = s.held || s.waRelevant || s.liveElsewhere.length > 0
    ? `<h2 class="sub3" data-golive="every" id="stop">${esc(t(locale, 'assistant.stop.title', { name }))}</h2>${silencedNote}${everyBody}` : '';
  // G3 — today's allowance, always visible: what is used, and when it renews.
  const a = r.allowance;
  const allowanceBlock = a ? `<h2 class="sub3" data-golive="allowance">${esc(t(locale, 'business.allowance.title'))}</h2>
       ${a.pctUsed === null ? `<p class="fdesc">${esc(t(locale, 'business.allowance.none'))}</p>`
         : `<p class="${a.used ? 'fwarn' : 'fdesc'}">${esc(t(locale, 'business.allowance.used', { pct: Math.min(100, a.pctUsed), time: show.time(locale, a.renewsAt) }))}</p>
            ${a.used ? `<p class="fdesc">${esc(t(locale, 'business.allowance.waiting'))}</p>
            <div class="doors">${deeper('/app/inbox?filter=pending', t(locale, 'assistant.stop.needsYou'))}</div>` : ''}`}` : '';
  const readyBody = everyBlock + (s.waRelevant
    ? `<h2 class="sub3" data-golive="whatsapp">${esc(t(locale, 'reach.channel.whatsapp'))}</h2>${whatsappBody}${elsewhereBody
        ? `<h2 class="sub3" data-golive="elsewhere">${esc(elsewhereNames)}</h2>${elsewhereBody}` : ''}`
    : `${elsewhereBody
        ? `<div data-golive="elsewhere">${elsewhereBody}</div>`
        // Phase 9 (w4-business-assistant-14) — the answer line above already says nothing is connected; here, only while it says something else (held).
        : `${s.held ? `<p class="fdesc" data-golive="none">${esc(t(locale, 'golive.none', { name }))}</p>` : ''}
           ${deeper(BUSINESS_SCREEN_PATH.channels, t(locale, 'factory.reach.title'))}`}
       ${deeper('/app/sandbox', t(locale, 'factory.ready.practice'))}`) + allowanceBlock;

  // M20.5 — appended AFTER the activation decision, never folded into it. These
  // are things the assistant cannot answer yet; none is a reason to stay off.
  const rehearsed = f.rehearsal ? rehearsalBlock(f.rehearsal, locale, name, f.products.namesZh) : '';

  // Phase 9 — the heading asks a question; this line answers it, from the same
  // facts the screen lists below (and the activate action obeys): stopped,
  // answering, ready to start, or how many things are first.
  const answer = s.held
    ? `<p class="fready">${todoMark()} ${esc(t(locale, 'factory.ready.answer.held', { name }))}</p>`
    : r.live || s.liveElsewhere.length > 0
      ? `<p class="fready">${signalMark('ok')} ${esc(t(locale, 'factory.ready.answer.live', { name }))}</p>`
      : !s.waRelevant
        ? `<p class="fready">${esc(t(locale, 'factory.ready.answer.nothing', { name }))}</p>`
        : r.canActivate
          ? `<p class="fready">${signalMark('ok')} ${esc(t(locale, 'factory.ready.answer.ready', { name }))}</p>`
          : `<p class="fready">${todoMark()} ${esc(tn(locale, 'factory.ready.answer.notYet', r.blockers.length, { name }))}</p>`;

  return `${head(locale, t(locale, 'business.row.live'), flash)}
    ${answer}
    <section class="fblock">
      ${readyBody}
      ${rehearsed}
      ${deeper('/app/onboarding', t(locale, 'pilot.title'))}
    </section>`;
}

/**
 * What she promises customers — the claims guard's OWN allowlist in her words,
 * and the price rules it enforces. Everything not listed is refused; that rule
 * is stated, never implied.
 *
 * The warmth run, phase 9 (w4-products-knowledge-02) — the ONE place the
 * certifications are switched on and off (`certRows`, the knowledge page's
 * rows moved here whole): "anything not turned on here" is now true of the page
 * that says it. What may be promised about returns, delivery and what is sold
 * is answered in How you sell, and the page says so with its door.
 */
function promisesScreen(f: FactoryView, locale: Locale, flash: Flash | null): string {
  const name = assistantName(locale);
  // Only what the guard actually enforces, and only in the shape the owner's
  // own data takes: one floor, or a range across her products.
  const lo = f.promises.floorLow;
  const hi = f.promises.floorHigh;
  const ceil = f.promises.ceilingPct;
  const ask = f.promises.askPct ?? null;
  // Phase 9 — nothing comes off a price unless she wrote a discount (the price
  // page says the same); with none, the ceiling and ask line limit nothing.
  const noDiscount = f.prices.volume.length === 0;
  const priceRules = [
    lo !== null && hi !== null
      ? (lo.amount === hi.amount && lo.currency === hi.currency
        ? t(locale, 'factory.promise.floor', { price: show.money(locale, lo), name })
        : t(locale, 'factory.promise.floorRange', { low: show.money(locale, lo), high: show.money(locale, hi), name }))
      : null,
    noDiscount ? t(locale, 'factory.promise.noDiscount', { name }) : null,
    !noDiscount && ceil !== null
      ? t(locale, f.promises.ceilingVaries ? 'factory.promise.ceilingVaries' : 'factory.promise.ceiling', { ceil, name })
      : null,
    // G7a — a gate now, so a promise. Not stated when it can never fire: an
    // ask line at the ceiling is a question the clamp means she never asks.
    !noDiscount && ask !== null && ceil !== null && ask < ceil
      ? t(locale, f.promises.askVaries ? 'factory.promise.askVaries' : 'factory.promise.ask', { ask, name })
      : null,
  ].filter((x): x is string => x !== null);

  return `${head(locale, t(locale, 'factory.promise.title'), flash)}
    <section class="fblock" id="certs" aria-labelledby="certs-h">
      <h2 id="certs-h">${esc(t(locale, 'knowledge.cert.title'))}</h2>
      <p class="fdesc">${esc(t(locale, 'knowledge.cert.scopeAll', { n: f.products.total }))}</p>
      ${certRows(locale, f.promises.certs, f.products.total)}
      <p class="fnever">${esc(t(locale, 'factory.promise.never', { name }))}</p>
    </section>
    <section class="fblock">
      ${priceRules.length ? `<ul class="frules">${priceRules.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      <p class="fdesc">${esc(t(locale, 'factory.promise.elsewhere', { name }))}</p>
      <div class="doors">${deeper(BUSINESS_SCREEN_PATH.how, t(locale, 'factory.sellhow.title'))}
        ${deeper('/app/knowledge', t(locale, 'factory.promise.more', { name }))}</div>
    </section>`;
}

/**
 * How you sell — D: HOW you sell, beside WHAT you sell. The questions first
 * (the owner's), then the same facts changed directly, each with what it is
 * set to now. Staff see the facts they may change (closures, a sample's
 * address) and never the questions, which only refuse them (rule 11).
 */
function howScreen(f: FactoryView, locale: Locale, flash: Flash | null, viewer: Viewer): string {
  const m = f.menu ?? null;
  const hs = m?.howYouSell ?? null;
  const questions = !viewer.isOwner ? '' : menuGroup('questions', null, [menuRow({
    href: HS_BASE, icon: 'question', label: t(locale, 'hs.questions.title'),
    value: hs ? t(locale, 'hs.progress', { done: hs.answered, total: hs.total }) : null,
    tone: hs && hs.answered >= hs.total ? 'ok' : undefined })]);
  // CUR — the rate door only where there is something to convert: a workspace
  // that sells in another currency than its country's own (`ratePairOf`).
  const home = currencyOfCountry(f.connection.country);
  const samples = m?.samples ?? null;
  const rows = [
    menuRow({ href: '/app/settings/terms', icon: 'terms', label: t(locale, 'terms.title'),
      value: m === null ? null : m.terms ? inLine([...(m.terms.incoterm ? [m.terms.incoterm] : []), m.terms.payment]) : t(locale, 'setup.value.notSetUp') }),
    menuRow({ href: '/app/settings/samples', icon: 'samples', label: t(locale, 'samples.title'),
      value: samples === null ? null : samples.waiting > 0 ? tn(locale, 'business.value.samplesWaiting', samples.waiting)
        : samples.price === null ? t(locale, 'setup.value.notSetUp')
        : samples.price.amount === 0 ? t(locale, 'business.value.free') : show.money(locale, samples.price),
      // A customer waiting for a sample is waiting for the owner; a price not stated is a setting.
      tone: samples !== null && samples.waiting > 0 ? 'warn' : undefined }),
    menuRow({ href: '/app/settings/closures', icon: 'closures', label: t(locale, 'closures.title'),
      value: m === null ? null : m.closure
        ? inLine([m.closure.label, t(locale, 'closures.range', { from: show.date(locale, m.closure.from), to: show.date(locale, m.closure.to) })])
        : t(locale, 'business.value.noClosures') }),
    ...(home !== null && home !== f.prices.currency ? [menuRow({ href: '/app/settings/rate', icon: 'rate', label: t(locale, 'business.row.rate'),
      value: m === null ? null : m.rate ? t(locale, 'rate.current', { rate: m.rate.rate, from: m.rate.from, to: m.rate.to }) : t(locale, 'setup.value.notSetUp') })] : []),
  ];
  // Phase 9 — the first door is the questions; the rest change one of the
  // same facts directly, and say so. Each row is named short, as a menu's are;
  // the page it opens keeps its full name.
  return `${head(locale, t(locale, 'factory.sellhow.title'), flash)}
    ${questions}
    <section class="sgroup">
      ${viewer.isOwner ? `<p class="sgroup-h">${esc(t(locale, 'factory.sellhow.direct'))}</p>` : ''}
      <ul class="scard">${rows.join('')}</ul>
    </section>`;
}
