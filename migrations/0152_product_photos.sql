-- ---------------------------------------------------------------------------
-- 0152 — Phase 2d (the owner's roadmap and word, 2026-10-13): A PRODUCT'S PHOTO,
-- KEPT AND SERVED BY NOMI, SO IT CAN BE SENT IN A CHAT.
--
-- 0024 let an outbound row carry a picture (`media_url`), pointing at
-- `product_images.url`; the worker sends one only when Nomi itself serves it
-- (F1, `servedByNomi`). Nothing wrote a photo Nomi serves, so nothing could be
-- sent. From here the owner uploads a product's photo on its page; it is kept
-- here, in Postgres, like the price-list photos (0094) — the owner's choice:
-- no new keys, no new processor, and the backups already carry it.
--
-- ONE PHOTO NOMI SERVES PER PRODUCT, on the row 0005 already has for it:
--   token       32 random bytes (base64url); the photo's public address is
--               /media/<token>, unguessable, as the price and proforma links are.
--   media_type  what the bytes are (JPEG, PNG or WebP, checked on their own
--               first bytes, never on the browser's label).
--   bytes       the photo, at most 5 MB (what WhatsApp takes; Instagram 8).
--   url         '/media/' || token for such a row: drawn by the product page as it
--               draws every row (root-relative, so `mayLoad` lets it), and made
--               absolute on the installation's public address to be sent.
-- Rows written before (a URL and nothing else) are left as they are.
--
-- The app role may not delete (archive-never-erase, 0005); a photo the owner
-- removes goes through `product_photo_remove`, which deletes only the photo
-- Nomi serves, and only for a product of the business in force.
-- ---------------------------------------------------------------------------

alter table product_images
  add column if not exists token text check (token is null or length(token) >= 32),
  add column if not exists media_type text check (media_type is null or media_type in ('image/jpeg', 'image/png', 'image/webp')),
  add column if not exists bytes bytea check (bytes is null or octet_length(bytes) between 1 and 5242880);

alter table product_images drop constraint if exists product_images_served;
alter table product_images add constraint product_images_served check (
  (token is null and media_type is null and bytes is null)
  or (token is not null and media_type is not null and bytes is not null and url = '/media/' || token));

create unique index if not exists product_images_token on product_images (token) where token is not null;
create unique index if not exists product_images_one_served on product_images (product_id) where token is not null;

-- Public: no session. The token to the photo's bytes, and nothing else — not the
-- product, not the business. Meta's servers fetch it to deliver a sent photo.
create or replace function product_photo(p_token text)
returns table (media_type text, bytes bytea)
language sql stable security definer set search_path = public as $$
  select i.media_type, i.bytes from product_images i
   where i.token = p_token and p_token is not null and length(p_token) >= 32
   limit 1
$$;
revoke all on function product_photo(text) from public;
grant execute on function product_photo(text) to nomi_app;

-- The owner removes the photo Nomi serves for one of the business's products.
create or replace function product_photo_remove(p_product uuid)
returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare v_n int;
begin
  delete from product_images i
   using products p
   where i.product_id = p_product and i.token is not null
     and p.id = i.product_id and p.business_id = current_business_id();
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function product_photo_remove(uuid) from public;
grant execute on function product_photo_remove(uuid) to nomi_app;

insert into _migrations (version, name) values (152, 'product_photos')
  on conflict (version) do nothing;
