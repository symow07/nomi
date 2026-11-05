import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { createDb, withTenantTx, type Db, type Tx } from '../../src/db/client.js';
import { parseBusinessId } from '../../src/core/types/ids.js';
import { seedRunTenant } from './tenant.js';
import * as products from '../../src/api/web/products.js';
import { saveProductPhoto } from '../../src/db/productPhotos.js';

const d=process.env['DATABASE_URL']&&process.env['MIGRATE_DATABASE_URL']?describe:describe.skip;
const B=randomUUID(),foreign=randomUUID(),ids=Array.from({length:207},()=>randomUUID()).sort(),foreignProduct=randomUUID();
const FORM={'content-type':'application/x-www-form-urlencoded'};
d('Area 4 complete Products catalogue and command return context',()=>{
 let db:Db,app:ReturnType<typeof Fastify>,owner='',staff='',accountant='',photoToken='';let calls=0;
 const tx=<T>(fn:(t:Tx)=>Promise<T>,biz=B)=>{const b=parseBusinessId(biz);if(!b.ok)throw Error('fixture');return withTenantTx(db,b.value,fn);};
 const get=(url:string,cookie=owner)=>app.inject({method:'GET',url,headers:{cookie}});
 const post=(url:string,payload:string,cookie=owner)=>app.inject({method:'POST',url,payload,headers:{cookie,...FORM}});
 beforeAll(async()=>{
  await seedRunTenant();db=createDb(process.env['DATABASE_URL']!);
  await tx(async t=>{
   await sql`insert into businesses(id,name,owner_locale) values(${B}::uuid,'Products routes','en')`.execute(t);
   await sql`insert into products(id,business_id,sku,name,name_zh,unit,moq,price_usd_per_unit,currency,is_active,updated_at)
     select x::uuid,${B}::uuid,'SKU-'||n,'Catalogue '||lpad((case when n=2 then 1 else n end)::text,3,'0'),case when n=207 then '独特名称' else null end,'pcs',1,12,'USD',n<205,'2026-01-01T00:00:00Z'::timestamptz
     from unnest(${ids}::text[]) with ordinality as a(x,n)`.execute(t);
   await sql`insert into product_aliases(product_id,alias) values(${ids[206]}::uuid,'Special hidden alias'),(${ids[0]}::uuid,'First alias')`.execute(t);
   await sql`insert into product_images(product_id,url,is_primary) values(${ids[0]}::uuid,'https://example.invalid/remote.jpg',true)`.execute(t);
   const b=parseBusinessId(B);if(!b.ok)throw Error('fixture');const photo=await saveProductPhoto(t,b.value,ids[206]!,Buffer.from([0xff,0xd8,0xff,1]));
   if(photo.outcome!=='saved'||!photo.token)throw Error('photo fixture');photoToken=photo.token;
  });
  await tx(async t=>{await sql`insert into businesses(id,name) values(${foreign}::uuid,'Other products')`.execute(t);await sql`insert into products(id,business_id,sku,name) values(${foreignProduct}::uuid,${foreign}::uuid,'SKU-999','Foreign secret product')`.execute(t);},foreign);
  const {registerWebApp}=await import('../../src/api/web/app.js');app=Fastify({logger:false});
  const secret='area-four-local-session-secret-at-least-thirty-two';
  registerWebApp(app,{db,businessId:B,accessCode:'area4-owner',sessionSecret:secret,employeeName:'Lily',avatar:'L',provider:'disabled',secureCookie:false,messagingEnabled:false,factsTtlMs:0,kickOutbound:async()=>{calls++;},kickDrive:async()=>{calls++;}} as unknown as Parameters<typeof registerWebApp>[1]);await app.ready();
  const login=async(code:string)=>String((await post('/login','code='+encodeURIComponent(code),'')).headers['set-cookie']??'').split(';')[0]!;
  owner=await login('area4-owner');const {addPerson}=await import('../../src/api/web/people.js');
  const s=await addPerson(db,B,secret,'Products staff','team'),a=await addPerson(db,B,secret,'Products accountant','accountant');if(s.code!=='added'||a.code!=='added')throw Error('people fixture');staff=await login(s.accessCode);accountant=await login(a.accessCode);
 },60_000);
 afterAll(async()=>{await app?.close();await db?.destroy();});
 it('walks every product beyond the old 200 cap once in deterministic pages, including inactive',async()=>{
  const seen:string[]=[];for(let page=1;page<=5;page++){const r=await products.loadProductPage(db,B,{page});expect(r.total).toBe(207);expect(r.items.length).toBe(page===5?7:50);seen.push(...r.items.map(p=>p.id));expect(r.prev===null).toBe(page===1);expect(r.next===null).toBe(page===5);}
  expect(seen).toEqual(ids);expect(new Set(seen).size).toBe(207);expect((await products.loadProductList(db,B)).length).toBe(200);
  expect((await products.loadProductPage(db,B,{pageSize:500})).items.length).toBe(100);
  for(const page of [-2,NaN,Infinity,1.2])expect((await products.loadProductPage(db,B,{page})).page).toBe(1);
  expect((await products.loadProductPage(db,B,{page:Number.MAX_SAFE_INTEGER})).page).toBe(5);
  expect((await products.loadProductPage(db,B,{q:'SKU-207',page:5})).page).toBe(1);
 });
 it('searches the full tenant catalogue by name, translated name, SKU and alias; wildcards are literal',async()=>{
  for(const q of ['Catalogue 207','独特名称','SKU-207','special HIDDEN alias']){const r=await products.loadProductPage(db,B,{q});expect(r.total,q).toBe(1);expect(r.items[0]?.id).toBe(ids[206]);expect(r.items[0]?.isActive).toBe(false);}
  for(const q of ['Foreign secret','%','_'])expect((await products.loadProductPage(db,B,{q})).total).toBe(0);
  expect((await products.loadProductPage(db,'invalid')).items).toEqual([]);
 });
 it('uses only stored served photo tokens, never aliases or external image URLs as thumbnails',async()=>{
  const stored=await products.loadProductPage(db,B,{q:'SKU-207'});expect(stored.items[0]?.photoToken).toBe(photoToken);
  const remote=await products.loadProductPage(db,B,{q:'SKU-1'});expect(remote.items.find(p=>p.id===ids[0])?.photoToken).toBeNull();
  expect(calls).toBe(0);
 });
 it('renders filtered catalogue pages and retains staff reads, owner-only limits, and tenant isolation',async()=>{
  const r=await get('/app/products?q=SKU-207');expect(r.statusCode).toBe(200);expect(r.body).toContain('Catalogue 207');expect(r.body).not.toContain('Catalogue 001');expect(r.body).toContain('/media/'+photoToken);
  const page=await get('/app/products?page=5');expect(page.body).toContain('Catalogue 207');expect(page.body).not.toContain('Catalogue 001');
  expect((await get('/app/products',staff)).statusCode).toBe(200);expect((await get('/app/products/'+ids[0],staff)).statusCode).toBe(200);
  expect((await get('/app/products/'+foreignProduct)).statusCode).toBe(404);
  const limits=await get('/app/products/price-limits');expect(limits.statusCode).toBe(200);expect(limits.body).toMatch(/href="\/app\/products"[^>]*aria-current="page"/);
  expect((await get('/app/products/price-limits',staff)).body).not.toContain('name="floor"');
  expect((await get('/app/products',accountant)).statusCode).toBe(302);expect((await get('/app/products/price-limits',accountant)).body).not.toContain('name="floor"');
  expect((await get('/app/business/prices?product='+ids[0])).headers['location']).toBe('/app/products/price-limits?product='+ids[0]);expect(calls).toBe(0);
 });
 it('preserves safe list filters/page/row through edit, rejected edits, name removal and photo removal',async()=>{
  const from='/app/products?q=Catalogue&page=5#p-'+ids[206],base='/app/products/'+ids[206],encoded=encodeURIComponent(from);
  const detail=await get(base+'?from='+encoded);expect(detail.body.replaceAll('&amp;','&')).toContain('value="'+from+'"');
  for(const [path,payload,hash] of [['/edit','name=Catalogue+207',''],['/names/remove','alias=missing','#names'],['/photo/remove','','#photo']]){
   const r=await post(base+path,payload+'&from='+encoded);expect(r.statusCode).toBe(302);const u=new URL(String(r.headers['location']),'http://local');expect(u.pathname).toBe(base);expect(u.searchParams.get('from')).toBe(from);expect(u.hash).toBe(hash);
  }
  const invalid=await post(base+'/edit','price=not-money&from='+encoded);expect(invalid.statusCode).toBe(400);expect(invalid.body.replaceAll('&amp;','&')).toContain('value="'+from+'"');
  const external=await post(base+'/names/remove','alias=missing&from=https%3A%2F%2Fevil.example');expect(String(external.headers['location'])).not.toContain('evil');expect(new URL(String(external.headers['location']),'http://local').searchParams.get('from')).toBe('/app/products');
  expect((await post(base+'/names/remove','alias=missing')).headers['location']).toBe(base+'#names');
 });
 it('keeps multipart return context through a saved or rejected photo without changing staff permission',async()=>{
  const from='/app/products?q=Catalogue&page=5#p-'+ids[206],base='/app/products/'+ids[206];
  const upload=(bytes:Buffer,cookie=owner)=>app.inject({method:'POST',url:base+'/photo',headers:{cookie,'content-type':'multipart/form-data; boundary=area4photo'},payload:Buffer.concat([
   Buffer.from('--area4photo\r\nContent-Disposition: form-data; name="from"\r\n\r\n'+from+'\r\n--area4photo\r\nContent-Disposition: form-data; name="photo"; filename="product.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'),bytes,Buffer.from('\r\n--area4photo--\r\n')])});
  for(const bytes of [Buffer.from([0xff,0xd8,0xff,1]),Buffer.from('not a photo'),Buffer.alloc(9*1024*1024)]){
   const r=await upload(bytes);expect(r.statusCode).toBe(302);const u=new URL(String(r.headers['location']),'http://local');expect(u.searchParams.get('from')).toBe(from);expect(u.hash).toBe('#photo');
  }
  const before=await products.loadProductDetail(db,B,ids[206]!);await upload(Buffer.from([0xff,0xd8,0xff,2]),staff);
  expect((await products.loadProductDetail(db,B,ids[206]!))?.photo).toEqual(before?.photo);
 });
 it('retains an unchecked offering on validation failure and does not mutate a rejected edit',async()=>{
  const base='/app/products/'+ids[0],before=await products.loadProductDetail(db,B,ids[0]!);
  expect(before?.isActive).toBe(true);
  const r=await post(base+'/edit','price=not-money&name=Typed+product&from='+encodeURIComponent('/app/products?page=2'));
  expect(r.statusCode).toBe(400);expect(r.body).toContain('value="Typed product"');expect(r.body).not.toMatch(/name="isActive"[^>]*checked/);
  expect((await products.loadProductDetail(db,B,ids[0]!))?.isActive).toBe(true);
  const refused=await post(base+'/edit','name=Forbidden&isActive=on',staff);expect(refused.statusCode).toBe(302);
  expect((await products.loadProductDetail(db,B,ids[0]!))?.name).toBe(before?.name);
 });
 it('price-limit commands retain old POST contracts and return to their canonical section',async()=>{
  const productId=ids[0]!;
  const r=await post('/app/business/prices','productId='+productId+'&floor=5&maxDiscountPct=10&askAbovePct=5');
  expect(r.statusCode).toBe(302);expect(r.headers['location']).toBe('/app/products/price-limits?product='+productId+'#p-'+productId);
  const invalid=await post('/app/business/prices','productId='+productId+'&floor=invalid&maxDiscountPct=10&askAbovePct=5');
  expect(invalid.statusCode).toBe(400);expect(invalid.body).toContain('value="invalid"');expect(invalid.body).toMatch(/href="\/app\/products"[^>]*aria-current="page"/);
  const volume=await post('/app/business/prices/volume','productId='+productId+'&minQty=20&discountPct=2');expect(volume.statusCode).toBe(302);expect(volume.headers['location']).toBe('/app/products/price-limits?product='+productId+'#volume');
 });

});
