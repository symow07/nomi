import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../core/owner/i18n/messages.js';
import type { KnowledgeKind, KnowledgeSource } from '../../core/types/knowledge.js';
import { renderUsageFact, type UsageFact } from './knowledge-insights.js';
import { esc } from './layout.js';

/**
 * M13 — the owner's teach/correct surface for factory knowledge.
 *
 * Descriptive facts (specs/materials/notes/answers/usage/restrictions) go to
 * product_knowledge. Certifications are NOT knowledge rows — the cert panel
 * writes claims_policy (the claims guard's allowlist), so teaching a cert both
 * records it AND authorises the employee to state it. Corrections ARCHIVE the
 * old row and add a new owner_corrected one (never delete, never overwrite).
 */

const KINDS: readonly KnowledgeKind[] = [
  'specification', 'material', 'production_note', 'faq', 'buyer_answer', 'usage', 'restriction',
];

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
  readonly items: readonly KItem[];
  readonly certs: readonly string[];   // active certification/compliance claim keys
};

export type KnowledgeIndex = {
  readonly products: readonly { readonly id: string; readonly name: string | null; readonly count: number }[];
  readonly business: readonly KItem[];
};

const rowToItem = (r: { id: string; kind: string; label: string; content: string; source: string }): KItem =>
  ({ id: r.id, kind: r.kind as KnowledgeKind, label: r.label, content: r.content, source: r.source as KnowledgeSource });

// ── loaders ──────────────────────────────────────────────────────────────────

export async function loadKnowledgeIndex(db: Db, businessIdRaw: string): Promise<KnowledgeIndex> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { products: [], business: [] };
  return withTenantTx(db, bid.value, async (tx) => {
    const products = (await sql<{ id: string; name: string | null; count: number }>`
      select p.id, p.name,
             (select count(*)::int from product_knowledge k where k.product_id = p.id and k.status='active') as count
        from products p where p.business_id = ${bid.value} and p.is_active
       order by p.name asc limit 200
    `.execute(tx)).rows;
    const business = (await sql<{ id: string; kind: string; label: string; content: string; source: string }>`
      select id, kind, label, content, source from product_knowledge
       where business_id = ${bid.value} and product_id is null and status='active'
       order by created_at desc
    `.execute(tx)).rows.map(rowToItem);
    return { products, business };
  });
}

