-- 0036 — M38: who may be written to, and how we know.
--
-- The outbound engine's foundation. Everything in Block C sits on these three
-- tables, and the gate that refuses a send (M42) reads exactly them.
--
-- ── ONE DECISION THAT SHAPES ALL THREE ────────────────────────────────────
--
-- Consent and suppression are keyed on (channel, identity), NOT on a contact
-- row's id. That is deliberate and it is the safety property:
--
--   * An unsubscribe survives archiving the contact and re-importing the same
--     address tomorrow. A suppression that a delete-and-re-add can shake off is
--     not a suppression, and re-import is exactly how that happens in practice.
--   * An attestation she records before the contact exists still counts.
--   * The address, normalised, is the thing the law and the buyer both care
--     about. The row we happen to keep about it is bookkeeping.
--
-- ── AND ONE THING THAT IS NOT STORED HERE ─────────────────────────────────
--
-- A buyer who wrote to her first HAS consented, and that consent is DERIVED
-- from his conversation every time it is asked for — never copied into a row.
-- Copying it would create a second answer to "did he write to us" that goes
-- stale the moment the first one changes, which is this repo's most expensive
-- recurring defect. `clients` already knows.
--
-- It also lands the legally correct answer for free: he messaged her on
-- WhatsApp, so the derivation only ever produces consent for WhatsApp. His
-- e-mail address, wherever she got it, is untouched by it.
--
-- ── NOT HERE: outreach_log ────────────────────────────────────────────────
--
-- The roadmap lists it under this milestone and it is deliberately postponed to
-- M42, which is the thing that writes it. `message_fragments` sat in migration
-- 0009 with no writer for eleven milestones and the batching it was for was
-- never wired; a table created ahead of its writer is the same mistake with a
-- schema attached. It ships with the gate.

-- IDENTITIES SHE ADDED. Not the buyers who wrote to her — those are `clients`,
-- and they stay there. This is the person whose card she took at the Canton
-- Fair, and later the rows an import produces.
create table if not exists contacts (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  channel       text not null check (channel in ('email','whatsapp')),
  -- Normalised before it arrives (lower-cased address, E.164-ish phone) so the
  -- same person cannot become two rows with two different suppression states.
  identity      text not null,
  display_name  text,
  company       text,
  -- Two values, because two things write one. 'csv' and 'apollo' arrive with
  -- the importers that produce them: a source nothing can write is a source
  -- nothing can display honestly.
  source        text not null check (source in ('inbound','manual')),
  source_detail text,
  created_at    timestamptz not null default now(),
  created_by    text not null default 'owner',
  -- ARCHIVE, NEVER ERASE. Her record of who she has met is hers.
  archived_at   timestamptz
);

-- One live row per identity per channel. Partial, so archiving and re-adding
-- the same address is allowed — while the suppression on it, keyed elsewhere,
-- carries straight across.
create unique index if not exists contacts_identity_live
  on contacts (business_id, channel, identity) where archived_at is null;
create index if not exists contacts_business_created
  on contacts (business_id, created_at desc);

-- HOW WE KNOW, WITH HER NAME ON IT. Append-only: a consent record that can be
-- edited is a consent record that will be edited into existence.
create table if not exists contact_consent (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  channel       text not null check (channel in ('email','whatsapp')),
  identity      text not null,
  -- 'replied_to_email' and 'form_submission' arrive with M40 and a form.
  -- 'inbound_message' is stored only where it cannot be derived; the ordinary
  -- case is derived from the conversation and never written here.
  evidence      text not null check (evidence in ('inbound_message','owner_attestation')),
  obtained_at   timestamptz not null default now(),
  note          text,
  -- For an attestation this is the person standing behind it, and that is the
  -- whole value of the row.
  recorded_by   text not null
);

create index if not exists contact_consent_identity
  on contact_consent (business_id, channel, identity, obtained_at desc);

-- NEVER AGAIN. Permanent, one row per identity, and the app role can neither
-- edit nor delete it.
create table if not exists suppressions (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  channel       text not null check (channel in ('email','whatsapp')),
  identity      text not null,
  reason        text not null check (reason in ('unsubscribed','bounced','complained')),
  at            timestamptz not null default now(),
  -- What happened, in whatever the source gave us. Never shown to a buyer.
  detail        text
);

-- Not partial and not conditional: an identity is suppressed once, forever.
create unique index if not exists suppressions_identity
  on suppressions (business_id, channel, identity);

alter table contacts        enable row level security;
alter table contact_consent enable row level security;
alter table suppressions    enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'contacts' and policyname = 'contacts_tenant') then
    create policy contacts_tenant on contacts
      for all to nomi_app
      using (business_id = current_business_id())
      with check (business_id = current_business_id());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'contact_consent' and policyname = 'contact_consent_tenant') then
    create policy contact_consent_tenant on contact_consent
      for all to nomi_app
      using (business_id = current_business_id())
      with check (business_id = current_business_id());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'suppressions' and policyname = 'suppressions_tenant') then
    create policy suppressions_tenant on suppressions
      for all to nomi_app
      using (business_id = current_business_id())
      with check (business_id = current_business_id());
  end if;
end $$;

-- Contacts are editable: she corrects a name, she archives a row.
grant select, insert, update on contacts to nomi_app;

-- Consent is not. The row says how we knew at the moment we knew it.
grant select, insert on contact_consent to nomi_app;
revoke update on contact_consent from nomi_app;

-- Suppression is neither. This is the one table in the product where the
-- runtime role holds insert and select and nothing else at all, and the reason
-- is that every other guarantee here is downstream of this one being unarguable.
grant select, insert on suppressions to nomi_app;
revoke update, delete on suppressions from nomi_app;

insert into _migrations (version, name)
values (36, 'contacts')
on conflict (version) do nothing;
