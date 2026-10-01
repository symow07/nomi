-- 0118 — EXT: a PDF price list read like a photographed page.
--
-- The page reader (M37) learns PDF documents: the model transcribes the pages
-- to text, the deterministic parser makes the products, and every priced row
-- waits for the owner's own tick — exactly as for a photo. The file is kept
-- beside the import as a photo is, so the review can show it.

alter table catalog_import_photos drop constraint if exists catalog_import_photos_media_type_check;
alter table catalog_import_photos add constraint catalog_import_photos_media_type_check
  check (media_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf'));

insert into _migrations (version, name) values (118, 'ext')
on conflict (version) do nothing;
