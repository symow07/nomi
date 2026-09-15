import { sql } from 'kysely';
import { type Money, moneyFromRow } from '../../core/types/money.js';
import { withTenantTx, type Db, type Tx } from '../../db/client.js';
import { issueProofLinkTx } from '../../db/proofs.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { LOCALES, type Locale, DEFAULT_LOCALE } from '../../core/owner/i18n/locale.js';
import { t, EMPLOYEE_NAME, type MessageKey } from '../../core/owner/i18n/messages.js';
import { formatMoney } from '../../core/owner/i18n/format.js';
import { esc } from './layout.js';
import { cssVariables } from '../../core/owner/css.js';

/**
 * M35 — the proof link. The FIRST buyer-facing surface this product has.
 *
 * Every quote she sends can carry a link. The buyer opens it — no login, no
 * app — and sees the price, the tier it came from, the MOQ, the lead time, and
 * where each fact came from: the owner's catalogue, her taught knowledge, a
 * certification the owner explicitly authorised.
 *
 * The provenance already existed; it was visible only to the owner. This turns
 * the invariant that makes her safe into an artifact the factory can forward.
 *
 * ── WHAT THIS PAGE MAY NEVER CONTAIN ──────────────────────────────────────
 *
 * "Show where every fact came from" reads, on its face, as "show the pricing
 * policy". It is the one kind of transparency that damages the person we work
 * for: `floor $0.35 · quoted $0.38` tells a buyer exactly how far to push.
 *
 * So the exclusion is STRUCTURAL, not a filter applied late. `loadProof` never
 * selects from `pricing_policy`, and it never reads `quotes.inputs` — the jsonb
 * snapshot that contains the policy, the tiers and the rules together. The
 * tier shown below is re-read from `price_tiers`, which holds quantities and
 * prices and no policy at all. There is no code path here that HAS the floor
 * price and declines to render it; the value never enters the process.
 *
 * Also never: capability or draft/auto state, refusal reasons, other quotes,
 * other buyers, tenant identifiers, or anything about the build or schema.
 *
 * `tests/parity/m35-proof.test.ts` names each of these. The natural reading of
 * "provenance" includes exactly the wrong rows, so the test exists to stop the
 * next person adding one helpfully.
 */

/** Where a fact on this page came from. Buyer-facing, so no table names. */
export type FactSource = 'catalogue' | 'taught' | 'authorised';

export type ProofFact = {
  readonly label: string;
  readonly value: string;
  readonly source: FactSource;
};

export type ProofView = {
  readonly seller: string;
  readonly productName: string;
  readonly sku: string;
  readonly quantity: number;
  readonly unit: string;
  readonly unitPrice: Money;
  readonly total: Money;
  /** The band this quantity fell in. Quantities and prices only. */
  readonly tier: { readonly minQty: number; readonly maxQty: number | null } | null;
  readonly moq: number;
  /** G5 — the lead time the QUOTE stated, never the product's. */
  readonly leadTimeDays: number | null;
  /**
   * G5 — her closure, when it is why the quote stated no date. The buyer is
   * told why, in her own words for it; never the date a lead time would have
   * promised. Optional so a view built before G5 still types.
   */
  readonly leadTimeWithheld?: { readonly label: string; readonly from: string; readonly to: string } | null;
  /** Certifications the owner explicitly authorised — never inferred. */
  readonly certifications: readonly string[];
  /** Taught facts behind claims in this quote, in the owner's own words. */
  readonly taught: readonly { readonly label: string; readonly content: string }[];
  readonly issuedAt: Date;
  /** The BUYER's language, from their own messages — not the owner's setting. */
  readonly locale: Locale;
};

/**
 * Issue (or re-issue) the link for a quote, in a transaction of this route's
 * own. G11 — the minting itself moved to `db/proofs.ts` so the TURN can do it
 * in the transaction that writes the quote; this is the owner's way in, and
 * both reach the same writer.
 */
export async function issueProofLink(
  db: Db, businessIdRaw: string, quoteId: string,
): Promise<{ token: string } | null> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return null;
  return withTenantTx(db, bid.value, (tx) => issueProofLinkTx(tx, bid.value, quoteId));
}

