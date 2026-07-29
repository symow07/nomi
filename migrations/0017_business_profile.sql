-- =============================================================================
-- 0017 — Business profile (M11.1). Extends the EXISTING businesses table; no
-- second business model. Product categories are DERIVED from products.category
-- (not stored here). Working hours are free text; languages_served is
-- informational (behavior is unaffected). All columns additive + nullable/defaulted.
-- =============================================================================

alter table businesses
  add column if not exists description       text,
  add column if not exists location          text,
  add column if not exists working_hours     text,
  add column if not exists contact_phone     text,
  add column if not exists languages_served  text[] not null default array['en','zh','ar'];

-- languages_served may only contain supported UI/reply languages.
alter table businesses drop constraint if exists businesses_languages_served_check;
alter table businesses add constraint businesses_languages_served_check
  check (languages_served <@ array['en','zh','ar']::text[]);

-- Owner profile edits audit into channel_audit (existing pattern); allow the verb.
alter table channel_audit drop constraint if exists channel_audit_action_check;
alter table channel_audit add constraint channel_audit_action_check
  check (action in ('connect','reconnect','disconnect','test','rotate_credential','set_owner_phone','update_profile'));

insert into _migrations (version, name) values (17, 'business_profile')
on conflict (version) do nothing;
