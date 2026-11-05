import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { customerValues, type CustomerValue } from './customerValue.js';
import { loadCustomerCard, type CustomerCard } from './customerCard.js';
import { sql, type RawBuilder } from 'kysely';
import { needsOwnerFor, searchOf } from './buyersList.js';
import { faceVersions } from './faces.js';
import { customerIdShape, literalLike, readCustomerKeyset, type CustomerPage, type CustomerPageOptions } from './customerPaging.js';
export type { CustomerPage, CustomerPageOptions } from './customerPaging.js';

export type CustomerDirectoryRow = {
  readonly clientId: string; readonly name: string | null; readonly phone: string | null; readonly email: string | null;
  readonly photo: string | null; readonly channels: readonly string[]; readonly lastContactAt: Date | null; readonly lastWrote: Date | null;
  readonly waiting: boolean; readonly conversationId: string | null; readonly value: CustomerValue;
  readonly labels: readonly { readonly id: string; readonly name: string }[];
};
export type CustomersQuery = CustomerPageOptions & { readonly businessId: BusinessId; readonly viewerId?: string; readonly q?: string; readonly label?: string };
export type CustomersPage = CustomerPage<CustomerDirectoryRow> & { readonly q: string; readonly label: string | null };
export type CustomerConversation = { readonly id: string; readonly channel: string; readonly active: boolean; readonly lastContactAt: Date | null; readonly waiting: boolean };
export type CustomerSelection = { readonly card: CustomerCard; readonly conversationId: string | null; readonly conversations: CustomerPage<CustomerConversation> };

/** Alias cl is a tenant client, never a contact/prospect. Closed and never-contacted clients remain customers. */
export const realCustomer = sql<boolean>`(not exists (select 1 from conversations c where c.business_id = cl.business_id and c.client_id = cl.id)
  or exists (select 1 from conversations c where c.business_id = cl.business_id and c.client_id = cl.id and not c.owner_testing))`;

function matching(q: string): RawBuilder<boolean> {
  if (!q) return sql<boolean>`true`;
  const pattern = literalLike(q), digits = q.replace(/[\s()+\-./]/g,'');
  const phone = /^[0-9]{4,}$/.test(digits) ? sql`or regexp_replace(coalesce(cl.phone,''),'[^0-9]','','g') like ${`%${digits}%`}
    or exists (select 1 from client_channels cc where cc.client_id = cl.id and regexp_replace(cc.channel_user_id,'[^0-9]','','g') like ${`%${digits}%`})` : sql``;
  return sql<boolean>`(cl.display_name ilike ${pattern} or cl.phone ilike ${pattern} or cl.email ilike ${pattern}
    or exists (select 1 from client_channels cc where cc.client_id = cl.id and cc.channel_user_id ilike ${pattern})
    or exists (select 1 from buyer_labels bl join labels l on l.id = bl.label_id where bl.client_id = cl.id
      and bl.removed_at is null and l.archived_at is null and l.name ilike ${pattern})
    or exists (select 1 from conversations c join conversation_state cs on cs.conversation_id = c.id
      join products p on p.id = cs.identified_product_id where c.client_id = cl.id and not c.owner_testing
      and (p.name ilike ${pattern} or p.name_zh ilike ${pattern})) ${phone})`;
}

