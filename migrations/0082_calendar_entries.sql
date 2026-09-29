-- 0082 — the owner's own dates on the calendar (the design pass, decided by
-- the owner 2026-09-29: "your own entries in this pass").
--
-- Until now every date on the calendar was one column of a row that already
-- existed (a sample, an order, a quote, a closure). An owner also has dates
-- nobody wrote down anywhere else — a photo shoot, a trade fair, a stocktake.
-- This is where those are kept. They belong to the business, never to a
-- customer: no client or conversation is linked, so a customer's erasure
-- never reaches them, and a workspace's erasure takes them with the rest
-- (both tools find a table by its columns).
--
-- Taken off the calendar, an entry is ARCHIVED (`removed_at`), never deleted:
-- the app role may not delete from this table at all.
--
-- On the page, where a date came from is shown by its EDGE: solid when it came
-- from a conversation, dashed when the owner put it there — these, and closures.

create table if not exists calendar_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  starts_at timestamptz not null,
  ends_at timestamptz,
  -- A date with no time: the whole day, in the business's timezone.
  all_day boolean not null default false,
  -- Who put it there: a person's id, or the owner sentinel.
  created_by text,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by text,
  constraint calendar_entries_order check (ends_at is null or ends_at >= starts_at),
  constraint calendar_entries_all_day check (not all_day or ends_at is null)
);

create index if not exists calendar_entries_business_start
  on calendar_entries (business_id, starts_at) where removed_at is null;

alter table calendar_entries enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'calendar_entries' and policyname = 'calendar_entries_tenant') then
    create policy calendar_entries_tenant on calendar_entries
      for all to nomi_app
      using (business_id = current_business_id())
      with check (business_id = current_business_id());
  end if;
end $$;

grant select, insert, update on calendar_entries to nomi_app;
revoke delete, truncate on calendar_entries from nomi_app;

insert into _migrations (version, name) values (82, 'calendar_entries')
on conflict (version) do nothing;
