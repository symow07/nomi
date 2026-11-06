import { sql, type RawBuilder } from 'kysely';
import type { Tx } from './client.js';
import { decimal, type Decimal } from '../core/types/decimal.js';
import { invoiceKey, statusOf, type InvoiceRow } from './booksInvoices.js';
import { literalLike } from './customerPaging.js';
import { holdsMoney } from '../core/books/moneyAccounts.js';

export type BooksOverviewOptions = {
  readonly today: string; readonly cashAccountIds?: readonly string[]; readonly payableAccountIds?: readonly string[];
  /** Explicit internal clearing accounts for this report, not inferred or persisted roles. */
  readonly transferAccountIds?: readonly string[];
};
export type OverviewState = 'available' | 'needs_setup' | 'unavailable' | 'needs_review';
export type OverviewPageOptions = {readonly page?:number;readonly size?:number};
export type OverviewPage<T> = {readonly rows:readonly T[];readonly total:number;readonly from:number;readonly to:number;readonly page:number;readonly pageSize:number;readonly next:number|null;readonly prev:number|null};
export type PaperWorkState = 'unread'|'problem'|'ready'|'draft'|'posted'|'set_aside';
export type OverviewPaper = {readonly id:string;readonly name:string;readonly mediaType:string;readonly addedOn:string;readonly state:PaperWorkState;readonly entryId:string|null;readonly lastOutcome:string|null};
export type OverviewHistoryPaper = {readonly id:string;readonly name:string;readonly mediaType:string;readonly bytes:number;readonly addedOn:string;readonly entryId:string|null;readonly historyEntries:number;readonly historyThrough:string;readonly keepUntil:string};
export type OverviewBankLine = {readonly id:string;readonly accountId:string;readonly account:string;readonly bookedOn:string;readonly currency:string;readonly amount:Decimal;readonly wording:string|null;readonly reference:string|null};
export type OverviewSupplier = {readonly id:string;readonly partyId:string|null;readonly party:string|null;readonly accountId:string;readonly account:string;readonly owed:Decimal;readonly advance:Decimal;readonly unassigned:boolean};
export type OverviewSupplierEntry = {readonly id:string;readonly entryId:string;readonly date:string;readonly label:string;readonly partyId:string|null;readonly party:string|null;readonly accountId:string;readonly account:string;readonly bookDebit:Decimal;readonly bookCredit:Decimal};
export type OverviewCashBalance = {readonly id:string;readonly code:string;readonly name:string;readonly balance:Decimal};
export type OverviewProfitEntry = {readonly id:string;readonly date:string;readonly label:string;readonly amount:Decimal};
export type OverviewCashEntry = {readonly id:string;readonly date:string;readonly label:string;readonly classification:'external'|'transfer'|'transfer_fee'|'review'|'valuation';readonly received:Decimal;readonly paidOut:Decimal;readonly reason:string|null};
export type BooksOverview = {
  readonly today:string;readonly bookCurrency:string;readonly month:{readonly from:string;readonly to:string};
  readonly fiscalYear:{readonly id:string;readonly startsOn:string;readonly endsOn:string;readonly state:string}|null;
  readonly needsYou:{readonly overdueInvoices:number;readonly unmatchedLines:number;readonly papers:{readonly unread:number;readonly problem:number;readonly ready:number;readonly draft:number;readonly posted:number;readonly setAside:number;readonly pending:number}};
  readonly customerOwed:{readonly byCurrency:readonly {readonly currency:string;readonly owed:Decimal;readonly refundDue:Decimal;readonly count:number;readonly overdue:number}[]};
  readonly profit:{readonly amount:Decimal;readonly from:string;readonly to:string;readonly basis:'fiscal'|'calendar'};
  /** Block 2 PR 4 — the money in the bank and cash accounts as of today: posted balances, by account, never a kept sum. */
  readonly cashToday:{readonly state:OverviewState;readonly balance:Decimal|null;readonly defaulted:boolean;readonly byAccount:readonly OverviewCashBalance[]};
  readonly cash:{readonly state:OverviewState;readonly received:Decimal|null;readonly paidOut:Decimal|null;readonly defaulted:boolean;readonly selectedIds:readonly string[];readonly transferIds:readonly string[];readonly reviewEntryIds:readonly string[];readonly reviewCount:number;readonly excludedTransferCount:number};
  readonly supplierOwed:{readonly state:OverviewState;readonly owed:Decimal|null;readonly advances:Decimal|null;readonly knownOwed:Decimal;readonly knownAdvances:Decimal;readonly unassignedOwed:Decimal;readonly unassignedAdvances:Decimal;readonly selectedIds:readonly string[]};
};
const uuid=(s:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
function day(s:string):void {if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s)throw Error('Invalid Books day');}
const sizeOf=(n?:number)=>Number.isSafeInteger(n)?Math.max(1,Math.min(100,n!)):50;
async function paged<T>(tx:Tx,source:RawBuilder<unknown>,sort:RawBuilder<unknown>,o:OverviewPageOptions):Promise<OverviewPage<T>> {
 const size=sizeOf(o.size),total=(await sql<{n:number}>`select count(*)::int as n from (${source}) overview_rows`.execute(tx)).rows[0]!.n;
 const page=Math.min(Number.isSafeInteger(o.page)?Math.max(1,o.page!):1,Math.max(1,Math.ceil(total/size)));
 const rows=(await sql<T>`select * from (${source}) overview_rows order by ${sort} limit ${size} offset ${(page-1)*size}`.execute(tx)).rows;
 return {rows,total,page,pageSize:size,from:rows.length?(page-1)*size+1:0,to:rows.length?(page-1)*size+rows.length:0,next:page*size<total?page+1:null,prev:page>1?page-1:null};
}

