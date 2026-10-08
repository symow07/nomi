import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { type MessageKey, claimName } from '../../core/owner/i18n/messages.js';
import { t, tn, assistantName } from './say.js';
import { formatList } from '../../core/owner/i18n/format.js';
import type { KnowledgeKind, KnowledgeSource } from '../../core/types/knowledge.js';
import { renderUsageFact, type UsageFact } from './knowledge-insights.js';
import { esc, back, deeper } from './layout.js';
import * as show from './values.js';
import { flashBanner, type Flash } from './flash.js';
import { GO } from './icons.js';

/**
 * M13 — the owner's teach/correct surface for factory knowledge.
 *
 * Descriptive facts (specs/materials/notes/answers/usage/restrictions) go to
 * product_knowledge. Certifications are NOT knowledge rows — the cert panel
 * writes claims_policy (the claims guard's allowlist), so teaching a cert both
 * records it AND authorises the employee to state it. Corrections ARCHIVE the
 * old row and add a new owner_corrected one (never delete, never overwrite).
 *
 * The warmth run, phase 9 (w4-products-knowledge-02) — ONE PLACE for each
 * fact. The certifications are what the business may claim, a fact about the
 * business: they are switched on My business › What you promise customers
 * (`certRows`, drawn there), and this page says which are on, with a door to
 * that screen. It no longer offers a second set of switches.
 */

/** Where the certifications are switched on and off: My business › What you promise customers. */
export const CERTS_HOME = '/app/business/promises';

const KINDS: readonly KnowledgeKind[] = [
  'specification', 'material', 'production_note', 'faq', 'buyer_answer', 'usage', 'restriction',
];
/** Phase 9 (V1-364) — what can be said of the business as a whole: no specifications or materials, which are a product's. */
const BUSINESS_KINDS: readonly KnowledgeKind[] = ['faq', 'buyer_answer', 'restriction'];

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Certification/compliance keys the claims guard recognises. */
const CERT_KEYS: readonly string[] = [
  'CE', 'FDA', 'RoHS', 'ISO9001', 'BSCI', 'food_grade', 'BPA_free', 'REACH', 'CPSIA',
];

export type KItem = {
  readonly id: string; readonly kind: KnowledgeKind;
  readonly label: string; readonly content: string; readonly source: KnowledgeSource;
};

export type ProductKnowledge = {
  readonly productId: string; readonly productName: string | null;
  /** Phase 9 (V1-375) — its Chinese name, which a Chinese page shows, as the product's own page does. */
  readonly productNameZh?: string | null;
  readonly items: readonly KItem[];
  readonly certs: readonly string[];   // active certification/compliance claim keys
  /**
   * M22 (F-03) — how many products a certification toggle on this page affects.
   * `claims_policy` has no product_id: it is BUSINESS-WIDE. Rendering it under
   * one product's name, with a hint saying "turned on here", read as if it
   * applied to that product alone. It never did. A real count, so the sentence
   * states the true scope instead of implying a false one.
   */
  readonly appliesToProducts: number;
};

export type KnowledgeIndex = {
  readonly products: readonly { readonly id: string; readonly name: string | null; readonly nameZh?: string | null; readonly count: number }[];
  readonly business: readonly KItem[];
  /** Phase 9 (V1-373) — the certifications, which apply to every product, live on this page: the ones on, and how many products they cover. */
  readonly certs?: readonly string[];
  readonly appliesToProducts?: number;
};

const rowToItem = (r: { id: string; kind: string; label: string; content: string; source: string }): KItem =>
  ({ id: r.id, kind: r.kind as KnowledgeKind, label: r.label, content: r.content, source: r.source as KnowledgeSource });

// ── loaders ──────────────────────────────────────────────────────────────────

export async function loadKnowledgeIndex(db: Db, businessIdRaw: string): Promise<KnowledgeIndex> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { products: [], business: [] };
  return withTenantTx(db, bid.value, async (tx) => {
    const products = (await sql<{ id: string; name: string | null; name_zh: string | null; count: number }>`
      select p.id, p.name, p.name_zh,
             (select count(*)::int from product_knowledge k where k.product_id = p.id and k.status='active') as count
        from products p where p.business_id = ${bid.value} and p.is_active
       order by p.name asc limit 200
    `.execute(tx)).rows.map((r) => ({ id: r.id, name: r.name, nameZh: r.name_zh, count: r.count }));
    const business = (await sql<{ id: string; kind: string; label: string; content: string; source: string }>`
      select id, kind, label, content, source from product_knowledge
       where business_id = ${bid.value} and product_id is null and status='active'
       order by created_at desc
    `.execute(tx)).rows.map(rowToItem);
    const certs = (await sql<{ claim_key: string }>`
      select claim_key from claims_policy
       where business_id = ${bid.value} and kind in ('certification','compliance') and allowed
    `.execute(tx)).rows.map((r) => r.claim_key);
    return { products, business, certs, appliesToProducts: products.length };
  });
}