/**
 * Revoke a link. The row stays — archive-never-erase — and the resolver stops
 * returning it, so the page becomes indistinguishable from one that never
 * existed.
 */
export async function revokeProofLink(
  db: Db, businessIdRaw: string, token: string,
): Promise<{ revoked: boolean }> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { revoked: false };
  return withTenantTx(db, bid.value, async (tx) => {
    const r = await sql<{ token: string }>`
      update quote_proofs set revoked_at = now()
       where token = ${token} and business_id = ${bid.value}::uuid and revoked_at is null
      returning token`.execute(tx);
    return { revoked: r.rows[0] !== undefined };
  });
}

/**
 * Resolve a token and build the buyer's view, or null.
 *
 * NULL IS THE ONLY FAILURE. Unknown token, revoked token, deleted quote — every
 * one returns null and the route answers 404. A 403 would confirm the quote
 * exists, which is an oracle: it tells whoever is guessing that they guessed
 * correctly and were merely unauthorised.
 */
export async function loadProof(db: Db, token: string): Promise<ProofView | null> {
  // Public: no session, so no tenant context yet. One SECURITY DEFINER function
  // resolves the token to its tenant and returns no quote data — the same
  // bootstrap the inbound webhook uses. Everything after runs under RLS.
  const resolved = await sql<{ business_id: string; quote_id: string; conversation_id: string | null }>`
    select business_id, quote_id, conversation_id from resolve_quote_proof(${token})
  `.execute(db);
  const r = resolved.rows[0];
  if (!r) return null;

  const bid = parseBusinessId(r.business_id);
  if (!bid.ok) return null;

  return withTenantTx(db, bid.value, async (tx): Promise<ProofView | null> => {
    // NOTE the columns: no `inputs`, so the policy snapshot never loads.
    //
    // G5 — the lead time is the QUOTE's (`q.`), not the product's (`p.`). The
    // product's lead time is exactly the number M44 refused to state during
    // one of her closures; reading it here printed that refused date on the
    // buyer's own page, attributed to her catalogue. And the money is in the
    // quote's own currency: every price here used to be shown as dollars.
    const q = (await sql<{
      quantity: number; unit_price_usd: string; total_usd: string; currency: string; created_at: Date;
      product_id: string; name: string; name_zh: string | null; sku: string;
      unit: string; moq: number; lead_time_days: number | null;
      lead_time_withheld: { label?: unknown; from?: unknown; to?: unknown } | null; seller: string;
    }>`
      select q.quantity, q.unit_price_usd, q.total_usd, q.currency, q.created_at,
             p.id as product_id, p.name, p.name_zh, p.sku, p.unit, p.moq,
             q.lead_time_days, q.lead_time_withheld,
             b.name as seller
        from quotes q
        join products p on p.id = q.product_id
        join businesses b on b.id = q.business_id
       where q.id = ${r.quote_id}::uuid
    `.execute(tx)).rows[0];
    if (!q) return null;

    // The tier, re-read from price_tiers: quantities and prices, no policy.
    // G11 — and the band must CONTAIN his quantity. Reading only the lower
    // bound showed "5,000–19,999" to a buyer who ordered 20,000, so the page
    // that exists to prove the price stated a band the price did not come
    // from. `selectTier` has always respected the ceiling; this now agrees.
    const tier = (await sql<{ min_qty: number; max_qty: number | null }>`
      select min_qty, max_qty from price_tiers
       where product_id = ${q.product_id}::uuid and min_qty <= ${q.quantity}
         and (max_qty is null or max_qty >= ${q.quantity})
       order by min_qty desc limit 1
    `.execute(tx)).rows[0];

    // Certifications the owner AUTHORISED. `allowed` is the whole point: the
    // claims guard is default-deny, and this page shows only what passed it.
    const certs = (await sql<{ claim_key: string }>`
      select claim_key from claims_policy
       where business_id = ${bid.value}::uuid and kind = 'certification' and allowed
       order by claim_key
    `.execute(tx)).rows.map((c) => c.claim_key);

    // Taught facts actually used in this conversation, in the owner's words.
    const taught = r.conversation_id
      ? (await sql<{ label: string; content: string }>`
          -- The id list is a jsonb array on the event. A set-returning function
          -- cannot live in a JOIN condition (Postgres 0A000), so it is expanded
          -- in a LATERAL first and joined on the expanded value.
          select distinct pk.label, pk.content
            from conversation_events e
            cross join lateral jsonb_array_elements_text(coalesce(e.payload->'ids', '[]'::jsonb)) as kid(id)
            join product_knowledge pk on pk.id = kid.id::uuid
           where e.conversation_id = ${r.conversation_id}::uuid
             and e.type = 'knowledge_used'
             and pk.status = 'active'
             -- G11 — about THIS product, or about the business. A fact taught
             -- for another product is not evidence for this quote, and a page
             -- whose whole claim is provenance must not carry one.
             and (pk.product_id is null or pk.product_id = ${q.product_id}::uuid)
           order by pk.label limit 6
        `.execute(tx)).rows
      : [];

    // G18 — the price a BUYER relies on, in the currency it was quoted in.
    // The old `?? usd(...)` made an unpriceable row read as dollars on the one
    // page whose whole claim is that it states only what the quote said. A
    // currency this build cannot price is not a proof page: it reads as a link
    // that no longer resolves, which is the same fail-closed answer the page
    // already gives for a quote that is gone.
    const unitPrice = moneyFromRow(Number(q.unit_price_usd), q.currency);
    const total = moneyFromRow(Number(q.total_usd), q.currency);
    if (!unitPrice || !total) return null;

    const locale = await buyerLocale(tx, r.conversation_id);
    const zh = locale === 'zh' && q.name_zh ? q.name_zh : q.name;

    return {
      seller: q.seller,
      productName: zh,
      sku: q.sku,
      quantity: q.quantity,
      unit: q.unit,
      unitPrice,
      total,
      tier: tier ? { minQty: tier.min_qty, maxQty: tier.max_qty } : null,
      moq: q.moq,
      leadTimeDays: q.lead_time_days,
      leadTimeWithheld: q.lead_time_withheld && typeof q.lead_time_withheld.label === 'string'
        ? { label: q.lead_time_withheld.label,
            from: String(q.lead_time_withheld.from ?? ''), to: String(q.lead_time_withheld.to ?? '') }
        : null,
      certifications: certs,
      taught: taught.map((x) => ({ label: x.label, content: x.content })),
      issuedAt: q.created_at,
      locale,
    };
  });
}