/** Dated balances deliberately do not call undated invoice_paid/invoice_credited command helpers. */
const invoiceSource=(businessId:string,today:string)=>sql`
 select i.id::text as id,i.year,i.number,i.state,coalesce(i.party_name,p.name) as party,i.issue_date::text as issue_date,
  i.due_date::text as due_date,i.currency,i.label,invoice_total(i.id) as total,
  coalesce((select sum(credit_note_total(c.id)) from credit_notes c where c.business_id=i.business_id and c.invoice_id=i.id and c.state='issued' and c.issue_date<=${today}::date),0) as credited,
  coalesce((select sum(case when ip.kind='refund' then -ip.amount else ip.amount end) from invoice_payments ip where ip.business_id=i.business_id and ip.invoice_id=i.id and ip.paid_on<=${today}::date),0) as paid
 from invoices i join parties p on p.id=i.party_id and p.business_id=i.business_id
 where i.business_id=${businessId}::uuid and i.state<>'discarded'`;
const datedInvoices=(businessId:string,today:string)=>sql`select *,total-credited-paid as owed from (${invoiceSource(businessId,today)}) invoices`;
export type OverviewInvoiceOptions=OverviewPageOptions&{readonly state?:'all'|'draft'|'unpaid'|'overdue'|'paid'|'refund_due';readonly q?:string};
export async function readOverviewInvoices(tx:Tx,businessId:string,today:string,o:OverviewInvoiceOptions={}):Promise<OverviewPage<InvoiceRow>> {
 day(today);const current=sql`state='issued' and issue_date<=${today}`;
 const state=o.state==='draft'?sql`state='draft'`:o.state==='unpaid'?sql`${current} and owed>0`:o.state==='overdue'?sql`${current} and owed>0 and due_date<${today}`:o.state==='paid'?sql`${current} and owed=0`:o.state==='refund_due'?sql`${current} and owed<0`:sql`true`;
 const q=o.q?.trim().slice(0,200)??'';
 const source=sql`select * from (${datedInvoices(businessId,today)}) i where ${state} and ${q?sql`(party ilike ${literalLike(q)} or coalesce(label,'') ilike ${literalLike(q)} or ('F-'||year||'-'||lpad(number::text,4,'0')) ilike ${literalLike(q)})`:sql`true`}`;
 type Raw={id:string;year:number|null;number:number|null;party:string;issue_date:string;due_date:string|null;currency:string;label:string|null;total:string;credited:string;paid:string;state:string};
 const p=await paged<Raw>(tx,source,sql`issue_date desc,number desc nulls first,id`,o);
 return {...p,rows:p.rows.map(r=>({id:r.id,key:r.number===null?null:invoiceKey(r.year!,r.number),party:r.party,issueDate:r.issue_date,dueDate:r.due_date,currency:r.currency,label:r.label,total:decimal(r.total),credited:decimal(r.credited),paid:decimal(r.paid),status:statusOf(r.state,decimal(r.total),decimal(r.credited),decimal(r.paid),r.due_date,today)}))};
}

