import {booksDay} from './booksOverview.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import type { OverviewPage, OverviewPaper, PaperWorkState } from '../../db/booksOverview.js';
import type { EntryView } from '../../db/booksEntries.js';
import { markSmall } from '../../core/owner/brand.js';
import { compareDecimal } from '../../core/types/decimal.js';
import { renderNewEntry, type EntryChoices } from './booksEntries.js';
import { customShown } from './booksFields.js';
import { safeBooksReturn } from './booksNavigation.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { booksMay, type Viewer } from '../../core/conversation/people.js';
import { moneyFromRow } from '../../core/types/money.js';
import type { Decimal } from '../../core/types/decimal.js';
import type { ReadingProblem } from '../../core/books/reading.js';
import type { ReadingRow } from '../../db/booksDocuments.js';
import { t } from './say.js';
import { esc } from './layout.js';
import { icon } from './icons.js';
import * as show from './values.js';

/**
 * D6 (Phase 5, item 7) — THE BOOKS' PAPERS on the page: kept (sealed, in the workspace's residency), read on request
 * where a reader is configured, and — from a reading with no problem — one draft the owner shapes: every account,
 * the supplier, each tax code chosen here. Nothing read is ever posted from this page.
 */
type Who = Viewer & { readonly kind?: 'team' | 'accountant' };
const owner = (v: Who) => booksMay({ id: v.id ?? '', name: '', ...v }, 'post');
const money = (locale: Locale, d: Decimal, currency: string | null) => {
  const m = currency ? moneyFromRow(d, currency) : null; return m ? esc(show.money(locale, m)) : esc(d);
};

export function problemText(locale: Locale, p: ReadingProblem): string {
  switch (p.kind) {
    case 'ambiguous': return t(locale, 'books.papers.problem.ambiguous', { where: p.where });
    case 'not_an_amount': return t(locale, 'books.papers.problem.notAnAmount', { where: p.where });
    case 'not_adding_up': return t(locale, 'books.papers.problem.notAddingUp', { lines: p.lines, total: p.total });
    case 'unknown_currency': return t(locale, 'books.papers.problem.currency', { currency: p.currency || '—' });
    case 'no_total': return t(locale, 'books.papers.problem.noTotal');
    case 'no_date': return t(locale, 'books.papers.problem.noDate');
    case 'no_number': return t(locale, 'books.papers.problem.noNumber');
  }
}

export type PaperChoices = {
  readonly journals: readonly { id: string; code: string; name: string }[];
  readonly parties: readonly { id: string; code: string; name: string }[];
  readonly accounts: readonly { id: string; code: string; name: string }[];
  readonly taxCodes: readonly { id: string; code: string; label: string }[];
  readonly payableDefault: string | null; readonly purchasesDefault: string | null;
};

const spendingStates = ['pending','unread','problem','ready','draft','posted','set_aside','history'] as const;
type SpendingFilter = PaperWorkState | 'pending' | 'history';
const stateText = (locale: Locale, state: SpendingFilter) => t(locale, `booksSpending.${state}` as MessageKey);
const day = (locale: Locale, date: string) => booksDay(locale,date.slice(0,10));
const statePill = (locale: Locale, state: SpendingFilter) => `<span class="pill${state === 'posted' ? ' ok' : ''}">${esc(stateText(locale,state))}</span>`;
const upload = (locale: Locale) => `<form method="post" action="/app/books/papers" enctype="multipart/form-data" class="pform"><label class="pq"><span>${esc(t(locale,'books.papers.file'))}</span><input type="file" name="paper" accept="image/jpeg,image/png,image/webp,application/pdf" required /></label><button class="btn send" type="submit">${esc(t(locale,'books.papers.keep'))}</button></form>`;

