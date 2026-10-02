import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { allowanceOf, allowanceUsed } from '../../db/allowance.js';
import { pageText, containFacts, type PageFact } from '../../core/owner/pageFacts.js';
import { StoreFetchError, type StoreFetcher } from '../../net/publicFetch.js';
import type { PageFactsReader } from '../../llm/ports.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { t } from './say.js';
import { esc, back } from './layout.js';
import { flashBanner, type Flash } from './flash.js';
import * as show from './values.js';

/**
 * EXT — A PAGE OF HER SITE, LEARNED LINE BY LINE.
 *
 * She gives the address of her shipping, returns, payment or care page (or
 * pastes its text). The page is fetched as any public page is (no private
 * address, ten seconds, five megabytes), read as text, and the model proposes
 * facts with the sentence each came from; a quote the page does not hold is
 * dropped (`containFacts`). The proposal is kept; NOTHING is written until she
 * ticks lines — none is ticked for her — and only those become her knowledge
 * (business-level, her own words confirmed), on the audit trail.
 */
export type PageFactsRefusal = 'not_an_address' | 'not_public' | 'unreachable' | 'too_large' | 'not_a_page'
  | 'nothing_read' | 'allowance_used' | 'reader_failed' | 'not_configured';

export type Proposal = {
  readonly id: string; readonly source: string; readonly lines: readonly (PageFact & { readonly key: string })[];
  readonly createdAt: Date; readonly decidedAt: Date | null; readonly written: number | null;
};