/** One document is one work item, classified by its latest reading. A fresh unlinked reading keeps
 * the existing per-reading draft option; older posted/discarded entries remain evidence, not its state. */
const paperSource=(businessId:string)=>sql`
 select d.id::text as id,d.name,d.media_type as "mediaType",d.created_at::date::text as "addedOn",r.outcome as "lastOutcome",
  e.id::text as "entryId",case when e.state='posted' then 'posted' when e.state='draft' then 'draft'
   when e.state='discarded' then 'set_aside' when r.id is null then 'unread'
   when r.outcome<>'read' or jsonb_array_length(r.problems)>0 or r.reading is null
     or nullif(r.reading->>'date','') is null or nullif(r.reading->>'currency','') is null or nullif(r.reading->>'number','') is null then 'problem' else 'ready' end as state
 from documents d
 left join lateral(select x.id,x.entry_id,x.outcome,x.problems,x.reading from document_readings x where x.business_id=d.business_id and x.document_id=d.id order by x.read_at desc,x.id desc limit 1) r on true
 left join journal_entries e on e.business_id=d.business_id and e.id=case when r.id is null then d.entry_id else r.entry_id end
 where d.business_id=${businessId}::uuid and d.history_through is null`;
export async function readOverviewPapers(tx:Tx,businessId:string,o:OverviewPageOptions&{readonly state?:PaperWorkState|'pending'}={}):Promise<OverviewPage<OverviewPaper>> {
 const filter=o.state==='pending'?sql`state in ('unread','problem','ready','draft')`:o.state?sql`state=${o.state}`:sql`true`;
 return paged(tx,sql`select * from (${paperSource(businessId)}) p where ${filter}`,sql`"addedOn" desc,id`,o);
}
/** Same one-paper classification as the queue, never a retained import-history source. */
export async function readOverviewPaper(tx:Tx,businessId:string,id:string):Promise<OverviewPaper|null> {
 if(!uuid(id))return null;
 return (await sql<OverviewPaper>`select * from (${paperSource(businessId)}) p where id=${id.toLowerCase()}`.execute(tx)).rows[0]??null;
}
/** Retained source originals remain reviewable separately; they are not unposted paperwork. */
export async function readOverviewHistoryPapers(tx:Tx,businessId:string,o:OverviewPageOptions={}):Promise<OverviewPage<OverviewHistoryPaper>> {
 return paged(tx,sql`select d.id::text as id,d.name,d.media_type as "mediaType",d.bytes,d.created_at::date::text as "addedOn",d.entry_id::text as "entryId",
  d.history_entries as "historyEntries",d.history_through::text as "historyThrough",d.keep_until::text as "keepUntil"
  from documents d where d.business_id=${businessId}::uuid and d.history_through is not null`,sql`"addedOn" desc,id`,o);
}
const bankSource=(businessId:string)=>sql`select s.id::text as id,s.account_id::text as "accountId",a.code||' · '||a.name as account,s.booked_on::text as "bookedOn",s.currency,s.amount::text as amount,s.wording,s.reference
 from statement_lines s join accounts a on a.id=s.account_id and a.business_id=s.business_id where s.business_id=${businessId}::uuid
 and not exists(select 1 from statement_matches m where m.business_id=s.business_id and m.statement_line_id=s.id and m.unmatched_at is null)`;