export function renderSpending(locale: Locale, viewer: Who, page: OverviewPage<OverviewPaper>, offered: boolean,
  opts: { readonly state?: SpendingFilter; readonly returnHref?: string } = {}): string {
  const url = (n: number) => `/app/books/spending?${new URLSearchParams({...(opts.state ? {state:opts.state} : {}),page:String(n)})}`;
  const from = safeBooksReturn(opts.returnHref) ?? url(page.page);
  return `<section class="books-spending"><header class="bs-header"><h1 class="page">${esc(t(locale,'booksSpending.title'))}</h1><p class="lede">${esc(t(locale,'booksSpending.lede'))}</p></header>
    ${owner(viewer) && offered ? `<details class="bs-upload"${page.total === 0 ? ' open' : ''}><summary>${esc(t(locale,'booksSpending.upload'))}</summary><div id="receipt-upload">${upload(locale)}</div></details>` : ''}
    <form method="get" action="/app/books/spending" class="bs-filter"><label><span>${esc(t(locale,'booksSpending.filter'))}</span><select name="state"><option value="">${esc(t(locale,'booksSpending.all'))}</option>${spendingStates.map(s=>`<option value="${s}"${s === opts.state ? ' selected' : ''}>${esc(stateText(locale,s))}</option>`).join('')}</select></label><button class="btn" type="submit">${esc(t(locale,'booksSpending.show'))}</button></form>
    ${page.rows.length ? `<ul class="bs-list">${page.rows.map(r=>`<li id="paper-${esc(r.id)}"><div><a href="/app/books/spending/${esc(r.id)}?from=${esc(encodeURIComponent(from.split('#')[0]+'#paper-'+r.id))}"><bdi>${esc(r.name)}</bdi></a><p class="muted">${esc(day(locale,r.addedOn))}</p></div>${statePill(locale,r.state)}</li>`).join('')}</ul>` : `<p>${esc(t(locale,'booksSpending.empty'))}</p>`}
    <nav class="bs-pagination" aria-label="${esc(t(locale,'booksSpending.title'))}"><p>${esc(t(locale,'booksSpending.range',{from:page.from,to:page.to,total:page.total}))}</p><div>${page.prev !== null ? `<a href="${esc(url(page.prev))}">${esc(t(locale,'booksSpending.previous'))}</a>` : ''}${page.next !== null ? `<a href="${esc(url(page.next))}">${esc(t(locale,'booksSpending.next'))}</a>` : ''}</div></nav></section>`;
}

export type PaperPresentation = {
  readonly previewHref?: string; readonly returnHref?: string; readonly state?: PaperWorkState; readonly entryId?: string | null;
  readonly values?: Readonly<Record<string,string>>; readonly problems?: readonly string[];
};
const hidden = (name: string, value: string) => `<input type="hidden" name="${esc(name)}" value="${esc(value)}" />`;
const options = (locale: Locale, rows: readonly {id:string;code:string;name?:string;label?:string}[], selected: string) => {
  const unknown = selected && !rows.some(r=>r.id === selected) ? `<option value="${esc(selected)}" selected>${esc(t(locale,'booksSpending.unavailable',{value:selected}))}</option>` : '';
  return `<option value=""></option>${unknown}${rows.map(r=>`<option value="${esc(r.id)}"${r.id === selected ? ' selected' : ''}>${esc(r.code)} · ${esc(r.name ?? r.label ?? '')}</option>`).join('')}`;
};
const pick = (locale: Locale, name: string, rows: readonly {id:string;code:string;name?:string;label?:string}[], selected: string, label: string, required = false) =>
  `<label class="pq"><span>${esc(label)}</span><select name="${esc(name)}"${required?' required':''}>${options(locale,rows,selected)}</select></label>`;
const alerts = (problems: readonly string[]) => problems.map(p=>`<p class="perr" role="alert">${esc(p)}</p>`).join('');

function readingFacts(locale: Locale, r: ReadingRow): string {
  const read = r.reading;
  return `<p class="bs-attribution">${markSmall(16,null)}<span>${esc(t(locale,'books.papers.readBy'))} · ${esc(t(locale,'booksSpending.readAt',{date:show.dateYear(locale,new Date(r.readAt))}))}</span></p>${r.outcome !== 'read' || !read
    ? `<p role="alert">${esc(t(locale,r.outcome === 'cut_off' ? 'books.papers.cutOff' : 'books.papers.unreadable'))}</p>`
    : `<dl class="bs-facts"><div><dt>${esc(t(locale,'books.papers.supplier'))}</dt><dd><bdi>${esc(read.supplierName ?? '—')}</bdi>${read.supplierTaxId ? `<br><bdi>${esc(read.supplierTaxId)}</bdi>` : ''}</dd></div><div><dt>${esc(t(locale,'books.entry.document'))}</dt><dd><bdi>${esc(read.number ?? '—')}</bdi></dd></div><div><dt>${esc(t(locale,'books.entry.date'))}</dt><dd>${read.date ? esc(day(locale,read.date)) : '—'}</dd></div><div><dt>${esc(t(locale,'books.entry.total'))}</dt><dd>${read.total !== null ? money(locale,read.total,read.currency) : '—'}</dd></div></dl>
      <ol class="bs-read-lines">${read.lines.map(l=>`<li><bdi>${esc(l.label)}</bdi><dl class="bs-facts"><div><dt>${esc(t(locale,'books.invoice.net'))}</dt><dd>${money(locale,l.net,read.currency)}</dd></div><div><dt>${esc(t(locale,'booksSpending.taxAmount'))}</dt><dd>${money(locale,l.tax,read.currency)} · ${esc(l.taxRate)}%</dd></div></dl></li>`).join('')}</ol>`}
    ${alerts(r.problems.map(p=>problemText(locale,p)))}${r.entryId?`<p><a href="/app/books/advanced/entries/${esc(r.entryId)}">${esc(t(locale,'books.invoice.seeEntry'))}</a></p>`:''}`;
}

