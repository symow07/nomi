-- 0118 — EXT: a PDF price list read like a photographed page; a store's policy
-- pages proposed as facts, confirmed line by line.
--
-- The page reader (M37) learns PDF documents: the model transcribes the pages
-- to text, the deterministic parser makes the products, and every priced row
-- waits for the owner's own tick — exactly as for a photo. The file is kept
-- beside the import as a photo is, so the review can show it.

alter table catalog_import_photos drop constraint if exists catalog_import_photos_media_type_check;
alter table catalog_import_photos add constraint catalog_import_photos_media_type_check
  check (media_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf'));

-- A page of the owner's site (shipping, returns, payment, care) read by the
-- model into facts a customer might ask about, each with the sentence it came
-- from. Proposed, never written: only the lines the owner ticks become
-- knowledge (`product_knowledge`, business-level, her own), and the proposal
-- remembers what was written.
create table if not exists knowledge_proposals (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  source       text not null check (length(source) between 1 and 500),
  lines        jsonb not null default '[]'::jsonb,
  created_by   text not null check (length(btrim(created_by)) between 1 and 120),
  created_at   timestamptz not null default now(),
  decided_at   timestamptz,
  written      integer check (written is null or written >= 0)
);
create index if not exists knowledge_proposals_business on knowledge_proposals (business_id, created_at desc);
alter table knowledge_proposals enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'knowledge_proposals' and policyname = 'knowledge_proposals_tenant') then
    create policy knowledge_proposals_tenant on knowledge_proposals for all to nomi_app
      using (business_id = current_business_id()) with check (business_id = current_business_id());
  end if;
end $$;
grant select, insert, update on knowledge_proposals to nomi_app;
revoke delete, truncate on knowledge_proposals from nomi_app;

-- The audit trail learns what was confirmed from a page (the whole list restated, as 0096 did).
alter table channel_audit drop constraint if exists channel_audit_action_check;
alter table channel_audit add constraint channel_audit_action_check
  check (action in ('connect','reconnect','disconnect','test','rotate_credential',
                    'set_owner_phone','update_profile','activate','deactivate',
                    'blocked_not_allowlisted','allowlist_add','allowlist_archive',
                    'send_refused','activation_refused','product_edited',
                    'price_rules_set','transcript_corrected',
                    'assistant_added','assistant_changed','assistant_archived',
                    'export_data','deletion_requested','deletion_withdrawn',
                    'assistant_stop','assistant_start',
                    'deletion_dismissed',
                    'product_imported','import_confirmed','prices_to_owner_set',
                    'selling_set','how_you_sell_saved','knowledge_imported'));

insert into _migrations (version, name) values (118, 'ext')
on conflict (version) do nothing;