export async function readOverviewBankLines(tx:Tx,businessId:string,o:OverviewPageOptions&{readonly accountId?:string}={}):Promise<OverviewPage<OverviewBankLine>> {
 const p=await paged<OverviewBankLine>(tx,sql`select * from (${bankSource(businessId)}) b where ${o.accountId?sql`"accountId"=${o.accountId}`:sql`true`}`,sql`"bookedOn",id`,o);
 return {...p,rows:p.rows.map(r=>({...r,amount:decimal(r.amount)}))};
}

type Scope={state:'available'|'needs_setup'|'unavailable';ids:string[];transfers:string[];defaulted?:boolean};
/** Block 2 PR 4 — nothing chosen: the chart's own bank and cash accounts (0225's `holds_money`, or rule 91's words in the
 * name), the receivable account never among them; for suppliers, the pack's creditors account (4411 / 2000). The home
 * then shows its figures without a choice; the chooser still overrides for one view. None in the chart: `needs_setup`. */
/** The chart's own bank and cash accounts (Block 2 PR 5 reads them too). */
export const moneyAccountIds=(tx:Tx,businessId:string):Promise<string[]>=>defaultScope(tx,businessId,'cash');
async function defaultScope(tx:Tx,businessId:string,kind:'cash'|'payable'):Promise<string[]> {
 if(kind==='payable')return (await sql<{id:string}>`select id::text as id from accounts where business_id=${businessId}::uuid and is_active and kind='liability' and code in ('4411','2000') order by case code when '4411' then 0 else 1 end limit 1`.execute(tx)).rows.map(r=>r.id);
 const rows=(await sql<{id:string;code:string;name:string;holds_money:boolean}>`select a.id::text as id,a.code,a.name,a.holds_money from accounts a where a.business_id=${businessId}::uuid and a.is_active and a.kind='asset'
  and not exists(select 1 from accounts c where c.parent_id=a.id) and not exists(select 1 from books_settings b where b.business_id=a.business_id and b.receivable_account_id=a.id) order by a.code,a.id`.execute(tx)).rows;
 return rows.filter(a=>a.holds_money||holdsMoney(a.code,a.name)).map(a=>a.id);
}
async function selected(tx:Tx,businessId:string,ids:readonly string[]|undefined,kind:'cash'|'payable',transfers:readonly string[]=[],payable:readonly string[]=[]):Promise<Scope>{
 const picked=[...new Set((ids??[]).map(id=>id.toLowerCase()))],clearing=[...new Set(transfers.map(id=>id.toLowerCase()))];const no:Scope={state:'unavailable',ids:[],transfers:[]};
 if([...picked,...clearing].some(x=>!uuid(x))||picked.length+clearing.length>200||picked.some(x=>clearing.includes(x))||kind==='cash'&&clearing.some(x=>payable.some(id=>id.toLowerCase()===x)))return no;
 if(!picked.length){const own=(await defaultScope(tx,businessId,kind)).filter(id=>!clearing.includes(id));return own.length?{state:'available',ids:own,transfers:clearing,defaulted:true}:{state:'needs_setup',ids:[],transfers:[]};}
 const all=[...picked,...clearing];const rows=(await sql<{id:string;kind:string;receivable:boolean}>`select a.id::text as id,a.kind,exists(select 1 from books_settings b where b.business_id=a.business_id and b.receivable_account_id=a.id) as receivable
  from accounts a where a.business_id=${businessId}::uuid and a.id=any(${all}::uuid[])`.execute(tx)).rows;
 if(rows.length!==all.length||rows.some(r=>picked.includes(r.id)?r.kind!==(kind==='cash'?'asset':'liability')||(kind==='cash'&&r.receivable):!['asset','liability'].includes(r.kind)||r.receivable))return no;
 return {state:'available',ids:picked,transfers:clearing};
}
const supplierSource=(businessId:string,today:string,ids:readonly string[])=>sql`
 select coalesce(p.id::text,'unassigned')||':'||a.id::text as id,p.id::text as "partyId",p.name as party,a.id::text as "accountId",a.code||' · '||a.name as account,
  greatest(sum(l.book_credit-l.book_debit),0)::text as owed,greatest(-sum(l.book_credit-l.book_debit),0)::text as advance,
  (p.id is null or p.kind<>'supplier') as unassigned
 from journal_lines l join journal_entries e on e.id=l.entry_id and e.business_id=l.business_id join accounts a on a.id=l.account_id and a.business_id=l.business_id
 left join parties p on p.id=l.party_id and p.business_id=l.business_id
 where l.business_id=${businessId}::uuid and l.account_id=any(${ids}::uuid[]) and e.state='posted' and e.entry_date<=${today}::date
 group by p.id,p.name,p.kind,a.id,a.code,a.name having sum(l.book_credit-l.book_debit)<>0`;