export function renderPaper(locale: Locale, viewer: Who, p: { id: string; name: string; mediaType: string; readings: readonly ReadingRow[];
  keepUntil?: string; history?: { readonly entries: number; readonly through: string } | null },
  c: PaperChoices, reader: { readonly available: boolean; readonly canRead: boolean }, opts: PaperPresentation = {}): string {
  const from = safeBooksReturn(opts.returnHref);
  const carry = from ? hidden('from',from) : '';
  const suffix = from ? `?from=${encodeURIComponent(from)}` : '';
  const last = p.readings[0] ?? null;
  const values = opts.values ?? {};
  const selected = (name: string, fallback = '') => values[name] ?? fallback;
  const entryId = opts.entryId !== undefined ? opts.entryId : last?.entryId ?? null;
  const state = opts.state ?? (entryId ? 'draft' : undefined);
  const draftable = !p.history && !entryId && last?.outcome === 'read' && last.reading && last.problems.length === 0 && owner(viewer);
  const form = !draftable || !last?.reading ? '' : `<section class="bs-draft-choices" id="draft"><h2>${esc(t(locale,'booksSpending.choose'))}</h2><p>${esc(t(locale,'books.papers.draftExplain'))}</p>
    <form method="post" action="/app/books/papers/${esc(p.id)}/draft" class="pform">${hidden('reading',last.id)}${hidden('presentation','spending')}${carry}<div class="bs-fields">${pick(locale,'journal',c.journals,selected('journal',c.purchasesDefault ?? ''),t(locale,'books.entry.journal'),true)}${pick(locale,'party',c.parties,selected('party'),t(locale,'books.papers.supplier'),true)}${pick(locale,'payable',c.accounts,selected('payable',c.payableDefault ?? ''),t(locale,'books.papers.payable'),true)}</div>
      ${last.reading.lines.map((l,i)=>`<fieldset class="bs-reading-line"><legend>${esc(t(locale,'booksSpending.line',{n:i+1}))} · <bdi>${esc(l.label)}</bdi></legend><dl class="bs-facts"><div><dt>${esc(t(locale,'books.invoice.net'))}</dt><dd>${money(locale,l.net,last.reading!.currency)}</dd></div><div><dt>${esc(t(locale,'booksSpending.taxAmount'))}</dt><dd>${money(locale,l.tax,last.reading!.currency)}</dd></div></dl><div class="bs-fields">${pick(locale,`account${i}`,c.accounts,selected(`account${i}`),t(locale,'books.entry.account'),true)}${pick(locale,`tax${i}`,c.taxCodes,selected(`tax${i}`),t(locale,'books.entry.tax'))}</div></fieldset>`).join('')}
      <button class="btn send" type="submit">${esc(t(locale,'books.entry.saveDraft'))}</button></form></section>`;
  const drafted = entryId && state ? `<p class="bs-entry-state">${statePill(locale,state)} <a href="${state === 'draft' ? `/app/books/spending/${esc(p.id)}/draft?entry=${esc(entryId)}${from?`&amp;from=${encodeURIComponent(from)}`:''}` : `/app/books/advanced/entries/${esc(entryId)}${esc(suffix)}`}">${esc(t(locale,state === 'draft' ? 'booksSpending.reviewDraft' : 'books.invoice.seeEntry'))}</a></p>` : '';
  const read = !owner(viewer) ? '' : !reader.available ? `<p>${esc(t(locale,'books.papers.noReader'))}</p>` : !reader.canRead ? `<p>${esc(t(locale,'books.papers.pdfNotRead'))}</p>`
    : `<form method="post" action="/app/books/papers/${esc(p.id)}/read" class="pform">${carry}<button class="btn${last?'':' send'}" type="submit">${esc(t(locale,last?'books.papers.readAgain':'books.papers.read'))}</button></form>`;
  const history = p.history ? `<p role="status">${statePill(locale,'history')}</p><p>${esc(t(locale,'books.papers.historyExplain',{n:p.history.entries,through:day(locale,p.history.through)}))}</p>` : '';
  // Preview URL is supplied by the authorised route. Only the kept original can be embedded here.
  const previewHref = opts.previewHref === `/app/books/spending/${p.id}/preview` ? opts.previewHref : null;
  const preview = !previewHref ? '' : ['image/jpeg','image/png','image/webp'].includes(p.mediaType) ? `<img class="bs-original-image" src="${esc(previewHref)}" alt="${esc(t(locale,'booksSpending.preview',{name:p.name}))}" />`
    : p.mediaType === 'application/pdf' ? `<iframe class="bs-original-pdf" src="${esc(previewHref)}" title="${esc(t(locale,'booksSpending.preview',{name:p.name}))}"></iframe>` : '';
  return `<section class="books-spending"><header class="bs-header"><h1 class="page"><bdi>${esc(p.name)}</bdi></h1>${alerts(opts.problems??[])}${history}${p.keepUntil?`<p class="muted">${esc(t(locale,'books.papers.keptUntil',{date:day(locale,p.keepUntil)}))}</p>`:''}${p.history?'':drafted}</header>
    <div class="bs-review"><section class="bs-original"><h2>${esc(t(locale,'booksSpending.original'))}</h2><p><a class="dl-get" href="/app/books/papers/${esc(p.id)}/file" download>${icon('download')}<span>${esc(t(locale,'booksSpending.download'))}</span></a></p>${preview}</section>
    ${p.history?'':`<section class="bs-reading"><h2>${esc(t(locale,'booksSpending.reading'))}</h2>${last ? `<p>${esc(t(locale,'booksSpending.checkReading'))}</p>${readingFacts(locale,last)}` : ''}${read}${p.readings.length>1?`<details class="bs-reading-history"><summary>${esc(t(locale,'booksSpending.previousReadings'))}</summary>${p.readings.slice(1).map(r=>`<section>${readingFacts(locale,r)}</section>`).join('')}</details>`:''}</section>`}</div>${form}
    <p><a class="deeper" href="${esc(from ?? '/app/books/spending')}">${esc(t(locale,from?'booksSpending.back':'booksSpending.title'))}</a></p></section>`;
}

