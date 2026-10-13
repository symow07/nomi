import { sql } from 'kysely';
import type { Db, Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { mintToken } from './proofs.js';

/**
 * Phase 2d (0152) — a product's photo, kept in Postgres and served by Nomi, so it can be sent in a chat.
 *
 * ONE PHOTO NOMI SERVES PER PRODUCT, on its `product_images` row: the bytes, what they are, and an unguessable token
 * whose public address (`/media/<token>`) Meta's and WhatsApp's servers fetch to deliver a sent photo. Replacing it
 * gives it a new address, and the old one answers 404 at once (the row is updated in place); a photo already
 * delivered stays with the customer, as the provider fetched it when it was sent.
 *
 * The bytes say what they are (`photoType`, their own first bytes), never the browser's label; at most 5 MB, what
 * WhatsApp takes (Instagram takes 8).
 */

export const PRODUCT_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** The channels whose adapter carries a picture (`sendMedia`): WhatsApp, Instagram, Messenger. Not e-mail. */
export const PHOTO_CHANNELS: readonly string[] = ['whatsapp', 'instagram', 'messenger'];
export type ProductPhotoType = 'image/jpeg' | 'image/png' | 'image/webp';

/** What the bytes are, read from their own start: JPEG, PNG or WebP, else null. */
export function productPhotoType(b: Uint8Array): ProductPhotoType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
    && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length >= 12 && String.fromCharCode(...b.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

/** The photo's address on this installation, from the root: what the product page draws. */
export const productPhotoPath = (token: string): string => `/media/${token}`;

/** The address a provider fetches: the installation's public one, or null when none is set (never a guess). */
export function productPhotoUrl(publicBaseUrl: string | null | undefined, token: string): string | null {
  if (!publicBaseUrl) return null;
  return `${publicBaseUrl.replace(/\/+$/, '')}${productPhotoPath(token)}`;
}

export type SaveOutcome = 'saved' | 'not_found' | 'not_a_photo' | 'too_large' | 'empty';

/** Keep (or replace) the product's photo. The product must be one of this business's. */
export async function saveProductPhoto(tx: Tx, businessId: BusinessId, productId: string, bytes: Uint8Array): Promise<{ outcome: SaveOutcome; token?: string }> {
  if (bytes.length === 0) return { outcome: 'empty' };
  if (bytes.length > PRODUCT_PHOTO_MAX_BYTES) return { outcome: 'too_large' };
  const type = productPhotoType(bytes);
  if (!type) return { outcome: 'not_a_photo' };
  const owned = (await sql<{ id: string }>`
    select id from products where id = ${productId}::uuid and business_id = ${businessId}::uuid`.execute(tx)).rows[0];
  if (!owned) return { outcome: 'not_found' };
  const token = mintToken();
  const buf = Buffer.from(bytes);
  // A replacement keeps its place; a first photo is the product's primary one only when it has none — a product may
  // carry one primary image (`idx_product_images_one_primary`), and an older one keeps it.
  const replaced = await sql<{ id: string }>`
    update product_images set token = ${token}, media_type = ${type}, bytes = ${buf}, url = ${productPhotoPath(token)}
     where product_id = ${productId}::uuid and token is not null
    returning id::text as id`.execute(tx);
  if (replaced.rows.length === 0) {
    await sql`
      insert into product_images (product_id, url, is_primary, sort_order, token, media_type, bytes)
      select ${productId}::uuid, ${productPhotoPath(token)},
             not exists (select 1 from product_images where product_id = ${productId}::uuid and is_primary), 0, ${token}, ${type}, ${buf}`.execute(tx);
  }
  return { outcome: 'saved', token };
}

/** Remove the photo Nomi serves for this product (one of the business in force). False: there was none. */
export async function removeProductPhoto(tx: Tx, productId: string): Promise<boolean> {
  return (await sql<{ removed: boolean }>`select product_photo_remove(${productId}::uuid) as removed`.execute(tx)).rows[0]?.removed === true;
}

/** The token of the photo Nomi serves for this product, or null. */
export async function productPhotoToken(tx: Tx, productId: string): Promise<string | null> {
  return (await sql<{ token: string }>`
    select token from product_images where product_id = ${productId}::uuid and token is not null limit 1`.execute(tx)).rows[0]?.token ?? null;
}

/** Every product of the workspace with a photo Nomi serves, active ones only, by name: what can be sent. */
export async function productsWithPhotos(tx: Tx): Promise<readonly { readonly productId: string; readonly name: string; readonly nameZh: string | null; readonly token: string }[]> {
  return (await sql<{ product_id: string; name: string; name_zh: string | null; token: string }>`
    select p.id::text as product_id, p.name, p.name_zh, i.token
      from product_images i join products p on p.id = i.product_id
     where i.token is not null and p.is_active
     order by p.name limit 200`.execute(tx)).rows
    .map((r) => ({ productId: r.product_id, name: r.name, nameZh: r.name_zh, token: r.token }));
}

/** Public: the photo's bytes by its token, through the one definer function, or null for every failure alike. */
export async function servedProductPhoto(db: Db, token: string): Promise<{ mediaType: string; bytes: Buffer } | null> {
  if (token.length < 32) return null;
  const r = (await sql<{ media_type: string; bytes: Buffer }>`select media_type, bytes from product_photo(${token})`.execute(db)).rows[0];
  return r ? { mediaType: r.media_type, bytes: r.bytes } : null;
}