export async function readOverviewSuppliers(tx:Tx,businessId:string,o:BooksOverviewOptions,p:OverviewPageOptions={}):Promise<OverviewPage<OverviewSupplier>&{readonly state:OverviewState}> {
 day(o.today);const scope=await selected(tx,businessId,o.payableAccountIds,'payable');
 const page=await paged<OverviewSupplier>(tx,supplierSource(businessId,o.today,scope.ids),sql`unassigned desc,party nulls first,id`,p);
 return {...page,state:scope.state,rows:page.rows.map(r=>({...r,owed:decimal(r.owed),advance:decimal(r.advance)}))};
}

/** Actual posted liability lines behind the selected supplier/account balances, including unassigned work. */
export async function readOverviewSupplierEntries(tx:Tx,businessId:string,o:BooksOverviewOptions,p:OverviewPageOptions&{readonly partyId?:string|null;readonly accountId?:string;readonly unassigned?:boolean}={}):Promise<OverviewPage<OverviewSupplierEntry>&{readonly state:OverviewState}> {
 day(o.today);const scope=await selected(tx,businessId,o.payableAccountIds,'payable');
 const source=sql`select l.id::text as id,e.id::text as "entryId",e.entry_date::text as date,e.label,p.id::text as "partyId",p.name as party,
  a.id::text as "accountId",a.code||' · '||a.name as account,l.book_debit::text as "bookDebit",l.book_credit::text as "bookCredit"
  from journal_lines l join journal_entries e on e.id=l.entry_id and e.business_id=l.business_id join accounts a on a.id=l.account_id and a.business_id=l.business_id
  left join parties p on p.id=l.party_id and p.business_id=l.business_id
  where l.business_id=${businessId}::uuid and l.account_id=any(${scope.ids}::uuid[]) and e.state='posted' and e.entry_date<=${o.today}::date
   and ${p.partyId===null?sql`p.id is null`:p.partyId?sql`p.id::text=${p.partyId}`:sql`true`}
   and ${p.accountId?sql`a.id::text=${p.accountId}`:sql`true`} and ${p.unassigned?sql`(p.id is null or p.kind<>'supplier')`:sql`true`}`;
 const page=await paged<OverviewSupplierEntry>(tx,source,sql`date desc,"entryId",id`,p);
 return {...page,state:scope.state,rows:page.rows.map(r=>({...r,bookDebit:decimal(r.bookDebit),bookCredit:decimal(r.bookCredit)}))};
}
const fiscalYearOf=async(tx:Tx,businessId:string,today:string)=>(await sql<{id:string;startsOn:string;endsOn:string;state:string}>`select id::text as id,starts_on::text as "startsOn",ends_on::text as "endsOn",state from fiscal_years where business_id=${businessId}::uuid and starts_on<=${today}::date and ends_on>=${today}::date`.execute(tx)).rows[0]??null;
const profitSource=(businessId:string,from:string,to:string)=>sql`select e.id::text as id,e.entry_date::text as date,e.label,sum(l.book_credit-l.book_debit)::text as amount
 from journal_lines l join journal_entries e on e.id=l.entry_id and e.business_id=l.business_id join journals j on j.id=e.journal_id and j.business_id=e.business_id join accounts a on a.id=l.account_id and a.business_id=l.business_id
 where l.business_id=${businessId}::uuid and e.state='posted' and j.kind<>'closing' and a.kind in ('income','expense') and e.entry_date between ${from}::date and ${to}::date
 group by e.id,e.entry_date,e.label`;
