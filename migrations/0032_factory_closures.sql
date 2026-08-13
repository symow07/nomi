-- 0032 — M44: the factory closure calendar.
--
-- Nothing here knows when Chinese New Year is, and that is deliberate. The
-- dates are lunar and move; Ramadan moves eleven days a year against the
-- Gregorian calendar; and the LENGTH is not a date at all but a business
-- decision — one Yiwu factory closes for eight days and one for five weeks,
-- and both are normal. A built-in table would have to guess when somebody
-- else's factory is shut, which is the same class of invented number this
-- product refuses everywhere else.
--
-- She states her closures. This table holds what she said.
--
-- ARCHIVE, NEVER ERASE: a closure that has passed still explains why a quote
-- in January promised no date. Removing one sets archived_at.

create table if not exists factory_closures (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  -- Her own words: 春节, Eid, annual maintenance. Never inferred, never
  -- translated — it is shown back to her exactly as she typed it.
  label        text not null check (btrim(label) <> ''),
  starts_on    date not null,
  ends_on      date not null,
  created_at   timestamptz not null default now(),
  archived_at  timestamptz,
  -- A closure that ends before it starts is a typo, and a typo here silently
  -- stops blocking anything: the failure would be invisible until a buyer was
  -- promised a date during the shutdown.
  constraint factory_closures_ordered check (ends_on >= starts_on)
);

create index if not exists factory_closures_live
  on factory_closures (business_id, starts_on)
  where archived_at is null;

alter table factory_closures enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'factory_closures' and policyname = 'factory_closures_tenant') then
    create policy factory_closures_tenant on factory_closures
      for all to nomi_app
      using (business_id = current_business_id())
      with check (business_id = current_business_id());
  end if;
end $$;

insert into _migrations (version, name)
values (32, 'factory_closures')
on conflict (version) do nothing;
