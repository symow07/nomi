-- ---------------------------------------------------------------------------
-- 0126 — A CUSTOMER'S DATA GOES WHEN THEY ASK; A WORKSPACE'S WHEN IT CLOSES
-- (the owner's direction, 2026-10-04).
--
-- The retention model is NOT "delete after 90 days". It is: keep a customer's
-- conversations while the workspace is active, and delete them when the
-- customer asks, or when the workspace closes. Until now a request was a row
-- (0064, 0073, 0076) and the erasure an operator's tool run by hand
-- (tools/erase-buyer.mjs, tools/erase-workspace.mjs). This makes the owner's
-- act the erasure itself — at once, for good — and keeps the rule that made
-- the tools tools: THE APP ROLE STILL HOLDS NO DELETE ON ANY TABLE
-- (tests/integration/grants.test.ts). The app reaches erasure only through two
-- definer functions that check whose business it is, who is asking, and what
-- may go:
--
--   erase_customer(request, by)        one customer of the CURRENT business,
--                                      under an open request, by its owner;
--   close_workspace(typed name, by)    the CURRENT business, whole, by its
--                                      owner, who typed its name.
--
-- ONE CONTRACT FOR THE APP AND THE OPERATOR. The tools call the same functions
-- (carry_out_customer_request, carry_out_workspace_erasure), so the two cannot
-- erase differently. The customer contract is erase-buyer's RULES, table by
-- table; `customer_erasure_contract()` states it in SQL, the tool refuses to
-- run when its RULES and this list differ, and a test holds them equal.
-- `customer_erasure_problems()` reads the live schema before every erasure: a
-- table or a link nobody classified stops it, by name, before anything changes
-- — a wrong guess is either somebody's data kept after they were told it was
-- gone, or a business's invoice deleted.
--
-- THE RECORD THAT IT HAPPENED keeps nothing that was erased: `erasure_ledger`
-- holds ids, who acted, when, the request and how many rows of each table —
-- never a name, a number or a word. It outlives the workspace (no foreign key,
-- and the workspace erasure leaves it), because it is also how an erasure
-- survives a restore: a backup cannot be edited, so after any restore
-- tools/replay-erasures.mjs carries out again every erasure the ledger lists
-- that the restored copy does not (docs/BACKUP-RESTORE.md).
--
-- RET IS RETIRED (0116, built and never switched on). The two functions that
-- listed and claimed its warnings are dropped, an active `retention` flag is
-- cleared and can no longer be set, and its daily job's schedule is removed.
-- ---------------------------------------------------------------------------

-- ── The ledger ─────────────────────────────────────────────────────────────
create table if not exists erasure_ledger (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('customer', 'workspace')),
  -- Ids only, and no foreign keys: the ledger outlives what it names.
  business_id uuid not null,
  -- The customer's id. Not `client_id`, on purpose: the erasure's own coverage
  -- check treats every `client_id` as a customer's data to classify, and this
  -- is the record that it was erased.
  customer_id uuid,
  request_id  uuid,
  -- 'owner' in the product; 'operator' by tools/erase-*.mjs; 'restore' when
  -- tools/replay-erasures.mjs carried it out again on a restored copy.
  via         text not null check (via in ('owner', 'operator', 'restore')),
  -- Who acted: a person's id in the product, or the operator's --by.
  by_who      text not null check (length(btrim(by_who)) between 1 and 120),
  at          timestamptz not null default now(),
  -- Rows per table, as the erasure counted them. Numbers, never content.
  counts      jsonb not null default '{}'::jsonb,
  constraint erasure_ledger_subject check ((kind = 'customer') = (customer_id is not null))
);
create index if not exists erasure_ledger_at on erasure_ledger (at);
create index if not exists erasure_ledger_client on erasure_ledger (customer_id) where customer_id is not null;
alter table erasure_ledger enable row level security;
-- The schema's default privileges (0005) grant the app role every new table:
-- taken back. The app writes it only through the functions below and never
-- reads it.
revoke all on erasure_ledger from public, nomi_app;

-- ── The audit trail learns one verb: a customer's data erased ──────────────
-- EVERY EXISTING VERB IS COPIED FROM THE LIVE CONSTRAINT, not from memory.
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
                    'product_imported','import_confirmed','prices_to_owner_set','selling_set',
                    'how_you_sell_saved','knowledge_imported','pilot_ended','pilot_resumed',
                    'customer_erased'));

-- ── The customer contract, as a list ───────────────────────────────────────
-- tools/erase-buyer.mjs's RULES, row for row (do, clear, blank, detach, match).
create or replace function customer_erasure_contract()
returns table (tbl text, action text, clear text[], blank text[], detach text[], match text)
language sql immutable set search_path = public as $$
  values
    ('clients', 'anonymise', array['display_name','email','phone','country','preferred_language','notes'], null::text[], null::text[], null::text),
    ('client_channels', 'erase', null, null, null, null),
    ('conversations', 'shell', array['assigned_to','assigned_at','ai_disclosed_at','ai_disclosure_delivered_at','owner_unsent_reply','owner_unsent_reply_at'], null, null, null),
    ('messages', 'erase', null, null, null, null),
    ('message_fragments', 'erase', null, null, null, null),
    ('turns', 'erase', null, null, null, null),
    ('drafts', 'erase', null, null, null, null),
    ('conversation_state', 'erase', null, null, null, null),
    ('conversation_signals', 'erase', null, null, null, null),
    ('conversation_events', 'erase', null, null, null, null),
    ('conversation_notes', 'erase', null, null, null, null),
    ('escalation_events', 'erase', null, null, null, null),
    ('handoffs', 'erase', null, null, null, null),
    ('sample_requests', 'erase', null, null, null, null),
    ('quotes', 'erase-unless-kept', null, null, null, null),
    ('quote_proofs', 'erase', null, null, null, null),
    ('outbound_messages', 'erase', null, null, null, null),
    ('outbound_transitions', 'erase', null, null, null, null),
    ('deliveries', 'erase', null, null, null, null),
    ('repairs', 'erase', null, null, null, null),
    ('shadow.turn_decisions', 'erase', null, null, null, null),
    ('spot_checks', 'detach', array['correction'], null, array['conversation_id'], null),
    ('orders', 'keep', array['client_email','shipping_address','notes'], null, null, null),
    ('order_updates', 'keep', null, null, null, null),
    ('email_confirmations', 'keep', array['subject','body_html'], array['to_email'], null, null),
    ('sequence_enrollments', 'erase', null, null, null, 'identity'),
    ('sequence_sends', 'erase', null, null, null, null),
    ('contacts', 'erase', null, null, null, 'identity'),
    ('contact_consent', 'erase', null, null, null, 'identity'),
    ('pilot_allowlist', 'erase', null, null, null, 'phone'),
    ('suppressions', 'keep', null, null, null, 'identity'),
    ('deletion_requests', 'keep', null, null, null, null),
    ('deletion_asks', 'erase', null, null, null, null),
    ('customers_answered', 'erase', null, null, null, null),
    ('order_proposals', 'erase', null, null, null, null),
    ('promised_dates', 'erase', null, null, null, null),
    ('client_faces', 'erase', null, null, null, null),
    ('channel_events', 'receipts', null, null, null, null),
    ('channel_audit', 'redact', null, null, null, null),
    ('logins', 'unrelated', null, null, null, null),
    ('login_codes', 'unrelated', null, null, null, null)
$$;
revoke all on function customer_erasure_contract() from public;