/** Conservative presentation choice only. Unsupported drafts continue through the existing full editor. */
export function spendingDraftSupported(entry: EntryView, c: EntryChoices, values: Readonly<Record<string,string>>): boolean {
  if (entry.state !== 'draft' || entry.reverses || entry.reversedBy || entry.lines.length < 2 || Object.keys(entry.custom).length || c.fields?.some(f=>f.appliesTo === 'entry' || f.appliesTo === 'line')) return false;
  const credits = entry.lines.filter(l=>l.credit !== null && compareDecimal(l.credit,'0' as Decimal)>0 && l.debit === null);
  if (credits.length !== 1 || !credits[0]?.party) return false;
  if (entry.lines.some(l=>l.isFx || l.rate !== null || l.currency !== c.bookCurrency || Object.keys(l.custom).length || (l !== credits[0] && (l.party !== null || l.debit === null || compareDecimal(l.debit,'0' as Decimal)<=0 || l.credit !== null)))) return false;
  for (const [k,v] of Object.entries(values)) {
    if (!v) continue;
    if (k.startsWith('cf_') || /^fx\d+$/.test(k) || (/^currency\d+$/.test(k) && v !== c.bookCurrency)) return false;
    const line = /^(?:account|party|tax|currency|debit|credit|label|fx)(\d+)$/.exec(k);
    if (line && Number(line[1]) >= entry.lines.length) return false;
  }
  return true;
}

