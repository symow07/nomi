-- 0120 — WA: a business's OWN WhatsApp number, connected through Meta's
-- Embedded Signup (the Tech Provider path, decision 43), the end of pilot
-- mode as the owner's own step, and (WA-S) the template that reopens a
-- customer's closed 24 hours.
--
-- Until now one number served the installation (the environment's
-- META_WHATSAPP_*), and `channel_credentials.secret_ref` named that variable.
-- A business that connects its own number keeps here what Meta handed back:
-- the WhatsApp Business Account it shared, the number's id and how it reads,
-- and the business token — ENCRYPTED, like `meta_accounts` (0054): a dump
-- must not carry a live key to someone's WhatsApp. The two-step PIN the number
-- was registered with is kept the same way; the owner may need it to move the
-- number later.
--
-- One live row per business, one live business per number: the second index is
-- how a number already live elsewhere — invisible under RLS — is learnt.

create table if not exists whatsapp_accounts (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references businesses(id) on delete cascade,
  waba_id            text not null check (waba_id ~ '^[0-9]{5,30}$'),
  phone_number_id    text not null check (phone_number_id ~ '^[0-9]{5,30}$'),
  display_phone      text check (display_phone is null or length(display_phone) <= 40),
  verified_name      text check (verified_name is null or length(verified_name) <= 200),
  name_status        text check (name_status is null or length(name_status) <= 40),
  token_ciphertext   text not null check (token_ciphertext like 'v1.%'),
  key_version        integer not null default 1,
  fingerprint        text not null check (fingerprint ~ '^[0-9a-f]{12}$'),
  pin_ciphertext     text check (pin_ciphertext is null or pin_ciphertext like 'v1.%'),
  connected_by       text not null,
  connected_at       timestamptz not null default now(),
  needs_attention_at timestamptz,
  last_error         text check (last_error is null or last_error in ('revoked', 'refused')),
  archived_at        timestamptz,
  archived_by        text,
  constraint whatsapp_accounts_archive_whole check ((archived_at is null) = (archived_by is null)),
  constraint whatsapp_accounts_attention_whole check ((needs_attention_at is null) = (last_error is null))
);
create unique index if not exists whatsapp_accounts_one_live
  on whatsapp_accounts (business_id) where archived_at is null;
create unique index if not exists whatsapp_accounts_number_live
  on whatsapp_accounts (phone_number_id) where archived_at is null;

alter table whatsapp_accounts enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'whatsapp_accounts' and policyname = 'whatsapp_accounts_tenant') then
    create policy whatsapp_accounts_tenant on whatsapp_accounts
      for all to nomi_app
      using (business_id = current_business_id())
      with check (business_id = current_business_id());
  end if;
end $$;
grant select, insert, update on whatsapp_accounts to nomi_app;
revoke delete, truncate on whatsapp_accounts from nomi_app;

-- WA-S — the reopening template, per business and language, as Meta answered.
-- One live row per business, name and language; Meta's status is copied here
-- when the owner asks it to be checked (and when the Channels page is opened),
-- and the outbound worker reopens a closed window only with an APPROVED one.
create table if not exists whatsapp_templates (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references businesses(id) on delete cascade,
  waba_id          text not null check (waba_id ~ '^[0-9]{5,30}$'),
  name             text not null check (name ~ '^[a-z0-9_]{1,255}$'),
  language         text not null check (language ~ '^[a-z]{2,3}(_[A-Z]{2})?$'),
  status           text not null default 'PENDING' check (length(status) between 1 and 40),
  meta_template_id text check (meta_template_id is null or meta_template_id ~ '^[0-9]{1,40}$'),
  reason           text check (reason is null or length(reason) <= 200),
  submitted_by     text not null,
  submitted_at     timestamptz not null default now(),
  checked_at       timestamptz,
  archived_at      timestamptz
);
create unique index if not exists whatsapp_templates_one_live
  on whatsapp_templates (business_id, name, language) where archived_at is null;
alter table whatsapp_templates enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'whatsapp_templates' and policyname = 'whatsapp_templates_tenant') then
    create policy whatsapp_templates_tenant on whatsapp_templates
      for all to nomi_app
      using (business_id = current_business_id())
      with check (business_id = current_business_id());
  end if;
end $$;
grant select, insert, update on whatsapp_templates to nomi_app;
revoke delete, truncate on whatsapp_templates from nomi_app;

-- The audit trail learns the end of pilot mode and its return (the whole list
-- restated, as 0118 did).
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
                    'selling_set','how_you_sell_saved','knowledge_imported',
                    'pilot_ended','pilot_resumed'));

insert into _migrations (version, name) values (120, 'whatsapp_accounts')
on conflict (version) do nothing;