-- Every link below a customer that the erasure below was written for. A new
-- one — a column, a table — must be read and decided before it can run.
create or replace function customer_erasure_edges()
returns table (child text, col text, parent text, pcol text)
language sql immutable set search_path = public as $$
  values
    ('client_channels', 'client_id', 'clients', 'id'),
    ('client_faces', 'client_id', 'clients', 'id'),
    ('conversations', 'client_id', 'clients', 'id'),
    ('customers_answered', 'client_id', 'clients', 'id'),
    ('deletion_asks', 'client_id', 'clients', 'id'),
    ('deletion_requests', 'client_id', 'clients', 'id'),
    ('order_proposals', 'client_id', 'clients', 'id'),
    ('orders', 'client_id', 'clients', 'id'),
    ('conversation_notes', 'conversation_id', 'conversations', 'id'),
    ('conversation_signals', 'conversation_id', 'conversations', 'id'),
    ('conversation_state', 'conversation_id', 'conversations', 'id'),
    ('deletion_asks', 'conversation_id', 'conversations', 'id'),
    ('deliveries', 'conversation_id', 'conversations', 'id'),
    ('drafts', 'conversation_id', 'conversations', 'id'),
    ('escalation_events', 'conversation_id', 'conversations', 'id'),
    ('handoffs', 'conversation_id', 'conversations', 'id'),
    ('message_fragments', 'conversation_id', 'conversations', 'id'),
    ('messages', 'conversation_id', 'conversations', 'id'),
    ('order_proposals', 'conversation_id', 'conversations', 'id'),
    ('orders', 'conversation_id', 'conversations', 'id'),
    ('outbound_messages', 'conversation_id', 'conversations', 'id'),
    ('promised_dates', 'conversation_id', 'conversations', 'id'),
    ('quote_proofs', 'conversation_id', 'conversations', 'id'),
    ('quotes', 'conversation_id', 'conversations', 'id'),
    ('repairs', 'conversation_id', 'conversations', 'id'),
    ('sample_requests', 'conversation_id', 'conversations', 'id'),
    ('sequence_enrollments', 'conversation_id', 'conversations', 'id'),
    ('spot_checks', 'conversation_id', 'conversations', 'id'),
    ('turns', 'conversation_id', 'conversations', 'id'),
    ('conversation_events', 'conversation_id', 'conversations', 'id'),
    ('shadow.turn_decisions', 'conversation_id', 'conversations', 'id'),
    ('deletion_asks', 'message_id', 'messages', 'id'),
    ('deletion_asks', 'request_id', 'deletion_requests', 'id'),
    ('drafts', 'turn_message_id', 'turns', 'message_id'),
    ('message_fragments', 'processed_in', 'turns', 'message_id'),
    ('email_confirmations', 'order_id', 'orders', 'id'),
    ('order_proposals', 'order_id', 'orders', 'id'),
    ('order_updates', 'order_id', 'orders', 'id'),
    ('orders', 'quote_id', 'quotes', 'id'),
    ('quote_proofs', 'quote_id', 'quotes', 'id'),
    ('turns', 'quote_id', 'quotes', 'id'),
    ('outbound_transitions', 'outbound_id', 'outbound_messages', 'id'),
    ('promised_dates', 'outbound_id', 'outbound_messages', 'id'),
    ('sequence_sends', 'outbound_id', 'outbound_messages', 'id'),
    ('sequence_sends', 'enrollment_id', 'sequence_enrollments', 'id')
$$;
revoke all on function customer_erasure_edges() from public;

-- What the live schema says that the two lists above do not. Empty: the
-- erasure may run. Read from pg_constraint, the way erase-buyer's coverage
-- walk reads it, with the two links 0005 made without a constraint.
create or replace function customer_erasure_problems() returns text[]
language sql stable security definer set search_path = public as $$
  with recursive fk as (
    select (case when n.nspname = 'public' then c.relname::text else n.nspname || '.' || c.relname end) as child,
           (select a.attname::text from pg_attribute a where a.attrelid = con.conrelid and a.attnum = con.conkey[1]) as col,
           (case when pn.nspname = 'public' then p.relname::text else pn.nspname || '.' || p.relname end) as parent,
           (select a.attname::text from pg_attribute a where a.attrelid = con.confrelid and a.attnum = con.confkey[1]) as pcol,
           cardinality(con.conkey) as width
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace
      join pg_class p on p.oid = con.confrelid join pg_namespace pn on pn.oid = p.relnamespace
     where con.contype = 'f'
       and n.nspname not in ('pg_catalog', 'information_schema', 'pgboss') and n.nspname not like 'pg\_%'
       and pn.nspname not in ('pg_catalog', 'information_schema', 'pgboss') and pn.nspname not like 'pg\_%'
  ), tables as (
    select (case when n.nspname = 'public' then c.relname::text else n.nspname || '.' || c.relname end) as t, c.oid
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p') and not c.relispartition
       and n.nspname not in ('pg_catalog', 'information_schema', 'pgboss') and n.nspname not like 'pg\_%'
  ), virt as (
    -- 0005 created both with a bare conversation_id and no constraint.
    select v.child, v.col, v.parent, v.pcol, 1 as width
      from (values ('conversation_events', 'conversation_id', 'conversations', 'id'),
                   ('shadow.turn_decisions', 'conversation_id', 'conversations', 'id')) v(child, col, parent, pcol)
      join tables t on t.t = v.child
     where exists (select 1 from pg_attribute a where a.attrelid = t.oid and a.attname = v.col and not a.attisdropped)
  ), edges as (
    select child, col, parent, pcol, width from fk union all select child, col, parent, pcol, width from virt
  ), reach(t) as (
    select 'clients'::text collate "C"
    union
    select e.child from edges e join reach r on e.parent = r.t
  ), live as (
    select distinct e.child, e.col, e.parent, e.pcol, e.width from edges e where e.parent in (select t from reach)
  ), suspects as (
    select t.t from tables t
     where exists (select 1 from pg_attribute a where a.attrelid = t.oid and not a.attisdropped and a.attnum > 0
                     and a.attname in ('client_id', 'conversation_id', 'identity', 'channel_user_id', 'wa_id', 'to_wa_id',
                                       'phone', 'email', 'client_email', 'to_email'))
  ), contract as (select * from customer_erasure_contract()),
  in_scope as (
    select t from reach union select t from suspects
    union select tbl from contract where match is not null or action in ('receipts', 'redact')
  ), problems as (
    select 1 as k, format('%s is a table this erasure does not know: decide what it means for a customer (erase-buyer''s RULES and customer_erasure_contract()) before anything is erased', s.t) as p
      from in_scope s where s.t in (select t from tables) and s.t not in (select tbl from contract)
    union all
    select 2, format('the contract names %s, and this database has no such table', c.tbl)
      from contract c where c.tbl not in (select t from tables)
    union all
    select 3, format('%s.%s → %s.%s is a link this erasure was not written for', l.child, l.col, l.parent, l.pcol)
      from live l where not exists (select 1 from customer_erasure_edges() x
                                     where x.child = l.child and x.col = l.col and x.parent = l.parent and x.pcol = l.pcol)
    union all
    select 4, format('%s → %s is a key over %s columns; the erasure follows single-column keys only', l.child, l.parent, l.width)
      from live l where l.width <> 1
    union all
    select 5, format('the link %s.%s → %s.%s is written into this erasure, and this database does not have it', x.child, x.col, x.parent, x.pcol)
      from customer_erasure_edges() x
     where not exists (select 1 from live l where l.child = x.child and l.col = x.col and l.parent = x.parent and l.pcol = x.pcol)
  )
  select coalesce(array_agg(p order by k, p), '{}') from problems
$$;
revoke all on function customer_erasure_problems() from public;

-- ── Small pieces, the tool's own, in SQL ───────────────────────────────────
-- JavaScript's String.prototype.trim, which the tool uses: every Unicode space.
create or replace function erasure_trim(p text) returns text
language sql immutable as $$
  select regexp_replace(coalesce(p, ''),
    '^[\t\n\v\f\r    -     　﻿]+|[\t\n\v\f\r    -     　﻿]+$', '', 'g')
$$;

-- erase-buyer's normalizeIdentity: a wa_id is digits, an address lower-case.
create or replace function erasure_identity(p_channel text, p_raw text) returns text
language sql immutable as $$
  select case
    when erasure_trim(p_raw) = '' then null
    when p_channel = 'email' then lower(erasure_trim(p_raw))
    when p_channel = 'whatsapp' then nullif(regexp_replace(
           regexp_replace(erasure_trim(p_raw), '[\t\n\v\f\r    -     　﻿\-().‐-―]', '', 'g'),
           '^(\+|00)', ''), '')
    else erasure_trim(p_raw)
  end
$$;

