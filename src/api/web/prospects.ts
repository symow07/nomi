import type { SearchFilter, SearchOutcome, SourceFailureReason } from '../../connectors/contract.js';
import type { KeyStatus, NoSource } from '../../prospects/service.js';
import type { Enrichment } from '../../db/prospects.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { t } from './say.js';
import { formatDate } from '../../core/owner/i18n/format.js';
import { OWNER_VIEW, type Viewer } from '../../core/conversation/people.js';
import { back, esc } from './layout.js';
import { flashBanner, type Flash } from './flash.js';

/**
 * C5 · M41 — finding buyers, as a list she decides about.
 *
 * NEVER A QUEUE. A result is a person on a page with one button, and the
 * button's sentence says what it costs (a credit) and what it does (puts them on
 * her list). Nothing here writes to anyone, and nothing here makes it possible to
 * write to them: a person added from a search arrives with no consent, and her
 * list says so on his row in the gate's own words.
 *
 * Her key is the owner's to add or remove; the value is never rendered back —
 * only a fingerprint that proves WHICH key is on file.
 */

export const SIZE_RANGES = ['', '1-10', '11-50', '51-200', '201-1000', '1001-'] as const;
export type SizeRange = (typeof SIZE_RANGES)[number];

const list = (v: unknown): string[] =>
  typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 10).map((x) => x.slice(0, 80)) : [];

/** The search in the query string, or null when she has not searched. */
export function filterFromQuery(q: Record<string, unknown>): (SearchFilter & { readonly size: SizeRange }) | null {
  if (q['search'] !== '1') return null;
  const size = SIZE_RANGES.find((s) => s === q['size']) ?? '';
  const [min, max] = size === '' ? [null, null] : size.split('-').map((n) => (n === '' ? null : Number(n)));
  const page = typeof q['page'] === 'string' && /^\d{1,3}$/.test(q['page']) ? Math.max(1, Number(q['page'])) : 1;
  const keywords = typeof q['keywords'] === 'string' && q['keywords'].trim() ? q['keywords'].trim().slice(0, 120) : null;
  return {
    titles: list(q['titles']), countries: list(q['countries']), keywords,
    employeesMin: min ?? null, employeesMax: max ?? null, page, size,
  };
}

/** The same search as a query string, for the next page and the way back. */
export function queryOf(f: SearchFilter & { readonly size: SizeRange }, page = f.page): string {
  const p = new URLSearchParams({ search: '1', page: String(page) });
  if (f.titles.length) p.set('titles', f.titles.join(', '));
  if (f.countries.length) p.set('countries', f.countries.join(', '));
  if (f.keywords) p.set('keywords', f.keywords);
  if (f.size) p.set('size', f.size);
  return `?${p.toString()}`;
}

/** The KEY for every way a lookup, a search or an add can end without a result. */
export function failureKey(r: SourceFailureReason | NoSource): MessageKey {
  return (r === 'no_key' || r === 'no_key_store' || r === 'unreadable_key'
    ? `prospects.noSource.${r}` : `prospects.failure.${r}`) as MessageKey;
}

/** The same, said — for the one place that renders it inside a page, not a notice. */
export const failureSentence = (locale: Locale, r: SourceFailureReason | NoSource): string =>
  t(locale, failureKey(r));

/**
 * What a company lookup found, as one line of HTML for a person — or null when
 * nothing is known.
 *
 * EACH PART ISOLATED, not the line. A vendor's facts are in the language the
 * vendor wrote them in (almost always English) and the words around them are in
 * hers; wrapped as one `<bdi>`, the Arabic page's first screenshot read
 * ": 60 عدد الموظفين" with the pieces out of order. Vendor text goes in its
 * own `<bdi>`, her words stay in the page's direction, and the separators
 * follow the page.
 */
export function companyLineHtml(locale: Locale, e: Enrichment | undefined): string | null {
  if (!e) return null;
  if (!e.found || !e.organization) {
    return esc(t(locale, 'contacts.company.notFound', { domain: '\u0000' })).replace('\u0000', `<bdi>${esc(e.domain)}</bdi>`);
  }
  const o = e.organization;
  const vendor = (x: string | null) => (x ? `<bdi>${esc(x)}</bdi>` : null);
  const parts = [
    vendor(o.name), vendor(o.industry),
    o.employees !== null ? esc(t(locale, 'contacts.company.employees', { n: String(o.employees) })) : null,
    vendor([o.city, o.country].filter(Boolean).join(', ') || null),
  ].filter((x): x is string => x !== null);
  return `${parts.join(' · ')} — ${esc(t(locale, 'contacts.company.lookedUp', { date: formatDate(locale, e.lookedUpAt) }))}`;
}