export async function loadProductKnowledge(db: Db, businessIdRaw: string, productId: string): Promise<ProductKnowledge | null> {
  const bid = parseBusinessId(businessIdRaw);
  // Phase 9 (missed-03) — an address cut short is a product that is not here, never a broken page.
  if (!bid.ok || !UUID_SHAPE.test(productId)) return null;
  return withTenantTx(db, bid.value, async (tx) => {
    const head = (await sql<{ name: string | null; name_zh: string | null }>`
      select name, name_zh from products where id = ${productId} limit 1`.execute(tx)).rows[0];
    if (!head) return null;
    const items = (await sql<{ id: string; kind: string; label: string; content: string; source: string }>`
      select id, kind, label, content, source from product_knowledge
       where product_id = ${productId} and status='active' order by kind, created_at desc
    `.execute(tx)).rows.map(rowToItem);
    const certs = (await sql<{ claim_key: string }>`
      select claim_key from claims_policy
       where business_id = ${bid.value} and kind in ('certification','compliance') and allowed
    `.execute(tx)).rows.map((r) => r.claim_key);
    const appliesToProducts = Number((await sql<{ n: number }>`
      select count(*)::int as n from products where business_id = ${bid.value} and is_active
    `.execute(tx)).rows[0]?.n ?? 0);
    return { productId, productName: head.name, productNameZh: head.name_zh, items, certs, appliesToProducts };
  });
}

// ── mutations (owner teach/correct) ──────────────────────────────────────────

export type KnowledgeFlash = 'taught' | 'corrected' | 'archived' | 'cert';

export async function teachKnowledge(db: Db, businessIdRaw: string, input: {
  productId: string | null; kind: string; label: string; content: string;
}): Promise<{ code: KnowledgeFlash | 'invalid' }> {
  const bid = parseBusinessId(businessIdRaw);
  const label = input.label.trim(), content = input.content.trim();
  if (!bid.ok || !KINDS.includes(input.kind as KnowledgeKind) || !label || !content) return { code: 'invalid' };
  if (input.productId !== null && !PRODUCT_ID.test(input.productId)) return { code: 'invalid' };
  const taught = await withTenantTx(db, bid.value, async (tx) => {
    // The product must be this workspace's own. A foreign key looks past row security, so the insert alone would
    // take another business's product id (the IDOR audit, 2026-10-08).
    if (input.productId !== null) {
      const mine = await sql`select 1 from products where id = ${input.productId}::uuid and business_id = ${bid.value}`.execute(tx);
      if (mine.rows.length === 0) return false;
    }
    await sql`
      insert into product_knowledge (business_id, product_id, kind, label, content, source)
      values (${bid.value}, ${input.productId}, ${input.kind}, ${label}, ${content}, 'owner_confirmed')
    `.execute(tx);
    return true;
  });
  return { code: taught ? 'taught' : 'invalid' };
}
const PRODUCT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Correct = archive the old row, insert a new owner_corrected one that supersedes it. */
export async function correctKnowledge(db: Db, businessIdRaw: string, id: string, content: string): Promise<{ code: KnowledgeFlash | 'invalid' }> {
  const bid = parseBusinessId(businessIdRaw);
  const text = content.trim();
  if (!bid.ok || !text) return { code: 'invalid' };
  await withTenantTx(db, bid.value, async (tx) => {
    const old = (await sql<{ product_id: string | null; kind: string; label: string }>`
      select product_id, kind, label from product_knowledge where id = ${id} and status='active' for update
    `.execute(tx)).rows[0];
    if (!old) return;
    await sql`update product_knowledge set status='archived', updated_at=now() where id = ${id}`.execute(tx);
    await sql`
      insert into product_knowledge (business_id, product_id, kind, label, content, source, supersedes_id)
      values (${bid.value}, ${old.product_id}, ${old.kind}, ${old.label}, ${text}, 'owner_corrected', ${id})
    `.execute(tx);
  });
  return { code: 'corrected' };
}

