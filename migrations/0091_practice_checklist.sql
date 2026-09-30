-- ---------------------------------------------------------------------------
-- 0091 — WHAT THE OWNER HAS SEEN IN PRACTICE (P4 part two; docs/PRACTICE.md).
--
-- The Practice checklist: nine things an owner should see before customers —
-- a product quoted correctly, a hard question handed over, "are you a bot?"
-- answered honestly, and so on. Each is read from the practice copy's own rows
-- when it happens; but Practice is not kept (0089: Start over, thirty days),
-- so what was SEEN is written down on the WORKSPACE, once, and outlives the
-- transcript it was seen in.
--
--   · practice_checks — one row per item the workspace has seen, with when.
--   · practice_totals — "your total first": the total the owner expected
--     before the answer came, and, once a quote came, what it said and
--     whether the two agreed. The page shows the pair; the rows are also the
--     measurement (how often an owner's expectation and the quote disagree).
--     Numbers only — never the customer's words.
-- Both are the workspace's own (row security as everywhere); erase-workspace
-- takes them with it.
-- ---------------------------------------------------------------------------

create table if not exists practice_checks (
  business_id uuid not null references businesses(id) on delete cascade,
  item        text not null check (item ~ '^[a-z_]{2,40}$'),
  seen_at     timestamptz not null default now(),
  primary key (business_id, item)
);

create table if not exists practice_totals (
  business_id uuid not null references businesses(id) on delete cascade,
  message_id  text not null,
  expected    numeric(14, 2) not null check (expected > 0),
  quoted      numeric(14, 2),
  currency    text,
  agreed      boolean,
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  primary key (business_id, message_id),
  check ((agreed is null) = (decided_at is null))
);

alter table practice_checks enable row level security;
alter table practice_totals enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'practice_checks' and policyname = 'practice_checks_tenant') then
    create policy practice_checks_tenant on practice_checks
      for all to nomi_app
      using (business_id = current_business_id())
      with check (business_id = current_business_id());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'practice_totals' and policyname = 'practice_totals_tenant') then
    create policy practice_totals_tenant on practice_totals
      for all to nomi_app
      using (business_id = current_business_id())
      with check (business_id = current_business_id());
  end if;
end $$;

grant select, insert, update on practice_checks, practice_totals to nomi_app;
revoke delete, truncate on practice_checks, practice_totals from nomi_app;

insert into _migrations (version, name) values (91, 'practice_checklist')
on conflict (version) do nothing;