/**
 * The BUYER's language, from the language detected on their own messages —
 * not the owner's interface setting. A page the buyer forwards to their boss
 * should be in the language the buyer wrote in.
 */
async function buyerLocale(tx: Tx, conversationId: string | null): Promise<Locale> {
  if (!conversationId) return DEFAULT_LOCALE;
  // G11 — what the turn remembered about HIM first (clients.preferred_language,
  // written from the analyser), then the language stamped on a message. Before
  // this, only voice notes and photos carried a detected language, so a buyer
  // who typed in Arabic got an English page about his own quote.
  const row = (await sql<{ lang: string | null }>`
    select coalesce(
             (select cl.preferred_language from conversations c
                join clients cl on cl.id = c.client_id
               where c.id = ${conversationId}::uuid),
             (select m.detected_language from messages m
               where m.conversation_id = ${conversationId}::uuid
                 and m.direction = 'inbound' and m.detected_language is not null
               order by m.sent_at desc limit 1)) as lang
  `.execute(tx)).rows[0];
  const lang = (row?.lang ?? '').slice(0, 2).toLowerCase();
  return (LOCALES as readonly string[]).includes(lang) ? lang as Locale : DEFAULT_LOCALE;
}

/** ── Renderer ─────────────────────────────────────────────────────────────
 *
 * Standalone: this page is not the owner's shell. It carries no nav, no
 * session, and no link back into the app, because a buyer who taps one would
 * hit a login screen and learn there is an app. It has to survive being
 * forwarded — readable with no context, on whatever phone the buyer's boss
 * uses.
 */
