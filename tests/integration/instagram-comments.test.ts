import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
const enabled = !!process.env['DATABASE_URL'] && !!process.env['MIGRATE_DATABASE_URL'];
const suite = enabled ? describe : describe.skip;
suite('Instagram comments · persistence, tenant bounds and erasure (real Postgres)', () => {
  let admin: pg.Client; let app: pg.Client;
  const business = randomUUID(); const other = randomUUID(); const account = randomUUID();
  const ig = String(Date.now()) + String(Math.floor(Math.random() * 10000));
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: process.env['MIGRATE_DATABASE_URL'] }); await admin.connect();
    app = new pg.Client({ connectionString: process.env['DATABASE_URL'] }); await app.connect();
    await admin.query('insert into businesses (id,name) values ($1,\'Comment shop\'),($2,\'Other shop\')',[business,other]);
    await admin.query("insert into meta_accounts (id,business_id,page_id,page_name,ig_account_id,token_ciphertext,fingerprint,scopes,connected_by) values ($1,$2,$3,'Page',$3,'v1.fake-test-ciphertext','000000000000','instagram_manage_comments','owner')",[account,business,ig]);
  });
  afterAll(async () => { await app?.end(); await admin?.end(); });
  const as = async <T>(b: string, fn: () => Promise<T>): Promise<T> => { await app.query('begin');try { await app.query("select set_config('app.business_id',$1,true)",[b]);const r=await fn();await app.query('commit');return r; }catch(e){await app.query('rollback');throw e;} };
  const add = async (created: Date | null, received = new Date()) => {
    const comment = randomUUID();
    const r = await admin.query("insert into ig_comments (business_id,meta_account_id,account_id,comment_id,identity,words,media_id,asking,created_at,received_at) values ($1,$2,$3,$4,'comment-person','Price please','post-1',true,$5,$6) returning id",[business,account,ig,comment,created,received]);
    return { id:r.rows[0].id as string, comment, received };
  };
  it('starts off and exposes only this tenant, with no app DELETE privilege', async () => {
    expect((await admin.query("select to_regclass('ig_comments') is not null as present")).rows[0].present).toBe(true);
    expect((await admin.query('select count(*)::int as n from ig_comment_settings where business_id=$1 and enabled',[business])).rows[0].n).toBe(0);
    const c=await add(new Date());
    expect((await as(other,()=>app.query('select id from ig_comments where id=$1',[c.id]))).rowCount).toBe(0);
    await expect(as(business,()=>app.query('delete from ig_comments where id=$1',[c.id]))).rejects.toMatchObject({code:'42501'});
  });
  it('uniqueness is account/comment, and cross-tenant account references cannot be inserted', async () => {
    const c=await add(new Date());
    await expect(admin.query("insert into ig_comments (business_id,meta_account_id,account_id,comment_id,identity,words,media_id) values ($1,$2,$3,$4,'p','x','m')",[business,account,ig,c.comment])).rejects.toMatchObject({code:'23505'});
    await expect(as(other,()=>app.query("insert into ig_comments (business_id,meta_account_id,account_id,comment_id,identity,words,media_id) values ($1,$2,$3,'wrong','p','x','m')",[other,account,ig]))).rejects.toBeDefined();
  });
  for (const age of ['known','unknown'] as const) it(`${age} age erasure keeps only an expiring digest and refuses replay`, async () => {
    const received=new Date();const c=await add(age==='known'?new Date(received.getTime()-3600000):null,received);
    await as(business,()=>app.query("select ig_comment_erase($1,'owner')",[c.id]));
    expect((await admin.query('select id from ig_comments where id=$1',[c.id])).rowCount).toBe(0);
    const stone=(await admin.query('select * from ig_comment_tombstones where digest=ig_comment_digest($1,$2,$3)',[business,ig,c.comment])).rows[0];
    expect(Object.keys(stone).sort()).toEqual(['digest','expires_at','state']);
    expect(stone.expires_at.getTime()).toBe(received.getTime()+8*86400000);
    expect((await as(business,()=>app.query('select ig_comment_was_erased($1,$2) as erased',[ig,c.comment]))).rows[0].erased).toBe(true);
    const ledger=(await admin.query("select * from erasure_ledger where kind='comment' and business_id=$1 order by at desc limit 1",[business])).rows[0];
    expect(JSON.stringify(ledger)).not.toContain('Price please'); expect(JSON.stringify(ledger)).not.toContain('comment-person');
    expect(ledger.comment_digests).toEqual([{digest:stone.digest,state:'erased',expires_at:stone.expires_at.toISOString()}]);
    await admin.query('delete from ig_comment_tombstones where digest=$1',[stone.digest]);
    expect(ledger.comment_ids).toEqual([c.id]);
    await admin.query('select ig_comment_replay($1,$2::uuid[],$3::jsonb)',[business,ledger.comment_ids,JSON.stringify(ledger.comment_digests)]);
    expect((await as(business,()=>app.query('select ig_comment_was_erased($1,$2) as erased',[ig,c.comment]))).rows[0].erased).toBe(true);
  });
  it('refuses a staff actor and a different tenant on the definer deletion', async () => {
    const c=await add(new Date());
    await expect(as(business,()=>app.query('select ig_comment_erase($1,$2)',[c.id,randomUUID()]))).rejects.toMatchObject({code:'42501'});
    await expect(as(other,()=>app.query("select ig_comment_erase($1,'owner')",[c.id]))).rejects.toBeDefined();
    expect((await admin.query('select id from ig_comments where id=$1',[c.id])).rowCount).toBe(1);
  });
  it('the daily sweep removes only expired digests, including ledger copies', async () => {
    const c=await add(new Date(Date.now()-10*86400000),new Date(Date.now()-9*86400000));
    await as(business,()=>app.query("select ig_comment_erase($1,'owner')",[c.id]));
    await admin.query('select ig_comment_sweep()');
    expect((await admin.query('select * from ig_comment_tombstones where digest=ig_comment_digest($1,$2,$3)',[business,ig,c.comment])).rowCount).toBe(0);
    expect((await admin.query("select count(*)::int as n from erasure_ledger, jsonb_array_elements(comment_digests) d where (d->>'expires_at')::timestamptz <= now()")).rows[0].n).toBe(0);
    const ledger=(await admin.query('select * from erasure_ledger where comment_ids @> array[$1::uuid]',[c.id])).rows[0];
    expect(ledger.kind).toBe('comment'); expect(ledger.customer_id).toBeNull();
    expect(ledger.comment_ids).toEqual([c.id]); expect(ledger.comment_digests).toEqual([]);
    await admin.query("insert into ig_comments(id,business_id,meta_account_id,account_id,comment_id,identity,words,media_id,received_at) values($1,$2,$3,$4,$5,'restored-person','Restored words','post-1',$6)",[c.id,business,account,ig,c.comment,c.received]);
    expect((await admin.query('select * from erasure_ledger_unkept() where ledger_id=$1',[ledger.id])).rowCount).toBe(1);
    await admin.query('select ig_comment_replay($1,$2::uuid[],$3::jsonb)',[business,ledger.comment_ids,'[]']);
    expect((await admin.query('select id from ig_comments where id=$1',[c.id])).rowCount).toBe(0);
  });
  for(const edge of ['identity','conversation'] as const)it(`customer erasure follows ${edge} and records ids on the customer ledger`,async()=>{
    const client=randomUUID();const conv=randomUUID();const request=randomUUID();const identity='person-'+randomUUID();
    await admin.query('insert into clients(id,business_id) values($1,$2)',[client,business]);
    await admin.query("insert into client_channels(client_id,channel,channel_user_id) values($1,'instagram',$2)",[client,identity]);
    await admin.query("insert into conversations(id,business_id,client_id,channel) values($1,$2,$3,'instagram')",[conv,business,client]);
    const c=await add(new Date());await admin.query('update ig_comments set identity=$2,conversation_id=$3 where id=$1',[c.id,edge==='identity'?identity:'unlinked-person',edge==='conversation'?conv:null]);
    await admin.query("insert into deletion_requests(id,business_id,scope,client_id,asked_by) values($1,$2,'buyer',$3,'owner')",[request,business,client]);
    await admin.query("select carry_out_customer_request($1,$2,'test','operator')",[business,request]);
    expect((await admin.query('select id from ig_comments where id=$1',[c.id])).rowCount).toBe(0);
    const ledger=(await admin.query('select * from erasure_ledger where business_id=$1 and customer_id=$2',[business,client])).rows;
    expect(ledger).toHaveLength(1);expect(ledger[0].kind).toBe('customer');expect(ledger[0].comment_ids).toContain(c.id);
    expect((await admin.query('select * from erasure_ledger_unkept() where ledger_id=$1',[ledger[0].id])).rowCount).toBe(0);
  });
  it('new single-column links still refuse foreign customers and products, including for an administrator',async()=>{
    const foreign=randomUUID();const product=randomUUID();await admin.query('insert into clients(id,business_id) values($1,$2)',[foreign,other]);
    await admin.query("insert into products(id,business_id,sku,name) values($1,$2,'FOREIGN','Other product')",[product,other]);
    const c=await add(new Date());
    await expect(admin.query('update ig_comments set client_id=$2 where id=$1',[c.id,foreign])).rejects.toMatchObject({code:'23514'});
    await expect(admin.query('update ig_comments set product_id=$2 where id=$1',[c.id,product])).rejects.toMatchObject({code:'23514'});
  });
  it('the mailed ledger retains internal ids but never a digest',async()=>{
    const c=await add(new Date());await as(business,()=>app.query("select ig_comment_erase($1,'owner')",[c.id]));
    await admin.query("update erasure_ledger set at=now()-interval '6 minutes' where comment_ids @> array[$1::uuid]",[c.id]);
    const lines=(await admin.query('select erasure_ledger_unmailed(10000) as line')).rows.map(r=>r.line);
    const line=lines.find(r=>r.comment_ids?.includes(c.id));
    expect(line?.kind).toBe('comment');expect(line?.comment_ids).toEqual([c.id]);
    expect(line).not.toHaveProperty('comment_digests');
    expect(JSON.stringify(line)).not.toContain('comment-person');
  });
});