/** A concurrent refusal can make the entry read-only; show attempted values without recreating a write form. */
function unsavedValues(locale: Locale, c: EntryChoices, values: Readonly<Record<string,string>>): string {
  const labels: Readonly<Record<string,MessageKey>> = {journal:'books.entry.journal',date:'books.entry.date',label:'books.entry.label',documentRef:'books.entry.document',documentDate:'books.entry.documentDate',account:'books.entry.account',party:'books.entry.party',tax:'books.entry.tax',currency:'books.entry.currency',debit:'books.entry.debit',credit:'books.entry.credit',fx:'books.entry.fx'};
  const rows = Object.entries(values).flatMap(([key,value])=>{
    const line = /^(account|party|tax|currency|debit|credit|label|fx)(\d+)$/.exec(key);
    const custom = /^cf_(entry|line(\d+))_(.+)$/.exec(key);
    const field = line?.[1] ?? key;
    if (!labels[field] && !custom) return [];
    const n = line?.[2] ?? custom?.[2];
    const label = custom ? (c.fields??[]).find(f=>f.appliesTo === (custom[1] === 'entry'?'entry':'line') && f.key === custom[3])?.label ?? custom[3]! : t(locale,labels[field]!);
    const choices = field === 'journal'?c.journals:field === 'account'?c.accounts:field === 'party'?c.parties:field === 'tax'?c.taxCodes:[];
    const option = choices.find(r=>r.id === value);
    const shown = option ? `${option.code} · ${'name' in option?option.name:option.label}` : value || '—';
    return [`<div><dt>${n !== undefined?`${esc(t(locale,'booksSpending.line',{n:Number(n)+1}))} · `:''}${esc(label)}</dt><dd><bdi>${esc(shown)}</bdi></dd></div>`];
  });
  return `<details class="bs-unsaved" open><summary>${esc(t(locale,'booksSpending.unsaved'))}</summary><dl class="bs-facts">${rows.join('')}</dl></details>`;
}