export async function archiveKnowledge(db: Db, businessIdRaw: string, id: string): Promise<{ code: KnowledgeFlash | 'invalid' }> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { code: 'invalid' };
  await withTenantTx(db, bid.value, (tx) =>
    sql`update product_knowledge set status='archived', updated_at=now() where id = ${id} and status='active'`.execute(tx));
  return { code: 'archived' };
}

/**
 * Phase 5 — Undo: an archived fact is one the assistant knows again — unless
 * it was archived by a correction (a newer version names it), which is not
 * this button's to reverse. The product it belongs to, for the way back.
 */
export async function restoreKnowledge(
  db: Db, businessIdRaw: string, id: string,
): Promise<{ code: 'restored' | 'invalid'; productId: string | null }> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { code: 'invalid', productId: null };
  return withTenantTx(db, bid.value, async (tx) => {
    const r = await sql<{ product_id: string | null }>`
      update product_knowledge k set status = 'active', updated_at = now()
       where k.id = ${id}::uuid and k.status = 'archived'
         and not exists (select 1 from product_knowledge n where n.supersedes_id = k.id)
      returning k.product_id`.execute(tx);
    const row = r.rows[0];
    return row ? { code: 'restored' as const, productId: row.product_id } : { code: 'invalid' as const, productId: null };
  });
}

/** Certifications live in claims_policy. Toggle authorises/withdraws the claim. */
export async function setCertification(db: Db, businessIdRaw: string, key: string, allowed: boolean): Promise<{ code: KnowledgeFlash | 'invalid' }> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok || !CERT_KEYS.includes(key)) return { code: 'invalid' };
  const kind = key === 'REACH' || key === 'CPSIA' ? 'compliance' : 'certification';
  await withTenantTx(db, bid.value, (tx) => sql`
    insert into claims_policy (business_id, kind, claim_key, allowed)
    values (${bid.value}, ${kind}, ${key}, ${allowed})
    on conflict (business_id, kind, claim_key) do update set allowed = ${allowed}, updated_at = now()
  `.execute(tx));
  return { code: 'cert' };
}

// ── renderers (pure, localized, escaped) ─────────────────────────────────────

const kindLabel = (l: Locale, k: KnowledgeKind) => t(l, `knowledge.kind.${k}` as MessageKey);
const sourceLabel = (l: Locale, s: KnowledgeSource) => t(l, `knowledge.source.${s}` as MessageKey);

/** A product's name as the page's language shows it: its Chinese name on a Chinese page (V1-361, V1-375). */
const shownName = (l: Locale, name: string | null, nameZh: string | null | undefined): string =>
  (l === 'zh' ? nameZh ?? name : name) ?? '—';
const COLLATE: Record<Locale, string> = { en: 'en', zh: 'zh-CN', ar: 'ar', es: 'es', fr: 'fr' };

function kindSelect(l: Locale, kinds: readonly KnowledgeKind[]): string {
  return `<select name="kind" id="teach-kind">${kinds.map((k) => `<option value="${k}">${esc(kindLabel(l, k))}</option>`).join('')}</select>`;
}

/**
 * The warmth run, phase 9 (w4-products-knowledge-14) — a name inside a
 * sentence: "Turn on food-safe materials…", "Activer marquage CE…" — never a
 * capital in the middle of a question. A name that starts with an initialism
 * ("CE marking", "BPA free", "ISO 9001…") keeps its capitals.
 */
const inSentence = (l: Locale, name: string): string =>
  (l === 'en' || l === 'es' || l === 'fr') && /^\p{Lu}\p{Ll}/u.test(name) ? name.charAt(0).toLocaleLowerCase(l) + name.slice(1) : name;

/**
 * Phase 9 (V1-371, V1-372, new-18, V1-374, missed-19) — each certification is
 * a row: its name in words ("Food-safe materials", never "food_grade"), whether
 * it is on (✓ On, or Off — in words, not only in green), and a button that
 * says what pressing it does. The ask-first dialog's own button repeats that
 * word, so it reads "Turn on", never the code.
 *
 * The warmth run, phase 9 (w4-products-knowledge-02) — drawn on My business ›
 * What you promise customers, the one place they are switched.
 */
