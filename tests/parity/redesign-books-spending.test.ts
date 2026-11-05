import { describe,it,expect } from 'vitest';
import { renderSpending,renderPaper,renderSpendingDraft,spendingDraftSupported } from '../../src/api/web/booksPapers.js';
import type { EntryView } from '../../src/db/booksEntries.js';
import type { EntryChoices } from '../../src/api/web/booksEntries.js';
import type { ReadingRow } from '../../src/db/booksDocuments.js';
import { decimal } from '../../src/core/types/decimal.js';
const owner={isOwner:true};const accountant={isOwner:false,kind:'accountant' as const};
const choices:EntryChoices={bookCurrency:'GBP',journals:[{id:'journal',code:'PUR',name:'Purchases'}],accounts:[{id:'cost',code:'6000',name:'Materials'},{id:'payable',code:'2000',name:'Suppliers'}],parties:[{id:'supplier',code:'S1',name:'Paper Shop'}],taxCodes:[{id:'tax',code:'VAT',label:'VAT',from:'2020-01-01'}]};
const line={lineNo:1,account:'6000',accountName:'Materials',party:null,taxCode:null,currency:'GBP',debit:decimal('12.50'),credit:null,bookDebit:null,bookCredit:null,rate:null,label:'Paper',isFx:false,custom:{}};
const entry:EntryView={id:'entry',key:'draft',journal:'PUR',date:'2026-11-01',label:'Paper Shop R1',state:'draft',total:'12.50',currency:'GBP',reverses:null,reversedBy:null,documentRef:'R1',documentDate:'2026-11-01',postedBy:null,custom:{},lines:[line,{...line,lineNo:2,account:'2000',accountName:'Suppliers',party:'Paper Shop',debit:null,credit:decimal('12.50'),label:null}]};
const values={journal:'journal',date:'2026-11-01',label:'Paper Shop R1',documentRef:'R1',documentDate:'2026-11-01',account0:'cost',currency0:'GBP',party0:'',tax0:'tax',debit0:'12.50',credit0:'',label0:'Paper',account1:'payable',currency1:'GBP',party1:'supplier',tax1:'',debit1:'',credit1:'12.50',label1:''};
const reading:ReadingRow={id:'reading',readAt:'2026-11-01T12:00:00Z',outcome:'read',modelId:'reader',problems:[],entryId:null,reading:{kind:'receipt',supplierName:'Paper Shop',supplierTaxId:'VAT1',number:'R1',date:'2026-11-01',currency:'GBP',total:decimal('12.50'),lines:[{label:'Paper',net:decimal('10'),taxRate:decimal('25'),tax:decimal('2.50')}]}};
const paperChoices={...choices,payableDefault:'payable',purchasesDefault:'journal'};
describe('Spending presentation preserves the original and explicit draft commands',()=>{
 it('uses full pagination counts and distinct real work states without making drafts done',()=>{
  const html=renderSpending('en',owner,{rows:[{id:'paper',name:'Receipt <1>',mediaType:'image/png',addedOn:'2026-11-01',state:'draft',entryId:'entry',lastOutcome:'read'}],total:101,from:51,to:51,page:2,pageSize:50,next:3,prev:1},true,{state:'draft'});
  expect(html).toContain('51–51 of 101');expect(html).toContain('state=draft');expect(html).toContain('page=3');expect(html).toContain('Receipt &lt;1&gt;');expect(html).toContain('/app/books/spending/paper');expect(html).not.toContain('pill ok');
  expect(html).toContain('action="/app/books/papers"');expect(html).toContain('name="paper"');
 });
 it('separates kept preview from extracted facts and preserves every draft choice after refusal',()=>{
  const html=renderPaper('en',owner,{id:'paper',name:'receipt.png',mediaType:'image/png',readings:[reading]},paperChoices,{available:true,canRead:true},{previewHref:'/app/books/spending/paper/preview',values:{journal:'journal',party:'supplier',payable:'payable',tax0:'tax',account0:'cost'},problems:['Choose a valid account.']});
  expect(html).toContain('src="/app/books/spending/paper/preview"');expect(html).toContain('class="bs-reading"');expect(html).toContain('Download original');expect(html).toContain('Tax amount');expect(html).toContain('action="/app/books/papers/paper/draft"');expect(html).toContain('name="reading" value="reading"');expect(html).toContain('name="presentation" value="spending"');
  expect(html).toContain('<fieldset class="bs-reading-line">');expect(html).toContain('name="tax0"');expect(html).toContain('value="tax" selected');expect(html).toContain('value="cost" selected');expect(html).toContain('Choose a valid account.');expect(html).toContain('href="/app/books/papers/paper/file"');
 });
 it('uses actual overview entry state even when the latest reading did not make the earlier draft',()=>{
  const html=renderPaper('en',owner,{id:'paper',name:'receipt.png',mediaType:'image/png',readings:[reading]},paperChoices,{available:true,canRead:true},{state:'draft',entryId:'earlier-entry'});
  expect(html).toContain('/app/books/spending/paper/draft');expect(html).not.toContain('action="/app/books/papers/paper/draft"');expect(html).not.toContain('pill ok');
  const done=renderPaper('en',owner,{id:'paper',name:'receipt.png',mediaType:'image/png',readings:[reading]},paperChoices,{available:true,canRead:true},{state:'posted',entryId:'earlier-entry'});expect(done).toContain('pill ok');expect(done).toContain('/app/books/advanced/entries/earlier-entry');expect(done).not.toContain('/paper/draft"');
 });
 it('keeps account, tax, amount, supplier and document fields and separates save from posting',()=>{
  expect(spendingDraftSupported(entry,choices,values)).toBe(true);
  const html=renderSpendingDraft('en',owner,{id:'paper',name:'receipt.png'},entry,choices,{...values,debit0:'12.75',label0:'Kept <text>'},['Amounts do not match.'],'2026-11-02');
  const edit=html.match(/<form[^>]*action="\/app\/books\/entries\/entry\/edit"[\s\S]*?<\/form>/)?.[0]??'';
  for(const name of ['paper','journal','date','label','documentRef','documentDate','account0','party0','tax0','currency0','debit0','credit0','label0','account1','party1','tax1','currency1','debit1','credit1','label1'])expect(edit).toContain(`name="${name}"`);
  expect(edit).toContain('value="12.75"');expect(edit).toContain('Kept &lt;text&gt;');expect(edit).not.toContain('<table');expect(html).toContain('Amounts do not match.');expect(html).not.toContain('action="/app/books/entries/entry/post"');
  const ready=renderSpendingDraft('en',owner,{id:'paper',name:'receipt.png'},entry,choices,values,[],'2026-11-02');
  for(const action of ['post','discard'])expect(ready.match(new RegExp(`<form[^>]*action="/app/books/entries/entry/${action}"[\\s\\S]*?</form>`))?.[0]).toContain('name="paper" value="paper"');
 });
 it('refuses to simplify FX or custom drafts and keeps rejected full form values available',()=>{
  const complex={...entry,lines:[{...line,isFx:true},entry.lines[1]!]};expect(spendingDraftSupported(complex,choices,values)).toBe(false);
  const initial=renderSpendingDraft('en',owner,{id:'paper',name:'receipt.png'},complex,choices,values,[],'2026-11-02');expect(initial).toContain('/app/books/advanced/entries/entry/edit');expect(initial).not.toContain('action="/app/books/entries/entry/edit"');
  const refused=renderSpendingDraft('en',owner,{id:'paper',name:'receipt.png'},complex,choices,{...values,fx0:'1',debit0:'12.71'},['Check conversion.'],'2026-11-02');expect(refused).toContain('name="fx0" value="1" checked');expect(refused).toContain('value="12.71"');expect(refused).toContain('name="paper" value="paper"');expect(refused).toContain('Check conversion.');
  expect(spendingDraftSupported({...entry,custom:{project:'abc'}},choices,values)).toBe(false);
 });
 it('keeps custom values and later indexed lines in the full editor after refusal',()=>{
  const fields:NonNullable<EntryChoices['fields']>=[{appliesTo:'entry',key:'project',label:'Project',kind:'text',choices:null,required:false},{appliesTo:'line',key:'job',label:'Job',kind:'text',choices:null,required:false}];
  const c={...choices,fields};const v={...values,cf_entry_project:'Kept <project>',cf_line0_job:'Job 12',account10:'cost',currency10:'EUR',debit10:'9.13',label10:'Later line'};
  const html=renderSpendingDraft('en',owner,{id:'paper',name:'receipt.png'},{...entry,custom:{project:'Kept project'},lines:[{...line,custom:{job:'Job 12'}},entry.lines[1]!] },c,v,['Check extra line.'],'2026-11-02');
  for(const name of ['cf_entry_project','cf_line0_job','account10','currency10','debit10','label10'])expect(html).toContain(`name="${name}"`);
  expect(html).toContain('Kept &lt;project&gt;');expect(html).toContain('value="9.13"');expect(html).toContain('<option selected>EUR</option>');expect(html).not.toContain('/entry/post"');
 });
 it('keeps unavailable submitted choices and refuses external preview targets',()=>{
  const html=renderPaper('en',owner,{id:'paper',name:'receipt.png',mediaType:'image/png',readings:[reading]},paperChoices,{available:false,canRead:false},{previewHref:'https://example.com/receipt',values:{account0:'retired-account',tax0:'unknown-tax'},problems:['Choose an account.']});
  expect(html).toContain('value="retired-account" selected');expect(html).toContain('value="unknown-tax" selected');expect(html).not.toContain('src="https:');expect(html).not.toContain('action="/app/books/papers/paper/read"');
 });
 it('uses explicit latest unlinked state and retains earlier entry evidence',()=>{
  const html=renderPaper('en',owner,{id:'paper',name:'receipt.png',mediaType:'image/png',readings:[reading,{...reading,id:'old-reading',entryId:'old-entry'}]},paperChoices,{available:true,canRead:true},{state:'ready',entryId:null});
  expect(html).toContain('action="/app/books/papers/paper/draft"');expect(html).toContain('href="/app/books/advanced/entries/old-entry"');
  const legacy=renderPaper('en',owner,{id:'paper',name:'receipt.png',mediaType:'image/png',readings:[reading,{...reading,id:'old-reading',entryId:'old-entry'}]},paperChoices,{available:true,canRead:true});expect(legacy).toContain('action="/app/books/papers/paper/draft"');
 });
 it('shows concurrent posting refusals and attempted values without offering another mutation',()=>{
  const html=renderSpendingDraft('en',owner,{id:'paper',name:'receipt.png'},{...entry,state:'posted'},choices,{...values,debit0:'12.73',label0:'My unsaved change'},['This entry was already posted.'],'2026-11-02');
  expect(html).toContain('This entry was already posted.');expect(html).toContain('12.73');expect(html).toContain('My unsaved change');expect(html).not.toContain('method="post"');
 });
 it('carries only safe list context through detail and draft actions',()=>{
  const from='/app/books/spending?state=draft&page=3#paper-12345678-1234-1234-1234-123456789abc';
  const html=renderSpendingDraft('en',owner,{id:'paper',name:'receipt.png'},entry,choices,values,[],'2026-11-02',{returnHref:from});
  expect(html.match(/name="from"/g)).toHaveLength(3);expect(html).toContain('value="/app/books/spending?page=3&amp;state=draft#paper-12345678-1234-1234-1234-123456789abc"');
  const unsafe=renderSpendingDraft('en',owner,{id:'paper',name:'receipt.png'},entry,choices,values,[],'2026-11-02',{returnHref:'https://example.com/'});expect(unsafe).not.toContain('name="from"');expect(unsafe).not.toContain('https://example.com');
 });
 it('keeps history read-only, retention visible and accountant and posted drafts without mutation forms',()=>{
  const history=renderPaper('en',owner,{id:'paper',name:'history.pdf',mediaType:'application/pdf',readings:[reading],history:{entries:4,through:'2025-12-31'},keepUntil:'2032-12-31'},paperChoices,{available:true,canRead:true});expect(history).not.toContain('method="post"');expect(history).toContain('2032');expect(history).toContain('/file');
  expect(renderSpendingDraft('en',accountant,{id:'paper',name:'receipt.png'},entry,choices,values,[],'2026-11-02')).not.toContain('method="post"');
  expect(renderSpendingDraft('en',owner,{id:'paper',name:'receipt.png'},{...entry,state:'posted'},choices,values,[],'2026-11-02')).not.toContain('method="post"');
 });
});