/** Caller binds tenant and viewer with withTenantTx; all enrichment is bounded to this page's IDs. */
export async function readCustomersPage(tx: Tx, o: CustomersQuery): Promise<CustomersPage> {
  const q = searchOf(o.q), label = o.label || null;
  const carrying = !label ? sql`true` : !customerIdShape(label) ? sql`false`
    : sql`exists (select 1 from buyer_labels bl join labels l on l.id = bl.label_id where bl.client_id = cl.id
      and bl.label_id = ${label}::uuid and bl.removed_at is null and l.archived_at is null)`;
  type Row = {id:string; name:string|null; phone:string|null; email:string|null; order_at:Date|null; last_wrote:Date|null; waiting:boolean; conversation_id:string|null; channels:string[]};
  const page = await readCustomerKeyset<Row>(tx,sql`
    with real_chats as (
      select c.id,c.client_id,c.channel,${needsOwnerFor(o.viewerId)} as waiting,
        max(m.sent_at) as last_at, max(m.sent_at) filter (where m.direction = 'inbound') as last_wrote
      from conversations c left join messages m on m.conversation_id = c.id
      where c.business_id = ${o.businessId}::uuid and not c.owner_testing group by c.id
    ), activity as (
      select client_id,max(last_at) as last_at,max(last_wrote) as last_wrote,bool_or(waiting) as waiting,
        (array_agg(id order by waiting desc,last_at desc nulls last,id))[1] as conversation_id,
        array_agg(distinct channel order by channel) as channels from real_chats group by client_id
    )
    select cl.id,cl.display_name as name,cl.phone,cl.email,a.last_at as order_at,a.last_wrote,
      coalesce(a.waiting,false) as waiting,a.conversation_id::text,coalesce(a.channels,array[]::text[]) as channels
    from clients cl left join activity a on a.client_id = cl.id
    where cl.business_id = ${o.businessId}::uuid and ${realCustomer} and ${matching(q)} and ${carrying}`,
  ['customers',o.businessId,o.viewerId ?? null,q,label],o);
  const ids = page.rows.map((r) => r.id);
  const [values,faces,labels] = await Promise.all([
    customerValues(tx,ids,new Date(),{realOnly:true}),faceVersions(tx,ids),
    sql<{client_id:string;id:string;name:string}>`select bl.client_id::text,l.id::text,l.name from buyer_labels bl join labels l on l.id = bl.label_id
      where bl.business_id = ${o.businessId}::uuid and bl.client_id = any(${ids}::uuid[]) and bl.removed_at is null and l.archived_at is null
      order by lower(l.name),l.id`.execute(tx),
  ]);
  return {...page,q,label,rows:page.rows.map((r) => ({clientId:r.id,name:r.name,phone:r.phone,email:r.email,
    photo:faces.get(r.id) ?? null,channels:r.channels,lastContactAt:r.order_at,lastWrote:r.last_wrote,
    waiting:r.waiting,conversationId:r.conversation_id,value:values.get(r.id)!,labels:labels.rows.filter((l) => l.client_id === r.id).map(({id,name}) => ({id,name}))}))};
}

export async function readCustomerSelection(tx: Tx, o: CustomerPageOptions & { readonly businessId: BusinessId; readonly clientId: string; readonly conversationId?: string; readonly viewerId?: string }): Promise<CustomerSelection | null> {
  if (!customerIdShape(o.clientId) || (o.conversationId !== undefined && !customerIdShape(o.conversationId))) return null;
  const authorised = (await sql<{id:string}>`select cl.id from clients cl where cl.business_id = ${o.businessId}::uuid
    and cl.id = ${o.clientId}::uuid and ${realCustomer}
    ${o.conversationId === undefined ? sql`` : sql`and exists (select 1 from conversations c where c.id = ${o.conversationId}::uuid
      and c.client_id = cl.id and c.business_id = cl.business_id and not c.owner_testing)`}`.execute(tx)).rows[0];
  if (!authorised) return null;
  const card = await loadCustomerCard(tx,authorised.id,o.viewerId,{realOnly:true});
  if (!card) return null;
  type Row = {id:string;channel:string;active:boolean;order_at:Date|null;waiting:boolean};
  const page = await readCustomerKeyset<Row>(tx,sql`select c.id,c.channel,c.is_active as active,${needsOwnerFor(o.viewerId)} as waiting,
      (select max(m.sent_at) from messages m where m.conversation_id = c.id) as order_at
    from conversations c where c.business_id = ${o.businessId}::uuid and c.client_id = ${o.clientId}::uuid and not c.owner_testing`,
  ['customer-conversations',o.businessId,authorised.id,o.viewerId ?? null],o);
  return {card,conversationId:o.conversationId?.toLowerCase() ?? card.conversationId,conversations:{...page,
    rows:page.rows.map((r) => ({id:r.id,channel:r.channel,active:r.active,lastContactAt:r.order_at,waiting:r.waiting}))}};
}
