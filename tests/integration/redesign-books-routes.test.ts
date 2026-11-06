import {settingsHref} from '../../src/api/web/settingsNavigation.js';
import {dayKey} from '../../src/core/owner/i18n/format.js';
import { draftEntryForm, loadEntry } from '../../src/db/booksEntries.js';
import { keepReading } from '../../src/db/booksDocuments.js';
import { checkReading, parseReadingAnswer } from '../../src/core/books/reading.js';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import Fastify from 'fastify';
import {randomUUID} from 'node:crypto';
import {sql} from 'kysely';
import {createDb,withTenantTx,type Db,type Tx} from '../../src/db/client.js';
import {parseBusinessId} from '../../src/core/types/ids.js';
import {decimal} from '../../src/core/types/decimal.js';
import {draftInvoice,issueInvoice} from '../../src/db/booksInvoices.js';
import {documentStoresFrom} from '../../src/db/documents.js';
import {seedRunTenant} from './tenant.js';
const d=process.env['DATABASE_URL']&&process.env['MIGRATE_DATABASE_URL']?describe:describe.skip;
const B=randomUUID(),F=randomUUID(),zone=new Date().getUTCHours()>=10?'Pacific/Kiritimati':'Pacific/Pago_Pago',today=dayKey(new Date(),zone),year=today.slice(0,4),key=Buffer.alloc(32,1);
const FORM={'content-type':'application/x-www-form-urlencoded'};
d('Approved Books destinations and bounded read-only overview',()=>{
 let db:Db,app:ReturnType<typeof Fastify>,owner='',staff='',accountant='',invoice='',paper='',foreignPaper='',calls=0;const ids:Record<string,string>={};
 const tx=<T>(fn:(t:Tx)=>Promise<T>,biz=B)=>{const b=parseBusinessId(biz);if(!b.ok)throw Error('fixture');return withTenantTx(db,b.value,fn);};
 const get=(url:string,cookie=owner)=>app.inject({method:'GET',url: settingsHref(url),headers:{cookie}});
 const post=(url:string,body:Record<string,string>={},cookie=owner)=>app.inject({method:'POST',url,payload:new URLSearchParams(body).toString(),headers:{cookie,...FORM}});
 const plain=(body:string)=>body.replace(/<(style|script)\b[\s\S]*?<\/\1>/gi,'').replace(/<[^>]*>/g,' ');
 const scopes=()=>new URLSearchParams({cash:ids['cash']!,payable:ids['payable']!}).toString();
 beforeAll(async()=>{
  await seedRunTenant();db=createDb(process.env['DATABASE_URL']!);
  await tx(async t=>{
   await sql`insert into businesses(id,name,country,currency,owner_locale,books_area,timezone) values(${B}::uuid,'Books route business','US','USD','en',true,${zone})`.execute(t);
   for(const [code,kind] of [['cash','asset'],['receivable','asset'],['sales','income'],['cost','expense'],['payable','liability']])ids[code!]=(await sql<{id:string}>`insert into accounts(business_id,code,name,kind) values(${B}::uuid,${code!},${code!},${kind!}) returning id::text`.execute(t)).rows[0]!.id;
   ids['journal']=(await sql<{id:string}>`insert into journals(business_id,code,name,kind) values(${B}::uuid,'SALES','Sales','sales') returning id::text`.execute(t)).rows[0]!.id;
   ids['purchases']=(await sql<{id:string}>`insert into journals(business_id,code,name,kind) values(${B}::uuid,'PURCH','Purchases','purchases') returning id::text`.execute(t)).rows[0]!.id;
   ids['supplier']=(await sql<{id:string}>`insert into parties(business_id,code,name,kind) values(${B}::uuid,'SUP','Recorded supplier','supplier') returning id::text`.execute(t)).rows[0]!.id;
   ids['party']=(await sql<{id:string}>`insert into parties(business_id,code,name,kind) values(${B}::uuid,'ONE','Recorded customer','customer') returning id::text`.execute(t)).rows[0]!.id;
   await sql`insert into fiscal_years(business_id,starts_on,ends_on) values(${B}::uuid,${year+'-01-01'}::date,${year+'-12-31'}::date)`.execute(t);
   await sql`insert into books_settings(business_id,sales_journal_id,receivable_account_id,sales_account_id) values(${B}::uuid,${ids['journal']}::uuid,${ids['receivable']}::uuid,${ids['sales']}::uuid)`.execute(t);
   const made=await draftInvoice(t,B,'owner',{partyId:ids['party']!,issueDate:today,dueDate:today,currency:'USD',label:'Unpaid recorded sale',lines:[{label:'Kept invoice item',quantity:decimal('1'),unitPrice:decimal('125'),accountId:ids['sales']!,taxCodeId:null}]});if(made.kind!=='drafted')throw Error('invoice');invoice=made.id;if((await issueInvoice(t,B,invoice,'owner')).kind!=='issued')throw Error('issue');
   paper=(await documentStoresFrom({},key).put(t,{businessId:B,name:'Original receipt.png',mediaType:'image/png',bytes:Buffer.from('89504e470d0a1a0a','hex'),by:'owner'})).id;
  });
  await tx(async t=>{await sql`insert into businesses(id,name,country,currency,books_area) values(${F}::uuid,'Foreign Books','US','USD',true)`.execute(t);foreignPaper=(await documentStoresFrom({},key).put(t,{businessId:F,name:'Foreign original.png',mediaType:'image/png',bytes:Buffer.from('89504e470d0a1a0a','hex'),by:'owner'})).id;},F);
  const {registerWebApp}=await import('../../src/api/web/app.js');app=Fastify({logger:false});const secret='area-five-isolated-session-secret-at-least-thirty-two';registerWebApp(app,{db,businessId:B,accessCode:'books-route-owner',sessionSecret:secret,employeeName:'Lily',avatar:'L',provider:'disabled',secureCookie:false,messagingEnabled:false,factsTtlMs:0,credentialKey:key,documents:documentStoresFrom({},key),kickOutbound:async()=>{calls++;},kickDrive:async()=>{calls++;}} as unknown as Parameters<typeof registerWebApp>[1]);await app.ready();
  const login=async(code:string)=>String((await post('/login',{code},'')).headers['set-cookie']??'').split(';')[0]!;owner=await login('books-route-owner');const {addPerson}=await import('../../src/api/web/people.js');const one=await addPerson(db,B,secret,'Books staff','team'),two=await addPerson(db,B,secret,'Books accountant','accountant');if(one.code!=='added'||two.code!=='added')throw Error('people');staff=await login(one.accessCode);accountant=await login(two.accessCode);
 },60_000);
 afterAll(async()=>{await app?.close();await db?.destroy();});
 it('offers every canonical read destination with staff excluded and accountant read-only',async()=>{
  for(const path of ['/app/books','/app/books/invoices','/app/books/spending','/app/books/bank','/app/books/bank?view=unmatched','/app/books/reports','/app/books/reports/cash','/app/books/reports/profit','/app/books/reports/suppliers','/app/books/reports/suppliers/entries','/app/books/year-end','/app/books/advanced','/app/books/advanced/entries','/app/books/advanced/trial-balance']){
   expect((await get(path)).statusCode,path).toBe(200);expect((await get(path,accountant)).statusCode,path+' accountant').toBe(200);expect((await get(path,staff)).statusCode,path+' staff').toBe(302);
  }
  for(const path of ['/app/settings/books','/app/settings/books/country','/app/settings/books/connections','/app/settings/books/accounts','/app/settings/books/tax','/app/settings/books/starting-balances']){expect((await get(path)).statusCode,path).toBe(200);for(const who of [staff,accountant])expect((await get(path,who)).statusCode,path).toBe(302);}
  expect((await get('/app/settings/books/fields',accountant)).statusCode).toBe(200);
  for(const path of ['/app/books/fec','/app/books/reports/fec'])expect((await get(path)).statusCode,path).toBe(404);
 });
 it('redirects old GET destinations and preserves query values, without moving commands',async()=>{
  for(const [old,now] of [['entries','advanced/entries'],['entries/new','advanced/entries/new'],['trial-balance','advanced/trial-balance'],['closing','year-end'],['papers','spending']]){const r=await get('/app/books/'+old+'?page=2&q=kept%20value');expect([r.statusCode,r.headers.location]).toEqual([302,'/app/books/'+now+'?page=2&q=kept%20value']);}
  const p=await get('/app/books/papers/'+paper);expect(p.headers.location).toBe('/app/books/spending/'+paper);
  const newEntry=await get('/app/books/advanced/entries/new');expect(newEntry.body).toContain('action="/app/books/entries"');
  const bad=await post('/app/books/entries',{label:'Retained typed entry'});expect(bad.statusCode).toBe(422);expect(bad.body).toContain('Retained typed entry');
 });
 it('separates unpaid sale profit from cash and links the exact source records',async()=>{
  const home=await get('/app/books?'+scopes());expect(home.statusCode).toBe(200);const text=plain(home.body);for(const word of ['Needs you','This month','Received','Paid out','Customers owe you','You owe','Profit this year'])expect(text).toContain(word);
  expect(text).toContain('125');expect(text).not.toMatch(/\bdebits?\b|\bcredits?\b(?!\s+notes?)/i);expect(home.body).toContain('/app/books/reports/cash?');expect(home.body).not.toContain('action="/app/books/odoo/connect"');
  const profit=await get('/app/books/reports/profit');expect(profit.body).toContain('Unpaid recorded sale');expect(profit.body).toContain('/app/books/advanced/entries/');
  const missing=plain((await get('/app/books')).body);expect(missing).toContain('Choose accounts');
 });
 it('keeps filtered invoice context through detail and refused issued-document edits',async()=>{
  const from='/app/books/invoices?q=Recorded&state=unpaid&page=3#invoice-'+invoice;
  const list=await get('/app/books/invoices?q=Recorded&state=unpaid');expect(list.body).toContain('Recorded customer');expect(list.body).toContain('?from=');
  const detail=await get('/app/books/invoices/'+invoice+'?from='+encodeURIComponent(from));expect(detail.body).toContain('Books route business');expect(detail.body).toContain('name="from"');expect(detail.body).toContain('Recorded customer');
  const refusal=await post('/app/books/invoices/'+invoice+'/discard',{from});expect(String(refusal.headers.location)).toContain('?from=');
  const bad=await post('/app/books/invoices/'+invoice+'/payments',{from,amount:'invalid'});expect(String(bad.headers.location)).toContain('?from=');
  const hostile=await post('/app/books/invoices/'+invoice+'/discard',{from:'https://evil.invalid'});expect(String(hostile.headers.location)).not.toContain('evil');
 });
 it('previews only the tenant original with safe headers and preserves attachment download',async()=>{
  const preview=await get('/app/books/spending/'+paper+'/preview');expect(preview.statusCode).toBe(200);expect(preview.headers['content-type']).toContain('image/png');expect(preview.headers['content-disposition']).toContain('inline');expect(preview.headers['x-content-type-options']).toBe('nosniff');
  const download=await get('/app/books/papers/'+paper+'/file');expect(download.statusCode).toBe(200);expect(download.headers['content-disposition']).toContain('attachment');
  expect((await get('/app/books/spending/'+foreignPaper+'/preview')).statusCode).toBe(404);expect((await get('/app/books/spending/'+paper+'/preview',staff)).statusCode).toBe(302);
 });
 it('keeps receipt-draft choices on a refused new presentation',async()=>{
  const reading=await tx(async t=>{const raw=parseReadingAnswer(JSON.stringify({kind:'bill',supplier:{name:'Recorded supplier',taxId:''},number:'REFUSAL-UI',date:today,currency:'USD',lines:[{label:'Supplies',net:'12',taxRate:'0',tax:'0'}],totalNet:'12',totalTax:'0',total:'12'}));if(!raw)throw Error('reading');const c=checkReading(raw);return keepReading(t,B,paper,'owner',{outcome:'read',reading:c.reading,problems:c.problems,modelId:'local-fixture',promptVersion:'fixture'});});
  const response=await post('/app/books/papers/'+paper+'/draft',{reading,journal:ids['purchases']!,party:ids['supplier']!,payable:'',account0:ids['cost']!,tax0:'',presentation:'spending'});
  expect(response.statusCode).toBe(422);for(const id of [ids['purchases'],ids['supplier'],ids['cost']])expect(response.body).toContain(`value="${id}" selected`);expect(response.body).toContain('role="alert"');expect(response.body).toContain('name="reading" value="'+reading+'"');
 });
 it('checks, edits and saves a receipt through the original commands without losing entered values or paper context',async()=>{
  const reading=await tx(async t=>{
   const raw=parseReadingAnswer(JSON.stringify({kind:'bill',supplier:{name:'Recorded supplier',taxId:''},number:'BILL-UI',date:today,currency:'USD',lines:[{label:'Supplies',net:'12',taxRate:'0',tax:'0'}],totalNet:'12',totalTax:'0',total:'12'}));if(!raw)throw Error('reading');const checked=checkReading(raw);expect(checked.problems).toEqual([]);
   return keepReading(t,B,paper,'owner',{outcome:'read',reading:checked.reading,problems:checked.problems,modelId:'local-fixture',promptVersion:'fixture'});
  });
  // A newer, unlinked reading arrives from another tab before this older form is submitted.
  await tx(async t=>{const old=(await sql<{reading:unknown}>`select reading from document_readings where business_id=${B}::uuid and id=${reading}::uuid`.execute(t)).rows[0]!.reading;return keepReading(t,B,paper,'owner',{outcome:'read',reading:old as Parameters<typeof keepReading>[4]['reading'],problems:[],modelId:'local-fixture',promptVersion:'newer-tab'});});
  const from='/app/books/spending?state=ready&page=3#paper-'+paper;
  const drafted=await post('/app/books/papers/'+paper+'/draft',{reading,journal:ids['purchases']!,party:ids['supplier']!,payable:ids['payable']!,account0:ids['cost']!,tax0:'',from});
  expect(drafted.statusCode).toBe(302);expect(String(drafted.headers.location)).toContain('/app/books/spending/'+paper+'/draft?entry=');
  const entryId=await tx(async t=>(await sql<{id:string}>`select entry_id::text as id from document_readings where business_id=${B}::uuid and id=${reading}::uuid`.execute(t)).rows[0]!.id);
  expect(new URL(String(drafted.headers.location),'https://local.invalid').searchParams.get('entry')).toBe(entryId);
  expect((await get('/app/books/spending/'+paper+'/draft?entry='+randomUUID())).statusCode).toBe(404);
  const duplicate=await post('/app/books/papers/'+paper+'/draft',{reading,journal:ids['purchases']!,party:ids['supplier']!,payable:ids['payable']!,account0:ids['cost']!,tax0:'',presentation:'spending',from});
  expect(duplicate.statusCode).toBe(422);expect(duplicate.body).toContain('role="alert"');expect(duplicate.body).toContain('/draft?entry='+entryId);expect(duplicate.body).not.toContain('name="presentation"');
  const page=await get(String(drafted.headers.location));expect(page.statusCode).toBe(200);expect(page.body).toContain('Save to the books');expect(page.body).toContain('name="paper"');
  const values=await tx(t=>draftEntryForm(t,B,entryId));if(!values)throw Error('draft form');
  const bad=await post('/app/books/entries/'+entryId+'/edit',{...values,label:'Keep this typed receipt',debit0:'not a figure',paper,from});expect(bad.statusCode).toBe(422);expect(bad.body).toContain('Keep this typed receipt');expect(bad.body).toContain('not a figure');expect(bad.body).toContain('name="paper"');expect(bad.body).toContain('name="from"');expect(bad.body).toContain('href="/app/books/spending" aria-current="page"');
  const wrong=await post('/app/books/entries/'+entryId+'/edit',{...values,paper:foreignPaper,label:'Foreign context'});expect(wrong.statusCode).toBe(404);
  const saved=await post('/app/books/entries/'+entryId+'/edit',{...values,paper,from,label:'Checked supplies'});expect(saved.statusCode).toBe(302);expect(String(saved.headers.location)).toContain('/app/books/spending/'+paper+'/draft?entry=');
  const reviewed=await tx(t=>loadEntry(t,B,entryId));expect(reviewed?.state).toBe('draft');expect(reviewed?.label).toBe('Checked supplies');
  const posted=await post('/app/books/entries/'+entryId+'/post',{paper,from});expect(posted.statusCode).toBe(302);expect(String(posted.headers.location)).toContain('/app/books/spending/'+paper+'/draft?entry=');expect((await tx(t=>loadEntry(t,B,entryId)))?.state).toBe('posted');
  const frozen=await get(String(posted.headers.location));expect(frozen.body).not.toContain('action="/app/books/entries/'+entryId+'/edit"');expect(frozen.body).toContain('Saved to the books');
 });
 it('keeps GET overview and scoped drilldowns read-only and external adapters unused',async()=>{
  const counts=()=>tx(async t=>(await sql<{snapshot:string}>`select concat((select count(*) from journal_entries where business_id=${B}::uuid),':',(select count(*) from invoice_payments where business_id=${B}::uuid),':',(select count(*) from documents where business_id=${B}::uuid),':',(select count(*) from books_exports where business_id=${B}::uuid)) as snapshot`.execute(t)).rows[0]!.snapshot);
  const before=await counts();for(const path of ['/app/books','/app/books/reports/cash','/app/books/reports/suppliers','/app/books/reports/profit'])expect((await get(path+'?'+scopes())).statusCode).toBe(200);expect(await counts()).toBe(before);expect(calls).toBe(0);
 });
 it('hides all new Books settings and reports when the feature is off',async()=>{
  await tx(t=>sql`update businesses set books_area=false where id=${B}::uuid`.execute(t));
  try{for(const path of ['/app/books/reports','/app/settings/books','/app/settings/books/accounts','/app/settings/books/fields'])expect((await get(path)).statusCode,path).toBe(404);expect((await get('/app/books',accountant)).statusCode).toBe(200);}finally{await tx(t=>sql`update businesses set books_area=true where id=${B}::uuid`.execute(t));}
 });
});
