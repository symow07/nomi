-- 0083 — what a reply promised, and for when (the design pass, decided by the
-- owner 2026-09-29: the calendar's dates from conversations — the promised
-- follow-up first, then the day a price ends and an agreed delivery date).
--
-- Written when a reply LEAVES (the provider accepted it), never when it is
-- drafted: what reached the customer is what was said. One row per promise,
-- with the sentence it was said in, as sent, and the day that sentence
-- names — read by rules (`src/core/conversation/promises.ts`), not a model.
--
-- It belongs to the customer's conversation: erasing the customer erases it
-- (tools/erase-buyer.mjs), and a workspace's erasure takes it with the rest.
-- The app role may not delete a row: a promise kept is marked kept.

create table if not exists promised_dates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  conversation_id uuid not null references conversations(id),
  outbound_id uuid references outbound_messages(id),
  kind text not null check (kind in ('follow_up', 'price_end', 'delivery')),
  due_on date not null,
  said text not null check (char_length(said) between 1 and 300),
  -- Who said it: the assistant's reply, or a person's own.
  said_by text not null check (said_by in ('assistant', 'person')),
  created_at timestamptz not null default now(),
  kept_at timestamptz,
  kept_by text
);

create unique index if not exists promised_dates_once
  on promised_dates (outbound_id, kind, due_on) where outbound_id is not null;
create index if not exists promised_dates_business_due
  on promised_dates (business_id, due_on);
create index if not exists promised_dates_conversation
  on promised_dates (conversation_id);

alter table promised_dates enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'promised_dates' and policyname = 'promised_dates_tenant') then
    create policy promised_dates_tenant on promised_dates
      for all to nomi_app
      using (business_id = current_business_id())
      with check (business_id = current_business_id());
  end if;
end $$;

grant select, insert, update on promised_dates to nomi_app;
revoke delete, truncate on promised_dates from nomi_app;

insert into _migrations (version, name) values (83, 'promised_dates')
on conflict (version) do nothing;