export async function loadProductKnowledge(db: Db, businessIdRaw: string, productId: string): Promise<ProductKnowledge | null> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return null;
  return withTenantTx(db, bid.value, async (tx) => {
    const head = (await sql<{ name: string | null }>`
      select name from products where id = ${productId} limit 1`.execute(tx)).rows[0];
    if (!head) return null;
    const items = (await sql<{ id: string; kind: string; label: string; content: string; source: string }>`
      select id, kind, label, content, source from product_knowledge
       where product_id = ${productId} and status='active' order by kind, created_at desc
    `.execute(tx)).rows.map(rowToItem);
    const certs = (await sql<{ claim_key: string }>`
      select claim_key from claims_policy
       where business_id = ${bid.value} and kind in ('certification','compliance') and allowed
    `.execute(tx)).rows.map((r) => r.claim_key);
    return { productId, productName: head.name, items, certs };
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
  await withTenantTx(db, bid.value, (tx) => sql`
    insert into product_knowledge (business_id, product_id, kind, label, content, source)
    values (${bid.value}, ${input.productId}, ${input.kind}, ${label}, ${content}, 'owner_confirmed')
  `.execute(tx));
  return { code: 'taught' };
}

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

function kindSelect(l: Locale): string {
  return `<select name="kind">${KINDS.map((k) => `<option value="${k}">${esc(kindLabel(l, k))}</option>`).join('')}</select>`;
}

export function renderKnowledgeIndex(data: KnowledgeIndex, locale: Locale, prefill = ''): string {
  const products = data.products.length
    ? `<div class="klist">${data.products.map((p) => `
        <a class="krow" href="/app/knowledge/${encodeURIComponent(p.id)}">
          <span>${esc(p.name ?? '—')}</span><span class="muted">${p.count}</span>
        </a>`).join('')}</div>`
    : `<div class="empty muted">${esc(t(locale, 'knowledge.empty'))}</div>`;

  const biz = data.business.map((i) => itemCard(i, locale, null)).join('');
  return `
    <h1 class="page">${esc(t(locale, 'knowledge.title'))}</h1>
    <p class="muted">${esc(t(locale, 'knowledge.intro'))}</p>
    <div class="card"><h2>${esc(t(locale, 'knowledge.products'))}</h2>${products}</div>
    <div class="card"><h2>${esc(t(locale, 'knowledge.business'))}</h2>
      ${biz || `<div class="empty muted">${esc(t(locale, 'knowledge.empty'))}</div>`}
      ${teachForm(locale, '', prefill)}
    </div>
    ${KNOWLEDGE_STYLE}`;
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
      <textarea name="content" rows="2" placeholder="${esc(t(locale, 'knowledge.correct'))}">${esc(i.content)}</textarea>
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

function teachForm(locale: Locale, productId: string, prefill = ''): string {
  return `<form method="post" action="/app/knowledge/teach" class="teach">
    <input type="hidden" name="productId" value="${esc(productId)}" />
    <h3>${esc(t(locale, 'knowledge.teach'))}</h3>
    <label class="muted">${esc(t(locale, 'knowledge.teach.kind'))}</label>${kindSelect(locale)}
    <label class="muted">${esc(t(locale, 'knowledge.teach.label'))}</label>
    <input type="text" name="label" required maxlength="120" value="${esc(prefill)}" />
    <label class="muted">${esc(t(locale, 'knowledge.teach.content'))}</label>
    <textarea name="content" rows="3" required></textarea>
    <button class="btn send" type="submit">${esc(t(locale, 'knowledge.teach.add'))}</button>
  </form>`;
}

export function renderProductKnowledge(
  d: ProductKnowledge, locale: Locale, flash: string | null,
  opts: { usage?: Map<string, UsageFact>; prefill?: string; now?: Date } = {},
): string {
  const now = opts.now ?? new Date();
  const flashHtml = flash ? `<div class="flash" role="status">${esc(flash)}</div>` : '';
  const items = d.items.length
    ? d.items.map((i) => itemCard(i, locale, d.productId, renderUsageFact(opts.usage?.get(i.id), locale, now))).join('')
    : `<div class="empty muted">${esc(t(locale, 'knowledge.empty'))}</div>`;

  const certs = CERT_KEYS.map((k) => {
    const on = d.certs.includes(k);
    return `<form method="post" action="/app/knowledge/cert" class="inline certtoggle">
      <input type="hidden" name="productId" value="${esc(d.productId)}" />
      <input type="hidden" name="key" value="${esc(k)}" />
      <input type="hidden" name="allowed" value="${on ? '0' : '1'}" />
      <button class="cert ${on ? 'on' : ''}" type="submit">${on ? '✓ ' : ''}${esc(k)}</button>
    </form>`;
  }).join('');

  return `
    <div class="dhead"><a class="back" href="/app/knowledge">${esc(t(locale, 'knowledge.back'))}</a>
      <h1 class="page">${esc(d.productName ?? '—')}</h1></div>
    ${flashHtml}
    <div class="card"><h2>${esc(t(locale, 'knowledge.cert.title'))}</h2>
      <p class="muted">${esc(t(locale, 'knowledge.cert.hint'))}</p>
      <div class="certs">${certs}</div>
    </div>
    <div class="card">${items}${teachForm(locale, d.productId, opts.prefill ?? '')}</div>
    ${KNOWLEDGE_STYLE}`;
}

const KNOWLEDGE_STYLE = `<style>
  .klist { display:flex; flex-direction:column; gap:8px; }
  .krow { display:flex; justify-content:space-between; background:#0f1216; border:1px solid #23272e; border-radius:10px; padding:12px 16px; }
  .krow:hover { border-color:#3a4250; }
  .kitem { border:1px solid #23272e; border-radius:12px; padding:14px; margin-bottom:12px; }
  .kh { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .kh .src { margin-inline-start:auto; font-size:12px; }
  .kc { margin:8px 0; white-space:pre-wrap; }
  .pill { background:#1b2430; color:#93c5fd; border-radius:999px; padding:3px 10px; font-size:12px; }
  .teach, .krow-actions { display:flex; flex-direction:column; gap:8px; margin-top:10px; }
  .teach h3 { margin:0; font-size:14px; }
  input[type=text], textarea, select { width:100%; background:#0f1216; border:1px solid #2b313a; border-radius:10px; color:#fff; padding:9px 12px; font:inherit; }
  .kbtns { display:flex; gap:8px; }
  .btn { padding:9px 16px; border:0; border-radius:9px; background:#2a313c; color:#fff; font-size:14px; font-weight:600; cursor:pointer; }
  .btn.send { background:#2563eb; } .btn.ghost { background:transparent; border:1px solid #2b313a; color:#b9c0c9; }
  .inline { display:inline; } .certs { display:flex; flex-wrap:wrap; gap:8px; }
  .cert { padding:8px 14px; border-radius:999px; border:1px solid #2b313a; background:#0f1216; color:#b9c0c9; cursor:pointer; font-size:13px; }
  .cert.on { background:#0f2e1c; color:#4ade80; border-color:#1f5a3a; }
  .flash { background:#0f2e1c; color:#4ade80; border-radius:10px; padding:10px 14px; margin-bottom:14px; }
  .dhead { display:flex; align-items:center; gap:12px; } .back { color:#60a5fa; font-size:14px; }
  .empty { text-align:center; padding:24px; }
  button:focus-visible, a:focus-visible, textarea:focus-visible, input:focus-visible, select:focus-visible { outline:2px solid #60a5fa; outline-offset:2px; }
</style>`;