export function certRows(l: Locale, certs: readonly string[], n: number, productId = ''): string {
  return `<ul class="rows certlist">${CERT_KEYS.map((k) => {
    const on = certs.includes(k);
    const label = claimName(l, k);
    const q = t(l, on ? 'knowledge.cert.confirmOff' : 'knowledge.cert.confirmOn', { key: inSentence(l, label), n });
    return `<li class="row">
      <span class="cert-name"><b><bdi>${esc(label)}</bdi></b> <span class="pill${on ? ' ok' : ''}">${esc(t(l, on ? 'knowledge.cert.on' : 'knowledge.cert.off'))}</span></span>
      <form method="post" action="/app/knowledge/cert" class="inline">
        <input type="hidden" name="productId" value="${esc(productId)}" />
        <input type="hidden" name="key" value="${esc(k)}" />
        <input type="hidden" name="allowed" value="${on ? '0' : '1'}" />
        <button class="btn" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(q)}">${esc(t(l, on ? 'knowledge.cert.turnOff' : 'knowledge.cert.turnOn'))}</button>
      </form></li>`;
  }).join('')}</ul>`;
}

/**
 * The certifications on this page and a product's: which are on, said once, and
 * the door to the one place they are switched (w4-products-knowledge-02).
 */
function certsSaid(locale: Locale, certs: readonly string[]): string {
  const on = CERT_KEYS.filter((k) => certs.includes(k)).map((k) => claimName(locale, k));
  return `<p class="fdesc">${esc(on.length ? t(locale, 'knowledge.cert.onHere', { list: formatList(locale, on) }) : t(locale, 'knowledge.cert.noneHere'))}</p>`;
}

export function renderKnowledgeIndex(data: KnowledgeIndex, locale: Locale, prefill = ''): string {
  // Phase 9 (V1-361) — each product by the name the reader's Products page shows, in the reader's order.
  const collator = new Intl.Collator(COLLATE[locale]);
  const sorted = [...data.products].sort((a, b) => collator.compare(shownName(locale, a.name, a.nameZh), shownName(locale, b.name, b.nameZh)));
  // Phase 9 (V1-360) — each row says what its number counts.
  // The warmth run, phase 9 (w4-products-knowledge-06) — each product is a menu
  // row, as on every settings menu: the name, what is taught on the line under
  // it (never run into the name, never cut on a phone), then the chevron.
  const products = sorted.length
    ? `<ul class="scard kmenu">${sorted.map((p) => `<li><a class="srow sr-menu sr-two" href="/app/knowledge/${encodeURIComponent(p.id)}">
          <span class="sr-main"><span class="sr-label"><bdi>${esc(shownName(locale, p.name, p.nameZh))}</bdi></span>
          <span class="sr-desc">${esc(p.count > 0 ? tn(locale, 'knowledge.product.facts', p.count) : t(locale, 'knowledge.product.none'))}</span></span>
          ${GO}</a></li>`).join('')}</ul>`
    : `<div class="empty">${esc(t(locale, 'knowledge.empty'))}</div>`;

  const biz = data.business.map((i) => itemCard(i, locale, null)).join('');
  // CC-20 — no title of its own: this is the second half of the knowledge page,
  // under the one <h1> the page's first half draws (`renderKnowledgeOps`), which
  // carries this page's lede too. It printed the same title a second time.
  // w4-products-knowledge-04 — the list is called what its own page is called: Products.
  return `
    <div class="block"><h2>${esc(t(locale, 'nav.products'))}</h2>${products}</div>
    <div class="block"><h2>${esc(t(locale, 'knowledge.business'))}</h2>
      ${biz || `<div class="empty">${esc(t(locale, 'knowledge.empty'))}</div>`}
      ${teachForm(locale, '', prefill, BUSINESS_KINDS)}
    </div>
    <div class="block" id="certs"><h2>${esc(t(locale, 'knowledge.cert.title'))}</h2>
      ${certsSaid(locale, data.certs ?? [])}
      ${deeper(CERTS_HOME, t(locale, 'factory.promise.title'))}
    </div>
    `;
}

