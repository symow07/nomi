import { describe,it,expect } from 'vitest';
import { renderBank,renderStatementColumns } from '../../src/api/web/booksInvoices.js';
import { decimal } from '../../src/core/types/decimal.js';
import { guessLayout } from '../../src/core/books/statements.js';
const owner={isOwner:true};const accountant={isOwner:false,kind:'accountant' as const};
const line={id:'line',bookedOn:'2026-11-02',amount:decimal('125.75'),currency:'GBP',wording:'Customer <transfer>',reference:'REF <101>',suggestions:[{journalLineId:'journal-line',entryId:'entry',key:'BK-2026-1',date:'2026-11-01',label:'Recorded payment'}]};
const data={accounts:[{id:'bank',code:'B01',name:'Business account'}],accountId:'bank',open:[line],matched:[{...line,id:'done',amount:decimal('-20'),suggestions:[],matchId:'match',entryId:'paid-entry',key:'BK-2026-2'}]};
describe('Bank statement review presentation',()=>{
 it('shows exact statement evidence and the actual suggested entry before its explicit match',()=>{
  const html=renderBank('en',owner,data);
  expect(html).toContain('class="bb-review-line" id="bank-line-line"');expect(html).toContain('£125.75');expect(html).toContain('£-20.00');
  expect(html).toContain('REF &lt;101&gt;');expect(html).toContain('Customer &lt;transfer&gt;');expect(html).toContain('href="/app/books/advanced/entries/entry"');
  expect(html).toContain('Recorded payment');expect(html).toContain('1 unmatched line shown');
  const form=html.match(/<form[^>]*action="\/app\/books\/bank\/match"[\s\S]*?<\/form>/)?.[0]??'';
  for(const [name,value]of [['account','bank'],['line','line'],['journalLine','journal-line']])expect(form).toContain(`name="${name}" value="${value}"`);
  expect(html.indexOf('href="/app/books/advanced/entries/entry"')).toBeLessThan(html.indexOf('action="/app/books/bank/match"'));
 });
 it('keeps upload and undo contracts, with done distinct from suggestions',()=>{
  const html=renderBank('en',owner,data);
  expect(html).toContain('<details class="bb-upload"><summary>');expect(html).toContain('<div id="read-statement">');
  expect(html).toContain('action="/app/books/bank/import?account=bank"');expect(html).toContain('enctype="multipart/form-data"');
  expect(html).toContain('name="statement" accept=".csv,.ofx,.qfx,.xml,text/csv,application/xml" required');
  expect(html).toContain('class="bb-review-line is-matched"');
  const undo=html.match(/<form[^>]*action="\/app\/books\/bank\/unmatch"[\s\S]*?<\/form>/)?.[0]??'';
  expect(undo).toContain('name="account" value="bank"');expect(undo).toContain('name="match" value="match"');expect(undo).toContain('data-confirm=');
  const open=html.slice(html.indexOf('id="bank-open"'),html.indexOf('id="bank-matched"'));expect(open).not.toContain('pill ok');
 });
 it('shows accountants the evidence but no mutation forms, and no work before choosing an account',()=>{
  const html=renderBank('en',accountant,data);expect(html).not.toContain('method="post"');expect(html).toContain('href="/app/books/advanced/entries/entry"');
  const unchosen=renderBank('en',owner,{...data,accountId:null,open:[],matched:[]});expect(unchosen).not.toContain('method="post"');expect(unchosen).toContain('method="get" action="/app/books/bank"');
 });
 it('keeps preview evidence separate from labelled mapping controls and retained problems',()=>{
  const preview=[['Date','Out','In','Description','Reference'],['2026-11-01','20','','Fee','F1']];const guess=guessLayout(preview,',');
  const html=renderStatementColumns('en',{accountId:'bank',account:'Business account',book:'GBP',preview,guess,problems:['Choose the date column.']});
  expect(html).toContain('role="region" aria-labelledby="bank-preview-heading" tabindex="0"');
  const region=html.match(/<div[^>]*role="region"[\s\S]*?<\/div>/)?.[0]??'';expect(region).toContain('<table');expect(region).not.toContain('<select');
  for(const name of ['sep','preview','headerRow','date','dateFormat','shape','amount','out','in','decimal','currency','description','reference'])expect(html).toContain(`name="${name}"`);
  expect(html).toContain('class="bb-map-fields"');expect(html).toContain('role="alert"');expect(html).toContain('action="/app/books/bank/columns?account=bank"');
 });
});
