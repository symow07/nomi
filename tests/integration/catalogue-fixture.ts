import { randomInt, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../src/db/client.js';
import type { BusinessId } from '../../src/core/types/ids.js';
import { liveWhatsAppAccount } from '../../src/db/whatsappAccounts.js';
import { saveProductPhoto } from '../../src/db/productPhotos.js';
import { saveCatalogueProduct, previewCatalogue, submitCatalogue, checkCatalogue } from '../../src/db/waCatalogue.js';
import type { CatalogueClient } from '../../src/net/waCatalogue.js';

/** Its own valid public capability, minted through the real selection workflow with no network. */
export async function seedCatalogueForWalk(db:Db,business:BusinessId):Promise<{batchId:string;token:string}> {
  await withTenantTx(db,business,async tx=>{
    if(!await liveWhatsAppAccount(tx,business)) await sql`insert into whatsapp_accounts
      (business_id,waba_id,phone_number_id,token_ciphertext,fingerprint,connected_by)
      values(${business}::uuid,'12345',${String(randomInt(100000,999999999))},'v1.fixture','012345abcdef','test')`.execute(tx);
    const p=(await sql<{id:string}>`insert into products(business_id,sku,name,unit,price_usd_per_unit,currency,is_active,quote_vetted_at)
      select id,${randomUUID()},'Linen shirt','item',12,currency,true,now() from businesses where id=${business}::uuid returning id`.execute(tx)).rows[0]!;
    await sql`insert into product_aliases(product_id,alias) values(${p.id}::uuid,'Linen shirt')`.execute(tx);
    await saveProductPhoto(tx,business,p.id,Buffer.from('89504e470d0a1a0a','hex'));
    const image=(await sql<{id:string}>`select id from product_images where product_id=${p.id}::uuid and token is not null`.execute(tx)).rows[0]!;
    await saveCatalogueProduct(tx,business,p.id,{description:'A linen shirt',link:'https://shop.example/shirt',availability:'in stock',brand:'Shop',condition:'new',imageId:image.id});
  });
  const client:CatalogueClient={linked:async()=>({ok:true,catalogId:'12345'}),
    submit:async()=>({ok:true,handle:'test-walk',invalid:{},warnings:{}}),status:async()=>({ok:true,finished:true,invalid:{},warnings:{}})};
  const deps={db,client,now:()=>new Date(),publicBaseUrl:'https://nomi.example'};
  const preview=await previewCatalogue(deps,business,'test');if(!preview.ok)throw Error(preview.reason);
  const ids=await withTenantTx(db,business,async tx=>(await sql<{id:string}>`select id from wa_catalogue_batch_items where batch_id=${preview.batchId}::uuid`.execute(tx)).rows.map(r=>r.id));
  const submitted=await submitCatalogue(deps,business,preview.batchId,ids);if(!submitted.ok)throw Error(submitted.reason);
  const checked=await checkCatalogue(deps,business,preview.batchId);if(!checked.ok)throw Error(checked.reason);
  const token=await withTenantTx(db,business,async tx=>(await sql<{token:string}>`select token from wa_catalogue_images where business_id=${business}::uuid and state='published' limit 1`.execute(tx)).rows[0]!.token);
  return {batchId:preview.batchId,token};
}
