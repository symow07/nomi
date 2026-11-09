-- ---------------------------------------------------------------------------
-- 0237 — SHOPIFY ORDERS IN THE CONVERSATION (Block 5.5).
--
-- A workspace may keep ONE read-only connection to its own Shopify store, and the owner may switch on "Answer order
-- questions from Shopify" (off by default). A customer who gives an order number AND the e-mail on that order is
-- answered from the order's verified state; every other outcome is one fixed sentence. Nothing from an order is kept
-- here except the verified order's name on the audit row.
--
--   · shopify_connections — the store's .myshopify.com address, the way it was connected (the owner's Admin API token,
--     or their own app's client ID and secret), the credential SEALED with CREDENTIAL_KEY as one value
--     (tools/rekey.mjs knows the column), the scopes Shopify granted, the API version Shopify last answered with, and
--     the switch. One live row per business. Disconnecting archives the row AND drops the sealed credential: nothing
--     usable is left. The app role cannot delete. A practice copy holds none (0086's refusal).
--   · shopify_order_lookups — one row per lookup: the conversation, when, the outcome, and the order's name only when
--     verified. No e-mail, no tracking, no order id. Written only by claim_order_lookup / finish_order_lookup, in a
--     transaction of their own (so a turn that later fails still counted its lookup). At most five that asked Shopify
--     per conversation in any 60 minutes; a lookup refused for that is recorded and does not count.
--   · Neither lookup function takes a lock the turn may hold: no foreign key to the conversation (a trigger checks, with
--     a plain read, that it exists and is the same workspace's), and the rate limit is serialised on its own advisory
--     key (`shopify-order-lookup:<conversation>`), never the turn's.
--   · Erasure: a customer's lookups go with them (`erase`); the connection holds no customer (`unrelated`). The two
--     shared erasure functions it changes are renamed `*_before_0237` and wrapped, whatever they are when this runs
--     (the edges are unchanged: the table has no foreign key).
-- ---------------------------------------------------------------------------

create table if not exists shopify_connections (
  id                     uuid primary key default gen_random_uuid(),
  business_id            uuid not null references businesses(id) on delete cascade,
  shop                   text not null check (shop ~ '^https://[a-z0-9][a-z0-9-]{0,61}\.myshopify\.com$'),
  way                    text not null check (way in ('token', 'client')),
  credential_ciphertext  text check (credential_ciphertext is null or credential_ciphertext like 'v1.%'),
  scopes                 text[] not null default '{}',
  api_version_seen       text check (api_version_seen is null or api_version_seen ~ '^[0-9A-Za-z_.-]{1,32}$'),
  api_version_seen_at    timestamptz,
  answer_orders          boolean not null default false,
  answer_orders_set_by   text,
  answer_orders_set_at   timestamptz,
  connected_by           text not null,
  connected_at           timestamptz not null default now(),
  archived_at            timestamptz,
  archived_by            text,
  constraint shopify_connections_archive_whole check ((archived_at is null) = (archived_by is null)),
  -- Live means a credential; archived means none, and the switch off.
  constraint shopify_connections_live_has_credential check ((archived_at is null) = (credential_ciphertext is not null)),
  constraint shopify_connections_archived_off check (archived_at is null or not answer_orders)
);
create unique index if not exists shopify_connections_one_live on shopify_connections (business_id) where archived_at is null;

alter table shopify_connections enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'shopify_connections' and policyname = 'shopify_connections_tenant') then
    create policy shopify_connections_tenant on shopify_connections
      for all to nomi_app
      using (business_id = current_business_id())
      with check (business_id = current_business_id());
  end if;
end $$;
grant select, insert, update on shopify_connections to nomi_app;
revoke delete, truncate on shopify_connections from nomi_app;
drop policy if exists not_for_accountants on shopify_connections;
create policy not_for_accountants on shopify_connections as restrictive for all
  using (not (select viewer_is_accountant())) with check (not (select viewer_is_accountant()));

create table if not exists shopify_order_lookups (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references businesses(id) on delete cascade,
  -- No foreign key, on purpose: its check takes FOR KEY SHARE on the conversation's row from the lookup's own
  -- transaction, which waits on any FOR UPDATE the turn waiting for that lookup holds. The reference is held instead
  -- by `shopify_order_lookups_reference` below, with a plain read that locks nothing.
  conversation_id  uuid not null,
  asked_at         timestamptz not null default now(),
  outcome          text not null check (outcome in ('asking', 'verified', 'not_found', 'mismatch', 'redacted', 'ambiguous',
                                                   'out_of_scope', 'rate_limited', 'unavailable')),
  -- The verified order's name, and nothing else of the order, ever.
  order_name       text check (order_name is null or (outcome = 'verified' and order_name ~ '^#[A-Za-z0-9_-]{1,40}$')),
  finished_at      timestamptz,
  constraint shopify_order_lookups_verified_named check (outcome <> 'verified' or order_name is not null)
);
create index if not exists shopify_order_lookups_by_conversation on shopify_order_lookups (conversation_id, asked_at);
create index if not exists shopify_order_lookups_by_business on shopify_order_lookups (business_id, asked_at);

alter table shopify_order_lookups enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'shopify_order_lookups' and policyname = 'shopify_order_lookups_tenant') then
    create policy shopify_order_lookups_tenant on shopify_order_lookups
      for all to nomi_app
      using (business_id = current_business_id())
      with check (business_id = current_business_id());
  end if;
end $$;
-- Read by the app; written only through the two functions below.
grant select on shopify_order_lookups to nomi_app;
revoke insert, update, delete, truncate on shopify_order_lookups from nomi_app;
drop policy if exists not_for_accountants on shopify_order_lookups;
create policy not_for_accountants on shopify_order_lookups as restrictive for all
  using (not (select viewer_is_accountant())) with check (not (select viewer_is_accountant()));