export function renderProof(v: ProofView): string {
  const l = v.locale;
  const name = EMPLOYEE_NAME[l];
  const dir = l === 'ar' ? 'rtl' : 'ltr';

  const sourceLabel = (s: FactSource): string =>
    t(l, `proof.source.${s}` as MessageKey, { name });

  // <bdi> isolates each value from the surrounding paragraph direction. Without
  // it an Arabic page renders "pcs 20,000" with the unit on the wrong side, and
  // an English sentence inside it loses its full stop to the left margin. Caught
  // by looking at the RTL screenshot, not by any test.
  const fact = (label: string, value: string): string =>
    `<div class="fact">
      <div class="f-l">${esc(label)}</div>
      <div class="f-v"><bdi>${esc(value)}</bdi></div>
    </div>`;

  const qty = `${v.quantity.toLocaleString('en-US')} ${v.unit}`;
  const tierText = v.tier
    ? (v.tier.maxQty === null
        ? t(l, 'proof.tier.from', { min: v.tier.minQty.toLocaleString('en-US'), unit: v.unit })
        : t(l, 'proof.tier.band', {
            min: v.tier.minQty.toLocaleString('en-US'),
            max: v.tier.maxQty.toLocaleString('en-US'), unit: v.unit }))
    : null;

  // Every fact in this group has the same source, so the attribution is stated
  // ONCE for the group rather than repeated under all six rows. Repetition was
  // honest and unreadable — six identical lines is noise, and noise is what the
  // owner's surfaces spent this month removing.
  const facts = [
    fact(t(l, 'proof.fact.quantity'), qty),
    fact(t(l, 'proof.fact.unitPrice'), formatMoney(v.unitPrice)),
    fact(t(l, 'proof.fact.total'), formatMoney(v.total)),
    ...(tierText ? [fact(t(l, 'proof.fact.tier'), tierText)] : []),
    fact(t(l, 'proof.fact.moq'), `${v.moq.toLocaleString('en-US')} ${v.unit}`),
    ...(v.leadTimeDays !== null
      ? [fact(t(l, 'proof.fact.leadTime'), t(l, 'proof.days', { n: v.leadTimeDays }))]
      // G5 — no date, and the page says WHY: her closure, in her words, with
      // the days it runs. Never the date a lead time would have promised.
      : v.leadTimeWithheld
        ? [fact(t(l, 'proof.fact.leadTime'), t(l, 'proof.leadTime.withheld', {
            label: v.leadTimeWithheld.label, from: v.leadTimeWithheld.from, to: v.leadTimeWithheld.to,
          }))]
        : []),
  ].join('') + `<div class="f-s group">${esc(sourceLabel('catalogue'))}</div>`;

  const certs = v.certifications.length
    ? `<section class="sec">
        <h2>${esc(t(l, 'proof.certs.title'))}</h2>
        <ul class="certs">${v.certifications.map((c) =>
          `<li>${esc(c)}<span class="f-s">${esc(sourceLabel('authorised'))}</span></li>`).join('')}</ul>
      </section>`
    : '';

  // Her taught knowledge is a PERSON's words — the second voice, as everywhere.
  const taught = v.taught.length
    ? `<section class="sec">
        <h2>${esc(t(l, 'proof.taught.title'))}</h2>
        ${v.taught.map((k) => `<div class="taught">
          <div class="f-l">${esc(k.label)}</div>
          <p class="voice"><bdi>${esc(k.content)}</bdi></p>
          <div class="f-s">${esc(sourceLabel('taught'))}</div>
        </div>`).join('')}
      </section>`
    : '';

  return `<!doctype html>
<html lang="${l}" dir="${dir}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(t(l, 'proof.title', { seller: v.seller }))}</title>
${PROOF_STYLE}
</head><body>
<main class="proof">
  <header class="head">
    <div class="seller">${esc(v.seller)}</div>
    <h1>${esc(v.productName)}</h1>
    <div class="sku">${esc(v.sku)}</div>
  </header>

  <section class="sec">
    <h2>${esc(t(l, 'proof.quote.title'))}</h2>
    <div class="facts">${facts}</div>
  </section>

  ${certs}
  ${taught}

  <footer class="foot">
    <p>${esc(t(l, 'proof.footer.explain', { name }))}</p>
    <p class="muted">${esc(t(l, 'proof.footer.issued', { date: v.issuedAt.toISOString().slice(0, 10) }))}</p>
  </footer>
</main>
</body></html>`;
}