-- Does any string anywhere in this JSON equal one of the values? (Values,
-- never keys; exact, never a substring.)
create or replace function erasure_mentions(p_doc jsonb, p_values text[]) returns boolean
language sql immutable as $$
  select coalesce(p_doc is not null and exists (
    select 1 from jsonb_path_query(p_doc, 'strict $.**') v
     where jsonb_typeof(v) = 'string' and (v #>> '{}') = any(p_values)), false)
$$;

-- erase-buyer's pruneMentions: every array element that names them goes,
-- innermost first; the rest — another customer's own record — stays.
create or replace function erasure_prune(p_doc jsonb, p_values text[]) returns jsonb
language plpgsql immutable as $$
declare
  v_out jsonb;
  v_el jsonb;
  v_key text;
begin
  if jsonb_typeof(p_doc) = 'array' then
    v_out := '[]'::jsonb;
    for v_el in select value from jsonb_array_elements(p_doc) loop
      v_el := erasure_prune(v_el, p_values);
      if not erasure_mentions(v_el, p_values) then v_out := v_out || jsonb_build_array(v_el); end if;
    end loop;
    return v_out;
  elsif jsonb_typeof(p_doc) = 'object' then
    v_out := '{}'::jsonb;
    for v_key, v_el in select key, value from jsonb_each(p_doc) loop
      v_out := v_out || jsonb_build_object(v_key, erasure_prune(v_el, p_values));
    end loop;
    return v_out;
  end if;
  return p_doc;
end $$;

-- A count joins the map only when there is something to count.
create or replace function erasure_add(p_map jsonb, p_table text, p_n bigint) returns jsonb
language sql immutable as $$
  select case when coalesce(p_n, 0) > 0 then p_map || jsonb_build_object(p_table, p_n) else p_map end
$$;

-- "messages 6, turns 3" — the closed request's note, as the tool wrote it.
create or replace function erasure_list(p_map jsonb) returns text
language sql immutable as $$
  select string_agg(key || ' ' || value, ', ' order by key collate "C")
    from jsonb_each_text(coalesce(p_map, '{}'::jsonb)) where value::bigint > 0
$$;

create or replace function erasure_total(p_map jsonb) returns bigint
language sql immutable as $$
  select coalesce(sum(value::bigint), 0)::bigint from jsonb_each_text(coalesce(p_map, '{}'::jsonb))
$$;

-- A statement that touched other than what was planned stops everything.
create or replace function erasure_expect(p_table text, p_got bigint, p_want bigint) returns void
language plpgsql immutable as $$
begin
  if p_got is distinct from p_want then
    raise exception 'erasure: % touched % rows where the plan said %. Rolled back; nothing changed.', p_table, p_got, p_want
      using errcode = 'NE010';
  end if;
end $$;

revoke all on function erasure_trim(text), erasure_identity(text, text), erasure_mentions(jsonb, text[]),
  erasure_prune(jsonb, text[]), erasure_add(jsonb, text, bigint), erasure_list(jsonb), erasure_total(jsonb),
  erasure_expect(text, bigint, bigint) from public;

-- ── One customer, erased ───────────────────────────────────────────────────
-- THE CONTRACT (erase-buyer's header says it in words):
--   ERASED — their identity on every channel; every message to or from them,
--     with the raw webhook receipts and the queued work that carries it;
--     drafts, quotes, sample requests, signals, events, notes, hand-offs,
--     proof links, outbound rows, fragments, conversation state; outreach
--     contacts, consent and sequence rows for their identities, and their
--     number on the pilot allowlist; their photo; their conversations —
--     EXCEPT one an order points at.
--   KEPT — orders, their items, prices and status history, detached from
--     contact details; the conversation an order points at, as an empty closed
--     shell; their `clients` row with every personal field cleared, so the
--     order and the request point at someone who is nobody; suppressions, so
--     they are never written to again; the request.
--   CHANGED IN PLACE — the owner's spot-check verdict loses its link and its
--     correction; an audit entry that named them loses its detail; another
--     customer's batched webhook receipt loses their part.
-- Returns {erased, kept, changed}: rows per table. `p_restored` is the replay
-- on a restored copy, where no worker runs: a job left 'active' by the backup
-- is not a worker busy with them.
create or replace function erase_customer_rows(p_business uuid, p_client uuid, p_request uuid, p_restored boolean default false)
returns jsonb
language plpgsql volatile security definer set search_path = public set row_security = off as $$
declare
  v_problems text[];
  v_ch text[]; v_val text[];
  v_vals text[];
  v_hook_ch text[]; v_hook_val text[];
  v_mp_ch text[]; v_mp_val text[];
  v_phones text[];
  v_conv uuid[]; v_keep_conv uuid[]; v_gone_conv uuid[];
  v_msg uuid[]; v_quote uuid[]; v_keep_quote uuid[]; v_gone_quote uuid[];
  v_turn text[]; v_draft uuid[]; v_frag text[]; v_out uuid[]; v_trans bigint[]; v_promised uuid[];
  v_proof text[]; v_order uuid[]; v_ou uuid[]; v_ec uuid[]; v_prop uuid[]; v_req uuid[]; v_ask uuid[];
  v_enr uuid[]; v_send_e uuid[]; v_send_p integer[];
  v_cc uuid[]; v_faces uuid[]; v_answered bigint;
  v_contacts uuid[]; v_consent uuid[]; v_allow uuid[]; v_supp uuid[];
  v_state uuid[]; v_signal uuid[]; v_event bigint[]; v_note uuid[]; v_esc uuid[]; v_handoff uuid[];
  v_sample uuid[]; v_deliv uuid[]; v_repair uuid[]; v_shadow text[]; v_spot uuid[];
  v_inbound text[]; v_sent text[]; v_their text[];
  v_own_ev text[]; v_audit bigint[];
  v_jobs uuid[] := '{}'; v_active bigint := 0;
  v_marker jsonb;
  v_row record;
  v_doc jsonb;
  v_pruned bigint := 0;
  v_bad text;
  v_n bigint;
  v_erased jsonb := '{}'; v_kept jsonb := '{}'; v_changed jsonb := '{}';
begin
  -- EVERY ROW OR NOTHING. A role row security filters would see a customer
  -- with nothing to erase and call it done; `row_security = off` above turns
  -- any filtering this did not foresee into an error instead.
  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception 'erasure: the role % is subject to row-level security, so it cannot see every row it must erase', current_user
      using errcode = 'NE009';
  end if;
  v_problems := customer_erasure_problems();
  if cardinality(v_problems) > 0 then
    raise exception 'erasure: %', array_to_string(v_problems, ' · ') using errcode = 'NE001';
  end if;
  if not exists (select 1 from clients where id = p_client and business_id = p_business) then
    raise exception 'erasure: no customer % in this workspace', p_client using errcode = 'NE004';
  end if;

  -- Nothing writes about them while this runs: each conversation's own lock
  -- (the one every turn takes, and takes first), then their row and their
  -- conversations. A conversation begun in between is locked too.
  perform set_config('lock_timeout', '15s', true);
  v_conv := array(select id from conversations where client_id = p_client order by id);
  perform pg_advisory_xact_lock(hashtextextended(x::text, 0)) from unnest(v_conv) x;
  perform 1 from clients where id = p_client for update;
  perform 1 from conversations where client_id = p_client for update;
  perform pg_advisory_xact_lock(hashtextextended(c.id::text, 0))
     from conversations c where c.client_id = p_client and not (c.id = any(v_conv));
  v_conv := array(select id from conversations where client_id = p_client order by id);
  if exists (select 1 from conversations where id = any(v_conv) and business_id <> p_business) then
    raise exception 'erasure: a conversation of this customer belongs to another workspace' using errcode = 'NE005';
  end if;

  -- Who they are, in this business: four places, as erase-buyer reads them.
  select coalesce(array_agg(s.ch order by s.ch, s.val), '{}'), coalesce(array_agg(s.val order by s.ch, s.val), '{}')
    into v_ch, v_val
    from (
      select distinct r.channel as ch, x.val
        from (
          select cc.channel, cc.channel_user_id as identity from client_channels cc where cc.client_id = p_client
          union select 'whatsapp', phone from clients where id = p_client and phone is not null
          union select 'email', email from clients where id = p_client and email is not null
          union select 'email', client_email from orders where client_id = p_client and business_id = p_business and client_email is not null
          union select v.channel, o.to_wa_id from outbound_messages o join conversations v on v.id = o.conversation_id
                 where v.client_id = p_client and v.business_id = p_business and o.to_wa_id is not null
        ) r
        cross join lateral (values (erasure_identity(r.channel, r.identity)), (erasure_trim(r.identity))) x(val)
       where x.val is not null and x.val <> ''
    ) s;
  v_vals := array(select distinct x from unnest(v_val) x);
  select coalesce(array_agg(c), '{}'), coalesce(array_agg(v), '{}') into v_hook_ch, v_hook_val
    from unnest(v_ch, v_val) i(c, v) where c in ('whatsapp', 'instagram', 'messenger');
  select coalesce(array_agg(c), '{}'), coalesce(array_agg(v), '{}') into v_mp_ch, v_mp_val
    from unnest(v_ch, v_val) i(c, v) where c in ('whatsapp', 'email');
  v_phones := array(select distinct v from unnest(v_ch, v_val) i(c, v) where c = 'whatsapp');

  -- Everything reached from them, down every key.
  v_msg := array(select id from messages where conversation_id = any(v_conv));
  v_quote := array(select id from quotes where conversation_id = any(v_conv));
  v_turn := array(select message_id from turns where conversation_id = any(v_conv) or quote_id = any(v_quote));
  v_draft := array(select id from drafts where conversation_id = any(v_conv) or turn_message_id = any(v_turn));
  v_frag := array(select id from message_fragments where conversation_id = any(v_conv) or processed_in = any(v_turn));
  v_out := array(select id from outbound_messages where conversation_id = any(v_conv));
  v_trans := array(select id from outbound_transitions where outbound_id = any(v_out));
  v_promised := array(select id from promised_dates where conversation_id = any(v_conv) or outbound_id = any(v_out));
  v_proof := array(select token from quote_proofs where conversation_id = any(v_conv) or quote_id = any(v_quote));
  v_order := array(select id from orders where client_id = p_client or conversation_id = any(v_conv) or quote_id = any(v_quote));
  v_ou := array(select id from order_updates where order_id = any(v_order));
  v_ec := array(select id from email_confirmations where order_id = any(v_order));
  v_req := array(select id from deletion_requests where client_id = p_client);
  v_prop := array(select id from order_proposals where client_id = p_client or conversation_id = any(v_conv) or order_id = any(v_order));
  v_ask := array(select id from deletion_asks where client_id = p_client or conversation_id = any(v_conv)
                   or message_id = any(v_msg) or request_id = any(v_req));
  -- An enrolment found by who they are, not by a key, may have started a
  -- thread under another customer row: the enrolment is theirs; that thread is not.
  v_enr := array(select x.id from sequence_enrollments x
                  where x.conversation_id = any(v_conv)
                     or (x.business_id = p_business and exists (
                          select 1 from unnest(v_mp_ch, v_mp_val) i(c, v)
                           where i.c = x.channel and (x.identity = i.v or (i.c = 'email' and lower(x.identity) = i.v)))));
  select coalesce(array_agg(enrollment_id order by enrollment_id, position), '{}'), coalesce(array_agg(position order by enrollment_id, position), '{}')
    into v_send_e, v_send_p
    from sequence_sends where enrollment_id = any(v_enr) or outbound_id = any(v_out);
  v_cc := array(select id from client_channels where client_id = p_client);
  v_faces := array(select client_id from client_faces where client_id = p_client);
  select count(*) into v_answered from customers_answered where client_id = p_client;
  v_state := array(select id from conversation_state where conversation_id = any(v_conv));
  v_signal := array(select id from conversation_signals where conversation_id = any(v_conv));
  v_event := array(select id from conversation_events where conversation_id = any(v_conv));
  v_note := array(select id from conversation_notes where conversation_id = any(v_conv));
  v_esc := array(select id from escalation_events where conversation_id = any(v_conv));
  v_handoff := array(select id from handoffs where conversation_id = any(v_conv));
  v_sample := array(select id from sample_requests where conversation_id = any(v_conv));
  v_deliv := array(select id from deliveries where conversation_id = any(v_conv));
  v_repair := array(select id from repairs where conversation_id = any(v_conv));
  v_shadow := array(select message_id from shadow.turn_decisions where conversation_id = any(v_conv));
  v_spot := array(select id from spot_checks where conversation_id = any(v_conv));
  -- Found by who they are, and only in this business: the same person in
  -- another business is that business's customer, left exactly as they are.
  v_contacts := array(select x.id from contacts x where x.business_id = p_business and exists (
                  select 1 from unnest(v_mp_ch, v_mp_val) i(c, v) where i.c = x.channel and (x.identity = i.v or (i.c = 'email' and lower(x.identity) = i.v))));
  v_consent := array(select x.id from contact_consent x where x.business_id = p_business and exists (
                  select 1 from unnest(v_mp_ch, v_mp_val) i(c, v) where i.c = x.channel and (x.identity = i.v or (i.c = 'email' and lower(x.identity) = i.v))));
  v_supp := array(select x.id from suppressions x where x.business_id = p_business and exists (
                  select 1 from unnest(v_mp_ch, v_mp_val) i(c, v) where i.c = x.channel and (x.identity = i.v or (i.c = 'email' and lower(x.identity) = i.v))));
  v_allow := array(select id from pilot_allowlist where business_id = p_business and phone = any(v_phones));

  -- Nothing reached may belong to another business, name another customer, or
  -- — reached down a key other than the conversation's — sit in another
  -- customer's conversation. That is inconsistent data, and inconsistent data
  -- is a person's to decide, not this function's.
  select string_agg(t, ', ') into v_bad from (
    select 'quotes' as t where exists (select 1 from quotes where id = any(v_quote) and business_id <> p_business)
    union all select 'turns' where exists (select 1 from turns where message_id = any(v_turn) and (business_id <> p_business or not conversation_id = any(v_conv)))
    union all select 'drafts' where exists (select 1 from drafts where id = any(v_draft) and (business_id <> p_business or not conversation_id = any(v_conv)))
    union all select 'message_fragments' where exists (select 1 from message_fragments where id = any(v_frag) and (business_id <> p_business or not conversation_id = any(v_conv)))
    union all select 'outbound_messages' where exists (select 1 from outbound_messages where id = any(v_out) and business_id <> p_business)
    union all select 'outbound_transitions' where exists (select 1 from outbound_transitions where id = any(v_trans) and business_id <> p_business)
    union all select 'promised_dates' where exists (select 1 from promised_dates where id = any(v_promised) and (business_id <> p_business or not conversation_id = any(v_conv)))
    union all select 'quote_proofs' where exists (select 1 from quote_proofs where token = any(v_proof) and (business_id <> p_business or (conversation_id is not null and not conversation_id = any(v_conv))))
    union all select 'orders' where exists (select 1 from orders where id = any(v_order) and (business_id <> p_business or client_id <> p_client or not conversation_id = any(v_conv)))
    union all select 'order_updates' where exists (select 1 from order_updates where id = any(v_ou) and business_id <> p_business)
    union all select 'order_proposals' where exists (select 1 from order_proposals where id = any(v_prop) and (business_id <> p_business or client_id <> p_client or not conversation_id = any(v_conv)))
    union all select 'deletion_requests' where exists (select 1 from deletion_requests where id = any(v_req) and business_id <> p_business)
    union all select 'deletion_asks' where exists (select 1 from deletion_asks where id = any(v_ask) and (business_id <> p_business or client_id <> p_client or not conversation_id = any(v_conv)))
    union all select 'sequence_enrollments' where exists (select 1 from sequence_enrollments where id = any(v_enr) and business_id <> p_business)
    union all select 'sequence_sends' where exists (select 1 from sequence_sends where enrollment_id = any(v_enr) and business_id <> p_business)
    union all select 'client_faces' where exists (select 1 from client_faces where client_id = p_client and business_id <> p_business)
    union all select 'customers_answered' where exists (select 1 from customers_answered where client_id = p_client and business_id <> p_business)
    union all select 'conversation_signals' where exists (select 1 from conversation_signals where id = any(v_signal) and business_id <> p_business)
    union all select 'conversation_events' where exists (select 1 from conversation_events where id = any(v_event) and business_id <> p_business)
    union all select 'conversation_notes' where exists (select 1 from conversation_notes where id = any(v_note) and business_id <> p_business)
    union all select 'escalation_events' where exists (select 1 from escalation_events where id = any(v_esc) and business_id <> p_business)
    union all select 'handoffs' where exists (select 1 from handoffs where id = any(v_handoff) and business_id <> p_business)
    union all select 'sample_requests' where exists (select 1 from sample_requests where id = any(v_sample) and business_id <> p_business)
    union all select 'deliveries' where exists (select 1 from deliveries where id = any(v_deliv) and business_id <> p_business)
    union all select 'repairs' where exists (select 1 from repairs where id = any(v_repair) and business_id <> p_business)
    union all select 'spot_checks' where exists (select 1 from spot_checks where id = any(v_spot) and business_id <> p_business)
    union all select 'shadow.turn_decisions' where exists (select 1 from shadow.turn_decisions where message_id = any(v_shadow) and business_id is distinct from p_business)
  ) s;
  if v_bad is not null then
    raise exception 'erasure: rows reached from this customer belong to another customer or workspace (%); nothing was changed', v_bad
      using errcode = 'NE005';
  end if;

  -- What a kept row needs, stays: the conversation and the quote an order
  -- points at, and the conversation such a quote was given in.
  v_keep_quote := array(select distinct quote_id from orders where id = any(v_order) and quote_id = any(v_quote));
  v_keep_conv := array(select distinct x from (
      select conversation_id as x from orders where id = any(v_order)
      union select conversation_id from quotes where id = any(v_keep_quote)) s where x = any(v_conv));
  v_gone_quote := array(select x from unnest(v_quote) x where not x = any(v_keep_quote));
  v_gone_conv := array(select x from unnest(v_conv) x where not x = any(v_keep_conv));

  -- Queued and finished work for their conversations. One a worker holds now
  -- cannot be taken from under it: try again in a minute.
  if to_regclass('pgboss.job') is not null and cardinality(v_conv) > 0 then
    execute $q$select coalesce(array_agg(id) filter (where $3 or state::text <> 'active'), '{}'),
                      count(*) filter (where state::text = 'active')
                 from pgboss.job where data->>'businessId' = $1 and data->>'conversationId' = any($2)$q$
      into v_jobs, v_active
      using p_business::text, array(select x::text from unnest(v_conv) x), p_restored;
    if v_active > 0 and not p_restored then
      raise exception 'erasure: a worker is handling this customer right now (% job(s)); nothing was changed — try again in a minute', v_active
        using errcode = 'NE002';
    end if;
  end if;

  -- ── The links that are not keys ──────────────────────────────────────────
  v_marker := jsonb_build_object('erased', 'buyer deletion request', 'request', p_request);
  v_inbound := array(select distinct external_id from messages where id = any(v_msg) and external_id is not null);
  v_sent := array(select distinct provider_message_id from outbound_messages where id = any(v_out) and provider_message_id is not null);
  -- A webhook receipt is THEIRS when its conversation key names them, or it
  -- is the receipt of a message they sent, or a status of one sent to them.
  v_own_ev := array(select e.id from channel_events e
                     where e.business_id = p_business and (
                           exists (select 1 from unnest(v_hook_ch, v_hook_val) i(c, v)
                                    where split_part(e.conversation_external_id, ':', 1) = i.c
                                      and split_part(e.conversation_external_id, ':', 2) = i.v)
                        or e.id = any(v_inbound)
                        or split_part(e.id, '#', 1) = any(v_sent)));
  -- The audit trail: an entry that names them or one of their rows keeps who
  -- did what and when, and loses what it said.
  v_their := array(select distinct x from (
      select unnest(v_vals) as x union select unnest(v_conv)::text union select unnest(v_msg)::text
      union select unnest(v_out)::text union select unnest(v_draft)::text) s);
  v_audit := array(select distinct a.id from channel_audit a
                    cross join lateral jsonb_path_query(a.detail, 'strict $.**') v
                    where a.business_id = p_business and a.detail is not null
                      and jsonb_typeof(v) = 'string' and (v #>> '{}') = any(v_their));

  -- Links cut and trails cleaned first, while what they point at still exists.
  update spot_checks set conversation_id = null, correction = null where id = any(v_spot);
  get diagnostics v_n = row_count; perform erasure_expect('spot_checks', v_n, cardinality(v_spot));
  v_changed := erasure_add(v_changed, 'spot_checks', v_n);

  if cardinality(v_vals) > 0 then
    -- Another customer's batched receipt that also carried them: their part out.
    for v_row in select e.id, e.payload from channel_events e
                  where e.business_id = p_business and not (e.id = any(v_own_ev))
                    and e.payload::text like any (array(select '%"' || x || '"%' from unnest(v_vals) x))
    loop
      if erasure_mentions(v_row.payload, v_vals) then
        v_doc := erasure_prune(v_row.payload, v_vals);
        if erasure_mentions(v_doc, v_vals) then v_doc := v_marker; end if;
        update channel_events set payload = v_doc where id = v_row.id;
        v_pruned := v_pruned + 1;
      end if;
    end loop;
  end if;

  update channel_audit set detail = v_marker where id = any(v_audit);
  get diagnostics v_n = row_count; perform erasure_expect('channel_audit', v_n, cardinality(v_audit));
  v_changed := erasure_add(v_changed, 'channel_audit', v_n);
  v_changed := erasure_add(v_changed, 'channel_events', v_pruned);

  -- ── Deepest first, so no delete waits on a key ───────────────────────────
  if cardinality(v_jobs) > 0 then
    execute 'delete from pgboss.job where id = any($1)' using v_jobs;
    get diagnostics v_n = row_count; perform erasure_expect('pgboss.job', v_n, cardinality(v_jobs));
    v_erased := erasure_add(v_erased, 'pgboss.job', v_n);
  end if;
  delete from sequence_sends where (enrollment_id, position) in (select * from unnest(v_send_e, v_send_p));
  get diagnostics v_n = row_count; perform erasure_expect('sequence_sends', v_n, cardinality(v_send_e));
  v_erased := erasure_add(v_erased, 'sequence_sends', v_n);
  delete from promised_dates where id = any(v_promised);
  get diagnostics v_n = row_count; perform erasure_expect('promised_dates', v_n, cardinality(v_promised));
  v_erased := erasure_add(v_erased, 'promised_dates', v_n);
  delete from outbound_transitions where id = any(v_trans);
  get diagnostics v_n = row_count; perform erasure_expect('outbound_transitions', v_n, cardinality(v_trans));
  v_erased := erasure_add(v_erased, 'outbound_transitions', v_n);
  delete from message_fragments where id = any(v_frag);
  get diagnostics v_n = row_count; perform erasure_expect('message_fragments', v_n, cardinality(v_frag));
  v_erased := erasure_add(v_erased, 'message_fragments', v_n);
  delete from drafts where id = any(v_draft);
  get diagnostics v_n = row_count; perform erasure_expect('drafts', v_n, cardinality(v_draft));
  v_erased := erasure_add(v_erased, 'drafts', v_n);
  delete from deletion_asks where id = any(v_ask);
  get diagnostics v_n = row_count; perform erasure_expect('deletion_asks', v_n, cardinality(v_ask));
  v_erased := erasure_add(v_erased, 'deletion_asks', v_n);
  delete from order_proposals where id = any(v_prop);
  get diagnostics v_n = row_count; perform erasure_expect('order_proposals', v_n, cardinality(v_prop));
  v_erased := erasure_add(v_erased, 'order_proposals', v_n);
  delete from quote_proofs where token = any(v_proof);
  get diagnostics v_n = row_count; perform erasure_expect('quote_proofs', v_n, cardinality(v_proof));
  v_erased := erasure_add(v_erased, 'quote_proofs', v_n);
  delete from turns where message_id = any(v_turn);
  get diagnostics v_n = row_count; perform erasure_expect('turns', v_n, cardinality(v_turn));
  v_erased := erasure_add(v_erased, 'turns', v_n);
  delete from messages where id = any(v_msg);
  get diagnostics v_n = row_count; perform erasure_expect('messages', v_n, cardinality(v_msg));
  v_erased := erasure_add(v_erased, 'messages', v_n);
  delete from outbound_messages where id = any(v_out);
  get diagnostics v_n = row_count; perform erasure_expect('outbound_messages', v_n, cardinality(v_out));
  v_erased := erasure_add(v_erased, 'outbound_messages', v_n);
  delete from sequence_enrollments where id = any(v_enr);
  get diagnostics v_n = row_count; perform erasure_expect('sequence_enrollments', v_n, cardinality(v_enr));
  v_erased := erasure_add(v_erased, 'sequence_enrollments', v_n);
  delete from conversation_state where id = any(v_state);
  get diagnostics v_n = row_count; perform erasure_expect('conversation_state', v_n, cardinality(v_state));
  v_erased := erasure_add(v_erased, 'conversation_state', v_n);
  delete from conversation_signals where id = any(v_signal);
  get diagnostics v_n = row_count; perform erasure_expect('conversation_signals', v_n, cardinality(v_signal));
  v_erased := erasure_add(v_erased, 'conversation_signals', v_n);
  delete from conversation_events where id = any(v_event);
  get diagnostics v_n = row_count; perform erasure_expect('conversation_events', v_n, cardinality(v_event));
  v_erased := erasure_add(v_erased, 'conversation_events', v_n);
  delete from conversation_notes where id = any(v_note);
  get diagnostics v_n = row_count; perform erasure_expect('conversation_notes', v_n, cardinality(v_note));
  v_erased := erasure_add(v_erased, 'conversation_notes', v_n);
  delete from escalation_events where id = any(v_esc);
  get diagnostics v_n = row_count; perform erasure_expect('escalation_events', v_n, cardinality(v_esc));
  v_erased := erasure_add(v_erased, 'escalation_events', v_n);
  delete from handoffs where id = any(v_handoff);
  get diagnostics v_n = row_count; perform erasure_expect('handoffs', v_n, cardinality(v_handoff));
  v_erased := erasure_add(v_erased, 'handoffs', v_n);
  delete from sample_requests where id = any(v_sample);
  get diagnostics v_n = row_count; perform erasure_expect('sample_requests', v_n, cardinality(v_sample));
  v_erased := erasure_add(v_erased, 'sample_requests', v_n);
  delete from deliveries where id = any(v_deliv);
  get diagnostics v_n = row_count; perform erasure_expect('deliveries', v_n, cardinality(v_deliv));
  v_erased := erasure_add(v_erased, 'deliveries', v_n);
  delete from repairs where id = any(v_repair);
  get diagnostics v_n = row_count; perform erasure_expect('repairs', v_n, cardinality(v_repair));
  v_erased := erasure_add(v_erased, 'repairs', v_n);
  delete from shadow.turn_decisions where message_id = any(v_shadow);
  get diagnostics v_n = row_count; perform erasure_expect('shadow.turn_decisions', v_n, cardinality(v_shadow));
  v_erased := erasure_add(v_erased, 'shadow.turn_decisions', v_n);
  delete from quotes where id = any(v_gone_quote);
  get diagnostics v_n = row_count; perform erasure_expect('quotes', v_n, cardinality(v_gone_quote));
  v_erased := erasure_add(v_erased, 'quotes', v_n);
  delete from conversations where id = any(v_gone_conv);
  get diagnostics v_n = row_count; perform erasure_expect('conversations', v_n, cardinality(v_gone_conv));
  v_erased := erasure_add(v_erased, 'conversations', v_n);
  delete from client_channels where id = any(v_cc);
  get diagnostics v_n = row_count; perform erasure_expect('client_channels', v_n, cardinality(v_cc));
  v_erased := erasure_add(v_erased, 'client_channels', v_n);
  delete from client_faces where client_id = any(v_faces);
  get diagnostics v_n = row_count; perform erasure_expect('client_faces', v_n, cardinality(v_faces));
  v_erased := erasure_add(v_erased, 'client_faces', v_n);
  delete from customers_answered where client_id = p_client;
  get diagnostics v_n = row_count; perform erasure_expect('customers_answered', v_n, v_answered);
  v_erased := erasure_add(v_erased, 'customers_answered', v_n);
  delete from contacts where id = any(v_contacts);
  get diagnostics v_n = row_count; perform erasure_expect('contacts', v_n, cardinality(v_contacts));
  v_erased := erasure_add(v_erased, 'contacts', v_n);
  delete from contact_consent where id = any(v_consent);
  get diagnostics v_n = row_count; perform erasure_expect('contact_consent', v_n, cardinality(v_consent));
  v_erased := erasure_add(v_erased, 'contact_consent', v_n);
  delete from pilot_allowlist where id = any(v_allow);
  get diagnostics v_n = row_count; perform erasure_expect('pilot_allowlist', v_n, cardinality(v_allow));
  v_erased := erasure_add(v_erased, 'pilot_allowlist', v_n);
  delete from channel_events where id = any(v_own_ev);
  get diagnostics v_n = row_count; perform erasure_expect('channel_events', v_n, cardinality(v_own_ev));
  v_erased := erasure_add(v_erased, 'channel_events', v_n);

  -- ── What stays, emptied ──────────────────────────────────────────────────
  -- Only a row that still holds something is written: a second request for
  -- someone already erased changes nothing but the request.
  update clients set display_name = null, email = null, phone = null, country = null,
                     preferred_language = null, notes = null
   where id = p_client
     and (display_name is not null or email is not null or phone is not null or country is not null
          or preferred_language is not null or notes is not null);
  v_kept := erasure_add(v_kept, 'clients', 1);
  update conversations
     set assigned_to = null, assigned_at = null, ai_disclosed_at = null, ai_disclosure_delivered_at = null,
         owner_unsent_reply = null, owner_unsent_reply_at = null,
         is_active = false, phase = 'closed', closed_at = coalesce(closed_at, now())
   where id = any(v_keep_conv)
     and (assigned_to is not null or assigned_at is not null or ai_disclosed_at is not null
          or ai_disclosure_delivered_at is not null or owner_unsent_reply is not null or owner_unsent_reply_at is not null
          or is_active or phase <> 'closed' or closed_at is null);
  v_kept := erasure_add(v_kept, 'conversations', cardinality(v_keep_conv));
  v_kept := erasure_add(v_kept, 'quotes', cardinality(v_keep_quote));
  update orders set client_email = null, shipping_address = null, notes = null
   where id = any(v_order) and (client_email is not null or shipping_address is not null or notes is not null);
  v_kept := erasure_add(v_kept, 'orders', cardinality(v_order));
  v_kept := erasure_add(v_kept, 'order_updates', cardinality(v_ou));
  update email_confirmations set to_email = '', subject = null, body_html = null
   where id = any(v_ec) and (to_email <> '' or subject is not null or body_html is not null);
  v_kept := erasure_add(v_kept, 'email_confirmations', cardinality(v_ec));
  v_kept := erasure_add(v_kept, 'deletion_requests', cardinality(v_req));
  v_kept := erasure_add(v_kept, 'suppressions', cardinality(v_supp));

  -- Nothing of theirs may be left but what the contract keeps.
  if exists (select 1 from messages where conversation_id = any(v_conv))
     or exists (select 1 from client_channels where client_id = p_client)
     or exists (select 1 from conversations where client_id = p_client and not (id = any(v_keep_conv)))
     or exists (select 1 from conversations where id = any(v_keep_conv) and (is_active or phase <> 'closed' or owner_unsent_reply is not null))
     or exists (select 1 from orders where id = any(v_order) and (client_email is not null or shipping_address is not null or notes is not null))
     or exists (select 1 from clients where id = p_client and (display_name is not null or email is not null or phone is not null or notes is not null)) then
    raise exception 'erasure: rows of this customer are still there after the erasure. Rolled back; nothing changed.' using errcode = 'NE010';
  end if;

  return jsonb_build_object('erased', v_erased, 'kept', v_kept, 'changed', v_changed,
                            'conversations', cardinality(v_conv), 'shells', cardinality(v_keep_conv));
end $$;
revoke all on function erase_customer_rows(uuid, uuid, uuid, boolean) from public;

-- "erased 12: messages 6, … · kept 4: orders 1, … · carried out …"
create or replace function erasure_note(p_counts jsonb, p_via text) returns text
language sql immutable as $$
  select format('erased %s: %s · kept %s: %s%s · %s',
    erasure_total(p_counts->'erased'), coalesce(erasure_list(p_counts->'erased'), 'nothing'),
    erasure_total(p_counts->'kept'), coalesce(erasure_list(p_counts->'kept'), 'nothing'),
    case when erasure_total(p_counts->'changed') > 0
         then format(' · changed in place %s: %s', erasure_total(p_counts->'changed'), erasure_list(p_counts->'changed'))
         else '' end,
    case p_via when 'operator' then 'carried out with tools/erase-buyer.mjs'
               when 'restore' then 'carried out again on a restored copy (tools/replay-erasures.mjs)'
               else 'deleted by the owner in Nomi' end)
$$;
revoke all on function erasure_note(jsonb, text) from public;

-- An open customer request of this business, carried out: the erasure, the
-- request closed as done, the ledger, the audit trail. One transaction.
create or replace function carry_out_customer_request(p_business uuid, p_request uuid, p_by text, p_via text)
returns jsonb
language plpgsql volatile security definer set search_path = public set row_security = off as $$
declare
  v_req record;
  v_counts jsonb;
  v_ledger uuid;
begin
  if p_via not in ('owner', 'operator') then
    raise exception 'erasure: % is not a way to carry out a request', p_via using errcode = 'NE004';
  end if;
  if length(btrim(coalesce(p_by, ''))) not between 1 and 120 then
    raise exception 'erasure: say who is carrying it out' using errcode = 'NE004';
  end if;
  select * into v_req from deletion_requests where id = p_request for update;
  if not found or v_req.business_id <> p_business then
    raise exception 'erasure: no deletion request % in this workspace', p_request using errcode = 'NE004';
  end if;
  if v_req.scope <> 'buyer' then
    raise exception 'erasure: request % is for a whole workspace, not a customer', p_request using errcode = 'NE004';
  end if;
  if v_req.state <> 'open' then
    raise exception 'erasure: request % is %, not open', p_request, v_req.state using errcode = 'NE004';
  end if;

  v_counts := erase_customer_rows(p_business, v_req.client_id, p_request, false);

  update deletion_requests
     set state = 'done', closed_at = now(), closed_by = p_by, closed_note = erasure_note(v_counts, p_via)
   where id = p_request and state = 'open';
  insert into erasure_ledger (kind, business_id, customer_id, request_id, via, by_who, counts)
  values ('customer', p_business, v_req.client_id, p_request, p_via, btrim(p_by), v_counts)
  returning id into v_ledger;
  -- The business's own trail says it happened, and which request — never whose.
  insert into channel_audit (business_id, channel_id, action, actor, detail)
  values (p_business, null, 'customer_erased', btrim(p_by),
          jsonb_build_object('request', p_request, 'erasure', v_ledger));
  return v_counts || jsonb_build_object('ledger', v_ledger, 'request', p_request, 'client', v_req.client_id);
end $$;
revoke all on function carry_out_customer_request(uuid, uuid, text, text) from public;

-- Is this the owner of the current workspace? 'owner' is a session signed
-- before people existed (M47): the installation's own access code.
create or replace function erasure_owner_of(p_business uuid, p_by text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(p_by = 'owner', false)
      or exists (select 1 from people p where p.id::text = p_by and p.business_id = p_business
                    and p.is_owner and p.archived_at is null)
$$;
revoke all on function erasure_owner_of(uuid, text) from public;

-- THE APP'S DOOR, for one customer. The workspace is the transaction's
-- (current_business_id()), never an argument, so no other business's customer
-- can be reached through it; the request must be open and this workspace's;
-- the person acting must be its owner.
create or replace function erase_customer(p_request uuid, p_by text) returns jsonb
language plpgsql volatile security definer set search_path = public set row_security = off as $$
declare
  v_business uuid := current_business_id();
begin
  if v_business is null then
    raise exception 'erasure: no workspace in this transaction' using errcode = 'NE003';
  end if;
  if not erasure_owner_of(v_business, p_by) then
    raise exception 'erasure: only the owner of this workspace deletes a customer''s data' using errcode = 'NE003';
  end if;
  if exists (select 1 from businesses where id = v_business and practice_of is not null) then
    raise exception 'erasure: a practice copy is erased by Start over, not here' using errcode = 'NE006';
  end if;
  return carry_out_customer_request(v_business, p_request, p_by, 'owner');
end $$;
revoke all on function erase_customer(uuid, text) from public;
grant execute on function erase_customer(uuid, text) to nomi_app;

-- ── A workspace, erased ────────────────────────────────────────────────────
-- tools/erase-workspace.mjs's contract, as it was: every public table with a
-- business_id, deepest first; the tables that hang off a parent; the shadow
-- decisions; queued jobs; the business's own flags; the invitation it came
-- from unlinked, never deleted; the business last. Read from the live schema
-- each time, so a table added next month is found the day it exists. The
-- ledger is never in it.
create or replace function workspace_erasure_steps()
returns table (ord integer, label text, count_sql text, run_sql text)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
  with recursive fk as (
    select con.conrelid::regclass::text as child, con.confrelid::regclass::text as parent
      from pg_constraint con join pg_namespace n on n.oid = con.connamespace
     where con.contype = 'f' and n.nspname = 'public'
  ), d(t, depth) as (
    select 'businesses'::text, 0
    union all
    select fk.child, d.depth + 1 from fk join d on fk.parent = d.t
     where fk.child <> d.t and d.depth < 12
  ), depth as (
    select t, max(depth) as depth from d group by t
  ), direct as (
    select c.relname::text as t
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'business_id' and not a.attisdropped)
       and c.relname not in ('businesses', 'ops_flags', 'erasure_ledger')
  ), indirect(t, cond) as (values
    ('messages', 'conversation_id in (select id from conversations where business_id = $1)'),
    ('conversation_state', 'conversation_id in (select id from conversations where business_id = $1)'),
    ('client_channels', 'client_id in (select id from clients where business_id = $1)'),
    ('price_tiers', 'product_id in (select id from products where business_id = $1)'),
    ('product_aliases', 'product_id in (select id from products where business_id = $1)'),
    ('product_images', 'product_id in (select id from products where business_id = $1)'),
    ('email_confirmations', 'order_id in (select id from orders where business_id = $1)'),
    ('login_codes', 'login_id in (select id from logins where business_id = $1)')
  ), steps as (
    select x.t, coalesce(i.cond, 'business_id = $1') as cond, coalesce(dp.depth, 0) as depth
      from (select t from direct union select t from indirect where to_regclass(indirect.t) is not null) x
      left join indirect i on i.t = x.t
      left join depth dp on dp.t = x.t
  ), ordered as (
    select (row_number() over (order by s.depth desc, s.t collate "C"))::integer as ord, s.t,
           format('select count(*) from %I where %s', s.t, s.cond) as count_sql,
           format('delete from %I where %s', s.t, s.cond) as run_sql
      from steps s
  )
  select o.ord, o.t, o.count_sql, o.run_sql from ordered o
  union all
  -- Outside public, with no key to follow: what the service would have said to each customer.
  select 100000, 'shadow.turn_decisions', 'select count(*) from shadow.turn_decisions where business_id = $1',
         'delete from shadow.turn_decisions where business_id = $1'
   where to_regclass('shadow.turn_decisions') is not null
  union all
  -- Queued and finished work: an inbound job carries a customer's own words.
  select 100001, 'pgboss.job', $s$select count(*) from pgboss.job where data->>'businessId' = $1::text and state::text <> 'active'$s$,
         $s$delete from pgboss.job where data->>'businessId' = $1::text and state::text <> 'active'$s$
   where to_regclass('pgboss.job') is not null
  union all
  -- A flag this business owns goes; a global one (business_id null) stays.
  select 100002, 'ops_flags', 'select count(*) from ops_flags where business_id = $1', 'delete from ops_flags where business_id = $1'
  union all
  -- The operator's record of who was let in: unlinked, never deleted.
  select 100003, 'signup_invites (unlinked, not deleted)', 'select count(*) from signup_invites where used_by = $1',
         'update signup_invites set used_by = null where used_by = $1'
   where to_regclass('signup_invites') is not null
  union all
  select 100004, 'businesses', 'select count(*) from businesses where id = $1', 'delete from businesses where id = $1'
  order by 1;
end $$;
revoke all on function workspace_erasure_steps() from public;

-- The workspace and its practice copies (0086), first the copies. `p_dry`
-- counts and changes nothing — the operator's dry run and the real run read
-- the same steps.
create or replace function erase_workspace_rows(p_business uuid, p_dry boolean, p_restored boolean default false)
returns jsonb
language plpgsql volatile security definer set search_path = public set row_security = off as $$
declare
  v_ids uuid[];
  v_id uuid;
  v_step record;
  v_n bigint;
  v_active bigint := 0;
  v_tables jsonb := '{}';
  v_copies jsonb := '{}';
begin
  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception 'erasure: the role % is subject to row-level security, so it cannot see every row it must erase', current_user
      using errcode = 'NE009';
  end if;
  if not exists (select 1 from businesses where id = p_business) then
    raise exception 'erasure: no workspace %', p_business using errcode = 'NE004';
  end if;
  v_ids := array(select id from businesses where practice_of = p_business order by id) || p_business;
  if not p_dry then
    perform set_config('lock_timeout', '15s', true);
    -- Every insert that names the business waits on this, then finds it gone.
    perform 1 from businesses where id = any(v_ids) for update;
  end if;
  if to_regclass('pgboss.job') is not null and not p_restored and not p_dry then
    execute $q$select count(*) from pgboss.job where data->>'businessId' = any($1) and state::text = 'active'$q$
      into v_active using array(select x::text from unnest(v_ids) x);
    if v_active > 0 then
      raise exception 'erasure: a worker is running % job(s) for this workspace right now; nothing was changed — try again in a minute', v_active
        using errcode = 'NE002';
    end if;
  end if;
  if p_restored and to_regclass('pgboss.job') is not null and not p_dry then
    execute $q$delete from pgboss.job where data->>'businessId' = any($1) and state::text = 'active'$q$
      using array(select x::text from unnest(v_ids) x);
  end if;
  foreach v_id in array v_ids loop
    for v_step in select * from workspace_erasure_steps() loop
      if p_dry then
        execute v_step.count_sql into v_n using v_id;
      else
        execute v_step.run_sql using v_id;
        get diagnostics v_n = row_count;
      end if;
      if v_id = p_business then
        v_tables := erasure_add(v_tables, v_step.label, coalesce((v_tables->>v_step.label)::bigint, 0) + v_n);
      else
        v_copies := erasure_add(v_copies, v_step.label, coalesce((v_copies->>v_step.label)::bigint, 0) + v_n);
      end if;
    end loop;
  end loop;
  if not p_dry and exists (select 1 from businesses where id = any(v_ids)) then
    raise exception 'erasure: the workspace is still there after the erasure. Rolled back; nothing changed.' using errcode = 'NE010';
  end if;
  return jsonb_build_object('tables', v_tables, 'copies', v_copies,
                            'rows', erasure_total(v_tables) + erasure_total(v_copies));
end $$;
revoke all on function erase_workspace_rows(uuid, boolean, boolean) from public;

-- The operator's run: under the workspace's open request (the authorisation
-- the owner gave in the product before closing was a button).
create or replace function carry_out_workspace_erasure(p_business uuid, p_request uuid, p_by text)
returns jsonb
language plpgsql volatile security definer set search_path = public set row_security = off as $$
declare
  v_counts jsonb;
  v_ledger uuid;
begin
  if length(btrim(coalesce(p_by, ''))) not between 1 and 120 then
    raise exception 'erasure: say who is carrying it out' using errcode = 'NE004';
  end if;
  if not exists (select 1 from deletion_requests where id = p_request and business_id = p_business
                    and scope = 'workspace' and state = 'open') then
    raise exception 'erasure: no open workspace deletion request % for this workspace', p_request using errcode = 'NE004';
  end if;
  v_counts := erase_workspace_rows(p_business, false);
  insert into erasure_ledger (kind, business_id, request_id, via, by_who, counts)
  values ('workspace', p_business, p_request, 'operator', btrim(p_by), v_counts)
  returning id into v_ledger;
  return v_counts || jsonb_build_object('ledger', v_ledger);
end $$;
revoke all on function carry_out_workspace_erasure(uuid, uuid, text) from public;

-- THE APP'S DOOR, for the whole workspace. The current workspace only; its
-- owner only, who typed its name; never a practice copy, the old shared
-- sandbox, or the installation's own workspace (opened with the access code:
-- 'owner' — the app also refuses PILOT_BUSINESS_ID by its own id); never while
-- a paid plan runs, which closing here would not cancel.
create or replace function close_workspace(p_typed_name text, p_by text) returns jsonb
language plpgsql volatile security definer set search_path = public set row_security = off as $$
declare
  v_business uuid := current_business_id();
  v_biz record;
  v_counts jsonb;
  v_ledger uuid;
begin
  if v_business is null then
    raise exception 'erasure: no workspace in this transaction' using errcode = 'NE003';
  end if;
  if not erasure_owner_of(v_business, p_by) then
    raise exception 'erasure: only the owner closes a workspace' using errcode = 'NE003';
  end if;
  select id, name, practice_of into v_biz from businesses where id = v_business for update;
  if not found then
    raise exception 'erasure: no workspace %', v_business using errcode = 'NE004';
  end if;
  if p_by = 'owner' or v_biz.practice_of is not null or v_business = '5a4d0000-0000-4000-8000-0000000000b1'::uuid then
    raise exception 'erasure: this workspace cannot be closed here' using errcode = 'NE006';
  end if;
  if lower(erasure_trim(p_typed_name)) is distinct from lower(erasure_trim(v_biz.name)) then
    raise exception 'erasure: the name typed is not this workspace''s' using errcode = 'NE007';
  end if;
  if exists (select 1 from workspace_billing w where w.business_id = v_business
                and w.stripe_subscription_id is not null and w.status in ('trial', 'active', 'past_due')) then
    raise exception 'erasure: a paid plan is running; cancel it first' using errcode = 'NE008';
  end if;
  v_counts := erase_workspace_rows(v_business, false);
  insert into erasure_ledger (kind, business_id, via, by_who, counts)
  values ('workspace', v_business, 'owner', btrim(p_by), v_counts)
  returning id into v_ledger;
  return v_counts || jsonb_build_object('ledger', v_ledger);
end $$;
revoke all on function close_workspace(text, text) from public;
grant execute on function close_workspace(text, text) to nomi_app;

-- ── After a restore ────────────────────────────────────────────────────────
-- Which erasures this copy's own ledger lists that do not hold in it. Empty in
-- every consistent copy: the ledger row is written in the erasure's own
-- transaction. The restore drill reports it (tools/verify-restore.sh).
create or replace function erasure_ledger_unkept()
returns table (ledger_id uuid, kind text, business_id uuid, customer_id uuid, reason text)
language sql stable security definer set search_path = public set row_security = off as $$
  select l.id, l.kind, l.business_id, l.customer_id, 'the workspace is still there'
    from erasure_ledger l
   where l.kind = 'workspace' and exists (select 1 from businesses b where b.id = l.business_id)
  union all
  select l.id, l.kind, l.business_id, l.customer_id, 'their name or contact details are still there'
    from erasure_ledger l join clients c on c.id = l.customer_id
   where l.kind = 'customer'
     and (c.display_name is not null or c.email is not null or c.phone is not null or c.notes is not null)
  union all
  select l.id, l.kind, l.business_id, l.customer_id, 'an identity of theirs is still there'
    from erasure_ledger l
   where l.kind = 'customer' and exists (select 1 from client_channels cc where cc.client_id = l.customer_id)
  union all
  select l.id, l.kind, l.business_id, l.customer_id, 'a message of theirs is still there'
    from erasure_ledger l
   where l.kind = 'customer'
     and exists (select 1 from messages m join conversations v on v.id = m.conversation_id where v.client_id = l.customer_id)
$$;
revoke all on function erasure_ledger_unkept() from public;

-- ── RET, retired ───────────────────────────────────────────────────────────
-- The functions that listed and claimed the 90-day warnings go; 0116 itself is
-- never edited. `retention_notices` stays (it may hold history; the workspace
-- erasure takes a workspace's rows with it).
drop function if exists claim_retention_warnings();
drop function if exists retention_workspaces();
-- The switch: cleared if anyone ever set it, and impossible to set again.
update ops_flags set cleared_at = now() where flag = 'retention' and cleared_at is null;
alter table ops_flags drop constraint if exists ops_flags_retention_retired;
alter table ops_flags add constraint ops_flags_retention_retired
  check (flag <> 'retention' or cleared_at is not null);
-- Its daily job: no schedule, and nothing queued.
do $$
begin
  if to_regclass('pgboss.schedule') is not null then
    delete from pgboss.schedule where name = 'ops.retention';
  end if;
  if to_regclass('pgboss.job') is not null then
    delete from pgboss.job where name = 'ops.retention' and state::text in ('created', 'retry');
  end if;
end $$;

insert into _migrations (version, name) values (126, 'erasure')
on conflict (version) do nothing;
