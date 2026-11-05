import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { createDb, withTenantTx, type Db, type Tx } from '../../src/db/client.js';
import { parseBusinessId, type BusinessId } from '../../src/core/types/ids.js';
import { asViewer } from '../../src/db/viewer.js';
import { readCustomersPage, readCustomerSelection } from '../../src/db/customers.js';
import { readCustomerOrdersPage } from '../../src/db/customerOrders.js';
import { customerValues } from '../../src/db/customerValue.js';
import { numeralOf } from '../../src/core/types/money.js';
import { loadCustomerCard } from '../../src/db/customerCard.js';
import { askedAbout } from '../../src/db/askedAbout.js';

const d = process.env['DATABASE_URL'] ? describe : describe.skip;
const uuid = () => randomUUID();
const B = uuid(), FOREIGN = uuid(), product = uuid(), testProduct = uuid();
const mixed = uuid(), closed = uuid(), empty = uuid(), testOnly = uuid(), foreign = uuid();
const realChat = uuid(), testChat = uuid(), closedChat = uuid(), onlyTestChat = uuid(), foreignChat = uuid();
const olderChat = uuid();
const label = uuid(), archived = uuid(), removed = uuid(), staff = uuid(), accountant = uuid();
const dollars = uuid(), euros = uuid(), testOrder = uuid(), legacy = uuid(), unknown = uuid();
const day = '2026-10-02T12:00:00.123456Z';
const business = (s: string): BusinessId => { const b = parseBusinessId(s); if (!b.ok) throw Error('fixture'); return b.value; };