export async function readOverviewProfitEntries(tx:Tx,businessId:string,today:string,p:OverviewPageOptions={}):Promise<OverviewPage<OverviewProfitEntry>&{readonly fromDate:string;readonly toDate:string;readonly basis:'fiscal'|'calendar'}> {
 day(today);const year=await fiscalYearOf(tx,businessId,today),from=year?.startsOn??today.slice(0,4)+'-01-01';
 const page=await paged<OverviewProfitEntry>(tx,profitSource(businessId,from,today),sql`date desc,id`,p);
 return {...page,fromDate:from,toDate:today,basis:year?'fiscal':'calendar',rows:page.rows.map(r=>({...r,amount:decimal(r.amount)}))};
}

/** Classify journal structures, never account names. Mixed movements that cannot be attributed stay review work.
 * Stored book amounts are authoritative: neither invoice payments nor matched bank statements add money here. */
const cashSource=(businessId:string,o:BooksOverviewOptions,scope:Scope)=>sql`
 with lines as (
  select e.id,e.entry_date,e.label,l.account_id,l.currency,l.is_fx,l.book_debit as dr,l.book_credit as cr,a.kind,
   l.account_id=any(${scope.ids}::uuid[]) as cash,l.account_id=any(${scope.transfers}::uuid[]) as clearing,
   (a.kind in ('asset','liability') and not(l.account_id=any(${scope.ids}::uuid[])) and not(l.account_id=any(${scope.transfers}::uuid[]))
    and not (a.kind='liability' and coalesce(p.kind='supplier',false))
    and not (a.kind='asset' and exists(select 1 from books_settings bs where bs.business_id=e.business_id and bs.receivable_account_id=l.account_id)
     and (coalesce(p.kind='customer',false) or exists(select 1 from invoice_payments ip where ip.business_id=e.business_id and ip.entry_id=e.id)))) as unknown_asset,
   coalesce((l.is_fx or l.account_id in (select fx_loss_account_id from books_settings where business_id=e.business_id union select fx_gain_account_id from books_settings where business_id=e.business_id)),false) as fx
  from journal_entries e join journals j on j.id=e.journal_id and j.business_id=e.business_id
   join journal_lines l on l.entry_id=e.id and l.business_id=e.business_id join accounts a on a.id=l.account_id and a.business_id=l.business_id
   left join parties p on p.id=l.party_id and p.business_id=l.business_id
  where e.business_id=${businessId}::uuid and e.state='posted' and j.kind not in ('opening','closing')
   and e.entry_date between ${o.today.slice(0,7)+'-01'}::date and ${o.today}::date
   and exists(select 1 from journal_lines cl where cl.business_id=e.business_id and cl.entry_id=e.id and cl.account_id=any(${scope.ids}::uuid[]))
 ), totals as (
  select id,entry_date::text as date,label,
   coalesce(sum(dr) filter(where cash and not is_fx),0) as cash_dr,coalesce(sum(cr) filter(where cash and not is_fx),0) as cash_cr,
   count(distinct account_id) filter(where cash and not is_fx) as cash_accounts,
   count(*) filter(where clearing) as clearing_lines,count(*) filter(where unknown_asset and not fx) as unknown_assets,
   count(*) filter(where not cash and not clearing and not fx) as external_lines,
   count(*) filter(where not cash and not clearing and not fx and kind<>'expense') as other_external,
   coalesce(sum(dr-cr) filter(where not cash and not clearing and not fx and kind='expense'),0) as expense,
   count(distinct currency) filter(where not fx) as currencies,count(*) filter(where fx and not cash) as fx_lines,
   count(*) filter(where not cash and not clearing and not fx and kind='expense' and cr>0) as expense_credits
  from lines group by id,entry_date,label
 ), classified as (
  select *,case
   when cash_dr=0 and cash_cr=0 then 'valuation'
   when unknown_assets>0 then 'review'
   when (cash_dr>0 and cash_cr>0 or clearing_lines>0) and external_lines=0 then 'transfer'
   when (cash_dr>0 and cash_cr>0 or clearing_lines>0) and other_external=0 and expense>0 and expense_credits=0 and currencies=1 and fx_lines=0 then 'transfer_fee'
   when clearing_lines>0 or cash_accounts>1 and cash_dr>0 and cash_cr>0 then 'review'
   when external_lines=0 and fx_lines>0 then 'valuation'
   else 'external' end as classification
  from totals
 ) select id::text as id,date,label,classification,
  case when classification='external' then cash_dr else 0 end::text as received,
  case when classification='external' then cash_cr when classification='transfer_fee' then expense else 0 end::text as "paidOut",
  case when classification='review' then case when unknown_assets>0 then 'unclassified_counterpart' else 'mixed_transfer' end else null end as reason from classified`;