const PROOF_STYLE = `<style>
${cssVariables()}
/*
 * M35 — the SAME design tokens as the owner's app, emitted into a standalone
 * document. The proof page is the factory's public face; a buyer forwarding it
 * should be forwarding something that looks like one product, and a second
 * hand-rolled palette here would drift from the first the week after it shipped.
 * tests/parity/shell.test.ts enforces exactly that: it caught this file
 * inventing its own --ink and --paper, correctly.
 */
  * { box-sizing:border-box; }
  body { margin:0; background:var(--color-paper); color:var(--color-ink);
         font: var(--font-size-base)/var(--line-height) var(--font-family);
         -webkit-text-size-adjust:100%; }
  .proof { max-width:var(--measure-prose); margin:0 auto; padding:var(--space-32) var(--space-16) var(--space-48); }
  .head { padding-bottom:var(--space-16); border-bottom:1px solid var(--color-border);
          margin-bottom:var(--space-24); }
  .seller { color:var(--color-ink-secondary); font-size:var(--font-size-note);
            letter-spacing:.4px; text-transform:uppercase; }
  h1 { font-size:var(--font-size-title); line-height:1.25; margin:var(--space-4) 0; font-weight:600; }
  .sku { color:var(--color-ink-secondary); font-size:var(--font-size-note); }
  .sec { margin:0 0 var(--space-24); }
  .sec h2 { font-size:var(--font-size-note); font-weight:600; color:var(--color-ink-secondary);
            margin:0 0 var(--space-12); letter-spacing:.3px; text-transform:uppercase; }
  .fact { display:flex; align-items:baseline; gap:var(--space-12); flex-wrap:wrap;
          padding:var(--space-8) 0; border-bottom:1px solid var(--color-border); }
  .fact:last-child { border-bottom:0; }
  .f-l { color:var(--color-ink-secondary); min-width:9rem; flex:0 0 auto; }
  .f-v { font-weight:600; flex:1 1 auto; }
  .f-s { color:var(--color-ink-secondary); font-size:var(--font-size-caption); }
  .f-s.group { padding-top:var(--space-8); }
  .certs { list-style:none; margin:0; padding:0; }
  .certs li { padding:var(--space-8) 0; border-bottom:1px solid var(--color-border); font-weight:600; }
  .certs .f-s { display:block; font-weight:400; margin-top:var(--space-4); }
  .certs li:last-child { border-bottom:0; }
  .taught { padding:var(--space-8) 0; border-bottom:1px solid var(--color-border); }
  .taught:last-child { border-bottom:0; }
  .voice { font-family:var(--font-voice); font-size:var(--font-size-small); margin:var(--space-4) 0; }
  .foot { margin-top:var(--space-32); padding-top:var(--space-16);
          border-top:1px solid var(--color-border);
          color:var(--color-ink-secondary); font-size:var(--font-size-note); }
  .foot p { margin:0 0 var(--space-4); }
  .muted { color:var(--color-ink-secondary); }
</style>`;

/**
 * M35.1 — what the OWNER needs to see beside a quote: is there a live link, and
 * which quote would one be issued for. Read-only.
 */
export type ProofLinkState = {
  readonly quoteId: string | null;
  readonly token: string | null;
};

export async function loadProofLinkState(tx: Tx, conversationId: string): Promise<ProofLinkState> {
  const q = (await sql<{ id: string }>`
    select id from quotes where conversation_id = ${conversationId}::uuid
     order by created_at desc limit 1`.execute(tx)).rows[0];
  if (!q) return { quoteId: null, token: null };
  const link = (await sql<{ token: string }>`
    select token from quote_proofs
     where quote_id = ${q.id}::uuid and revoked_at is null limit 1`.execute(tx)).rows[0];
  return { quoteId: q.id, token: link?.token ?? null };
}

/**
 * The 404 body. Says nothing: not whether the link ever existed, not whether it
 * was revoked, not which factory it belonged to. A helpful message here would
 * be the oracle the 404 exists to remove.
 */
export function notFoundPage(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Not found</title>
${PROOF_STYLE}
</head><body><main class="proof"><h1>Not found</h1>
<p class="muted">This link is not available.</p>
</main></body></html>`;
}
