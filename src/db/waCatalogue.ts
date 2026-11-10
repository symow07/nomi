import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { withTenantTx, type Db, type Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { catalogueEligibility, catalogueRequest, type CatalogueProduct, type CatalogueMethod, type CatalogueRequest } from '../core/catalogue/whatsapp.js';
import type { CatalogueClient } from '../net/waCatalogue.js';
import { liveWhatsAppAccount } from './whatsappAccounts.js';
import { mintToken } from './proofs.js';

export type CatalogueDeps = { db: Db; client: CatalogueClient; now: () => Date; publicBaseUrl: string; accountId?: string };
export type CatalogueConfig = { description: string; link: string; availability: string; brand: string; condition: string; imageId: string | null };
export type CatalogueRow = CatalogueProduct & {
  itemId: string | null; retailerId: string | null; state: string; error: string | null;
  acceptedFingerprint: string | null; acceptedCatalog: string | null; acceptedAccount: string | null;
  photoId: string | null; photoToken: string | null; fingerprint: string; reasons: string[];
};
type Refusal = { ok: false; reason: string };
type Outcome = { ok: true; state: string } | Refusal;
type Preview = { ok: true; batchId: string } | Refusal;
type Batch = { id: string; account_id: string; catalog_id: string; state: string; handle: string | null; error: string | null };
export type CatalogueReviewItem = { id: string; item_id: string; operation: CatalogueMethod; fingerprint: string; snapshot: CatalogueRow; selected: boolean; result: string; error: string | null; warning: string | null };
export type CatalogueReview = Batch & { items: CatalogueReviewItem[] };
export const CATALOGUE_IMAGE_LEASE_MS = 15 * 60 * 1000;
const fingerprint = (p: CatalogueProduct): string => createHash('sha256').update(JSON.stringify(p)).digest('hex');
const json = (v: unknown) => JSON.stringify(v);
const refusal = (reason: string): Refusal => ({ ok: false, reason });

/** The same current product facts govern preview, confirmation, status and public image serving. */
export async function catalogueProducts(tx: Tx, business: BusinessId): Promise<CatalogueRow[]> {
  type Row = CatalogueProduct & Omit<CatalogueRow, keyof CatalogueProduct | 'fingerprint' | 'reasons'>;
  const rows = (await sql<Row>`
    select p.id, p.name, p.is_active as active,
      exists(select 1 from product_aliases a where a.product_id=p.id) as findable,
      p.price_usd_per_unit::text as amount, p.currency, b.currency as "workspaceCurrency",
      exists(select 1 from price_tiers t where t.product_id=p.id) as tiered,
      quote_vetted(p.id) as vetted, (p.quote_vetted_at is not null) as "explicitlyVetted",
      b.prices_to_owner as "pricesToOwner", (b.practice_of is not null) as practice,
      coalesce(c.description,'') as description, coalesce(c.product_url,'') as link,
      coalesce(c.availability,'') as availability, coalesce(c.brand,b.name) as brand,
      coalesce(c.condition,'new') as condition,
      case when i.bytes is not null then i.id else null end as "imageId",
      case when i.bytes is not null then i.token else null end as "imageVersion",
      c.id as "itemId", c.retailer_id as "retailerId", coalesce(c.state,'not_submitted') as state, c.error,
      c.accepted_fingerprint as "acceptedFingerprint", c.catalog_id as "acceptedCatalog", c.account_id as "acceptedAccount",
      photo.id as "photoId", photo.token as "photoToken"
    from products p join businesses b on b.id=p.business_id
    left join wa_catalogue_items c on c.business_id=p.business_id and c.product_id=p.id
    left join product_images i on i.id=c.image_id and i.product_id=p.id
    left join product_images photo on photo.product_id=p.id and photo.token is not null
    where p.business_id=${business}::uuid order by p.name,p.id`.execute(tx)).rows;
  return rows.map(row => {
    const p: CatalogueProduct = { id: row.id, name: row.name, active: row.active, findable: row.findable,
      amount: row.amount, currency: row.currency, workspaceCurrency: row.workspaceCurrency, tiered: row.tiered,
      vetted: row.vetted, explicitlyVetted: row.explicitlyVetted, pricesToOwner: row.pricesToOwner, practice: row.practice,
      description: row.description, link: row.link, availability: row.availability, brand: row.brand, condition: row.condition,
      imageId: row.imageId, imageVersion: row.imageVersion };
    return { ...row, fingerprint: fingerprint(p), reasons: catalogueEligibility(p) };
  });
}

/** Configuration alone never vets, publishes or contacts the provider. */
export async function saveCatalogueProduct(tx: Tx, business: BusinessId, product: string, c: CatalogueConfig): Promise<boolean> {
  if (c.description.length > 5000 || c.link.length > 2000 || c.brand.length > 100 || c.availability.length > 40 || c.condition.length > 40) return false;
  const owned = (await sql`select p.id from products p join businesses b on b.id=p.business_id
    where p.id=${product}::uuid and p.business_id=${business}::uuid and b.practice_of is null
      and (${c.imageId}::uuid is null or exists(select 1 from product_images i where i.id=${c.imageId}::uuid and i.product_id=p.id and i.bytes is not null))`.execute(tx)).rows.length;
  if (!owned) return false;
  await sql`insert into wa_catalogue_items(business_id,product_id,description,product_url,availability,brand,condition,image_id)
    values(${business}::uuid,${product}::uuid,${c.description},${c.link},${c.availability},${c.brand},${c.condition},${c.imageId}::uuid)
    on conflict(business_id,product_id) do update set description=excluded.description,product_url=excluded.product_url,
      availability=excluded.availability,brand=excluded.brand,condition=excluded.condition,image_id=excluded.image_id,updated_at=now()`.execute(tx);
  return true;
}

async function connected(deps: CatalogueDeps, business: BusinessId) {
  return withTenantTx(deps.db,business,async tx => {
    const eligible = (await sql`select id from businesses where id=${business}::uuid and practice_of is null and is_active`.execute(tx)).rows.length;
    if (!eligible) return null;
    const account = await liveWhatsAppAccount(tx,business);
    return account && !account.needsAttention && (!deps.accountId || deps.accountId === account.id) ? account : null;
  });
}
export async function previewCatalogue(deps: CatalogueDeps, business: BusinessId, actor: string): Promise<Preview> {
  const account = await connected(deps,business); if (!account) return refusal('connection');
  const linked = await deps.client.linked(account.wabaId);
  if (!linked.ok) return refusal(linked.reason);
  if (!linked.catalogId) return refusal('no_catalogue');
  return withTenantTx(deps.db,business,async tx => {
    if ((await liveWhatsAppAccount(tx,business))?.id !== account.id) return refusal('changed');
    const products = await catalogueProducts(tx,business);
    if (products.some(p => p.acceptedFingerprint && (p.acceptedCatalog !== linked.catalogId || p.acceptedAccount !== account.id))) return refusal('changed_catalogue');
    const batch = (await sql<{id:string}>`insert into wa_catalogue_batches(business_id,account_id,catalog_id,created_by,created_at)
      values(${business}::uuid,${account.id}::uuid,${linked.catalogId},${actor},${deps.now()}) returning id`.execute(tx)).rows[0]!;
    for (const p of products) {
      if (!p.itemId || ['pending','unknown'].includes(p.state)) continue;
      const operation: CatalogueMethod | null = p.acceptedFingerprint
        ? p.reasons.length ? 'DELETE' : p.fingerprint !== p.acceptedFingerprint || p.state !== 'synced' ? 'UPDATE' : null
        : p.reasons.length ? null : 'CREATE';
      if (!operation) continue;
      await sql`insert into wa_catalogue_batch_items(business_id,batch_id,item_id,operation,fingerprint,snapshot)
        values(${business}::uuid,${batch.id}::uuid,${p.itemId}::uuid,${operation},${p.fingerprint},${json(p)}::jsonb)`.execute(tx);
    }
    return { ok:true, batchId:batch.id };
  });
}
export async function catalogueReview(tx: Tx, business: BusinessId, id: string): Promise<CatalogueReview | null> {
  const batch=(await sql<Batch>`select id,account_id,catalog_id,state,handle,error from wa_catalogue_batches
    where id=${id}::uuid and business_id=${business}::uuid`.execute(tx)).rows[0];
  if (!batch) return null;
  const items=(await sql<CatalogueReviewItem>`select id,item_id,operation,fingerprint,snapshot,selected,result,error,warning
    from wa_catalogue_batch_items where business_id=${business}::uuid and batch_id=${id}::uuid order by id`.execute(tx)).rows;
  return {...batch,items};
}
export async function submitCatalogue(deps: CatalogueDeps, business: BusinessId, batchId: string, selected: string[]): Promise<Outcome> {
  if (selected.length > 3000) return refusal('too_large');
  if (new Set(selected).size !== selected.length) return refusal('changed');
  const account=await connected(deps,business); if (!account) return refusal('connection');
  // An empty confirmation needs no provider read or write.
  const linked=selected.length ? await deps.client.linked(account.wabaId) : null;
  if (linked && !linked.ok) return refusal(linked.reason);
  const prepared=await withTenantTx(deps.db,business,async tx => {
    await sql`select id from wa_catalogue_batches where id=${batchId}::uuid and business_id=${business}::uuid for update`.execute(tx);
    const batch=await catalogueReview(tx,business,batchId);
    if (!batch || batch.state !== 'preview') return refusal('changed');
    if (batch.account_id !== account.id || (linked?.ok && linked.catalogId !== batch.catalog_id)
      || (await liveWhatsAppAccount(tx,business))?.id !== account.id) return refusal('changed');
    if (selected.some(id => !batch.items.some(i => i.id === id))) return refusal('changed');
    if (selected.length === 0) {
      await sql`update wa_catalogue_batches set state='empty' where id=${batchId}::uuid`.execute(tx);
      return {ok:true as const, state:'empty', requests:[] as CatalogueRequest[], catalog:batch.catalog_id};
    }
    // Serialize selection across previews too. No item can be in two submitted batches.
    await sql`select id from wa_catalogue_items where id in (
      select item_id from wa_catalogue_batch_items where batch_id=${batchId}::uuid and id=any(${selected}::uuid[]))
      order by id for update`.execute(tx);
    const current=await catalogueProducts(tx,business);
    const chosen=batch.items.filter(i=>selected.includes(i.id));
    for (const row of chosen) {
      const p=current.find(p=>p.itemId===row.item_id);
      if (!p || p.fingerprint!==row.fingerprint || ['pending','unknown'].includes(p.state)
        || (row.operation==='DELETE' ? !p.acceptedFingerprint || !p.reasons.length : p.reasons.length>0)
        || (p.acceptedFingerprint && (p.acceptedCatalog!==batch.catalog_id || p.acceptedAccount!==account.id))) return refusal('changed');
    }
    let origin: URL;
    try { origin=new URL(deps.publicBaseUrl); if(origin.protocol!=='https:' || origin.username || origin.password) return refusal('image_address'); }
    catch { return refusal('image_address'); }
    const requests: CatalogueRequest[]=[];
    for (const row of chosen) {
      const p=current.find(p=>p.itemId===row.item_id)!;
      let address='';
      if (row.operation!=='DELETE') {
        const token=mintToken();
        await sql`insert into wa_catalogue_images(business_id,item_id,batch_item_id,image_id,image_version,token,state,pending_until)
          values(${business}::uuid,${row.item_id}::uuid,${row.id}::uuid,${p.imageId}::uuid,${p.imageVersion},${token},'submitted',
          ${new Date(deps.now().getTime()+CATALOGUE_IMAGE_LEASE_MS)})`.execute(tx);
        address=new URL('/catalogue-media/'+token,origin).toString();
      }
      const request=catalogueRequest(row.operation,p.retailerId!,p,address)!;
      requests.push(request);
      await sql`update wa_catalogue_batch_items set selected=true,result='pending' where id=${row.id}::uuid`.execute(tx);
      await sql`update wa_catalogue_items set state='pending',error=null where id=${p.itemId}::uuid`.execute(tx);
    }
    await sql`update wa_catalogue_batches set state='submitting',submitted_at=${deps.now()} where id=${batchId}::uuid`.execute(tx);
    return {ok:true as const,state:'submitting',requests,catalog:batch.catalog_id};
  });
  if (!prepared.ok) return prepared;
  if (prepared.state==='empty') return {ok:true,state:'empty'};
  // The committed one-shot claim precedes the external write. An uncertain call is never automatically retried.
  const receipt=await deps.client.submit(prepared.catalog,prepared.requests);
  return withTenantTx(deps.db,business,async tx => {
    const state=receipt.ok?'pending':receipt.reason==='unknown'?'unknown':'failed';
    await sql`update wa_catalogue_batches set state=${state},handle=${receipt.ok?receipt.handle:null},error=${receipt.ok?null:receipt.reason}
      where id=${batchId}::uuid and state='submitting'`.execute(tx);
    const review=await catalogueReview(tx,business,batchId);
    for (const row of review!.items.filter(i=>i.selected)) {
      const key=row.snapshot.retailerId!;
      const error=receipt.ok?receipt.invalid[key]??null:receipt.invalid?.[key]??receipt.reason;
      const result=error?(state==='unknown'?'unknown':'failed'):'pending';
      await sql`update wa_catalogue_batch_items set result=${result},error=${error},warning=${receipt.warnings?.[key]??null} where id=${row.id}::uuid`.execute(tx);
      if(error) {
        await sql`update wa_catalogue_items set state=${result==='unknown'?'unknown':'error'},error=${error} where id=${row.item_id}::uuid`.execute(tx);
        await sql`update wa_catalogue_images set state='revoked' where batch_item_id=${row.id}::uuid`.execute(tx);
      }
    }
    return {ok:true,state};
  });
}
export async function checkCatalogue(deps: CatalogueDeps, business: BusinessId, batchId: string): Promise<Outcome> {
  const account=await connected(deps,business); if(!account) return refusal('connection');
  const batch=await withTenantTx(deps.db,business,tx=>catalogueReview(tx,business,batchId));
  if(!batch || batch.account_id!==account.id || !batch.handle || !['pending','unknown'].includes(batch.state)) return refusal('changed');
  const linked=await deps.client.linked(account.wabaId);
  if(!linked.ok || linked.catalogId!==batch.catalog_id) return refusal('changed');
  const status=await deps.client.status(batch.catalog_id,batch.handle,batch.items.filter(i=>i.selected).map(i=>i.snapshot.retailerId!));
  if(!status.ok) return refusal(status.reason);
  if(!status.finished) return {ok:true,state:'pending'};
  return withTenantTx(deps.db,business,async tx=>{
    await sql`select id from wa_catalogue_batches where id=${batchId}::uuid for update`.execute(tx);
    const fresh=await catalogueReview(tx,business,batchId);
    if(!fresh || !['pending','unknown'].includes(fresh.state)) return refusal('changed');
    const current=await catalogueProducts(tx,business);
    for(const row of fresh.items.filter(i=>i.selected && i.result==='pending')) {
      const p=current.find(p=>p.itemId===row.item_id);
      const grant=(await sql<{id:string;state:string;pending_until:Date}>`select id,state,pending_until from wa_catalogue_images
        where batch_item_id=${row.id}::uuid`.execute(tx)).rows[0];
      const remoteError=status.invalid[row.snapshot.retailerId!]??null;
      const error=remoteError??
        (!p || p.fingerprint!==row.fingerprint?'changed':null)??
        (row.operation!=='DELETE' && (!grant || grant.state!=='submitted' || grant.pending_until<=deps.now())?'image_expired':null);
      // Keep what the provider accepted even when it is no longer safe to publish locally.
      // The next review must be able to remove that remote item, or replace its expired image.
      if(!remoteError) await sql`update wa_catalogue_items set
        accepted_fingerprint=${row.operation==='DELETE'?null:row.fingerprint},
        accepted_snapshot=${row.operation==='DELETE'?null:json(row.snapshot)}::jsonb,
        account_id=${batch.account_id}::uuid,catalog_id=${batch.catalog_id} where id=${row.item_id}::uuid`.execute(tx);
      if(error) {
        await sql`update wa_catalogue_items set state='error',error=${error} where id=${row.item_id}::uuid`.execute(tx);
        await sql`update wa_catalogue_images set state='revoked' where batch_item_id=${row.id}::uuid`.execute(tx);
      } else {
        await sql`update wa_catalogue_items set state=${row.operation==='DELETE'?'removed':'synced'},error=null,
          accepted_fingerprint=${row.operation==='DELETE'?null:row.fingerprint},
          accepted_snapshot=${row.operation==='DELETE'?null:json(row.snapshot)}::jsonb,
          account_id=${batch.account_id}::uuid,catalog_id=${batch.catalog_id} where id=${row.item_id}::uuid`.execute(tx);
        await sql`update wa_catalogue_images set state='revoked' where item_id=${row.item_id}::uuid
          and batch_item_id<>${row.id}::uuid`.execute(tx);
        if(row.operation!=='DELETE') await sql`update wa_catalogue_images set state='published',published_at=${deps.now()}
          where batch_item_id=${row.id}::uuid`.execute(tx);
      }
      await sql`update wa_catalogue_batch_items set result=${error?'failed':'synced'},error=${error},
        warning=coalesce(${status.warnings[row.snapshot.retailerId!]??null},warning) where id=${row.id}::uuid`.execute(tx);
    }
    await sql`update wa_catalogue_batches set state='finished',checked_at=${deps.now()} where id=${batchId}::uuid`.execute(tx);
    return {ok:true,state:'finished'};
  });
}
export async function catalogueImage(db: Db, token: string, now: Date): Promise<{mediaType:string;bytes:Buffer}|null> {
  if(!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const business=(await sql<{business:BusinessId|null}>`select wa_catalogue_image_business(${token},${now}) as business`.execute(db)).rows[0]?.business;
  if(!business) return null;
  return withTenantTx(db,business,async tx=>{
    const grant=(await sql<{item_id:string;fingerprint:string;media_type:string;bytes:Buffer}>`
      select g.item_id,bi.fingerprint,i.media_type,i.bytes from wa_catalogue_images g
      join wa_catalogue_batch_items bi on bi.id=g.batch_item_id and bi.selected
      join product_images i on i.id=g.image_id and i.token=g.image_version
      where g.token=${token} and (g.state='published' or (g.state='submitted' and g.pending_until>${now}))`.execute(tx)).rows[0];
    if(!grant) return null;
    const p=(await catalogueProducts(tx,business)).find(p=>p.itemId===grant.item_id);
    return p && !p.reasons.length && p.fingerprint===grant.fingerprint ? {mediaType:grant.media_type,bytes:grant.bytes} : null;
  });
}
