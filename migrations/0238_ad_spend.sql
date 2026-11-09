-- 0238 — Ad spend beside orders.
--
-- The owner may connect ONE Meta ad account, through a separate login that asks for `ads_read` only (the
-- Page connect is untouched). A daily read keeps Meta's spend per day and per placement (`publisher_platform`)
-- exactly as Meta wrote it, and Results shows it beside the orders from conversations on the same channel.
-- Nothing here is a customer's: all five tables are `unrelated` to a customer's erasure, are found by
-- `business_id` when a workspace goes, and are never copied into Practice (a practice copy is refused one).
--
--   · ad_spend_connections — the chosen account, its currency and time zone as Meta gave them, and the user
--     token from the ads login, SEALED like every other token (tools/lib/sealed.mjs). One live row per business;
--     disconnecting archives it. `state` is what Meta last said of the token: refused (190) or no permission (200)
--     stops every call until the owner connects again.
--   · ad_spend_days — one row per account, day (the account's own day) and placement. `amount` is Meta's
--     decimal string, kept as written; `amount_num` is the same value as an exact numeric, never a float.
--     A re-read updates the row in place (`revision`); it is never a second row.
--   · ad_spend_day_history — the value a re-read replaced, and when it had been read.
--   · ad_spend_reads — every read: its span, pages, rows, outcome, Meta's error and its usage headers.
--   · ad_spend_recorded — a month's spend on one placement recorded as a cost through the spending book, so the
--     offer is not made again.

create table ad_spend_connections (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references businesses(id) on delete cascade,
  ad_account_id      text not null check (ad_account_id ~ '^[0-9]{1,30}$'),
  ad_account_name    text not null default '' check (length(ad_account_name) <= 200),
  account_currency   text not null check (account_currency ~ '^[A-Z]{3}$'),
  timezone_name      text not null check (length(timezone_name) between 1 and 64),
  token_ciphertext   text not null,
  token_fingerprint  text not null,
  state              text not null default 'active' check (state in ('active', 'refused', 'permission')),
  state_note         text check (length(state_note) <= 500),
  retry_after        timestamptz,
  connected_by       text not null check (length(btrim(connected_by)) between 1 and 120),
  connected_at       timestamptz not null default now(),
  archived_by        text,
  archived_at        timestamptz,
  check ((archived_at is null) = (archived_by is null)),
  unique (business_id, id)
);
create unique index ad_spend_one_live on ad_spend_connections (business_id) where archived_at is null;

create table ad_spend_days (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses(id) on delete cascade,
  ad_account_id  text not null check (ad_account_id ~ '^[0-9]{1,30}$'),
  day            date not null,
  -- Meta's own word for the placement, exactly as sent: known ones get a name on the page, any other is shown
  -- under "Other placements" and never folded into another.
  platform       text not null check (length(platform) between 1 and 80 and platform !~ '[[:cntrl:]]'),
  amount         text not null check (amount ~ '^[0-9]{1,15}(\.[0-9]{1,6})?$'),
  amount_num     numeric generated always as (amount::numeric) stored,
  currency       text not null check (currency ~ '^[A-Z]{3}$'),
  timezone_name  text not null check (length(timezone_name) between 1 and 64),
  -- What Meta calls spend: an estimate. Never anything else here.
  estimated      boolean not null default true check (estimated),
  first_read_at  timestamptz not null default now(),
  read_at        timestamptz not null default now(),
  revision       integer not null default 1 check (revision >= 1),
  unique (business_id, ad_account_id, day, platform),
  unique (business_id, id)
);

create table ad_spend_day_history (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  day_id       uuid not null,
  revision     integer not null check (revision >= 1),
  amount       text not null check (amount ~ '^[0-9]{1,15}(\.[0-9]{1,6})?$'),
  currency     text not null check (currency ~ '^[A-Z]{3}$'),
  read_at      timestamptz not null,
  replaced_at  timestamptz not null default now(),
  unique (day_id, revision),
  foreign key (business_id, day_id) references ad_spend_days (business_id, id)
);

create table ad_spend_reads (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses(id) on delete cascade,
  connection_id  uuid not null,
  ad_account_id  text not null,
  since          date not null,
  until          date not null,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  pages          integer not null default 0,
  rows_read      integer not null default 0,
  outcome        text check (outcome in ('ok', 'incomplete', 'refused', 'permission', 'throttled', 'failed')),
  error_code     integer,
  error_subcode  integer,
  error_message  text check (length(error_message) <= 500),
  usage          jsonb,
  foreign key (business_id, connection_id) references ad_spend_connections (business_id, id)
);
create index ad_spend_reads_latest on ad_spend_reads (business_id, connection_id, started_at desc);

create table ad_spend_recorded (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses(id) on delete cascade,
  ad_account_id  text not null check (ad_account_id ~ '^[0-9]{1,30}$'),
  month          date not null check (extract(day from month) = 1),
  platform       text not null check (length(platform) between 1 and 80),
  bill_id        uuid not null references spending_bills(id),
  spend_seen     text not null check (spend_seen ~ '^[0-9]{1,15}(\.[0-9]{1,6})?$'),
  currency       text not null check (currency ~ '^[A-Z]{3}$'),
  recorded_by    text not null check (length(btrim(recorded_by)) between 1 and 120),
  recorded_at    timestamptz not null default now(),
  unique (business_id, ad_account_id, month, platform)
);

do $$ declare t text; begin
  foreach t in array array['ad_spend_connections', 'ad_spend_days', 'ad_spend_day_history', 'ad_spend_reads', 'ad_spend_recorded'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant on %I for all to nomi_app using (business_id = current_business_id()) with check (business_id = current_business_id())', t);
    -- The amounts are the owner's: staff and the accountant read none of it, whatever a page forgets.
    execute format('create policy not_for_staff on %I as restrictive for all using (not (select viewer_is_staff())) with check (not (select viewer_is_staff()))', t);
    execute format('create policy not_for_accountants on %I as restrictive for all using (not (select viewer_is_accountant())) with check (not (select viewer_is_accountant()))', t);
    execute format('grant select, insert, update on %I to nomi_app', t);
    execute format('revoke delete, truncate on %I from nomi_app', t);
  end loop;
end $$;
-- What was replaced, and what was recorded, is not rewritten.
revoke update on ad_spend_day_history from nomi_app;
revoke update on ad_spend_recorded from nomi_app;

-- A practice copy reaches nobody (0086): no ad account, and no spend, ever.
create trigger ad_spend_connections_practice_refuses before insert or update on ad_spend_connections
  for each row execute function practice_refuses();
create trigger ad_spend_days_practice_refuses before insert or update on ad_spend_days
  for each row execute function practice_refuses();

-- The daily read's list: a live, accepted connection of a real workspace that is switched on and not suspended,
-- whose last refusal to wait has passed. Ids only.
create function ad_spend_workspaces() returns table (business_id uuid)
language sql stable security definer set search_path = public set row_security = off as $$
  select c.business_id
    from ad_spend_connections c join businesses b on b.id = c.business_id
   where c.archived_at is null and c.state = 'active'
     and (c.retry_after is null or c.retry_after <= now())
     and b.practice_of is null and b.is_active
     and not exists (select 1 from workspace_suspensions s where s.business_id = b.id and s.restored_at is null)
$$;
revoke all on function ad_spend_workspaces() from public;
grant execute on function ad_spend_workspaces() to nomi_app;

-- ── The erasure contract: five tables, none of them a customer's ────────────────────────────────────────────
alter function customer_erasure_contract() rename to customer_erasure_contract_before_0238;
create function customer_erasure_contract() returns table(tbl text,action text,clear text[],blank text[],detach text[],match text)
language sql immutable set search_path=public as $$
 select * from customer_erasure_contract_before_0238()
 union all select t,'unrelated',null::text[],null::text[],null::text[],null::text from unnest(array[
 'ad_spend_connections','ad_spend_days','ad_spend_day_history','ad_spend_reads','ad_spend_recorded']) t
$$;
revoke all on function customer_erasure_contract() from public;
