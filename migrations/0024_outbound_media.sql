-- ---------------------------------------------------------------------------
-- 0024 — an outbound row can carry a picture.
--
-- WHY. She can already READ a buyer's photo and match it to a product (M4
-- vision + trigram catalogue match). She cannot send one back. For a Yiwu
-- supplier — whose whole trade is "is this the one?" — that is half a
-- salesperson, and every workaround (pasting a URL into the text) puts an
-- unsourced link in front of a buyer through a path the guards do not inspect.
--
-- WHAT THIS ADDS. One nullable column. `kind` already exists and is deliberately
-- unconstrained text (0010 comments it as 'text' | 'quote_card' but enforces
-- nothing), so 'image' needs no constraint change — and adding a CHECK now
-- would be a new restriction on a column that has none, which is not what an
-- additive migration is for.
--
--   media_url   where the picture is. NULL for every text row, which is every
--               row that exists today. A row with kind='image' and no media_url
--               is refused before it reaches the adapter (worker.ts), not here:
--               the send path is the one authority on what may leave.
--
-- The picture itself is not stored. `media_url` points at the same
-- `product_images.url` the owner already uploaded — one source for a product's
-- pictures, and no second copy to keep in sync or to leak.
--
-- Additive and forward-only (ADR-0007): an older build ignores the column and
-- keeps sending text, which is what makes rollback safe.
-- ---------------------------------------------------------------------------

alter table outbound_messages
  add column if not exists media_url text;

comment on column outbound_messages.media_url is
  'M24/0024: for kind=''image'', where the picture is (product_images.url). NULL for text.';

insert into _migrations (version, name) values (24, '0024_outbound_media')
  on conflict (version) do nothing;
