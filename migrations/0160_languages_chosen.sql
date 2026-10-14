-- ---------------------------------------------------------------------------
-- 0160 — THE LANGUAGES AN OWNER CHOSE, TOLD APART FROM THE DEFAULT (the owner,
-- 2026-10-14, on #344).
--
-- "Require a name only for a language the owner actually serves — the ones
-- they selected, or the ones their buyers have actually written in. Everything
-- else is a suggestion, not an undone step." `languages_served` is
-- en/zh/ar for every workspace that never touched it (0017's default), which
-- looks exactly like a choice. `languages_chosen_at` is when the owner first
-- changed that list on the profile: from then on the list is theirs.
--
-- Backfilled from the profile's own audit (`channel_audit`, 'update_profile',
-- which names the fields that changed), and for a list that is not the default
-- — nobody but a person sets one.
-- ---------------------------------------------------------------------------

alter table businesses add column if not exists languages_chosen_at timestamptz;

comment on column businesses.languages_chosen_at is
  'When the owner first changed languages_served on the profile; null while the list is the default nobody chose (0160). Setup asks for product names only in a chosen language or one buyers wrote in.';

update businesses b set languages_chosen_at = a.first
  from (select business_id, min(at) as first from channel_audit
         where action = 'update_profile' and detail->'fields' ? 'languages_served'
         group by business_id) a
 where a.business_id = b.id and b.languages_chosen_at is null;

update businesses set languages_chosen_at = coalesce(created_at, now())
 where languages_chosen_at is null
   and languages_served is distinct from array['en','zh','ar']::text[];

insert into _migrations (version, name) values (160, 'languages_chosen')
  on conflict (version) do nothing;
