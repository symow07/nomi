import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { sql } from 'kysely';
import { createDb, withTenantTx, type Db } from '../../src/db/client.js';
import type { BusinessId } from '../../src/core/types/ids.js';
import { decimal } from '../../src/core/types/decimal.js';
import { COUNTRY_PACKS } from '../../src/core/books/countryPacks.js';
import { loadCountryPack } from '../../src/db/booksCountry.js';
import { draftInvoice, issueInvoice } from '../../src/db/booksInvoices.js';
import { draftCreditNote, issueCreditNote } from '../../src/db/booksCreditNotes.js';
import { trialBalanceOf } from '../../src/db/booksReports.js';
import { importStatement } from '../../src/db/bankStatements.js';
import { bindStripe, reservePayment, saveStripeMapping } from '../../src/db/stripePayments.js';
import { postCapturedPayment, postStripeRefund, recordStripePayout, confirmStripePayout, receiveStripePayout } from '../../src/db/stripePosting.js';
import { purgeBusinesses } from './books-db.js';

const d=process.env['DATABASE_URL']&&process.env['MIGRATE_DATABASE_URL']?describe:describe.skip;
d('payment links · the books tie in both supported charts',()=>{
  let db:Db,admin:pg.Client;
  const businesses:string[]=[];
  beforeAll(async()=>{admin=new pg.Client({connectionString:process.env['MIGRATE_DATABASE_URL']});await admin.connect();db=createDb(process.env['DATABASE_URL']!);});
  afterAll(async()=>{await db?.destroy();if(admin){await purgeBusinesses(admin,businesses,'payment-link-balance-test');await admin.end();}});
  it.each(['GB','US'] as const)('%s: 100 received, 3 fee, 97 paid out and matched; then a partial credit/refund ties',async country=>{
    const bid=randomUUID() as BusinessId;businesses.push(bid);const currency=country==='GB'?'GBP':'USD';const now=new Date('2026-10-10T12:00:00Z');const created=Math.floor(now.getTime()/1000);
    await admin.query("insert into businesses(id,name,engine,country,currency,books_area,timezone) values($1,'Balance fixture','service',$2,$3,true,'UTC')",[bid,country,currency]);
    await withTenantTx(db,bid,async tx=>{
      await loadCountryPack(tx,bid,COUNTRY_PACKS[country],'2026-01-01');
      await sql`insert into fiscal_years(business_id,starts_on,ends_on) values(${bid}::uuid,'2026-01-01','2026-12-31')`.execute(tx);
      const a=Object.fromEntries((await sql<{id:string;code:string}>`select id::text,code from accounts`.execute(tx)).rows.map(x=>[x.code,x.id]));
      const j=Object.fromEntries((await sql<{id:string;code:string}>`select id::text,code from journals`.execute(tx)).rows.map(x=>[x.code,x.id]));
      const party=(await sql<{id:string}>`insert into parties(business_id,code,name,kind) values(${bid}::uuid,'C001','Fixture customer','customer') returning id::text`.execute(tx)).rows[0]!.id;
      const tax=(await sql<{id:string}>`insert into tax_codes(business_id,code,label,rate,kind,account_id,valid_from) values(${bid}::uuid,'FIXTURE20','Fixture tax',20,'collected',${a['2100']}::uuid,'2026-01-01') returning id::text`.execute(tx)).rows[0]!.id;
      const b=await bindStripe(tx,bid,{id:`acct_${bid.replaceAll('-','')}`,country,currency,ready:true},false,'owner');if(!b.ok)throw new Error(b.reason);
      expect((await saveStripeMapping(tx,bid,b.value,{clearingId:a['1030']!,transitId:a['1040']!,feeId:a['5020']!,journalId:j['GJ']!,bankId:a['1000']!},'owner')).ok).toBe(true);
      const inv=await draftInvoice(tx,bid,'owner',{partyId:party,issueDate:'2026-10-10',dueDate:null,currency,label:null,lines:[
        {label:'Taxed goods',quantity:decimal('1'),unitPrice:decimal('50'),accountId:a['4000']!,taxCodeId:tax},
        {label:'Other goods',quantity:decimal('1'),unitPrice:decimal('40'),accountId:a['4000']!,taxCodeId:null},
      ]});if(inv.kind!=='drafted')throw new Error(inv.reason);
      expect((await issueInvoice(tx,bid,inv.id,'owner')).kind).toBe('issued');
      const r=await reservePayment(tx,bid,inv.id,false,now);if(!r.ok)throw new Error(r.reason);
      expect(await postCapturedPayment(tx,bid,r.value.id,{id:'pi_balance',attemptId:r.value.id,succeeded:true,charge:{id:'ch_balance',paid:true,captured:true,amount:decimal('100'),currency,created,balance:{id:'txn_balance',gross:decimal('100'),fee:decimal('3'),net:decimal('97'),currency,created}}})).toEqual({state:'posted'});
      await recordStripePayout(tx,bid,b.value,{id:'po_balance',status:'paid',amount:decimal('97'),currency,created,arrival:created,balance:null});
      expect(await confirmStripePayout(tx,bid,b.value,'po_balance',decimal('97'),'owner')).toEqual({state:'posted'});
      await importStatement(tx,bid,'owner',a['1000']!,'csv','balance-fixture',[{bookedOn:'2026-10-11',currency,amount:decimal('97'),reference:'po_balance',wording:null,fingerprint:'balance-fixture'}]);
      const st=(await sql<{id:string}>`select id::text from statement_lines where reference='po_balance'`.execute(tx)).rows[0]!.id;
      expect(await receiveStripePayout(tx,bid,b.value,'po_balance',st,'owner')).toEqual({state:'posted'});
      const tb=await trialBalanceOf(tx,bid,{from:'2026-01-01',to:'2026-12-31'});
      expect(tb.balanced).toBe(true);expect(tb.totals.period).toEqual({debit:'397',credit:'397'});
      const close=Object.fromEntries(tb.rows.map(x=>[x.code,x.closing]));
      expect(close['1000']).toEqual({debit:'97',credit:'0'});expect(close['5020']).toEqual({debit:'3',credit:'0'});
      expect(close['4000']).toEqual({debit:'0',credit:'90'});expect(close['2100']).toEqual({debit:'0',credit:'10'});
      for(const code of ['1030','1040','1100'])expect(close[code]).toEqual({debit:'0',credit:'0'});
      const refund={id:'re_balance',intentId:'pi_balance',status:'succeeded' as const,amount:decimal('25'),currency,created:Math.floor(new Date('2026-10-12T12:00:00Z').getTime()/1000),balance:null};
      expect(await postStripeRefund(tx,bid,b.value,{...refund,status:'pending'})).toMatchObject({state:'pending'});
      await recordStripePayout(tx,bid,b.value,{id:'po_blocked',status:'paid',amount:decimal('10'),currency,created,arrival:created,balance:null});
      expect(await confirmStripePayout(tx,bid,b.value,'po_blocked',decimal('10'),'owner')).toEqual({state:'exception',reason:'payments_outstanding'});
      const credit=await draftCreditNote(tx,bid,'owner',{invoiceId:inv.id,issueDate:'2026-10-12',reason:'Returned goods',lines:[{invoiceLineNo:2,quantity:decimal('0.625')}]});
      if(credit.kind!=='drafted')throw new Error(credit.reason);expect((await issueCreditNote(tx,bid,credit.id,'owner')).kind).toBe('issued');
      expect(await postStripeRefund(tx,bid,b.value,refund)).toEqual({state:'posted'});expect(await postStripeRefund(tx,bid,b.value,refund)).toEqual({state:'posted'});
      const after=await trialBalanceOf(tx,bid,{from:'2026-01-01',to:'2026-12-31'});
      expect(after.balanced).toBe(true);expect(after.totals.period).toEqual({debit:'447',credit:'447'});
      expect((await sql<{owed:string}>`select (invoice_total(id)-invoice_credited(id)-invoice_paid(id))::text as owed from invoices where id=${inv.id}::uuid`.execute(tx)).rows[0]!.owed).toBe('0.00');
    });
  });
});