d('Area 3 customer reads: actual customers, authorised selection, recorded orders', () => {
  let db: Db;
  const tx = <T>(fn: (t: Tx) => Promise<T>, b = B) => withTenantTx(db, business(b), fn);
  beforeAll(async () => {
    db = createDb(process.env['DATABASE_URL']!);
    await tx(async (t) => {
      await sql`insert into businesses (id,name) values (${B}::uuid,'Area 3 reader test')`.execute(t);
      await sql`insert into products (id,business_id,sku,name,unit,moq) values
        (${product}::uuid,${B}::uuid,'REAL','Real fabric','pcs',1),
        (${testProduct}::uuid,${B}::uuid,'TEST','Pretend fabric','pcs',1)`.execute(t);
      for (const [id,name] of [[mixed,'Mixed customer'],[closed,'Closed customer'],[empty,'100%_ literal'],[testOnly,'Test only']]) {
        await sql`insert into clients (id,business_id,display_name,phone) values (${id}::uuid,${B}::uuid,${name},${id === empty ? '+44 (7700) 123456' : null})`.execute(t);
      }
      for (const [id,client,isTest,active] of [[realChat,mixed,false,true],[testChat,mixed,true,false],[closedChat,closed,false,false],[onlyTestChat,testOnly,true,true]] as const) {
        await sql`insert into conversations (id,business_id,client_id,channel,owner_testing,is_active,assigned_to)
          values (${id}::uuid,${B}::uuid,${client}::uuid,'whatsapp',${isTest},${active},${isTest ? 'unclaimed' : null})`.execute(t);
        await sql`insert into conversation_state (conversation_id,identified_product_id) values (${id}::uuid,${isTest ? testProduct : product}::uuid)`.execute(t);
        await sql`insert into messages (conversation_id,direction,text_content,sent_at)
          values (${id}::uuid,'inbound','recorded words',${isTest ? '2026-11-01T00:00:00Z' : day}::timestamptz)`.execute(t);
      }
      await sql`insert into client_channels (business_id,client_id,channel,channel_user_id)
        values (${B}::uuid,${empty}::uuid,'email','directory@example.test')`.execute(t);
      await sql`insert into conversations (id,business_id,client_id,channel,is_active)
        values (${olderChat}::uuid,${B}::uuid,${mixed}::uuid,'email',false)`.execute(t);
      for (const [id,name,arch] of [[label,'Wholesale',false],[archived,'Old event',true],[removed,'Removed',false]] as const) {
        await sql`insert into labels (id,business_id,name,created_by,archived_at,archived_by)
          values (${id}::uuid,${B}::uuid,${name},'owner',${arch ? new Date() : null},${arch ? 'owner' : null})`.execute(t);
        await sql`insert into buyer_labels (business_id,client_id,label_id,added_by,removed_at,removed_by)
          values (${B}::uuid,${mixed}::uuid,${id}::uuid,'owner',${id === removed ? new Date() : null},${id === removed ? 'owner' : null})`.execute(t);
      }
      for (const [id,kind] of [[staff,'team'],[accountant,'accountant']] as const) {
        await sql`insert into people (id,business_id,name,kind) values (${id}::uuid,${B}::uuid,${kind},${kind})`.execute(t);
      }
      for (const [id,client,conv,currency,total,state] of [
        [dollars,mixed,realChat,'USD','100','confirmed'],[euros,mixed,olderChat,'EUR','80','shipped'],
        [testOrder,mixed,testChat,'USD','9000','confirmed'],[legacy,closed,closedChat,'USD','25','confirmed'],
        [unknown,closed,closedChat,'USD',null,'cancelled'],
      ] as const) {
        await sql`insert into orders (id,business_id,client_id,conversation_id,product_id,order_reference,quantity,unit,
          agreed_unit_price_usd,total_value_usd,currency,status,created_at,confirmed_at)
          values (${id}::uuid,${B}::uuid,${client}::uuid,${conv}::uuid,${product}::uuid,${'REF-'+id},10,'pcs',1,${total},${currency},${state},${id === testOrder ? '2026-11-01T00:00:00Z' : day}::timestamptz,${day}::timestamptz)`.execute(t);
      }
      await sql`insert into order_updates (business_id,order_id,state,at,by_actor)
        values (${B}::uuid,${dollars}::uuid,'cancelled','2026-10-03T00:00:00Z','owner'),
               (${B}::uuid,${legacy}::uuid,'pending_confirmation','2026-10-03T00:00:00Z','migration')`.execute(t);
    });
    await tx(async (t) => {
      await sql`insert into businesses (id,name) values (${FOREIGN}::uuid,'Other tenant')`.execute(t);
      await sql`insert into clients (id,business_id,display_name) values (${foreign}::uuid,${FOREIGN}::uuid,'Mixed customer')`.execute(t);
      await sql`insert into conversations (id,business_id,client_id,channel) values (${foreignChat}::uuid,${FOREIGN}::uuid,${foreign}::uuid,'whatsapp')`.execute(t);
    }, FOREIGN);
  }, 60_000);
  afterAll(async () => { await db?.destroy(); });

  it('includes no-conversation and closed customers once; omits test-only and foreign identities', async () => {
    const p = await tx((t) => readCustomersPage(t,{businessId:business(B)}));
    expect(p.rows.map((r) => r.clientId).sort()).toEqual([mixed,closed,empty].sort());
    expect(p.total).toBe(3); expect(p.from).toBe(1); expect(p.to).toBe(3);
    const row = p.rows.find((r) => r.clientId === mixed)!;
    expect(row.waiting).toBe(false); expect(row.lastContactAt?.toISOString()).toBe('2026-10-02T12:00:00.123Z');
    expect(row.labels).toEqual([{id:label,name:'Wholesale'}]);
    expect(p.rows.find((r) => r.clientId === empty)?.lastContactAt).toBeNull();
  });

  it('excludes test purchases but preserves legacy helper defaults and gives mixed-currency omissions', async () => {
    const [p,old] = await tx(async (t) => [await readCustomersPage(t,{businessId:business(B)}),await customerValues(t,[mixed])] as const);
    const value = p.rows.find((r) => r.clientId === mixed)!.value;
    expect(value.orders).toBe(2); expect(value.omittedCurrencyOrders).toBe(1); expect(value.unknownAmountOrders).toBe(0);
    const newestCurrency = dollars > euros ? 'USD' : 'EUR';
    expect(value.spent?.currency).toBe(newestCurrency);
    expect(numeralOf(value.spent!)).toBe(newestCurrency === 'USD' ? 100 : 80);
    expect(old.get(mixed)?.orders).toBe(3); expect(old.get(mixed)?.omittedCurrencyOrders).toBeUndefined();
  });

  it('pages ties and null dates forward/back without duplication; rejects reused filter cursors', async () => {
    const opts = {businessId:business(B),size:1};
    const a = await tx((t) => readCustomersPage(t,opts));
    const b = await tx((t) => readCustomersPage(t,{...opts,after:a.next!}));
    const c = await tx((t) => readCustomersPage(t,{...opts,after:b.next!}));
    expect(new Set([...a.rows,...b.rows,...c.rows].map((r) => r.clientId)).size).toBe(3);
    expect(c.rows[0]?.clientId).toBe(empty); expect(c.next).toBeNull();
    const back = await tx((t) => readCustomersPage(t,{...opts,before:c.prev!}));
    expect(back.rows[0]?.clientId).toBe(b.rows[0]?.clientId); expect(back.from).toBe(2);
    const changed = await tx((t) => readCustomersPage(t,{...opts,q:'literal',after:a.next!}));
    expect(changed.rows[0]?.clientId).toBe(empty); expect(changed.from).toBe(1);
    expect((await tx((t) => readCustomersPage(t,{...opts,after:'not-a-cursor'}))).rows[0]?.clientId).toBe(a.rows[0]?.clientId);
  });

  it('searches literal wildcards, normalized phones, identities and active labels, not test products', async () => {
    for (const q of ['%_','77001234','directory@example.test']) {
      expect((await tx((t) => readCustomersPage(t,{businessId:business(B),q}))).rows.map((r) => r.clientId)).toEqual([empty]);
    }
    expect((await tx((t) => readCustomersPage(t,{businessId:business(B),q:'Wholesale'}))).rows.map((r) => r.clientId)).toEqual([mixed]);
    for (const q of ['Old event','Removed','Pretend']) expect((await tx((t) => readCustomersPage(t,{businessId:business(B),q}))).total).toBe(0);
    for (const id of [archived,removed,uuid(),'broken']) expect((await tx((t) => readCustomersPage(t,{businessId:business(B),label:id}))).total).toBe(0);
    expect((await tx((t) => readCustomersPage(t,{businessId:business(B),label}))).rows.map((r) => r.clientId)).toEqual([mixed]);
  });

  it('selection refuses malformed/foreign/test/wrong-customer conversation instead of choosing a fallback', async () => {
    for (const clientId of ['broken',foreign,testOnly,uuid()]) expect(await tx((t) => readCustomerSelection(t,{businessId:business(B),clientId}))).toBeNull();
    for (const conversationId of ['broken',closedChat,testChat,foreignChat,uuid()]) {
      expect(await tx((t) => readCustomerSelection(t,{businessId:business(B),clientId:mixed,conversationId}))).toBeNull();
    }
    const p = await tx((t) => readCustomerSelection(t,{businessId:business(B),clientId:mixed,conversationId:realChat}));
    expect(p?.conversationId).toBe(realChat); expect(p?.conversations.rows.map((r) => r.id)).toEqual([realChat,olderChat]);
    expect(p?.card.value.orders).toBe(2); expect(p?.card.waiting).toBe(false);
    const noChat = await tx((t) => readCustomerSelection(t,{businessId:business(B),clientId:empty}));
    expect(noChat?.conversationId).toBeNull(); expect(noChat?.conversations.total).toBe(0);
  });

  it('operational orders read the latest log, retain legacy pending state and never count test orders', async () => {
    const { loadOrder } = await import('../../src/api/web/orders.js');
    const p = await tx((t) => readCustomerOrdersPage(t,{businessId:business(B)}));
    expect(p.total).toBe(4); expect(p.rows.some((r) => r.id === testOrder)).toBe(false);
    expect(p.rows.find((r) => r.id === dollars)?.state).toBe('cancelled');
    expect(p.rows.find((r) => r.id === legacy)?.state).toBe('pending_confirmation');
    const detail = await loadOrder(db,B,legacy);
    expect(detail?.history.at(-1)?.state).toBe('pending_confirmation');
    expect(p.rows.find((r) => r.id === legacy)?.stateAt?.toISOString()).toBe('2026-10-03T00:00:00.000Z');
    expect(p.rows.find((r) => r.id === unknown)?.total).toBeNull();
    expect(numeralOf(p.rows.find((r) => r.id === dollars)!.total!)).toBe(100);
    expect(p.rows.find((r) => r.id === euros)?.total?.currency).toBe('EUR');
    expect((await tx((t) => readCustomerOrdersPage(t,{businessId:business(B),state:'pending_confirmation'}))).rows.map((r) => r.id)).toEqual([legacy]);
    expect((await tx((t) => readCustomerOrdersPage(t,{businessId:business(B),clientId:mixed}))).total).toBe(2);
    for (const clientId of ['broken',foreign,testOnly]) expect((await tx((t) => readCustomerOrdersPage(t,{businessId:business(B),clientId}))).total).toBe(0);
  });

  it('orders have bounded stable paging, literal reference search, and filter-bound cursors', async () => {
    const opts = {businessId:business(B),size:2};
    const a = await tx((t) => readCustomerOrdersPage(t,opts));
    const b = await tx((t) => readCustomerOrdersPage(t,{...opts,after:a.next!}));
    expect(new Set([...a.rows,...b.rows].map((r) => r.id)).size).toBe(4); expect(b.next).toBeNull();
    expect((await tx((t) => readCustomerOrdersPage(t,{...opts,before:b.prev!}))).rows).toEqual(a.rows);
    expect((await tx((t) => readCustomerOrdersPage(t,{...opts,q:'REF-'+legacy,after:a.next!}))).rows.map((r) => r.id)).toEqual([legacy]);
    expect((await tx((t) => readCustomerOrdersPage(t,{...opts,q:'%'}))).total).toBe(0);
  });

  it('staff can read; accountant RLS returns no directory, selection or orders', async () => {
    expect((await asViewer(staff,() => tx((t) => readCustomersPage(t,{businessId:business(B),viewerId:staff})))).total).toBe(3);
    await asViewer(accountant,async () => {
      expect((await tx((t) => readCustomersPage(t,{businessId:business(B),viewerId:accountant}))).total).toBe(0);
      expect(await tx((t) => readCustomerSelection(t,{businessId:business(B),clientId:mixed}))).toBeNull();
      expect((await tx((t) => readCustomerOrdersPage(t,{businessId:business(B)}))).total).toBe(0);
    });
  });

  it('all reads work inside a server-enforced read-only transaction', async () => {
    await tx(async (t) => {
      await sql`set transaction read only`.execute(t);
      await readCustomersPage(t,{businessId:business(B)});
      await readCustomerSelection(t,{businessId:business(B),clientId:mixed});
      await readCustomerOrdersPage(t,{businessId:business(B)});
    });
  });

  it('real-only asked-about and cards exclude tests while legacy callers keep their old scope', async () => {
    await tx(async (t) => {
      expect((await askedAbout(t,mixed,10)).map((p) => p.name).sort()).toEqual(['Pretend fabric','Real fabric']);
      expect((await askedAbout(t,mixed,10,{realOnly:true})).map((p) => p.name)).toEqual(['Real fabric']);
      expect((await loadCustomerCard(t,mixed))?.waiting).toBe(true);
      expect((await loadCustomerCard(t,mixed,undefined,{realOnly:true}))?.waiting).toBe(false);
      expect(await loadCustomerCard(t,testOnly,undefined,{realOnly:true})).toBeNull();
      expect(await loadCustomerCard(t,testOnly)).not.toBeNull();
    });
  });

  it('conversation paging is bounded and honors explicit selection outside the current page', async () => {
    const opts = {businessId:business(B),clientId:mixed,size:1,conversationId:olderChat};
    const a = await tx((t) => readCustomerSelection(t,opts));
    expect(a?.conversationId).toBe(olderChat); expect(a?.conversations.rows.map((r) => r.id)).toEqual([realChat]);
    const b = await tx((t) => readCustomerSelection(t,{...opts,after:a!.conversations.next!}));
    expect(b?.conversations.rows.map((r) => r.id)).toEqual([olderChat]);
    const back = await tx((t) => readCustomerSelection(t,{...opts,before:b!.conversations.prev!}));
    expect(back?.conversations.rows.map((r) => r.id)).toEqual([realChat]);
  });

  it('canonical file validates expected client and excludes newer test orders; legacy file remains unchanged', async () => {
    const { loadCustomerFile } = await import('../../src/api/web/conversations.js');
    const scoped = {realOnly:true,expectedClientId:mixed};
    expect(await loadCustomerFile(db,B,realChat,{...scoped,expectedClientId:closed})).toBeNull();
    expect(await loadCustomerFile(db,B,testChat,scoped)).toBeNull();
    expect(await loadCustomerFile(db,B,foreignChat,scoped)).toBeNull();
    expect(await loadCustomerFile(db,B,'invalid',scoped)).toBeNull();
    const current = await loadCustomerFile(db,B,realChat,scoped);
    expect(current?.customer?.clientId).toBe(mixed);
    expect(current?.customer?.value.orders).toBe(2);
    expect(current?.context.order?.id).not.toBe(testOrder);
    expect(current?.context.order?.id).toBe(dollars > euros ? dollars : euros);
    const old = await loadCustomerFile(db,B,realChat);
    expect(old?.customer?.value.orders).toBe(3);
    expect(old?.context.order?.id).toBe(testOrder);
  });

  it('valid upper-case IDs keep canonical identity and the same customer totals', async () => {
    const p = await tx((t) => readCustomerSelection(t,{businessId:business(B),clientId:mixed.toUpperCase(),conversationId:realChat.toUpperCase()}));
    expect(p?.card.clientId).toBe(mixed); expect(p?.conversationId).toBe(realChat);
    expect(p?.card.value.orders).toBe(2);
  });

  it('refuses a canonical file if its conversation is reassigned between the head and subsequent reads', async () => {
    const { loadCustomerFile } = await import('../../src/api/web/conversations.js');
    let headQuery: unknown, moved = false;
    const changing = db.withPlugin({
      transformQuery(args) {
        if (args.node.kind === 'RawNode' && args.node.sqlFragments.join('').includes('cl.display_name as buyer')) headQuery = args.queryId;
        return args.node;
      },
      async transformResult(args) {
        if (args.queryId === headQuery && !moved) {
          moved = true;
          await tx((t) => sql`update conversations set client_id = ${closed}::uuid where id = ${realChat}::uuid`.execute(t));
        }
        return args.result;
      },
    });
    try {
      expect(await loadCustomerFile(changing,B,realChat,{realOnly:true,expectedClientId:mixed})).toBeNull();
      expect(moved).toBe(true);
    } finally {
      await tx((t) => sql`update conversations set client_id = ${mixed}::uuid where id = ${realChat}::uuid`.execute(t));
    }
  });

  it('caps requested directory size and returns an exact final page', async () => {
    const tenant = uuid();
    await tx(async (t) => {
      await sql`insert into businesses (id,name) values (${tenant}::uuid,'Bounded directory')`.execute(t);
      await sql`insert into clients (business_id,display_name) select ${tenant}::uuid,'Customer ' || n from generate_series(1,105) n`.execute(t);
    },tenant);
    const first = await tx((t) => readCustomersPage(t,{businessId:business(tenant),size:10000}),tenant);
    expect(first.rows).toHaveLength(100); expect(first.total).toBe(105); expect(first.from).toBe(1); expect(first.to).toBe(100);
    const last = await tx((t) => readCustomersPage(t,{businessId:business(tenant),size:10000,after:first.next!}),tenant);
    expect(last.rows).toHaveLength(5); expect(last.to).toBe(105); expect(last.next).toBeNull();
  });

  it('retains SQL microseconds, survives moving boundaries and refuses invalid cursor dates', async () => {
    const tenant = uuid(), customers = [uuid(),uuid()].sort(), c1 = customers[0]!, c2 = customers[1]!;
    const conv1 = uuid(), conv2 = uuid();
    await tx(async (t) => {
      await sql`insert into businesses (id,name) values (${tenant}::uuid,'Microseconds')`.execute(t);
      for (const [id,conv,stamp] of [[c1,conv1,'2026-10-02T12:00:00.123456Z'],[c2,conv2,'2026-10-02T12:00:00.123455Z']]) {
        await sql`insert into clients (id,business_id,display_name) values (${id}::uuid,${tenant}::uuid,'Tie')`.execute(t);
        await sql`insert into conversations (id,business_id,client_id,channel) values (${conv}::uuid,${tenant}::uuid,${id}::uuid,'email')`.execute(t);
        await sql`insert into messages (conversation_id,direction,text_content,sent_at) values (${conv}::uuid,'inbound','Hi',${stamp}::timestamptz)`.execute(t);
      }
    },tenant);
    const o = {businessId:business(tenant),size:1};
    const first = await tx((t) => readCustomersPage(t,o),tenant);
    expect(first.rows[0]?.clientId).toBe(c1);
    const cursor = JSON.parse(Buffer.from(first.next!,'base64url').toString('utf8')) as {at:string};
    expect(cursor.at).toBe('2026-10-02T12:00:00.123456Z');
    await tx((t) => sql`insert into messages (conversation_id,direction,text_content,sent_at)
      values (${conv1}::uuid,'inbound','New activity','2026-11-01T00:00:00Z')`.execute(t),tenant);
    expect((await tx((t) => readCustomersPage(t,{...o,after:first.next!}),tenant)).rows[0]?.clientId).toBe(c2);
    for (const at of ['2026-02-31T00:00:00.123456Z','2026-13-02T00:00:00.123456Z','garbage']) {
      const forged = Buffer.from(JSON.stringify({...cursor,at})).toString('base64url');
      expect((await tx((t) => readCustomersPage(t,{...o,after:forged}),tenant)).rows[0]?.clientId).toBe(c1);
    }
  });

  it('missing totals remain unknown and unit groups are not falsely added together', async () => {
    const tenant = uuid(), client = uuid(), item = uuid(), firstConv = uuid(), secondConv = uuid();
    await tx(async (t) => {
      await sql`insert into businesses (id,name) values (${tenant}::uuid,'Missing amounts')`.execute(t);
      await sql`insert into clients (id,business_id,display_name) values (${client}::uuid,${tenant}::uuid,'Buyer')`.execute(t);
      await sql`insert into products (id,business_id,sku,name,unit,moq) values (${item}::uuid,${tenant}::uuid,'S','Fabric','pcs',1)`.execute(t);
      for (const [conv,currency,amount,unit,stamp] of [[firstConv,'USD','100','pcs','2026-10-01T00:00:00Z'],[secondConv,'EUR',null,'boxes','2026-10-02T00:00:00Z']] as const) {
        await sql`insert into conversations (id,business_id,client_id,channel) values (${conv}::uuid,${tenant}::uuid,${client}::uuid,'email')`.execute(t);
        await sql`insert into orders (business_id,client_id,conversation_id,product_id,order_reference,quantity,unit,currency,total_value_usd,status,created_at)
          values (${tenant}::uuid,${client}::uuid,${conv}::uuid,${item}::uuid,${uuid()},10,${unit},${currency},${amount},'confirmed',${stamp}::timestamptz)`.execute(t);
      }
      const selection = await readCustomerSelection(t,{businessId:business(tenant),clientId:client});
      expect(selection?.card.value.spent).toBeNull();
      expect(selection?.card.value.orders).toBe(2);
      expect(selection?.card.value.omittedCurrencyOrders).toBe(1);
      expect(selection?.card.value.unknownAmountOrders).toBe(1);
      expect(selection?.card.bought.map((b) => [b.quantity,b.unit])).toEqual([[10,'boxes'],[10,'pcs']]);
    },tenant);
  });
});
