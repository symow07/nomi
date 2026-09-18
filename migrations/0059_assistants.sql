-- ---------------------------------------------------------------------------
-- 0059 — A5.1: more than one assistant.
--
-- There was one digital employee, and her name was a constant in the code:
-- "Lily", "小雅", "ياسمين", by language. A business with a sales conversation on
-- WhatsApp and after-sales questions on Instagram wants two, each with a name
-- its buyers and its staff recognise, and each answering where it belongs.
--
-- v1, as decided with the owner: assistants differ by NAME, ROLE and CHANNELS.
-- What she sells, what she was taught, her price limits and what she may do
-- alone stay the BUSINESS's — whoever is speaking, the floor is the floor.
--
--   assistants                 per business. Exactly one live default; a
--                              channel belongs to at most one live assistant.
--   conversations.assistant_id who answers this conversation, decided once
--                              when it starts and changeable by the owner.
--                              NULL means "the default", which is what every
--                              conversation before today is.
--
-- A business that never adds a second assistant sees no difference: its default
-- is created the first time it is needed, carrying the name it always had.
-- ---------------------------------------------------------------------------

create table if not exists assistants (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  name         text not null check (btrim(name) <> '' and length(name) <= 40),
  role         text not null default 'sales' check (role in ('sales', 'support', 'after_sales', 'other')),
  -- How this one should sound, in the owner's words. Shown to the reply writer
  -- as tone only — the guards do not read it and it cannot widen what she may say.
  note         text check (note is null or length(note) <= 600),
  -- The channels it answers on. Empty for the default: it answers everything
  -- nobody else claimed.
  channels     text[] not null default '{}',
  is_default   boolean not null default false,
  created_at   timestamptz not null default now(),
  created_by   text not null default 'owner',
  -- Archive, never erase: a conversation she held last March still names her.
  archived_at  timestamptz
);

create unique index if not exists assistants_one_default
  on assistants (business_id) where is_default and archived_at is null;
create index if not exists assistants_live
  on assistants (business_id) where archived_at is null;

alter table assistants enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'assistants' and policyname = 'assistants_tenant') then
    create policy assistants_tenant on assistants
      for all to nomi_app
      using (business_id = current_business_id())
      with check (business_id = current_business_id());
  end if;
end $$;

grant select, insert, update on assistants to nomi_app;
revoke delete, truncate on assistants from nomi_app;

alter table conversations
  add column if not exists assistant_id uuid references assistants(id);

-- The audit trail learns three verbs. The whole list is restated, as 0027 did:
-- a check constraint cannot be added to, only replaced.
alter table channel_audit drop constraint if exists channel_audit_action_check;
alter table channel_audit add constraint channel_audit_action_check
  check (action in ('connect','reconnect','disconnect','test','rotate_credential',
                    'set_owner_phone','update_profile',
                    'activate','deactivate','blocked_not_allowlisted',
                    'allowlist_add','allowlist_archive',
                    'send_refused','activation_refused',
                    'product_edited','price_rules_set',
                    'transcript_corrected',
                    'assistant_added','assistant_changed','assistant_archived'));

insert into _migrations (version, name) values (59, 'assistants')
on conflict (version) do nothing;