export async function readOverviewCashEntries(tx:Tx,businessId:string,o:BooksOverviewOptions,p:OverviewPageOptions&{readonly state?:'review'|'external'|'transfer'}={}):Promise<OverviewPage<OverviewCashEntry>&{readonly state:OverviewState}> {
 day(o.today);const scope=await selected(tx,businessId,o.cashAccountIds,'cash',o.transferAccountIds,o.payableAccountIds);
 const filter=p.state==='transfer'?sql`classification in ('transfer','transfer_fee')`:p.state?sql`classification=${p.state}`:sql`true`;
 const page=await paged<OverviewCashEntry>(tx,sql`select * from (${cashSource(businessId,o,scope)}) c where ${filter}`,sql`date desc,id`,p);
 return {...page,state:scope.state,rows:page.rows.map(r=>({...r,received:decimal(r.received),paidOut:decimal(r.paidOut)}))};
}

export async function readBooksOverview(tx:Tx,businessId:string,o:BooksOverviewOptions):Promise<BooksOverview> {
 day(o.today);
 const business=(await sql<{currency:string}>`select books_currency(id) as currency from businesses where id=${businessId}::uuid`.execute(tx)).rows[0];
 if(!business)throw Error('Books workspace not found');
 const year=await fiscalYearOf(tx,businessId,o.today);
 const from=year?.startsOn??o.today.slice(0,4)+'-01-01';
 // Opening P&L is retained, matching existing Books reports; closing transfers to equity are excluded.
 const profit=(await sql<{amount:string}>`select coalesce(sum(amount::numeric),0)::text as amount from (${profitSource(businessId,from,o.today)}) p`.execute(tx)).rows[0]!.amount;
 const owed=(await sql<{currency:string;owed:string;refundDue:string;count:number;overdue:number}>`select currency,coalesce(sum(greatest(owed,0)),0)::text as owed,coalesce(sum(greatest(-owed,0)),0)::text as "refundDue",count(*) filter(where owed>0)::int as count,count(*) filter(where owed>0 and due_date<${o.today})::int as overdue
  from (${datedInvoices(businessId,o.today)}) i where state='issued' and issue_date<=${o.today} and owed<>0 group by currency order by currency`.execute(tx)).rows;
 const paper=(await sql<{unread:number;problem:number;ready:number;draft:number;posted:number;setAside:number;pending:number}>`select count(*) filter(where state='unread')::int as unread,count(*) filter(where state='problem')::int as problem,count(*) filter(where state='ready')::int as ready,count(*) filter(where state='draft')::int as draft,count(*) filter(where state='posted')::int as posted,count(*) filter(where state='set_aside')::int as "setAside",count(*) filter(where state in ('unread','problem','ready','draft'))::int as pending from (${paperSource(businessId)}) p`.execute(tx)).rows[0]!;
 const bank=(await sql<{n:number}>`select count(*)::int as n from (${bankSource(businessId)}) b`.execute(tx)).rows[0]!.n;
 const cashScope=await selected(tx,businessId,o.cashAccountIds,'cash',o.transferAccountIds,o.payableAccountIds);
 const cash=(await sql<{received:string;paidOut:string;reviews:number;transfers:number}>`select coalesce(sum(received::numeric),0)::text as received,coalesce(sum("paidOut"::numeric),0)::text as "paidOut",count(*) filter(where classification='review')::int as reviews,count(*) filter(where classification in ('transfer','transfer_fee'))::int as transfers from (${cashSource(businessId,o,cashScope)}) c`.execute(tx)).rows[0]!;
 const reviewIds=cash.reviews?(await sql<{id:string}>`select id from (${cashSource(businessId,o,cashScope)}) c where classification='review' order by date desc,id limit 50`.execute(tx)).rows.map(r=>r.id):[];
 const cashState:OverviewState=cashScope.state!=='available'?cashScope.state:cash.reviews?'needs_review':'available';
 const byAccount=cashScope.state==='available'?(await sql<{id:string;code:string;name:string;balance:string}>`select a.id::text as id,a.code,a.name,coalesce(sum(case when e.id is null then 0 else l.book_debit-l.book_credit end),0)::text as balance
  from accounts a left join journal_lines l on l.account_id=a.id and l.business_id=a.business_id left join journal_entries e on e.id=l.entry_id and e.business_id=l.business_id and e.state='posted' and e.entry_date<=${o.today}::date
  where a.business_id=${businessId}::uuid and a.id=any(${cashScope.ids}::uuid[]) group by a.id,a.code,a.name order by a.code,a.id`.execute(tx)).rows.map(r=>({...r,balance:decimal(r.balance)})):[];
 // A line whose entry is not posted by today joins no entry (e.id null) and counts nothing: each account's balance is its posted lines alone.
 const payableScope=await selected(tx,businessId,o.payableAccountIds,'payable');
 const supplier=(await sql<{owed:string;advances:string;unassignedOwed:string;unassignedAdvances:string;unassigned:number}>`select coalesce(sum(owed::numeric) filter(where not unassigned),0)::text as owed,coalesce(sum(advance::numeric) filter(where not unassigned),0)::text as advances,coalesce(sum(owed::numeric) filter(where unassigned),0)::text as "unassignedOwed",coalesce(sum(advance::numeric) filter(where unassigned),0)::text as "unassignedAdvances",count(*) filter(where unassigned)::int as unassigned from (${supplierSource(businessId,o.today,payableScope.ids)}) s`.execute(tx)).rows[0]!;
 const supplierState:OverviewState=payableScope.state!=='available'?payableScope.state:supplier.unassigned?'needs_review':'available';
 return {today:o.today,bookCurrency:business.currency,month:{from:o.today.slice(0,7)+'-01',to:o.today},fiscalYear:year,
  needsYou:{overdueInvoices:owed.reduce((n,r)=>n+r.overdue,0),unmatchedLines:bank,papers:paper},
  customerOwed:{byCurrency:owed.map(r=>({...r,owed:decimal(r.owed),refundDue:decimal(r.refundDue)}))},
  profit:{amount:decimal(profit),from,to:o.today,basis:year?'fiscal':'calendar'},
  cashToday:{state:cashScope.state,balance:cashScope.state==='available'?decimal((await sql<{s:string}>`select coalesce(sum(l.book_debit-l.book_credit),0)::text as s from journal_lines l join journal_entries e on e.id=l.entry_id and e.business_id=l.business_id
   where l.business_id=${businessId}::uuid and l.account_id=any(${cashScope.ids}::uuid[]) and e.state='posted' and e.entry_date<=${o.today}::date`.execute(tx)).rows[0]!.s):null,defaulted:cashScope.defaulted===true,byAccount},
  cash:{state:cashState,defaulted:cashScope.defaulted===true,received:cashState==='available'?decimal(cash.received):null,paidOut:cashState==='available'?decimal(cash.paidOut):null,selectedIds:cashScope.ids,transferIds:cashScope.transfers,reviewEntryIds:reviewIds,reviewCount:cash.reviews,excludedTransferCount:cash.transfers},
  supplierOwed:{state:supplierState,owed:supplierState==='available'?decimal(supplier.owed):null,advances:supplierState==='available'?decimal(supplier.advances):null,knownOwed:decimal(supplier.owed),knownAdvances:decimal(supplier.advances),unassignedOwed:decimal(supplier.unassignedOwed),unassignedAdvances:decimal(supplier.unassignedAdvances),selectedIds:payableScope.ids}};
}