function itemCard(i: KItem, locale: Locale, productId: string | null, usageHtml = ''): string {
  const pid = esc(productId ?? '');
  return `<div class="kitem">
    <div class="kh"><b>${esc(i.label)}</b> <span class="pill">${esc(kindLabel(locale, i.kind))}</span>
      <span class="muted src">${esc(sourceLabel(locale, i.source))}</span></div>
    <div class="kc">${esc(i.content)}</div>
    ${usageHtml}
    <form method="post" action="/app/knowledge/correct" class="krow-actions">
      <input type="hidden" name="id" value="${esc(i.id)}" />
      <input type="hidden" name="productId" value="${pid}" />
      <textarea name="content" rows="2" aria-label="${esc(t(locale, 'knowledge.correct'))}" placeholder="${esc(t(locale, 'knowledge.correct'))}">${esc(i.content)}</textarea>
      <div class="kbtns">
        <button class="btn" type="submit">${esc(t(locale, 'knowledge.correct.save'))}</button>
      </div>
    </form>
    <form method="post" action="/app/knowledge/archive" class="inline">
      <input type="hidden" name="id" value="${esc(i.id)}" />
      <input type="hidden" name="productId" value="${pid}" />
      <button class="btn ghost" type="submit">${esc(t(locale, 'knowledge.archive'))}</button>
    </form>
  </div>`;
}

/**
 * Phase 9 (V1-363, V1-368, V1-377) — the teach form is the product's own form:
 * each field's name is its label, in the page's size, attached to the field.
 */
function teachForm(locale: Locale, productId: string, prefill = '', kinds: readonly KnowledgeKind[] = KINDS): string {
  return `<form method="post" action="/app/knowledge/teach" class="pform teach">
    <input type="hidden" name="productId" value="${esc(productId)}" />
    <h3 class="sub3">${esc(t(locale, 'knowledge.teach'))}</h3>
    <label class="pq"><span>${esc(t(locale, 'knowledge.teach.kind'))}</span>${kindSelect(locale, kinds)}</label>
    <label class="pq"><span>${esc(t(locale, 'knowledge.teach.label'))}</span>
      <input type="text" name="label" required maxlength="120" value="${esc(prefill)}" /></label>
    <label class="pq"><span>${esc(t(locale, 'knowledge.teach.content'))}</span>
      <textarea name="content" rows="3" required></textarea></label>
    <button class="btn send" type="submit">${esc(t(locale, 'knowledge.teach.add'))}</button>
  </form>`;
}

export function renderProductKnowledge(
  d: ProductKnowledge, locale: Locale, flash: Flash | null,
  opts: { usage?: Map<string, UsageFact>; prefill?: string; now?: Date } = {},
): string {
  const now = opts.now ?? new Date();
  const flashHtml = flashBanner(flash);
  const name = assistantName(locale);
  const title = shownName(locale, d.productName, d.productNameZh);
  const items = d.items.length
    ? d.items.map((i) => itemCard(i, locale, d.productId, renderUsageFact(opts.usage?.get(i.id), locale, now))).join('')
    : `<div class="empty">${esc(t(locale, 'knowledge.empty'))}</div>`;
  // Phase 9 (V1-373) — a setting for every product is not on one product's page:
  // which certifications are on is said here, and changed where they all are
  // (My business › What you promise customers, w4-products-knowledge-02).

  // Phase 9 (V1-377, V1-378) — the back link names the page it opens, and stands
  // above the title, as on the product's own page; V1-376 — and that page is a door away.
  // The warmth run, phase 9 (new-17) — the page's one measure (`.kpage`), as on Knowledge itself.
  return `<div class="kpage">
    ${back('/app/knowledge', t(locale, 'nav.knowledge'))}
    <h1 class="page"><bdi>${esc(title)}</bdi></h1>
    ${flashHtml}
    <div class="block">
      <h2>${esc(t(locale, 'knowledge.taught.title', { name }))}</h2>
      <p class="scope">${esc(t(locale, 'knowledge.taught.scope', { product: title }))}</p>
      ${items}${teachForm(locale, d.productId, opts.prefill ?? '')}</div>
    <div class="block"><h2>${esc(t(locale, 'knowledge.cert.title'))}</h2>
      ${certsSaid(locale, d.certs)}
      <div class="doors">${deeper(CERTS_HOME, t(locale, 'factory.promise.title'))}
        ${deeper(`/app/products/${encodeURIComponent(d.productId)}`, t(locale, 'knowledge.productDoor'))}</div>
    </div>
    </div>`;
}
