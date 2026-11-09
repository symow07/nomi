import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomInt, randomUUID } from 'node:crypto';
import { saveProductPhoto } from '../../src/db/productPhotos.js';
import { createDb, withTenantTx, type Db } from '../../src/db/client.js';
import type { BusinessId } from '../../src/core/types/ids.js';
import { catalogueProducts, saveCatalogueProduct, previewCatalogue, submitCatalogue, checkCatalogue, catalogueImage } from '../../src/db/waCatalogue.js';
import type { CatalogueClient } from '../../src/net/waCatalogue.js';
import Fastify from 'fastify';
import { registerWebApp } from '../../src/api/web/app.js';
import { hashCode } from '../../src/api/web/people.js';
import { makeSessionCodec } from '../../src/api/web/session.js';

const d = process.env['DATABASE_URL'] && process.env['MIGRATE_DATABASE_URL'] ? describe : describe.skip;
d('The owner-selected catalogue (requires DATABASE_URL)', () => {
  let admin: pg.Client;
  let db: Db;
  beforeAll(async () => { admin = new pg.Client({ connectionString: process.env['MIGRATE_DATABASE_URL'] }); await admin.connect(); db=createDb(process.env['DATABASE_URL']!); });
  afterAll(async () => { await db?.destroy(); await admin?.end(); });
  const one = async (text: string, values: unknown[] = []) => (await admin.query(text,values)).rows[0];
  const fixture = async (existing?: BusinessId) => {
    const biz=existing??randomUUID() as BusinessId;
    if(!existing) await admin.query(`insert into businesses(id,name,currency) values($1,'The shop','GBP')`,[biz]);
    const product=(await one(`insert into products(business_id,sku,name,unit,price_usd_per_unit,currency,is_active,quote_vetted_at)
      values($1,$2,'Linen shirt','item',24.50,'GBP',true,now()) returning id`,[biz,randomUUID()])).id as string;
    await admin.query(`insert into product_aliases(product_id,alias) values($1,'linen shirt')`,[product]);
    await withTenantTx(db,biz,tx=>saveProductPhoto(tx,biz,product,Buffer.from('89504e470d0a1a0a','hex')));
    const image=(await one(`select id from product_images where product_id=$1`,[product])).id as string;
    const account=existing?(await one(`select id from whatsapp_accounts where business_id=$1`,[biz])).id as string:(await one(`insert into whatsapp_accounts(business_id,waba_id,phone_number_id,token_ciphertext,fingerprint,connected_by)
      values($1,'12345',$2,'v1.test-only-encrypted','012345abcdef','owner') returning id`,[biz,String(randomInt(100000,999999999))])).id as string;
    await withTenantTx(db,biz,tx=>saveCatalogueProduct(tx,biz,product,{description:'A linen shirt',link:'https://shop.example/shirt',availability:'in stock',brand:'The shop',condition:'new',imageId:image}));
    return {biz,product,image,account};
  };
  const scenario = async () => {
    const f=await fixture(); let clock=new Date('2031-05-12T12:00:00Z');
    const calls: import('../../src/core/catalogue/whatsapp.js').CatalogueRequest[][]=[];
    let result: Awaited<ReturnType<CatalogueClient['status']>>={ok:true,finished:true,invalid:{},warnings:{}};
    const client: CatalogueClient={linked:async()=>({ok:true,catalogId:'456'}),
      submit:async(_id,items)=>{calls.push([...items]);return {ok:true,handle:'batch-one',invalid:{},warnings:{}};},status:async()=>result};
    const deps={db,client,now:()=>clock,publicBaseUrl:'https://nomi.example'};
    const preview=await previewCatalogue(deps,f.biz,'owner'); if(!preview.ok) throw Error(preview.reason);
    const item=await one(`select id,item_id,snapshot from wa_catalogue_batch_items where batch_id=$1`,[preview.batchId]);
    const submit=()=>submitCatalogue(deps,f.biz,preview.batchId,[item.id]);
    const check=()=>checkCatalogue(deps,f.biz,preview.batchId);
    return {...f,deps,calls,item,batch:preview.batchId,submit,check,setResult:(r:typeof result)=>{result=r;},advance:(ms:number)=>{clock=new Date(clock.getTime()+ms);}};
  };
  it('classifies every new table, enables RLS and grants no app deletion', async () => {
    const names = ['wa_catalogue_items', 'wa_catalogue_batches', 'wa_catalogue_batch_items', 'wa_catalogue_images', 'wa_catalogue_sends'];
    const rows = (await admin.query(`select relname, relrowsecurity, has_table_privilege('nomi_app', oid, 'DELETE') as can_delete
      from pg_class where relname = any($1::text[]) order by relname`, [names])).rows;
    expect(rows).toEqual(names.sort().map(relname => ({ relname, relrowsecurity: true, can_delete: false })));
    expect((await admin.query(`select tbl from customer_erasure_contract() where tbl = any($1::text[])`, [names])).rows).toHaveLength(5);
  });
  it('ticks only, once; a handle is pending; terminal acceptance publishes the chosen image', async () => {
    const f=await fixture(); const now=new Date('2031-05-12T12:00:00Z');
    const calls: unknown[]=[];
    const client: CatalogueClient={
      linked:async()=>({ok:true,catalogId:'456'}),
      submit:async(_id,items)=>{calls.push(items); return {ok:true,handle:'batch-one',invalid:{},warnings:{}};},
      status:async()=>({ok:true,finished:true,invalid:{},warnings:{}}),
    };
    const deps={db,client,now:()=>now,publicBaseUrl:'https://nomi.example'};
    const products=await withTenantTx(db,f.biz,tx=>catalogueProducts(tx,f.biz));
    expect(products).toHaveLength(1); expect(products[0]!.reasons).toEqual([]);
    const empty=await previewCatalogue(deps,f.biz,'owner'); expect(empty.ok).toBe(true);
    if(!empty.ok) throw Error('preview');
    expect(await submitCatalogue(deps,f.biz,empty.batchId,[])).toMatchObject({ok:true,state:'empty'});
    expect(calls).toHaveLength(0);
    const preview=await previewCatalogue(deps,f.biz,'owner'); if(!preview.ok) throw Error('preview');
    const row=await one(`select id from wa_catalogue_batch_items where batch_id=$1`,[preview.batchId]);
    expect(await submitCatalogue(deps,f.biz,preview.batchId,[row.id])).toMatchObject({ok:true,state:'pending'});
    expect(await submitCatalogue(deps,f.biz,preview.batchId,[row.id])).toMatchObject({ok:false});
    expect(calls).toHaveLength(1);
    expect((await one(`select state from wa_catalogue_items where business_id=$1`,[f.biz])).state).toBe('pending');
    const grant=await one(`select token from wa_catalogue_images where business_id=$1`,[f.biz]);
    expect(grant.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await catalogueImage(db,grant.token,now)).not.toBeNull();
    expect(await checkCatalogue(deps,f.biz,preview.batchId)).toMatchObject({ok:true,state:'finished'});
    expect((await one(`select state from wa_catalogue_items where business_id=$1`,[f.biz])).state).toBe('synced');
    expect(await catalogueImage(db,grant.token,new Date(now.getTime()+3600000))).not.toBeNull();
  });
  it.each(['price','image','availability','account'] as const)('a changed %s after preview sends nothing', async field=>{
    const s=await scenario();
    if(field==='price') await admin.query(`update products set price_usd_per_unit=25 where id=$1`,[s.product]);
    if(field==='image') await withTenantTx(db,s.biz,tx=>saveProductPhoto(tx,s.biz,s.product,Buffer.from('89504e470d0a1a0a','hex')));
    if(field==='availability') await admin.query(`update wa_catalogue_items set availability='out of stock' where business_id=$1`,[s.biz]);
    if(field==='account') s.deps.client.linked=async()=>({ok:true,catalogId:'789'});
    expect(await s.submit()).toMatchObject({ok:false,reason:'changed'}); expect(s.calls).toHaveLength(0);
    expect((await one(`select count(*)::int as n from wa_catalogue_images where business_id=$1`,[s.biz])).n).toBe(0);
  });
  it('an expired pending image stays gone when status arrives late; the next review offers an update', async()=>{
    const s=await scenario(); await s.submit();
    const g=await one(`select token from wa_catalogue_images where business_id=$1`,[s.biz]);
    s.advance(15*60000-1); expect(await catalogueImage(db,g.token,s.deps.now())).not.toBeNull();
    s.advance(1); expect(await catalogueImage(db,g.token,s.deps.now())).toBeNull();
    await s.check(); expect(await catalogueImage(db,g.token,s.deps.now())).toBeNull();
    const preview=await previewCatalogue(s.deps,s.biz,'owner'); if(!preview.ok) throw Error(preview.reason);
    expect((await one(`select operation from wa_catalogue_batch_items where batch_id=$1`,[preview.batchId]))?.operation).toBe('UPDATE');
  });
  it('a product unvetted during ingestion is offered for removal after provider acceptance', async()=>{
    const s=await scenario(); await s.submit();
    await admin.query(`update products set price_usd_per_unit=26 where id=$1`,[s.product]);
    await s.check();
    const preview=await previewCatalogue(s.deps,s.biz,'owner'); if(!preview.ok) throw Error(preview.reason);
    expect((await one(`select operation from wa_catalogue_batch_items where batch_id=$1`,[preview.batchId]))?.operation).toBe('DELETE');
  });
  it('mixed ticks and partial failure affect only the chosen matching item, then removal revokes the good image', async()=>{
    const s=await scenario(), second=await fixture(s.biz), unticked=await fixture(s.biz);
    const preview=await previewCatalogue(s.deps,s.biz,'owner');if(!preview.ok)throw Error(preview.reason);
    const rows=(await admin.query(`select id,item_id,snapshot from wa_catalogue_batch_items where batch_id=$1`,[preview.batchId])).rows;
    const selected=rows.filter(r=>r.snapshot.id!==unticked.product);
    expect(await submitCatalogue(s.deps,s.biz,preview.batchId,selected.map(r=>r.id))).toEqual({ok:true,state:'pending'});
    expect(s.calls).toHaveLength(1);expect(s.calls[0]!.map(r=>r.data['id']).sort()).toEqual(selected.map(r=>r.snapshot.retailerId).sort());
    expect((await one(`select count(*)::int as n from wa_catalogue_images g join wa_catalogue_items i on i.id=g.item_id where i.product_id=$1`,[unticked.product])).n).toBe(0);
    s.setResult({ok:true,finished:true,invalid:{[s.item.snapshot.retailerId]:'Description refused'},warnings:{}});
    await checkCatalogue(s.deps,s.biz,preview.batchId);
    const grants=(await admin.query(`select g.token,i.product_id,i.state from wa_catalogue_images g join wa_catalogue_items i on i.id=g.item_id where g.business_id=$1`,[s.biz])).rows;
    const failed=grants.find(g=>g.product_id===s.product)!,good=grants.find(g=>g.product_id===second.product)!;
    expect(failed.state).toBe('error');expect(good.state).toBe('synced');
    expect(await catalogueImage(db,failed.token,s.deps.now())).toBeNull();expect(await catalogueImage(db,good.token,s.deps.now())).not.toBeNull();
    await admin.query(`update products set is_active=false where id=$1`,[second.product]);
    const removal=await previewCatalogue(s.deps,s.biz,'owner');if(!removal.ok)throw Error(removal.reason);
    const line=await one(`select bi.id,bi.operation from wa_catalogue_batch_items bi join wa_catalogue_items i on i.id=bi.item_id where bi.batch_id=$1 and i.product_id=$2`,[removal.batchId,second.product]);
    expect(line.operation).toBe('DELETE');
    expect(await catalogueImage(db,good.token,s.deps.now())).toBeNull();
    await submitCatalogue(s.deps,s.biz,removal.batchId,[line.id]);s.setResult({ok:true,finished:true,invalid:{},warnings:{}});await checkCatalogue(s.deps,s.biz,removal.batchId);
    expect((await one(`select state from wa_catalogue_items where product_id=$1`,[second.product])).state).toBe('removed');
    expect((await one(`select state from wa_catalogue_images where token=$1`,[good.token])).state).toBe('revoked');
  });
  it('a wholly rejected receipt keeps the item reason and warning, and revokes the image',async()=>{
    const s=await scenario();s.deps.client.submit=async()=>({ok:false,reason:'not_ingested',invalid:{[s.item.snapshot.retailerId]:'Description missing'},warnings:{[s.item.snapshot.retailerId]:'Check the size'}});
    expect(await s.submit()).toEqual({ok:true,state:'failed'});
    expect(await one(`select error,warning from wa_catalogue_batch_items where id=$1`,[s.item.id])).toEqual({error:'Description missing',warning:'Check the size'});
    expect((await one(`select state from wa_catalogue_images where business_id=$1`,[s.biz])).state).toBe('revoked');
  });
  it('an unknown submission is never retried or called synced', async()=>{
    const s=await scenario(); let attempts=0;
    s.deps.client.submit=async()=>{attempts++;return {ok:false,reason:'unknown'};};
    expect(await s.submit()).toEqual({ok:true,state:'unknown'});
    expect(await s.submit()).toMatchObject({ok:false});expect(attempts).toBe(1);
    expect((await one(`select state from wa_catalogue_items where business_id=$1`,[s.biz])).state).toBe('unknown');
  });
  it('foreign review IDs and checked IDs never disclose or submit another workspace', async()=>{
    const s=await scenario(), other=await fixture();
    expect(await submitCatalogue(s.deps,other.biz,s.batch,[s.item.id])).toMatchObject({ok:false});
    expect(await submitCatalogue(s.deps,s.biz,s.batch,[randomUUID()])).toMatchObject({ok:false});
    expect(s.calls).toHaveLength(0);
  });
  it('Practice and a missing linked catalogue call no batch endpoint', async()=>{
    const s=await scenario(), live=await fixture();
    await admin.query(`update businesses set practice_of=$2 where id=$1`,[s.biz,live.biz]);
    expect(await s.submit()).toMatchObject({ok:false});
    expect(s.calls).toHaveLength(0);
    s.deps.client.linked=async()=>({ok:true,catalogId:null});
    expect(await previewCatalogue(s.deps,live.biz,'owner')).toEqual({ok:false,reason:'no_catalogue'});
  });
  it('the real owner routes save and review; staff sees the page but cannot write',async()=>{
    const f=await fixture(),secret='catalogue-test-session-secret-long-enough',code='owner-catalogue-test',staffCode='STAFF-CAT-'+randomUUID();
    await admin.query(`insert into people(business_id,name,code_hash) values($1,'Colleague',$2)`,[f.biz,hashCode(secret,staffCode)]);
    const app=Fastify({logger:false});
    registerWebApp(app,{db,businessId:f.biz,accessCode:code,sessionSecret:secret,provider:'disabled',secureCookie:false,
      publicBaseUrl:'https://nomi.example',catalogueClient:()=>({linked:async()=>({ok:true,catalogId:'456'}),
        submit:async()=>({ok:true,handle:'fake-handle',invalid:{},warnings:{}}),status:async()=>({ok:true,finished:true,invalid:{},warnings:{}})}),
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const post=(cookie:string,url:string,body:Record<string,string>={})=>app.inject({method:'POST',url,headers:{cookie,'content-type':'application/x-www-form-urlencoded'},payload:new URLSearchParams(body).toString()});
    const login=async(code:string)=>{const r=await post('','/login',{code});return String(r.headers['set-cookie']).split(';')[0]!;};
    try{
      const owner=await login(code),staff=await login(staffCode);
      const page=await app.inject({url:'/app/products/whatsapp',headers:{cookie:owner}});
      expect(page.statusCode).toBe(200);expect(page.body).toContain('Details for WhatsApp');
      const readonly=await app.inject({url:'/app/products/whatsapp',headers:{cookie:staff}});
      expect(readonly.statusCode).toBe(200);expect(readonly.body).toContain('Only the owner');
      const before=await one(`select description from wa_catalogue_items where business_id=$1`,[f.biz]);
      const refused=await post(staff,`/app/products/${f.product}/whatsapp`,{description:'Not authorized'});
      expect(refused.statusCode).toBe(302);expect(await one(`select description from wa_catalogue_items where business_id=$1`,[f.biz])).toEqual(before);
      const preview=await post(owner,'/app/products/whatsapp/preview');expect(preview.statusCode).toBe(302);
      expect(preview.headers.location).toMatch(/^\/app\/products\/whatsapp\/review\//);
      const review=await app.inject({url:preview.headers.location!,headers:{cookie:owner}});
      expect(review.statusCode).toBe(200);expect(review.body).toContain('Apply the ticked changes');
      expect((await app.inject({url:'/catalogue-media/'+ 'x'.repeat(43)})).statusCode).toBe(404);
      const parent=await fixture();await admin.query(`update businesses set practice_of=$2 where id=$1`,[f.biz,parent.biz]);
      const practice=await post(owner,`/app/products/${f.product}/whatsapp`,{description:'Kept, not saved'});
      expect(practice.statusCode).toBe(400);expect(practice.body).toContain('Practice');
      expect(practice.body).not.toContain('class="wc-form"');expect(practice.body).not.toContain('action="/app/products/whatsapp/preview"');
    }finally{await app.close();}
  });
  it('the media capability is public: the same answer to anyone, no cookie, noindex, no-referrer; 404 for mutated, malformed, old photo/proof, unticked, unpublished, revoked, practice-copy and switched-off',async()=>{
    const s=await scenario(),other=await fixture(),secret='catalogue-media-session-secret-long';
    const app=Fastify({logger:false});
    registerWebApp(app,{db,businessId:s.biz,accessCode:'media-test-owner',sessionSecret:secret,provider:'disabled',secureCookie:false,
      catalogueNow:s.deps.now} as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    try{
      const get=(token:string,cookie='')=>app.inject({url:'/catalogue-media/'+token,headers:{cookie}});
      for(const token of ['bad','x'.repeat(43),(await one(`select token from product_images where id=$1`,[s.image])).token])
        expect((await get(token)).statusCode).toBe(404);
      // A well-formed proof capability belongs to a different surface too.
      const proofToken=Buffer.from(randomUUID()+randomUUID()).toString('base64url').slice(0,43);
      expect((await get(proofToken)).statusCode).toBe(404);
      await s.submit();await s.check();
      const grant=await one(`select token from wa_catalogue_images where business_id=$1`,[s.biz]);
      const valid=await get(grant.token);expect(valid.statusCode).toBe(200);expect(valid.headers['cache-control']).toBe('private, no-store');
      expect(valid.headers['set-cookie']).toBeUndefined();expect(valid.headers['x-robots-tag']).toContain('noindex');expect(valid.headers['referrer-policy']).toBe('no-referrer');
      expect(Buffer.from(grant.token,'base64url')).toHaveLength(32);
      const own='yf_session='+makeSessionCodec(secret).sign({businessId:s.biz,exp:Date.now()+60000});
      const foreign='yf_session='+makeSessionCodec(secret).sign({businessId:other.biz,exp:Date.now()+60000});
      for(const cookie of [own,foreign]){const answer=await get(grant.token,cookie);expect(answer.statusCode).toBe(valid.statusCode);expect(answer.rawPayload).toEqual(valid.rawPayload);expect(answer.headers['set-cookie']).toBeUndefined();}
      for(let i=0;i<grant.token.length;i++){
        const changed=grant.token.slice(0,i)+(grant.token[i]==='A'?'B':'A')+grant.token.slice(i+1);
        expect((await get(changed)).statusCode).toBe(404);
      }
      // A refusal is the same answer to anyone, with the same headers: no cookie, noindex, no-referrer.
      const refusal=async(token:string)=>{
        const blank=await get(token);expect(blank.statusCode).toBe(404);
        for(const cookie of ['',own,foreign]){
          const a=await get(token,cookie);expect(a.statusCode).toBe(404);expect(a.body).toBe(blank.body);
          expect(a.headers['set-cookie']).toBeUndefined();expect(a.headers['x-robots-tag']).toContain('noindex');
          expect(a.headers['referrer-policy']).toBe('no-referrer');expect(a.headers['cache-control']).toBe('private, no-store');
        }
      };
      await refusal('x'.repeat(43));await refusal('bad');
      // Unpublished: still 'submitted', its 15-minute lease run out.
      const kept=await one(`select state,pending_until,published_at from wa_catalogue_images where business_id=$1`,[s.biz]);
      await admin.query(`update wa_catalogue_images set state='submitted',published_at=null,pending_until='2000-01-01T00:00:00Z' where business_id=$1`,[s.biz]);
      await refusal(grant.token);
      await admin.query(`update wa_catalogue_images set state=$2,pending_until=$3,published_at=$4 where business_id=$1`,[s.biz,kept.state,kept.pending_until,kept.published_at]);
      expect((await get(grant.token)).statusCode).toBe(200);
      // A switched-off workspace and a practice copy publish nothing.
      await admin.query(`update businesses set is_active=false where id=$1`,[s.biz]);
      await refusal(grant.token);
      await admin.query(`update businesses set is_active=true where id=$1`,[s.biz]);
      await admin.query(`update businesses set practice_of=$2 where id=$1`,[s.biz,other.biz]);
      await refusal(grant.token);
      await admin.query(`update businesses set practice_of=null where id=$1`,[s.biz]);
      expect((await get(grant.token)).statusCode).toBe(200);
      await admin.query(`update wa_catalogue_batch_items set selected=false where id=$1`,[s.item.id]);
      await refusal(grant.token);
      await admin.query(`update wa_catalogue_batch_items set selected=true where id=$1`,[s.item.id]);
      await admin.query(`update wa_catalogue_images set state='revoked' where business_id=$1`,[s.biz]);
      await refusal(grant.token);
    }finally{await app.close();}
  });
});
