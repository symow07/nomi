import { sql } from 'kysely';
import type { Tx } from './client.js';
import { stripeBinding,stripeMapping,type StripeBinding,type StripeMapping } from './stripePayments.js';
import { paymentAccounts } from './bankStatements.js';

export type StripePage={
  deauthorization?:{account:string;reason:string|null}|null;
  country:string|null;practice:boolean;configured:boolean;live:boolean;connection:StripeBinding|null;mapping:StripeMapping|null;
  accounts:readonly {id:string;code:string;name:string;kind:string}[];
  banks:readonly {id:string;code:string;name:string}[];journals:readonly {id:string;code:string;name:string}[];
  attempts:readonly {id:string;invoiceId:string;key:string;amount:string;currency:string;state:string;reason:string|null;expiresAt:Date;url:string|null;closedFor?:string|null;paidOver?:string|null}[];
  movements:readonly {id:string;kind:string;amount:string;currency:string;date:string;entryId:string|null;reason:string|null;providerId:string}[];
  payouts:readonly {id:string;amount:string;currency:string;date:string;status:string;nomiAmount:string|null;entryId:string|null;receiptId:string|null;reversalId?:string|null;failureDate?:string|null;reason:string|null}[];
  statements:readonly {id:string;amount:string;currency:string;date:string;bankId:string}[];
  events:readonly {id:string;reason:string|null;state:string}[];
};
export async function readStripePage(tx:Tx,bid:string,configured:boolean,live:boolean):Promise<StripePage>{
  const b=(await sql<{country:string|null;practice:boolean}>`select country,practice_of is not null as practice from businesses where id=${bid}::uuid`.execute(tx)).rows[0];
  const c=await stripeBinding(tx,bid,live),m=c?await stripeMapping(tx,bid,c.id):null;
  return {
    deauthorization:(await sql<{account:string;reason:string|null}>`select account,deauthorization_reason as reason from stripe_connections where business_id=${bid}::uuid and live=${live} and deauthorization_state='pending' order by disconnected_at desc limit 1`.execute(tx)).rows[0]??null,
    country:b?.country??null,practice:b?.practice??false,configured,live,connection:c,mapping:m,
    accounts:(await sql<StripePage['accounts'][number]>`select a.id::text,a.code,a.name,a.kind from accounts a where a.business_id=${bid}::uuid and a.is_active and a.kind in ('asset','expense')
      and not exists(select 1 from accounts ch where ch.business_id=a.business_id and ch.parent_id=a.id and ch.is_active) order by a.code`.execute(tx)).rows,
    banks:await paymentAccounts(tx,bid),journals:(await sql<StripePage['journals'][number]>`select id::text,code,name from journals where business_id=${bid}::uuid and kind='general' order by code`.execute(tx)).rows,
    attempts:(await sql<StripePage['attempts'][number]>`select a.id::text,a.invoice_id::text as "invoiceId",'F-'||i.year||'-'||lpad(i.number::text,4,'0') as key,a.amount::text,a.currency,a.state,a.reason,a.expires_at as "expiresAt",a.url,a.closed_for::text as "closedFor",a.paid_over as "paidOver"
      from stripe_checkout_attempts a join invoices i on i.id=a.invoice_id join stripe_connections c on c.id=a.connection_id
      where a.business_id=${bid}::uuid and c.live=${live} order by a.created_at desc limit 100`.execute(tx)).rows,
    movements:(await sql<StripePage['movements'][number]>`select m.id::text,m.kind,m.amount::text,m.currency,m.event_date::text as date,m.entry_id::text as "entryId",m.reason,m.provider_id as "providerId"
      from stripe_movements m join stripe_connections c on c.id=m.connection_id where m.business_id=${bid}::uuid and c.live=${live} order by m.event_date desc,m.id desc limit 100`.execute(tx)).rows,
    payouts:(await sql<StripePage['payouts'][number]>`select p.provider_id as id,p.amount::text,p.currency,p.event_date::text as date,p.status,p.nomi_amount::text as "nomiAmount",p.entry_id::text as "entryId",p.receipt_id::text as "receiptId",p.reversal_id::text as "reversalId",p.failure_date::text as "failureDate",p.reason
      from stripe_payouts p join stripe_connections c on c.id=p.connection_id where p.business_id=${bid}::uuid and c.live=${live} order by p.event_date desc,p.provider_id limit 100`.execute(tx)).rows,
    statements:m?(await sql<StripePage['statements'][number]>`select s.id::text,s.amount::text,s.currency,s.booked_on::text as date,s.account_id::text as "bankId" from statement_lines s
      where s.business_id=${bid}::uuid and s.account_id=${m.bankId}::uuid and s.amount>0 and not exists(select 1 from statement_matches sm where sm.statement_line_id=s.id and sm.unmatched_at is null) order by s.booked_on desc limit 100`.execute(tx)).rows:[],
    events:(await sql<StripePage['events'][number]>`select e.event_id as id,e.reason,e.state from stripe_event_inbox e join stripe_connections c on c.id=e.connection_id
      where e.business_id=${bid}::uuid and c.live=${live} and e.state<>'done' order by e.received_at desc limit 100`.execute(tx)).rows,
  };
}