-- The reference a foreign key would have held, without its lock: the conversation exists and belongs to the row's own
-- workspace. A PLAIN read (no FOR SHARE, no FOR KEY SHARE), so it never waits on the turn that holds that row.
create or replace function shopify_order_lookups_reference() returns trigger
language plpgsql security definer set search_path = public, pg_temp set row_security = off as $$
begin
  if not exists (select 1 from conversations where id = new.conversation_id and business_id = new.business_id) then
    raise exception 'a lookup names a conversation of its own workspace' using errcode = '23503';
  end if;
  return new;
end $$;
revoke all on function shopify_order_lookups_reference() from public;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'shopify_order_lookups_reference') then
    create trigger shopify_order_lookups_reference before insert or update of conversation_id, business_id on shopify_order_lookups
      for each row execute function shopify_order_lookups_reference();
  end if;
end $$;

-- A practice copy can reach nobody (0086): its refusal, on both tables.
do $$
declare t text;
begin
  foreach t in array array['shopify_connections', 'shopify_order_lookups'] loop
    if not exists (select 1 from pg_trigger where tgname = t || '_practice_refuses') then
      execute format('create trigger %I before insert or update on %I for each row execute function practice_refuses()',
                     t || '_practice_refuses', t);
    end if;
  end loop;
end $$;

-- A lookup's slot, claimed BEFORE Shopify is asked, in the caller's own transaction. Five that asked Shopify per
-- conversation in the last 60 minutes; the sixth is recorded as `rate_limited` (which never counts) and refused.
-- Serialised per conversation by its own advisory key (never the turn's: the turn holds that one while it waits).
create or replace function claim_order_lookup(p_conversation uuid) returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_business uuid := current_business_id();
  v_asked integer;
  v_id uuid;
begin
  if v_business is null
     or not exists (select 1 from conversations where id = p_conversation and business_id = v_business) then
    raise exception 'not this workspace''s conversation' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('shopify-order-lookup:' || p_conversation::text, 0));
  select count(*) into v_asked from shopify_order_lookups
   where conversation_id = p_conversation and outcome <> 'rate_limited' and asked_at > now() - interval '60 minutes';
  if v_asked >= 5 then
    insert into shopify_order_lookups (business_id, conversation_id, outcome, finished_at)
    values (v_business, p_conversation, 'rate_limited', now());
    return null;
  end if;
  insert into shopify_order_lookups (business_id, conversation_id, outcome)
  values (v_business, p_conversation, 'asking') returning id into v_id;
  return v_id;
end $$;
revoke all on function claim_order_lookup(uuid) from public;
grant execute on function claim_order_lookup(uuid) to nomi_app;

-- How a claimed lookup ended. Once: only an `asking` row of this workspace changes.
create or replace function finish_order_lookup(p_id uuid, p_outcome text, p_order_name text) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if p_outcome not in ('verified', 'not_found', 'mismatch', 'redacted', 'ambiguous', 'out_of_scope', 'unavailable') then
    raise exception 'not a lookup outcome' using errcode = '22023';
  end if;
  update shopify_order_lookups
     set outcome = p_outcome,
         order_name = case when p_outcome = 'verified' then p_order_name else null end,
         finished_at = now()
   where id = p_id and business_id = current_business_id() and outcome = 'asking';
end $$;
revoke all on function finish_order_lookup(uuid, text, text) from public;
grant execute on function finish_order_lookup(uuid, text, text) to nomi_app;

-- ── Erasure: rename and wrap, as 0233 does ────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('customer_erasure_contract_before_0237()') is null then
    alter function customer_erasure_contract() rename to customer_erasure_contract_before_0237;
  end if;
  if to_regprocedure('erase_customer_rows_before_0237(uuid, uuid, uuid, boolean)') is null then
    alter function erase_customer_rows(uuid, uuid, uuid, boolean) rename to erase_customer_rows_before_0237;
  end if;
end $$;

create or replace function customer_erasure_contract()
returns table (tbl text, action text, clear text[], blank text[], detach text[], match text)
language sql immutable set search_path = public as $$
  select * from customer_erasure_contract_before_0237()
  union all values
    -- 0237 — the store's connection: no customer in it.
    ('shopify_connections', 'unrelated', null::text[], null::text[], null::text[], null::text),
    -- 0237 — that a customer's order was looked up, its outcome, and the verified order's name: theirs.
    ('shopify_order_lookups', 'erase', null::text[], null::text[], null::text[], null::text)
$$;
revoke all on function customer_erasure_contract() from public;
revoke all on function customer_erasure_contract_before_0237() from public;

create or replace function erase_customer_rows(p_business uuid, p_client uuid, p_request uuid, p_restored boolean default false)
returns jsonb
language plpgsql volatile security definer set search_path = public set row_security = off as $$
declare
  v_counts jsonb;
  v_lookups bigint;
begin
  delete from shopify_order_lookups
   where business_id = p_business
     and conversation_id in (select c.id from conversations c where c.client_id = p_client and c.business_id = p_business);
  get diagnostics v_lookups = row_count;
  v_counts := erase_customer_rows_before_0237(p_business, p_client, p_request, p_restored);
  return jsonb_set(v_counts, '{erased}', erasure_add(coalesce(v_counts -> 'erased', '{}'::jsonb), 'shopify_order_lookups', v_lookups));
end $$;
revoke all on function erase_customer_rows(uuid, uuid, uuid, boolean) from public;
revoke all on function erase_customer_rows_before_0237(uuid, uuid, uuid, boolean) from public;

insert into _migrations (version, name) values (237, 'shopify_orders')
  on conflict (version) do nothing;