/** "myshop.com/pages/shipping" → a public https address; null when it is not one. */
export function pageAddress(raw: string): string | null {
  const v = raw.trim();
  if (!v || v.length > 500) return null;
  let url: URL;
  try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`); } catch { return null; }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null;
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(url.hostname)) return null;
  return url.toString();
}

export async function startPageFacts(
  db: Db, businessIdRaw: string, actor: string,
  deps: {
    readonly fetcher: StoreFetcher;
    readonly reader?: PageFactsReader | undefined;
    readonly spent?: ((u: { llmCalls: number; inputTokens: number; outputTokens: number }) => Promise<void>) | undefined;
  },
  input: { readonly address: string; readonly text: string },
): Promise<{ readonly ok: true; readonly id: string } | { readonly ok: false; readonly reason: PageFactsRefusal }> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { ok: false, reason: 'unreachable' };
  if (!deps.reader) return { ok: false, reason: 'not_configured' };
  let text: string; let source: string;
  if (input.text.trim()) {
    text = pageText(input.text);
    source = 'pasted';
  } else {
    const url = pageAddress(input.address);
    if (!url) return { ok: false, reason: 'not_an_address' };
    try {
      const page = await deps.fetcher.get(url);
      if (page.status < 200 || page.status >= 300 || !/html|text\/plain/i.test(page.contentType)) return { ok: false, reason: 'not_a_page' };
      text = pageText(page.body);
    } catch (e) {
      const why = e instanceof StoreFetchError ? e.reason : 'unreachable';
      return { ok: false, reason: why === 'not_public' ? 'not_public' : why === 'too_large' ? 'too_large' : 'unreachable' };
    }
    source = url;
  }
  if (text.length < 20) return { ok: false, reason: 'nothing_read' };
  const allowance = await withTenantTx(db, bid.value, (tx) => allowanceOf(tx));
  if (allowanceUsed(allowance)) return { ok: false, reason: 'allowance_used' };
  let read: Awaited<ReturnType<PageFactsReader['read']>>;
  try {
    read = await deps.reader.read({ text });
  } catch {
    return { ok: false, reason: 'reader_failed' };
  }
  await deps.spent?.({ llmCalls: 1, inputTokens: read.usage.inputTokens, outputTokens: read.usage.outputTokens });
  const facts = containFacts(read.facts, text);
  if (facts.length === 0) return { ok: false, reason: 'nothing_read' };
  const lines = facts.map((f, i) => ({ key: `f${i + 1}`, ...f }));
  const id = await withTenantTx(db, bid.value, async (tx) => (await sql<{ id: string }>`
    insert into knowledge_proposals (business_id, source, lines, created_by)
    values (${bid.value}, ${source.slice(0, 500)}, ${JSON.stringify(lines)}::jsonb, ${actor.slice(0, 120)})
    returning id::text as id`.execute(tx)).rows[0]!.id);
  return { ok: true, id };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadProposal(db: Db, businessIdRaw: string, id: string): Promise<Proposal | null> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok || !UUID.test(id)) return null;
  const r = await withTenantTx(db, bid.value, async (tx) => (await sql<{ id: string; source: string; lines: unknown; created_at: Date; decided_at: Date | null; written: number | null }>`
    select id::text as id, source, lines, created_at, decided_at, written from knowledge_proposals
     where business_id = ${bid.value} and id = ${id}::uuid`.execute(tx)).rows[0]);
  if (!r) return null;
  const lines = (Array.isArray(r.lines) ? r.lines : []).flatMap((x: unknown) => {
    const o = (typeof x === 'object' && x !== null ? x : {}) as Record<string, unknown>;
    return typeof o['key'] === 'string' && typeof o['fact'] === 'string' && typeof o['quote'] === 'string'
      ? [{ key: o['key'], fact: o['fact'], quote: o['quote'] }] : [];
  });
  return { id: r.id, source: r.source, lines, createdAt: r.created_at, decidedAt: r.decided_at, written: r.written };
}

/** Only the ticked lines become knowledge; none ticked writes nothing. Once decided, a proposal is closed. */
export async function confirmPageFacts(
  db: Db, businessIdRaw: string, id: string, actor: string, ticked: readonly string[], label: string,
): Promise<{ readonly kind: 'written'; readonly n: number } | { readonly kind: 'none_ticked' } | { readonly kind: 'gone' }> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok || !UUID.test(id)) return { kind: 'gone' };
  return withTenantTx(db, bid.value, async (tx) => {
    const p = (await sql<{ lines: unknown; decided_at: Date | null }>`
      select lines, decided_at from knowledge_proposals where business_id = ${bid.value} and id = ${id}::uuid for update`.execute(tx)).rows[0];
    if (!p || p.decided_at) return { kind: 'gone' } as const;
    const want = new Set(ticked);
    const lines = (Array.isArray(p.lines) ? p.lines : []) as { key?: unknown; fact?: unknown }[];
    const chosen = lines.filter((l) => typeof l.key === 'string' && want.has(l.key) && typeof l.fact === 'string');
    if (chosen.length === 0) return { kind: 'none_ticked' } as const;
    for (const l of chosen) {
      await sql`insert into product_knowledge (business_id, product_id, kind, label, content, source)
                values (${bid.value}, null, 'faq', ${label.slice(0, 200)}, ${String(l.fact)}, 'owner_confirmed')`.execute(tx);
    }
    await sql`update knowledge_proposals set decided_at = now(), written = ${chosen.length} where business_id = ${bid.value} and id = ${id}::uuid`.execute(tx);
    await sql`insert into channel_audit (business_id, channel_id, action, actor, detail)
              values (${bid.value}, null, 'knowledge_imported', ${actor}, ${JSON.stringify({ proposal: id, written: chosen.length, of: lines.length })}::jsonb)`.execute(tx);
    return { kind: 'written', n: chosen.length } as const;
  });
}

/**
 * The form, on the knowledge page: an address, or the page's text pasted.
 * Phase 6 — a page that came to nothing says why UNDER THE FIELD, on the
 * knowledge page itself, with what was typed still in it; it was a page of its
 * own ("Nothing was read") that lost the address.
 */
export type PageFactsKept = { readonly address: string; readonly text: string; readonly reason: PageFactsRefusal };
export function renderPageFactsForm(locale: Locale, kept: PageFactsKept | null = null): string {
  const bad = kept ? ' aria-invalid="true" aria-describedby="pf-err" autofocus' : '';
  return `<div class="block" id="from-page">
    <h2>${esc(t(locale, 'pageFacts.title'))}</h2>
    ${/* Phase 9 (V1-365) — the section's description at the lede's size, its field as wide as the teach form's. */ ''}
    <p class="fdesc">${esc(t(locale, 'pageFacts.intro'))}</p>
    <form method="post" action="/app/knowledge/from-page" class="pform">
      <label class="pq" for="pf-address"><span>${esc(t(locale, 'pageFacts.address'))}</span></label>
      <input id="pf-address" type="text" name="address" inputmode="url" autocapitalize="none" spellcheck="false" dir="ltr" maxlength="500" placeholder="myshop.com/pages/shipping"${
        kept ? ` value="${esc(kept.address)}"` : ''}${kept && !kept.text ? bad : ''} />
      ${kept ? `<p class="perr" role="alert" id="pf-err">${esc(t(locale, `pageFacts.refused.${kept.reason}` as MessageKey))}</p>` : ''}
      <details${kept?.text ? ' open' : ''}><summary>${esc(t(locale, 'pageFacts.pasteInstead'))}</summary>
        <textarea name="text" rows="6" dir="auto" maxlength="60000" aria-label="${esc(t(locale, 'pageFacts.pasteInstead'))}"${kept?.text ? bad : ''}>${esc(kept?.text ?? '')}</textarea></details>
      <button class="btn" type="submit">${esc(t(locale, 'pageFacts.read'))}</button>
    </form>
  </div>`;
}

/** The proposal: each line with the sentence it came from; none ticked. */
export function renderProposal(p: Proposal, locale: Locale, flash: Flash | null): string {
  const head = `${back('/app/knowledge', t(locale, 'nav.knowledge'))}
    <h1 class="page">${esc(t(locale, 'pageFacts.reviewTitle'))}</h1>
    ${flashBanner(flash)}
    <p class="muted">${esc(t(locale, 'pageFacts.from', { source: p.source === 'pasted' ? t(locale, 'pageFacts.pasted') : p.source }))}</p>`;
  if (p.decidedAt) {
    return `${head}<p>${esc(t(locale, 'pageFacts.decided', { n: show.count(locale, p.written ?? 0), date: show.date(locale, p.decidedAt) }))}</p>`;
  }
  return `${head}
    <p>${esc(t(locale, 'pageFacts.tickIntro'))}</p>
    <form method="post" action="/app/knowledge/from-page/${esc(p.id)}/confirm" class="pform">
      <ul class="rows">${p.lines.map((l) => `<li class="row"><label class="pcheck"><input type="checkbox" name="line:${esc(l.key)}" />
        <span dir="auto">${esc(l.fact)}</span></label>
        <p class="muted small" dir="auto">${esc(t(locale, 'pageFacts.quote', { quote: l.quote }))}</p></li>`).join('')}</ul>
      <button class="btn send" type="submit">${esc(t(locale, 'pageFacts.confirm'))}</button>
    </form>`;
}

