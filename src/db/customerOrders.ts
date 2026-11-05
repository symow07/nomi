import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { moneyFromRow, type Money } from '../core/types/money.js';
import { isReportedOrderState, type ReportedOrderState } from '../core/commerce/orderState.js';
import type { CustomerPage, CustomerPageOptions } from './customers.js';
import { sql } from 'kysely';
import { searchOf } from './buyersList.js';
import { realCustomer } from './customers.js';
import { customerIdShape, literalLike, readCustomerKeyset } from './customerPaging.js';

export type CustomerOrderRow = {
  readonly id: string; readonly clientId: string; readonly customerName: string | null; readonly conversationId: string | null;
  readonly reference: string; readonly productId: string | null; readonly productName: string | null; readonly productNameZh: string | null;
  readonly quantity: number; readonly unit: string; readonly unitPrice: Money | null; readonly total: Money | null;
  readonly state: ReportedOrderState | null; readonly stateAt: Date | null; readonly createdAt: Date; readonly confirmedAt: Date | null;
};
export type CustomerOrdersQuery = CustomerPageOptions & { readonly businessId: BusinessId; readonly clientId?: string; readonly state?: string; readonly q?: string };
export type CustomerOrdersPage = CustomerPage<CustomerOrderRow> & { readonly q: string; readonly clientId: string | null; readonly state: ReportedOrderState | null };
/** Operational records, not Books' invoice eligibility. History is authoritative; cache is fallback only. */
export async function readCustomerOrdersPage(tx: Tx, o: CustomerOrdersQuery): Promise<CustomerOrdersPage> {
  const q = searchOf(o.q), clientId = o.clientId || null, state = o.state && isReportedOrderState(o.state) ? o.state : null;
  const client = !clientId ? sql`true` : customerIdShape(clientId) ? sql`o.client_id = ${clientId}::uuid` : sql`false`;
  const pattern = literalLike(q);
  type Row = {id:string; client_id:string;customer_name:string|null;conversation_id:string|null;reference:string;
    product_id:string|null;product_name:string|null;product_name_zh:string|null;quantity:number;unit:string;
    price:string|null;total:string|null;currency:string;state:string;state_at:Date|null;order_at:Date;confirmed_at:Date|null};
  const page = await readCustomerKeyset<Row>(tx,sql`
    select o.id,o.client_id::text,cl.display_name as customer_name,o.conversation_id::text,o.order_reference as reference,
      o.product_id::text,p.name as product_name,p.name_zh as product_name_zh,o.quantity,o.unit,
      o.agreed_unit_price_usd::text as price,o.total_value_usd::text as total,o.currency,
      coalesce(u.state,o.status) as state,u.at as state_at,o.created_at as order_at,o.confirmed_at
    from orders o join clients cl on cl.id = o.client_id and cl.business_id = o.business_id
      left join products p on p.id = o.product_id and p.business_id = o.business_id
      left join lateral (select state,at from order_updates where business_id = o.business_id and order_id = o.id order by at desc,id desc limit 1) u on true
    where o.business_id = ${o.businessId}::uuid and ${realCustomer} and ${client}
      and not exists (select 1 from conversations tc where tc.id = o.conversation_id and tc.owner_testing)
      ${state ? sql`and coalesce(u.state,o.status) = ${state}` : sql``}
      ${q ? sql`and (o.order_reference ilike ${pattern} or cl.display_name ilike ${pattern} or p.name ilike ${pattern} or p.name_zh ilike ${pattern})` : sql``}`,
  ['customer-orders',o.businessId,clientId,state,q],o);
  return {...page,q,clientId,state,rows:page.rows.map((r) => ({id:r.id,clientId:r.client_id,customerName:r.customer_name,
    conversationId:r.conversation_id,reference:r.reference,productId:r.product_id,productName:r.product_name,productNameZh:r.product_name_zh,
    quantity:r.quantity,unit:r.unit,unitPrice:r.price === null ? null : moneyFromRow(r.price,r.currency),total:r.total === null ? null : moneyFromRow(r.total,r.currency),
    state:isReportedOrderState(r.state) ? r.state : null,stateAt:r.state_at,createdAt:r.order_at,confirmedAt:r.confirmed_at}))};
}