function keyBlock(locale: Locale, status: KeyStatus, viewer: Viewer): string {
  const state = status.kind === 'no_key_store' ? t(locale, 'prospects.noSource.no_key_store')
    : status.kind === 'none' ? t(locale, 'prospects.key.none')
    : status.readable
      ? t(locale, 'prospects.key.stored', { fp: status.fingerprint, who: status.createdBy, date: formatDate(locale, status.createdAt) })
      : t(locale, 'prospects.noSource.unreadable_key');
  if (status.kind === 'no_key_store') return `<section class="block"><h2>${esc(t(locale, 'prospects.key.title'))}</h2>
    <p class="muted">${esc(state)}</p></section>`;
  const controls = !viewer.isOwner
    ? `<p class="muted">${esc(t(locale, 'staff.prospects.keyOwner'))}</p>`
    : `<form method="post" action="/app/prospects/key" class="pform">
        <label class="fld"><span class="muted">${esc(t(locale, 'prospects.key.field'))}</span>
          <input name="apiKey" type="password" autocomplete="off" spellcheck="false" required maxlength="128" dir="ltr" /></label>
        <button class="btn send" type="submit">${esc(t(locale, status.kind === 'stored' ? 'prospects.key.replace' : 'prospects.key.save'))}</button>
      </form>
      ${status.kind === 'stored' ? `<form method="post" action="/app/prospects/key/remove" class="inline">
        <button class="btn stop" type="submit">${esc(t(locale, 'prospects.key.remove'))}</button></form>` : ''}`;
  return `<section class="block"><h2>${esc(t(locale, 'prospects.key.title'))}</h2>
    <p class="muted">${esc(state)}</p>${controls}</section>`;
}

export function renderProspects(
  v: {
    readonly status: KeyStatus;
    readonly filter: (SearchFilter & { readonly size: SizeRange }) | null;
    readonly outcome: SearchOutcome | { readonly kind: NoSource } | null;
  },
  locale: Locale, flash: Flash | null, viewer: Viewer = OWNER_VIEW,
): string {
  const f = v.filter;
  const canSearch = v.status.kind === 'stored' && v.status.readable;

  const results = !v.outcome ? '' : v.outcome.kind === 'results'
    ? (v.outcome.prospects.length === 0
      ? `<div class="empty">${esc(t(locale, 'prospects.results.none'))}</div>`
      : `<ul class="rows">${v.outcome.prospects.map((p) => `<li class="row lines">
          <div class="dhead"><span class="who"><bdi>${esc(p.name)}</bdi></span>
            ${p.title ? `<span class="muted"><bdi>${esc(p.title)}</bdi></span>` : ''}</div>
          <div class="small">${[p.organization, [p.city, p.country].filter(Boolean).join(', ')]
            .filter(Boolean).map((x) => `<bdi>${esc(x!)}</bdi>`).join(' · ')}</div>
          <form method="post" action="/app/prospects/add" class="inline">
            <input type="hidden" name="sourceId" value="${esc(p.sourceId)}" />
            <input type="hidden" name="name" value="${esc(p.name)}" />
            <input type="hidden" name="title" value="${esc(p.title ?? '')}" />
            <input type="hidden" name="organization" value="${esc(p.organization ?? '')}" />
            <input type="hidden" name="back" value="${esc(f ? queryOf(f) : '')}" />
            <button class="btn" type="submit">${esc(t(locale, 'prospects.add.button'))}</button>
          </form>
        </li>`).join('')}</ul>
        ${f && v.outcome.totalPages > v.outcome.page
          ? `<p><a class="btn" href="/app/prospects${esc(queryOf(f, v.outcome.page + 1))}">${esc(t(locale, 'prospects.results.next'))}</a></p>` : ''}`)
    // D5 — a search that failed is a refusal, and now looks like one.
    : flashBanner({ text: failureSentence(locale, v.outcome.kind === 'failed' ? v.outcome.reason : v.outcome.kind), bad: true });

  return `${back('/app/contacts', t(locale, 'contacts.title'))}
    <h1 class="page">${esc(t(locale, 'prospects.title'))}</h1>
    ${flashBanner(flash)}
    <section class="block"><p class="muted">${esc(t(locale, 'prospects.intro'))}</p></section>
    ${keyBlock(locale, v.status, viewer)}
    ${canSearch ? `<section class="block">
      <h2>${esc(t(locale, 'prospects.search.title'))}</h2>
      <form method="get" action="/app/prospects" class="pform">
        <input type="hidden" name="search" value="1" />
        <label class="fld"><span class="muted">${esc(t(locale, 'prospects.search.titles'))}</span>
          <input name="titles" dir="auto" maxlength="400" value="${esc(f?.titles.join(', ') ?? '')}" /></label>
        <label class="fld"><span class="muted">${esc(t(locale, 'prospects.search.countries'))}</span>
          <input name="countries" dir="auto" maxlength="400" value="${esc(f?.countries.join(', ') ?? '')}" /></label>
        <label class="fld"><span class="muted">${esc(t(locale, 'prospects.search.keywords'))}</span>
          <input name="keywords" dir="auto" maxlength="120" value="${esc(f?.keywords ?? '')}" /></label>
        <label class="fld"><span class="muted">${esc(t(locale, 'prospects.search.size'))}</span>
          <select name="size">${SIZE_RANGES.map((s) => `<option value="${s}" ${f?.size === s ? 'selected' : ''}>${
            esc(t(locale, `prospects.size.${s === '' ? 'any' : s.replace('-', '_')}` as MessageKey))}</option>`).join('')}</select></label>
        <button class="btn send" type="submit">${esc(t(locale, 'prospects.search.button'))}</button>
      </form>
      <p class="muted note">${esc(t(locale, 'prospects.add.hint'))}</p>
      ${results}
    </section>` : ''}`;
}