export function renderSpendingDraft(locale: Locale, viewer: Who, paper: {readonly id:string;readonly name:string}, entry: EntryView,
  c: EntryChoices, values: Readonly<Record<string,string>>, problems: readonly string[], today: string, opts: {readonly returnHref?: string} = {}): string {
  const from = safeBooksReturn(opts.returnHref);
  const carry = hidden('paper',paper.id) + (from ? hidden('from',from) : '');
  const suffix = from ? `?from=${encodeURIComponent(from)}` : '';
  const link = `<p><a href="/app/books/spending/${esc(paper.id)}${esc(suffix)}"><bdi>${esc(paper.name)}</bdi></a></p>`;
  const summary = `<details class="bs-ledger" open><summary>${esc(t(locale,'booksSpending.ledger'))}</summary><dl class="bs-facts"><div><dt>${esc(t(locale,'books.entry.journal'))}</dt><dd><bdi>${esc(entry.journal)}</bdi></dd></div><div><dt>${esc(t(locale,'books.entry.date'))}</dt><dd>${esc(day(locale,entry.date))}</dd></div><div><dt>${esc(t(locale,'books.entry.document'))}</dt><dd><bdi>${esc(entry.documentRef??'—')}</bdi>${entry.documentDate?` · ${esc(day(locale,entry.documentDate))}`:''}</dd></div></dl>${Object.keys(entry.custom).length?`<p>${customShown(locale,c.fields??[],'entry',entry.custom)}</p>`:''}<ul class="bs-saved-lines">${entry.lines.map(l=>`<li><div><bdi>${esc(l.account)} · ${esc(l.accountName)}</bdi>${l.label?`<p><bdi>${esc(l.label)}</bdi></p>`:''}${l.party?`<p><bdi>${esc(l.party)}</bdi></p>`:''}${l.taxCode?`<p>${esc(t(locale,'books.entry.tax'))}: <bdi>${esc(l.taxCode)}</bdi></p>`:''}${l.isFx?`<p>${esc(t(locale,'books.entry.fx'))}</p>`:''}${Object.keys(l.custom).length?`<p>${customShown(locale,c.fields??[],'line',l.custom)}</p>`:''}</div><dl class="bs-facts">${l.debit!==null?`<div><dt>${esc(t(locale,'books.entry.debit'))}</dt><dd>${money(locale,l.debit,l.currency)}</dd></div>`:''}${l.credit!==null?`<div><dt>${esc(t(locale,'books.entry.credit'))}</dt><dd>${money(locale,l.credit,l.currency)}</dd></div>`:''}${l.rate!==null?`<div><dt>${esc(t(locale,'books.entry.fx'))}</dt><dd>${esc(l.rate)}</dd></div>`:''}</dl></li>`).join('')}</ul></details>`;
  const head = `<header class="bs-header"><h1 class="page">${esc(t(locale,entry.state === 'draft'?'booksSpending.draftTitle':entry.state === 'posted'?'booksSpending.savedTitle':'booksSpending.setAsideTitle'))}</h1>${entry.state === 'draft'?`<p class="lede">${esc(t(locale,'booksSpending.draftLede'))}</p>`:''}${link}${statePill(locale,entry.state === 'discarded' ? 'set_aside' : entry.state)}</header>`;
  if (!owner(viewer) || entry.state !== 'draft') return `<section class="books-spending">${head}${alerts(problems)}${problems.length?unsavedValues(locale,c,values):''}${summary}<p><a href="/app/books/advanced/entries/${esc(entry.id)}">${esc(t(locale,'books.invoice.seeEntry'))}</a></p></section>`;
  if (!spendingDraftSupported(entry,c,values)) {
    // The existing editor is the complete contract, including FX/custom values and indexed extra rows.
    const retained = problems.length ? renderNewEntry(locale,c,values,problems,today,entry.id).replace(/(<form\b[^>]*>)/,`$1${carry}`) : '';
    return `<section class="books-spending">${retained ? link : head}<p>${esc(t(locale,retained?'booksSpending.retained':'booksSpending.complex'))}</p>${retained ? `<section class="bs-advanced" aria-label="${esc(t(locale,'booksSpending.fullEditor'))}">${retained}</section>` : `${summary}<p><a href="/app/books/advanced/entries/${esc(entry.id)}/edit${esc(suffix)}">${esc(t(locale,'booksSpending.advanced'))}</a></p>`}</section>`;
  }
  const v = (k:string) => esc(values[k] ?? '');
  const input = (name:string,label:string,type='text',extra='') => `<label class="pq"><span>${esc(label)}</span><input type="${type}" name="${name}" value="${v(name)}"${extra} /></label>`;
  const field = (name:string,key:MessageKey,type='text',extra='') => input(name,t(locale,key),type,extra);
  const lineForm = (i:number) => {
    const supplier = entry.lines[i]!.credit !== null;
    const extraSide = supplier ? `debit${i}` : `credit${i}`;
    return `<fieldset class="bs-draft-line"><legend>${esc(t(locale,supplier?'booksSpending.supplierLine':'booksSpending.costLine',{n:i+1}))}</legend><div class="bs-fields">${pick(locale,`account${i}`,c.accounts,values[`account${i}`]??'',t(locale,'books.entry.account'),true)}${pick(locale,`party${i}`,c.parties,values[`party${i}`]??'',t(locale,'books.papers.supplier'))}${field(supplier?`credit${i}`:`debit${i}`,supplier?'booksSpending.owedAmount':'booksSpending.costAmount','text',' inputmode="decimal"')}${pick(locale,`tax${i}`,c.taxCodes,values[`tax${i}`]??'',t(locale,'books.entry.tax'))}${field(`label${i}`,'books.entry.lineLabel')}<label class="pq"><span>${esc(t(locale,'books.entry.currency'))}</span><select name="currency${i}"><option value="${esc(c.bookCurrency)}" selected>${esc(c.bookCurrency)}</option></select></label></div><details class="bs-line-advanced"${values[extraSide]?' open':''}><summary>${esc(t(locale,'booksSpending.lineDetails'))}</summary>${field(extraSide,supplier?'books.entry.debit':'books.entry.credit','text',' inputmode="decimal"')}</details></fieldset>`;
  };
  return `<section class="books-spending">${head}${alerts(problems)}<form method="post" action="/app/books/entries/${esc(entry.id)}/edit" class="pform bs-draft-form">${carry}<fieldset><legend>${esc(t(locale,'booksSpending.details'))}</legend><div class="bs-fields">${pick(locale,'journal',c.journals,values['journal']??'',t(locale,'books.entry.journal'),true)}${field('date','books.entry.date','date',' required')}${field('label','books.entry.label','text',' required maxlength="200"')}${field('documentRef','books.entry.document','text',' maxlength="80"')}${field('documentDate','books.entry.documentDate','date')}</div></fieldset>${entry.lines.map((_,i)=>lineForm(i)).join('')}<button class="btn" type="submit">${esc(t(locale,'booksSpending.saveChanges'))}</button></form>
    ${problems.length?'':`<section class="bs-post"><h2>${esc(t(locale,'booksSpending.savedDraft'))}</h2><p>${esc(t(locale,'booksSpending.savedOnly'))}</p><form method="post" action="/app/books/entries/${esc(entry.id)}/post" class="pform">${carry}<button class="btn send" type="submit">${esc(t(locale,'booksSpending.post'))}</button></form></section>`}
    <form method="post" action="/app/books/entries/${esc(entry.id)}/discard" class="pform">${carry}<button class="btn ghost" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale,'books.entry.discardAsk'))}">${esc(t(locale,'books.entry.discard'))}</button></form></section>`;
}
