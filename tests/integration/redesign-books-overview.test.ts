import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { sql } from 'kysely';
import { createDb, withTenantTx, type Db, type Tx } from '../../src/db/client.js';
import { parseBusinessId } from '../../src/core/types/ids.js';
import { decimal } from '../../src/core/types/decimal.js';
import { draftEntry, postEntry, discardEntry, reverseEntry, type DraftLine } from '../../src/db/booksEntries.js';
import { draftInvoice, issueInvoice, recordPayment } from '../../src/db/booksInvoices.js';
import { draftCreditNote, issueCreditNote } from '../../src/db/booksCreditNotes.js';
import { importStatement, matchLine, openLines } from '../../src/db/bankStatements.js';
import { closeYear } from '../../src/db/booksClose.js';
import { keepReading, draftFromReading } from '../../src/db/booksDocuments.js';
import * as overview from '../../src/db/booksOverview.js';

const d=process.env['DATABASE_URL']&&process.env['MIGRATE_DATABASE_URL']?describe:describe.skip;
const TODAY='2026-11-06';
type Fixture={biz:string;ids:Record<string,string>};
d('Area 5 truthful dated Books overview',()=>{
 let db:Db,admin:pg.Client; const businesses:string[]=[];
 const tx=<T>(f:Fixture,fn:(t:Tx)=>Promise<T>)=>{const b=parseBusinessId(f.biz);if(!b.ok)throw Error('fixture');return withTenantTx(db,b.value,fn);};
 beforeAll(async()=>{db=createDb(process.env['DATABASE_URL']!);admin=new pg.Client({connectionString:process.env['MIGRATE_DATABASE_URL']});await admin.connect();});
 afterAll(async()=>{await db?.destroy();await admin?.end();});
 const setup=async():Promise<Fixture>=>{
  const f={biz:randomUUID(),ids:{} as Record<string,string>};businesses.push(f.biz);
  await admin.query("insert into businesses(id,name,country,currency,books_area) values($1,'Overview fixture','US','USD',true)",[f.biz]);
  await tx(f,async t=>{
   for(const [code,kind] of [['cash','asset'],['bank','asset'],['ar','asset'],['unknown','asset'],['clearing','asset'],['ap','liability'],['sales','income'],['cost','expense'],['loss','expense'],['gain','income'],['equity','equity']])f.ids[code!]=(await sql<{id:string}>`insert into accounts(business_id,code,name,kind) values(${f.biz}::uuid,${code!},${code!},${kind!}) returning id::text`.execute(t)).rows[0]!.id;
   for(const [code,kind] of [['general','bank'],['salesJournal','sales'],['opening','opening'],['closing','closing']])f.ids[code!]=(await sql<{id:string}>`insert into journals(business_id,code,name,kind) values(${f.biz}::uuid,${code!.slice(0,6).toUpperCase()},${code!},${kind!}) returning id::text`.execute(t)).rows[0]!.id;
   for(const [code,kind] of [['customer','customer'],['supplier','supplier'],['advance','supplier']])f.ids[code!]=(await sql<{id:string}>`insert into parties(business_id,code,name,kind) values(${f.biz}::uuid,${code!},${code!},${kind!}) returning id::text`.execute(t)).rows[0]!.id;
   await sql`insert into fiscal_years(business_id,starts_on,ends_on) values(${f.biz}::uuid,'2025-04-01','2026-03-31'),(${f.biz}::uuid,'2026-04-01','2027-03-31')`.execute(t);
   await sql`insert into books_settings(business_id,sales_journal_id,receivable_account_id,sales_account_id,fx_loss_account_id,fx_gain_account_id)
    values(${f.biz}::uuid,${f.ids['salesJournal']}::uuid,${f.ids['ar']}::uuid,${f.ids['sales']}::uuid,${f.ids['loss']}::uuid,${f.ids['gain']}::uuid)`.execute(t);
   await sql`insert into owner_rates(business_id,from_currency,to_currency,rate,stated_at) values(${f.biz}::uuid,'EUR','USD',2,'2025-04-01T00:00:00Z')`.execute(t);
  });return f;
 };
 const line=(f:Fixture,account:string,debit:string,credit:string,party?:string,currency='USD',fx=false):DraftLine=>({accountId:f.ids[account]!,partyId:party?f.ids[party]!:null,taxCodeId:null,currency,debit:debit==='0'?null:decimal(debit),credit:credit==='0'?null:decimal(credit),label:null,isFx:fx});
 const entry=async(f:Fixture,lines:DraftLine[],date=TODAY,journal='general',state='posted',acrossCurrencies=false)=>tx(f,async t=>{const r=await draftEntry(t,f.biz,'owner',{journalId:f.ids[journal]!,date,label:'Overview record',documentRef:randomUUID(),documentDate:date,lines,acrossCurrencies});if(r.kind!=='drafted')throw Error(JSON.stringify(r));if(state==='posted'){const p=await postEntry(t,f.biz,r.id,'owner');if(p.kind!=='posted')throw Error(JSON.stringify(p));}if(state==='discarded')await discardEntry(t,f.biz,r.id);return r.id;});
 const invoice=async(f:Fixture,amount='100',currency='USD',date='2026-11-01',due='2026-11-02')=>tx(f,async t=>{const r=await draftInvoice(t,f.biz,'owner',{partyId:f.ids['customer']!,issueDate:date,dueDate:due,currency,label:null,lines:[{label:'Recorded sale',quantity:decimal('1'),unitPrice:decimal(amount),accountId:f.ids['sales']!,taxCodeId:null}]});if(r.kind!=='drafted')throw Error(JSON.stringify(r));const issued=await issueInvoice(t,f.biz,r.id,'owner');if(issued.kind!=='issued')throw Error(JSON.stringify(issued));return r.id;});
 const pay=(f:Fixture,id:string,amount:string,date=TODAY,refund=false,paid?:{currency:string;amount:ReturnType<typeof decimal>})=>tx(f,async t=>{const r=await recordPayment(t,f.biz,id,'owner',{amount:decimal(amount),paidOn:date,accountId:f.ids['cash']!,journalId:f.ids['general']!,refund,...(paid?{paid}:{})});if(r.kind!=='recorded')throw Error(JSON.stringify(r));return r.entryId;});
 const credit=(f:Fixture,id:string,date:string,reduction='100')=>tx(f,async t=>{const r=await draftCreditNote(t,f.biz,'owner',{invoiceId:id,issueDate:date,reason:'Recorded adjustment',lines:[{invoiceLineNo:1,quantity:decimal('0'),reduction:decimal(reduction)}]});if(r.kind!=='drafted')throw Error(JSON.stringify(r));const c=await issueCreditNote(t,f.biz,r.id,'owner');if(c.kind!=='issued')throw Error(JSON.stringify(c));});
 const read=(f:Fixture,options:Partial<overview.BooksOverviewOptions>={})=>tx(f,t=>overview.readBooksOverview(t,f.biz,{today:TODAY,...options}));
 const chosen=(f:Fixture)=>({cashAccountIds:[f.ids['cash']!,f.ids['bank']!],payableAccountIds:[f.ids['ap']!]});

 it('distinguishes missing selections from confirmed zero, rejects foreign/wrong-kind IDs, and reads without writes',async()=>{
  const f=await setup(),other=await setup();const missing=await read(f);expect(missing.cash.state).toBe('needs_setup');expect(missing.cash.received).toBeNull();expect(missing.supplierOwed.state).toBe('needs_setup');
  const empty=await read(f,chosen(f));expect(empty.cash).toMatchObject({state:'available',received:'0',paidOut:'0'});expect(empty.supplierOwed).toMatchObject({state:'available',owed:'0',advances:'0'});
  for(const cashAccountIds of [[other.ids['cash']!],[f.ids['sales']!],['not-a-uuid']])expect((await read(f,{cashAccountIds})).cash.state).toBe('unavailable');
  expect((await read(f,{payableAccountIds:[other.ids['ap']!]})).supplierOwed.state).toBe('unavailable');
  await tx(f,async t=>{await sql`set transaction read only`.execute(t);expect((await overview.readBooksOverview(t,f.biz,{today:TODAY,...chosen(f)})).needsYou.overdueInvoices).toBe(0);});
 });
 it('counts 205 overdue invoices without capping, excludes future settlements/credits, and paginates exact records',async()=>{
  const f=await setup();for(let i=0;i<205;i++)await invoice(f,'1');const id=await invoice(f,'100');await pay(f,id,'40','2026-11-07');await credit(f,id,'2026-11-08','20');
  await invoice(f,'99','USD','2026-11-20','2026-11-21');await invoice(f,'7','EUR');
  const r=await read(f);expect(r.needsYou.overdueInvoices).toBe(207);expect(r.customerOwed.byCurrency).toEqual(expect.arrayContaining([expect.objectContaining({currency:'USD',owed:'305',count:206}),expect.objectContaining({currency:'EUR',owed:'7',count:1})]));
  const pages=[];for(let page=1;page<=5;page++){const p=await tx(f,t=>overview.readOverviewInvoices(t,f.biz,TODAY,{state:'overdue',page}));expect(p.total).toBe(207);pages.push(...p.rows.map(i=>i.id));}expect(new Set(pages).size).toBe(207);
  expect((await tx(f,t=>overview.readOverviewInvoices(t,f.biz,TODAY,{state:'unpaid',q:'customer',page:999}))).page).toBe(5);
 });
 it('counts posted cash once even after statement matching, distinguishes unpaid profit, and keeps refunds as paid out',async()=>{
  const f=await setup();const id=await invoice(f);let r=await read(f,chosen(f));expect(r.profit.amount).toBe('100');expect(r.cash.received).toBe('0');expect(r.customerOwed.byCurrency[0]?.owed).toBe('100');
  const eid=await pay(f,id,'100');await credit(f,id,TODAY);r=await read(f,chosen(f));expect(r.customerOwed.byCurrency[0]?.refundDue).toBe('100');await pay(f,id,'25',TODAY,true);
  await tx(f,async t=>{await importStatement(t,f.biz,'owner',f.ids['cash']!,'csv','fixture',[{bookedOn:TODAY,amount:decimal('100'),currency:'USD',wording:null,reference:null,fingerprint:randomUUID()}]);const s=(await sql<{id:string}>`select id from statement_lines where business_id=${f.biz}::uuid`.execute(t)).rows[0]!;const l=(await sql<{id:string}>`select id from journal_lines where entry_id=${eid}::uuid and account_id=${f.ids['cash']}::uuid`.execute(t)).rows[0]!;expect(await matchLine(t,f.biz,'owner',s.id,l.id)).toBe(true);});
  r=await read(f,chosen(f));expect(r.cash).toMatchObject({received:'100',paidOut:'25'});expect(r.needsYou.unmatchedLines).toBe(0);expect(r.customerOwed.byCurrency[0]?.refundDue).toBe('75');
 });
 it('uses actual settlement books value, not invoice currency payment amount; fiscal profit is exact and opening P&L retained',async()=>{
  const f=await setup();const id=await invoice(f,'100','EUR');await pay(f,id,'100',TODAY,false,{currency:'USD',amount:decimal('210')});
  await entry(f,[line(f,'cash','99','0'),line(f,'sales','0','99')],'2026-03-31');
  await entry(f,[line(f,'cash','10.01','0'),line(f,'sales','0','10.01')],'2026-04-01','opening');
  const r=await read(f,chosen(f));expect(r.cash.received).toBe('210');expect(r.profit).toMatchObject({amount:'220.01',from:'2026-04-01',to:TODAY,basis:'fiscal'});
 });
 it('excludes selected-account transfers and explicit clearing, retains a fee and gross same-account batch directions',async()=>{
  const f=await setup();await entry(f,[line(f,'cash','0','100'),line(f,'bank','100','0')]);await entry(f,[line(f,'cash','0','103'),line(f,'bank','100','0'),line(f,'cost','3','0')]);
  await entry(f,[line(f,'cash','0','22'),line(f,'bank','10','0',undefined,'EUR'),line(f,'loss','2','0',undefined,'USD',true)],TODAY,'general','posted',true);
  await entry(f,[line(f,'cash','20','0'),line(f,'ar','0','20','customer'),line(f,'cash','0','8'),line(f,'ap','8','0','supplier')]);
  await entry(f,[line(f,'cash','0','50'),line(f,'clearing','50','0')]);await entry(f,[line(f,'bank','50','0'),line(f,'clearing','0','50')]);
  const r=await read(f,{...chosen(f),transferAccountIds:[f.ids['clearing']!]});expect(r.cash).toMatchObject({state:'available',received:'20',paidOut:'11'});expect(r.cash.excludedTransferCount).toBe(5);
 });
 it('does not invent cash from FX valuation or ambiguous asset and mixed transfers',async()=>{
  const f=await setup();await entry(f,[line(f,'cash','5','0'),line(f,'gain','0','5',undefined,'USD',true)]);
  expect((await read(f,chosen(f))).cash.received).toBe('0');const unknown=await entry(f,[line(f,'cash','0','40'),line(f,'unknown','40','0')]);
  const r=await read(f,chosen(f));expect(r.cash).toMatchObject({state:'needs_review',received:null,paidOut:null});expect(r.cash.reviewEntryIds).toContain(unknown);
  const page=await tx(f,t=>overview.readOverviewCashEntries(t,f.biz,{today:TODAY,...chosen(f)},{state:'review'}));expect(page.rows.map(e=>e.id)).toContain(unknown);
 });
 it('keeps supplier advances separate and exposes unassigned liability balances',async()=>{
  const f=await setup();await entry(f,[line(f,'cost','100','0'),line(f,'ap','0','100','supplier')]);await entry(f,[line(f,'ap','20','0','advance'),line(f,'cash','0','20')]);
  let r=await read(f,chosen(f));expect(r.supplierOwed).toMatchObject({state:'available',owed:'100',advances:'20'});
  await entry(f,[line(f,'cost','9','0'),line(f,'ap','0','9')]);r=await read(f,chosen(f));expect(r.supplierOwed.unassignedOwed).toBe('9');expect(r.supplierOwed.state).toBe('needs_review');
 });
 it('counts 205 unmatched lines and one work item per paper across read/draft/posted/discarded/history states',async()=>{
  const f=await setup();await tx(f,t=>importStatement(t,f.biz,'owner',f.ids['cash']!,'csv','many',Array.from({length:205},()=>({bookedOn:TODAY,amount:decimal('1'),currency:'USD',wording:null,reference:null,fingerprint:randomUUID()}))));
  const paper=async(history=false,entryId:string|null=null)=>tx(f,async t=>(await sql<{id:string}>`insert into documents(business_id,entry_id,name,media_type,bytes,sha256,residency,store,key_version,created_by,history_through,history_entries)
   values(${f.biz}::uuid,${entryId}::uuid,'Receipt','image/png',10,${'a'.repeat(64)},'test','database',1,'owner',${history?TODAY:null}::date,${history?1:null}) returning id::text`.execute(t)).rows[0]!.id);
  for(let i=0;i<205;i++)await paper();await paper(true);
  const draft=await entry(f,[line(f,'cost','10','0'),line(f,'ap','0','10','supplier')],TODAY,'general','draft');const posted=await entry(f,[line(f,'cost','10','0'),line(f,'ap','0','10','supplier')]);const discarded=await entry(f,[line(f,'cost','10','0'),line(f,'ap','0','10','supplier')],TODAY,'general','discarded');
  await paper(false,draft);await paper(false,posted);await paper(false,discarded);
  const bad=await paper();await tx(f,t=>keepReading(t,f.biz,bad,'owner',{outcome:'unreadable',reading:null,problems:[],modelId:'fixture',promptVersion:'fixture'}));
  const r=await read(f);expect(r.needsYou.unmatchedLines).toBe(205);expect(r.needsYou.papers).toMatchObject({unread:205,problem:1,draft:1,posted:1,setAside:1,pending:207});
  const p=await tx(f,t=>overview.readOverviewPapers(t,f.biz,{state:'pending',page:5}));expect(p.total).toBe(207);expect(p.rows).toHaveLength(7);
  const bank=await tx(f,t=>overview.readOverviewBankLines(t,f.biz,{page:5}));expect(bank.total).toBe(205);expect(bank.rows).toHaveLength(5);
 });
 it('respects month and fiscal boundaries, includes reversals, excludes closing, and labels the calendar fallback',async()=>{
  const f=await setup();await entry(f,[line(f,'cash','15.31','0'),line(f,'sales','0','15.31')],'2026-10-31');
  const original=await entry(f,[line(f,'cash','12.01','0'),line(f,'sales','0','12.01')]);
  await tx(f,async t=>{expect((await reverseEntry(t,f.biz,original,'owner',TODAY)).kind).toBe('reversed');});
  await entry(f,[line(f,'cash','999','0'),line(f,'sales','0','999')],'2026-11-07');
  await entry(f,[line(f,'cash','33','0'),line(f,'sales','0','33')],'2026-03-01');
  await tx(f,async t=>{const year=(await sql<{id:string}>`select id from fiscal_years where business_id=${f.biz}::uuid and ends_on='2026-03-31'`.execute(t)).rows[0]!.id;
   expect((await closeYear(t,f.biz,{yearId:year,resultAccountId:f.ids['equity']!,journalId:f.ids['closing']!,by:'owner',label:'Close year',ref:'CLOSE'})).kind).toBe('closed');});
  expect((await read(f,{today:'2026-03-31'})).profit.amount).toBe('33');
  const r=await read(f,chosen(f));expect(r.cash).toMatchObject({received:'12.01',paidOut:'12.01'});expect(r.profit.amount).toBe('15.31');
  expect((await read(f,{today:'2027-03-31'})).profit.amount).toBe('1014.31');
  expect((await read(f,{today:'2028-11-06'})).profit).toMatchObject({basis:'calendar',from:'2028-01-01',amount:'0'});
 });
 it('marks mixed transfer/clearing entries for review without silently showing partial cash',async()=>{
  const f=await setup();const id=await entry(f,[line(f,'cash','20','0'),line(f,'bank','0','10'),line(f,'ar','0','10','customer')]);
  const clearing=await entry(f,[line(f,'cash','20','0'),line(f,'clearing','0','10'),line(f,'sales','0','10')]);
  const r=await read(f,{...chosen(f),transferAccountIds:[f.ids['clearing']!]});expect(r.cash.state).toBe('needs_review');expect(r.cash.received).toBeNull();expect(r.cash.reviewEntryIds).toEqual(expect.arrayContaining([id,clearing]));
 });
 it('keeps one paper work item and preserves drafting a fresh reading after discarded or posted earlier readings',async()=>{
  const f=await setup();const paper=await tx(f,async t=>(await sql<{id:string}>`insert into documents(business_id,name,media_type,bytes,sha256,residency,store,key_version,created_by)
   values(${f.biz}::uuid,'One original','image/png',10,${'b'.repeat(64)},'test','database',1,'owner') returning id::text`.execute(t)).rows[0]!.id);
  const reading={kind:'bill' as const,supplierName:'Supplier',supplierTaxId:null,number:'R1',date:TODAY,currency:'USD',lines:[{label:'Expense',net:decimal('10'),taxRate:decimal('0'),tax:decimal('0')}],total:decimal('10')};
  const kept=()=>tx(f,t=>keepReading(t,f.biz,paper,'owner',{outcome:'read',reading,problems:[],modelId:'fixture',promptVersion:'fixture'}));
  const draft=async(id:string)=>tx(f,async t=>{const r=await draftFromReading(t,f.biz,id,'owner',{journalId:f.ids['general']!,partyId:f.ids['supplier']!,payableAccountId:f.ids['ap']!,lines:[{accountId:f.ids['cost']!,taxCodeId:null}]});expect(r.kind).toBe('drafted');if(r.kind!=='drafted')throw Error('fixture draft');return r.id;});
  const first=await kept();expect((await read(f)).needsYou.papers).toMatchObject({ready:1,pending:1});
  const firstEntry=await draft(first);expect((await read(f)).needsYou.papers).toMatchObject({draft:1,ready:0,pending:1});
  await tx(f,t=>discardEntry(t,f.biz,firstEntry));expect((await read(f)).needsYou.papers).toMatchObject({setAside:1,pending:0});
  const second=await kept();expect(await tx(f,t=>overview.readOverviewPaper(t,f.biz,paper))).toMatchObject({state:'ready',entryId:null});
  expect((await read(f)).needsYou.papers).toMatchObject({ready:1,setAside:0,pending:1});
  const secondEntry=await draft(second);await tx(f,t=>postEntry(t,f.biz,secondEntry,'owner'));
  expect((await read(f)).needsYou.papers).toMatchObject({posted:1,ready:0,pending:0});
  const third=await kept();expect(await tx(f,t=>overview.readOverviewPaper(t,f.biz,paper))).toMatchObject({state:'ready',entryId:null});
  expect((await read(f)).needsYou.papers).toMatchObject({ready:1,posted:0,pending:1});await draft(third);
  expect((await read(f)).needsYou.papers).toMatchObject({draft:1,posted:0,pending:1});
  expect((await tx(f,t=>overview.readOverviewPapers(t,f.biz))).rows).toHaveLength(1);
 });
 it('never exposes another tenant through overview supporting reads',async()=>{
  const f=await setup(),other=await setup();await invoice(other,'123');
  await tx(f,async t=>{expect((await overview.readOverviewInvoices(t,other.biz,TODAY)).total).toBe(0);expect((await overview.readOverviewPapers(t,other.biz)).total).toBe(0);expect((await overview.readOverviewBankLines(t,other.biz)).total).toBe(0);await expect(overview.readBooksOverview(t,other.biz,{today:TODAY})).rejects.toThrow('Books workspace not found');});
 });

 it('keeps ambiguous liability counterparts out of cash headlines and validates normalized account selections',async()=>{
  const f=await setup();expect((await read(f,{cashAccountIds:[f.ids['cash']!.toUpperCase()]})).cash.state).toBe('available');
  const id=await entry(f,[line(f,'cash','0','10'),line(f,'ap','10','0')]);
  const r=await read(f,chosen(f));expect(r.cash.state).toBe('needs_review');expect(r.cash.reviewEntryIds).toContain(id);expect(r.cash.paidOut).toBeNull();
 });
 it('drills supplier and profit totals into uncapped exact supporting entries with matching filters',async()=>{
  const f=await setup();for(let i=0;i<105;i++)await entry(f,[line(f,'cost','0.01','0'),line(f,'ap','0','0.01','supplier')]);
  await entry(f,[line(f,'cost','2','0'),line(f,'ap','0','2')]);
  const supplier=await tx(f,t=>overview.readOverviewSupplierEntries(t,f.biz,{today:TODAY,...chosen(f)},{partyId:f.ids['supplier']!,page:3}));
  expect(supplier.total).toBe(105);expect(supplier.rows).toHaveLength(5);expect(supplier.rows.every(r=>r.bookCredit==='0.01'&&r.entryId)).toBe(true);
  const missing=await tx(f,t=>overview.readOverviewSupplierEntries(t,f.biz,{today:TODAY,...chosen(f)},{unassigned:true}));expect(missing.total).toBe(1);expect(missing.rows[0]?.bookCredit).toBe('2');
  const profit=await tx(f,t=>overview.readOverviewProfitEntries(t,f.biz,TODAY,{page:3}));expect(profit.total).toBe(106);expect(profit.rows).toHaveLength(6);expect(profit).toMatchObject({basis:'fiscal',fromDate:'2026-04-01',toDate:TODAY});
  expect((await read(f)).profit.amount).toBe('-3.05');
 });

 it('excludes a cash-only self transfer, rejects conflicting report roles, and handles missing FX settings conservatively',async()=>{
  const f=await setup();await entry(f,[line(f,'cash','10','0'),line(f,'cash','0','10')]);
  expect((await read(f,chosen(f))).cash).toMatchObject({state:'available',received:'0',paidOut:'0',excludedTransferCount:1});
  expect((await read(f,{...chosen(f),transferAccountIds:[f.ids['ap']!]})).cash.state).toBe('unavailable');
  await tx(f,t=>sql`update books_settings set fx_loss_account_id=null,fx_gain_account_id=null where business_id=${f.biz}::uuid`.execute(t));
  await entry(f,[line(f,'cash','0','2'),line(f,'unknown','2','0')]);expect((await read(f,chosen(f))).cash.state).toBe('needs_review');
 });

 it('opens an exact unmatched bank line beyond the first 200, retaining suggestions and tenant/account boundaries',async()=>{
  const f=await setup(),other=await setup();
  await tx(f,t=>importStatement(t,f.biz,'owner',f.ids['cash']!,'csv','exact-line',Array.from({length:205},()=>({bookedOn:TODAY,amount:decimal('1'),currency:'USD',wording:'Exact line',reference:null,fingerprint:randomUUID()}))));
  const eid=await entry(f,[line(f,'cash','1','0'),line(f,'sales','0','1')]);
  const last=(await tx(f,t=>overview.readOverviewBankLines(t,f.biz,{page:5}))).rows.at(-1)!;
  const first=await tx(f,t=>openLines(t,f.biz,f.ids['cash']!));expect(first).toHaveLength(200);expect(first.map(r=>r.id)).not.toContain(last.id);
  const exact=await tx(f,t=>openLines(t,f.biz,f.ids['cash']!,last.id));expect(exact).toHaveLength(1);expect(exact[0]).toMatchObject({id:last.id,amount:'1',suggestions:[expect.objectContaining({entryId:eid})]});
  expect(await tx(f,t=>openLines(t,f.biz,f.ids['bank']!,last.id))).toEqual([]);
  expect(await tx(other,t=>openLines(t,other.biz,other.ids['cash']!,last.id))).toEqual([]);
  expect(await tx(other,t=>openLines(t,f.biz,f.ids['cash']!,last.id))).toEqual([]);
  await tx(f,async t=>{expect(await matchLine(t,f.biz,'owner',last.id,exact[0]!.suggestions[0]!.journalLineId)).toBe(true);expect(await openLines(t,f.biz,f.ids['cash']!,last.id)).toEqual([]);});
 });
 it('resolves one paper through the same classification and pages all retained history separately',async()=>{
  const f=await setup(),other=await setup();
  const ids=await tx(f,async t=>{const rows=[];for(let i=0;i<205;i++)rows.push((await sql<{id:string}>`insert into documents(business_id,name,media_type,bytes,sha256,residency,store,key_version,created_by,history_through,history_entries)
   values(${f.biz}::uuid,${'Source '+i},'text/csv',10,${String(i).padStart(64,'c')},'test','database',1,'owner',${TODAY}::date,${i+1}) returning id::text`.execute(t)).rows[0]!.id);return rows;});
  const paper=await tx(f,async t=>(await sql<{id:string}>`insert into documents(business_id,name,media_type,bytes,sha256,residency,store,key_version,created_by)
   values(${f.biz}::uuid,'Real paper','image/png',10,${'d'.repeat(64)},'test','database',1,'owner') returning id::text`.execute(t)).rows[0]!.id);
  await tx(f,t=>keepReading(t,f.biz,paper,'owner',{outcome:'unreadable',reading:null,problems:[],modelId:'fixture',promptVersion:'fixture'}));
  const classified=await tx(f,t=>overview.readOverviewPaper(t,f.biz,paper));expect(classified).toMatchObject({id:paper,state:'problem',lastOutcome:'unreadable'});
  expect(classified).toEqual((await tx(f,t=>overview.readOverviewPapers(t,f.biz))).rows[0]);
  expect(await tx(f,t=>overview.readOverviewPaper(t,f.biz,ids[0]!))).toBeNull();expect(await tx(f,t=>overview.readOverviewPaper(t,f.biz,'invalid'))).toBeNull();
  const found:string[]=[];for(let page=1;page<=5;page++){const result=await tx(f,t=>overview.readOverviewHistoryPapers(t,f.biz,{page}));expect(result.total).toBe(205);found.push(...result.rows.map(r=>r.id));expect(result.rows.every(r=>r.historyThrough===TODAY&&r.historyEntries>0&&r.keepUntil&&r.bytes===10)).toBe(true);}
  expect(new Set(found)).toEqual(new Set(ids));expect((await read(f)).needsYou.papers).toMatchObject({problem:1,pending:1});
  expect(await tx(other,t=>overview.readOverviewPaper(t,f.biz,paper))).toBeNull();expect((await tx(other,t=>overview.readOverviewHistoryPapers(t,f.biz))).total).toBe(0);
 });

});
