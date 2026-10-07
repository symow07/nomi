-- ---------------------------------------------------------------------------
-- 0130 — THE ADVISOR'S MEMORY: STORAGE AND DELETION (docs/ADVISOR-MEMORY.md; the owner's decisions of
-- 2026-10-07). Nothing here is reachable from a page yet; the page comes with the next migration's PR.
--
--   · The owner switches advisor history on for the workspace first (D1, `businesses.advisor_history_at`,
--     set only through `advisor_history_set`, owner only); then each person decides for themselves
--     (`advisor_consents`, append-only). NOTHING is kept for a person whose newest consent is not
--     `granted`, or in a workspace whose switch is off: `advisor_consent_gate` refuses the row.
--   · A person's history is theirs alone (D2): row security by business AND person
--     (`current_person_id()`, the transaction's `app.person_id`). The owner cannot read it — only delete
--     all of it, unread (`advisor_forget`, owner, scope all).
--   · The content is sealed by the app with ADVISOR_KEY (D8): the database holds ciphertext and the key's
--     fingerprint (`sealed_with`), never the words.
--   · Every deletion goes through the erasure system that exists: `advisor_forget` (withdrawal, one
--     conversation, the owner unread), `advisor_history_set(false)` (the workspace switched off),
--     `advisor_expire()` (12 months unopened, D5), a person removed from the team (trigger), a customer's
--     erasure (`erase_customer_rows`, below, and erase-buyer's RULES), a workspace closed (every table with
--     a business_id, already). Each writes `erasure_ledger` — kind `advisor`, ids and counts only — so a
--     restore replays it (tools/replay-erasures.mjs).
--   · The app role still holds no DELETE on any table (tests/integration/grants.test.ts).
-- ---------------------------------------------------------------------------

-- ── Who is asking ──────────────────────────────────────────────────────────
create or replace function current_person_id() returns uuid
language sql stable as $$ select nullif(current_setting('app.person_id', true), '')::uuid $$;

-- ── D1: the workspace's switch ─────────────────────────────────────────────
alter table businesses add column if not exists advisor_history_at timestamptz;
alter table businesses add column if not exists advisor_history_by text;

-- ── Each person's own decision, append-only ────────────────────────────────
create table if not exists advisor_consents (
  id             uuid primary key default gen_random_uuid(),
  seq            bigint generated always as identity,
  business_id    uuid not null references businesses(id) on delete cascade,
  person_id      uuid not null references people(id) on delete cascade,
  event          text not null check (event in ('granted', 'refused', 'withdrawn')),
  -- The first 12 hex of the sha256 of the English sentence that was asked (as TERMS_VERSION).
  wording_version text not null check (wording_version ~ '^[0-9a-f]{12}$'),
  locale         text not null check (locale in ('en', 'zh', 'ar', 'es', 'fr')),
  at             timestamptz not null default now()
);
create index if not exists advisor_consents_person on advisor_consents (business_id, person_id, seq desc);

-- ── A conversation, and its turns ──────────────────────────────────────────
create table if not exists advisor_threads (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references businesses(id) on delete cascade,
  person_id        uuid not null references people(id) on delete cascade,
  started_at       timestamptz not null default now(),
  last_turn_at     timestamptz not null default now(),
  -- D5: a conversation not opened for 12 months is deleted.
  opened_at        timestamptz not null default now(),
  title_ciphertext text not null,
  sealed_with      text not null check (sealed_with ~ '^[0-9a-f]{12}$'),
  unique (id, business_id, person_id)
);
create index if not exists advisor_threads_person on advisor_threads (business_id, person_id, last_turn_at desc);
create index if not exists advisor_threads_opened on advisor_threads (opened_at);

create table if not exists advisor_turns (
  id                  uuid primary key default gen_random_uuid(),
  thread_id           uuid not null,
  business_id         uuid not null references businesses(id) on delete cascade,
  person_id           uuid not null references people(id) on delete cascade,
  asked_at            timestamptz not null default now(),
  question_ciphertext text not null,
  -- The catalogue entry it was resolved to (src/advisor/catalogue.ts), or 'unknown'.
  entry_id            text not null check (entry_id ~ '^([A-I][0-9]{1,2}n?|unknown)$'),
  params_ciphertext   text not null,
  answer_kind         text not null check (answer_kind in ('fact', 'none', 'notStored', 'opinion', 'unknown', 'failed')),
  answer_ciphertext   text not null,
  facts_ciphertext    text not null,
  door                text check (door is null or door ~ '^/app/'),
  provider            text,
  model               text,
  phrased             boolean not null default false,
  sealed_with         text not null check (sealed_with ~ '^[0-9a-f]{12}$'),
  -- A turn belongs to a conversation of the same person, in the same workspace.
  foreign key (thread_id, business_id, person_id) references advisor_threads (id, business_id, person_id) on delete cascade
);
create index if not exists advisor_turns_thread on advisor_turns (thread_id, asked_at);

-- Every customer a turn named: how a customer's erasure finds the turns that name them.
create table if not exists advisor_turn_subjects (
  turn_id     uuid not null references advisor_turns(id) on delete cascade,
  client_id   uuid not null references clients(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  primary key (turn_id, client_id)
);
create index if not exists advisor_turn_subjects_client on advisor_turn_subjects (client_id);

-- ── Row security: the business AND the person ──────────────────────────────
alter table advisor_consents enable row level security;
alter table advisor_threads enable row level security;
alter table advisor_turns enable row level security;
alter table advisor_turn_subjects enable row level security;
drop policy if exists advisor_consents_own on advisor_consents;
create policy advisor_consents_own on advisor_consents
  using (business_id = current_business_id() and person_id = current_person_id())
  with check (business_id = current_business_id() and person_id = current_person_id());
drop policy if exists advisor_threads_own on advisor_threads;
create policy advisor_threads_own on advisor_threads
  using (business_id = current_business_id() and person_id = current_person_id())
  with check (business_id = current_business_id() and person_id = current_person_id());
drop policy if exists advisor_turns_own on advisor_turns;
create policy advisor_turns_own on advisor_turns
  using (business_id = current_business_id() and person_id = current_person_id())
  with check (business_id = current_business_id() and person_id = current_person_id());
drop policy if exists advisor_turn_subjects_own on advisor_turn_subjects;
create policy advisor_turn_subjects_own on advisor_turn_subjects
  using (business_id = current_business_id() and exists (select 1 from advisor_turns t where t.id = turn_id))
  with check (business_id = current_business_id() and exists (select 1 from advisor_turns t where t.id = turn_id));

-- The app role: read and write its own rows, append consents, never delete anything, never rewrite a consent.
revoke all on advisor_consents, advisor_threads, advisor_turns, advisor_turn_subjects from public, nomi_app;
grant select, insert on advisor_consents to nomi_app;
grant select, insert on advisor_threads to nomi_app;
grant update (last_turn_at, opened_at, title_ciphertext, sealed_with) on advisor_threads to nomi_app;
grant select, insert on advisor_turns to nomi_app;
grant update (question_ciphertext, params_ciphertext, answer_ciphertext, facts_ciphertext, sealed_with) on advisor_turns to nomi_app;
grant select, insert on advisor_turn_subjects to nomi_app;

-- ── The gate: nothing kept without the switch and a granted consent ────────
create or replace function advisor_may_keep(p_business uuid, p_person uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from businesses b where b.id = p_business and b.advisor_history_at is not null)
     and exists (select 1 from people p where p.id = p_person and p.business_id = p_business and p.archived_at is null)
     and coalesce((select c.event = 'granted' from advisor_consents c
                     where c.business_id = p_business and c.person_id = p_person
                     order by c.seq desc limit 1), false)
$$;
revoke all on function advisor_may_keep(uuid, uuid) from public;
grant execute on function advisor_may_keep(uuid, uuid) to nomi_app;

create or replace function advisor_consent_gate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not advisor_may_keep(new.business_id, new.person_id) then
    raise exception 'advisor history: nothing is kept for % without the workspace''s switch and their own consent', new.person_id
      using errcode = 'NE020';
  end if;
  return new;
end $$;
drop trigger if exists advisor_threads_consent on advisor_threads;
create trigger advisor_threads_consent before insert on advisor_threads for each row execute function advisor_consent_gate();
drop trigger if exists advisor_turns_consent on advisor_turns;
create trigger advisor_turns_consent before insert on advisor_turns for each row execute function advisor_consent_gate();

-- ── The ledger learns the advisor's deletions ──────────────────────────────
alter table erasure_ledger add column if not exists person_id uuid;
alter table erasure_ledger add column if not exists thread_ids uuid[];
alter table erasure_ledger drop constraint if exists erasure_ledger_kind_check;
alter table erasure_ledger add constraint erasure_ledger_kind_check check (kind in ('customer', 'workspace', 'advisor'));
alter table erasure_ledger drop constraint if exists erasure_ledger_via_check;
-- 'person': someone deleting their own; 'retention': 12 months unopened.
alter table erasure_ledger add constraint erasure_ledger_via_check check (via in ('owner', 'operator', 'restore', 'person', 'retention'));
alter table erasure_ledger drop constraint if exists erasure_ledger_advisor;
alter table erasure_ledger add constraint erasure_ledger_advisor check ((kind = 'advisor') = (thread_ids is not null));

-- Delete these conversations, whole, and write the ledger. Shared by every advisor deletion below.
create or replace function advisor_erase_threads(p_business uuid, p_person uuid, p_threads uuid[], p_via text, p_by text)
returns jsonb
language plpgsql volatile security definer set search_path = public set row_security = off as $$
declare
  v_links bigint; v_turns bigint; v_n bigint; v_counts jsonb;
begin
  select count(*) into v_links from advisor_turn_subjects s join advisor_turns t on t.id = s.turn_id where t.thread_id = any(p_threads);
  select count(*) into v_turns from advisor_turns where thread_id = any(p_threads);
  delete from advisor_turn_subjects s using advisor_turns t where t.id = s.turn_id and t.thread_id = any(p_threads);
  get diagnostics v_n = row_count; perform erasure_expect('advisor_turn_subjects', v_n, v_links);
  delete from advisor_turns where thread_id = any(p_threads);
  get diagnostics v_n = row_count; perform erasure_expect('advisor_turns', v_n, v_turns);
  delete from advisor_threads where id = any(p_threads) and business_id = p_business;
  get diagnostics v_n = row_count; perform erasure_expect('advisor_threads', v_n, cardinality(p_threads));
  v_counts := jsonb_build_object('erased',
    erasure_add(erasure_add(erasure_add('{}'::jsonb, 'advisor_turn_subjects', v_links), 'advisor_turns', v_turns),
                'advisor_threads', cardinality(p_threads)::bigint));
  if cardinality(p_threads) > 0 then
    insert into erasure_ledger (kind, business_id, person_id, thread_ids, via, by_who, counts)
    values ('advisor', p_business, p_person, p_threads, p_via, p_by, v_counts);
  end if;
  return v_counts;
end $$;
revoke all on function advisor_erase_threads(uuid, uuid, uuid[], text, text) from public;

-- THE APP'S DOOR (D2 and every person's own): the person themselves, one conversation or all of it; or the
-- owner, all of a team member's history, unread. The workspace and the caller are the transaction's, never
-- arguments. Returns counts, never content.
create or replace function advisor_forget(p_person uuid, p_thread uuid) returns jsonb
language plpgsql volatile security definer set search_path = public set row_security = off as $$
declare
  v_business uuid := current_business_id();
  v_caller uuid := current_person_id();
  v_owner boolean;
  v_threads uuid[];
begin
  if v_business is null or v_caller is null then
    raise exception 'advisor history: no workspace or person in this transaction' using errcode = 'NE021';
  end if;
  if not exists (select 1 from people where id = p_person and business_id = v_business) then
    raise exception 'advisor history: no such person in this workspace' using errcode = 'NE021';
  end if;
  v_owner := exists (select 1 from people where id = v_caller and business_id = v_business and is_owner and archived_at is null);
  if v_caller <> p_person and not (v_owner and p_thread is null) then
    raise exception 'advisor history: only its person deletes a conversation; the owner deletes a person''s history only whole, unread'
      using errcode = 'NE022';
  end if;
  v_threads := array(select id from advisor_threads
                      where business_id = v_business and person_id = p_person and (p_thread is null or id = p_thread) order by id);
  if p_thread is not null and cardinality(v_threads) = 0 then
    raise exception 'advisor history: no such conversation' using errcode = 'NE021';
  end if;
  return advisor_erase_threads(v_business, p_person, v_threads,
    case when v_caller = p_person then 'person' else 'owner' end, v_caller::text);
end $$;
revoke all on function advisor_forget(uuid, uuid) from public;
grant execute on function advisor_forget(uuid, uuid) to nomi_app;

-- D1: the owner's switch. Off deletes everyone's history in the workspace, then stops anything being kept.
create or replace function advisor_history_set(p_on boolean) returns jsonb
language plpgsql volatile security definer set search_path = public set row_security = off as $$
declare
  v_business uuid := current_business_id();
  v_caller uuid := current_person_id();
  v_threads uuid[];
  v_counts jsonb := jsonb_build_object('erased', '{}'::jsonb);
begin
  if v_business is null or v_caller is null
     or not exists (select 1 from people where id = v_caller and business_id = v_business and is_owner and archived_at is null) then
    raise exception 'advisor history: only the owner turns it on or off for the workspace' using errcode = 'NE022';
  end if;
  if p_on then
    update businesses set advisor_history_at = coalesce(advisor_history_at, now()), advisor_history_by = v_caller::text where id = v_business;
  else
    v_threads := array(select id from advisor_threads where business_id = v_business order by id);
    v_counts := advisor_erase_threads(v_business, null, v_threads, 'owner', v_caller::text);
    update businesses set advisor_history_at = null, advisor_history_by = v_caller::text where id = v_business;
  end if;
  return v_counts;
end $$;
revoke all on function advisor_history_set(boolean) from public;
grant execute on function advisor_history_set(boolean) to nomi_app;

-- D5: every conversation not opened for 12 months, in every workspace; one ledger line per workspace.
create or replace function advisor_expire() returns bigint
language plpgsql volatile security definer set search_path = public set row_security = off as $$
declare
  v_row record;
  v_total bigint := 0;
begin
  for v_row in
    select business_id, array_agg(id order by id) as threads from advisor_threads
     where opened_at < now() - interval '12 months' group by business_id
  loop
    perform advisor_erase_threads(v_row.business_id, null, v_row.threads, 'retention', 'retention');
    v_total := v_total + cardinality(v_row.threads);
  end loop;
  return v_total;
end $$;
revoke all on function advisor_expire() from public;
grant execute on function advisor_expire() to nomi_app;

-- A person removed from the team: their history goes with them, however they were removed.
create or replace function advisor_person_removed() returns trigger
language plpgsql security definer set search_path = public set row_security = off as $$
declare
  v_threads uuid[];
begin
  if new.archived_at is not null and old.archived_at is null then
    v_threads := array(select id from advisor_threads where business_id = new.business_id and person_id = new.id order by id);
    perform advisor_erase_threads(new.business_id, new.id, v_threads, 'owner', 'team-removal');
  end if;
  return new;
end $$;
drop trigger if exists people_advisor_removed on people;
create trigger people_advisor_removed after update of archived_at on people for each row execute function advisor_person_removed();

-- The keys the history is sealed with, counted — never opened (a rotation's progress; tools/rekey.mjs).
create or replace function advisor_seal_census() returns table (sealed_with text, rows bigint)
language sql stable security definer set search_path = public set row_security = off as $$
  select s, count(*) from (select sealed_with as s from advisor_threads union all select sealed_with from advisor_turns) x group by s order by s
$$;
revoke all on function advisor_seal_census() from public;
grant execute on function advisor_seal_census() to nomi_app;

-- ── A customer's erasure reaches the advisor ───────────────────────────────
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
    ('login_codes', 'unrelated', null, null, null, null),
    -- 0130 — the advisor's history: a turn that names them goes whole, its other links with it, and a
    -- conversation it leaves empty goes too (erase_customer_rows, below).
    ('advisor_turn_subjects', 'erase', null, null, null, null),
    ('advisor_turns', 'erase', null, null, null, null),
    ('advisor_threads', 'erase', null, null, null, null)
$$;
revoke all on function customer_erasure_contract() from public;

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
    ('sequence_sends', 'enrollment_id', 'sequence_enrollments', 'id'),
    -- 0130 — the advisor's link to each customer a turn named.
    ('advisor_turn_subjects', 'client_id', 'clients', 'id')
$$;
revoke all on function customer_erasure_edges() from public;

-- The customer erasure (0126) keeps its body; a wrapper takes its name. Before it runs, every advisor turn
-- that names the customer goes whole — with its links to any other customer it named — and a conversation
-- left with no turn goes too. Counted, checked against what was planned, and added to the erasure's own
-- counts, so the closed request, the ledger and erase-buyer's plan all say the same.
do $$ begin
  if not exists (select 1 from pg_proc where proname = 'erase_customer_rows_core') then
    alter function erase_customer_rows(uuid, uuid, uuid, boolean) rename to erase_customer_rows_core;
  end if;
end $$;
revoke all on function erase_customer_rows_core(uuid, uuid, uuid, boolean) from public;

create or replace function erase_customer_rows(p_business uuid, p_client uuid, p_request uuid, p_restored boolean default false)
returns jsonb
language plpgsql volatile security definer set search_path = public set row_security = off as $$
declare
  v_problems text[];
  v_turns uuid[];
  v_threads uuid[];
  v_links bigint;
  v_n bigint;
  v_counts jsonb;
begin
  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception 'erasure: the role % is subject to row-level security, so it cannot see every row it must erase', current_user
      using errcode = 'NE009';
  end if;
  v_problems := customer_erasure_problems();
  if cardinality(v_problems) > 0 then
    raise exception 'erasure: %', array_to_string(v_problems, ' · ') using errcode = 'NE001';
  end if;
  v_turns := array(select distinct turn_id from advisor_turn_subjects where client_id = p_client and business_id = p_business order by 1);
  select count(*) into v_links from advisor_turn_subjects where turn_id = any(v_turns);
  v_threads := array(select t.id from advisor_threads t
                      where t.id in (select thread_id from advisor_turns where id = any(v_turns))
                        and not exists (select 1 from advisor_turns u where u.thread_id = t.id and not (u.id = any(v_turns)))
                      order by t.id);
  delete from advisor_turn_subjects where turn_id = any(v_turns);
  get diagnostics v_n = row_count; perform erasure_expect('advisor_turn_subjects', v_n, v_links);
  delete from advisor_turns where id = any(v_turns);
  get diagnostics v_n = row_count; perform erasure_expect('advisor_turns', v_n, cardinality(v_turns)::bigint);
  delete from advisor_threads where id = any(v_threads);
  get diagnostics v_n = row_count; perform erasure_expect('advisor_threads', v_n, cardinality(v_threads)::bigint);
  v_counts := erase_customer_rows_core(p_business, p_client, p_request, p_restored);
  return jsonb_set(v_counts, '{erased}',
    erasure_add(erasure_add(erasure_add(coalesce(v_counts->'erased', '{}'::jsonb), 'advisor_turn_subjects', v_links),
                            'advisor_turns', cardinality(v_turns)::bigint), 'advisor_threads', cardinality(v_threads)::bigint));
end $$;
revoke all on function erase_customer_rows(uuid, uuid, uuid, boolean) from public;

-- ── After a restore: the advisor's deletions hold too ──────────────────────
-- Carry out an advisor ledger line again on a restored copy (tools/replay-erasures.mjs): the conversations it
-- named, whole. The line itself is written back by the tool, by its own id — no new one here.
create or replace function advisor_replay_erasure(p_business uuid, p_threads uuid[]) returns bigint
language plpgsql volatile security definer set search_path = public set row_security = off as $$
declare
  v_n bigint; v_total bigint := 0;
begin
  delete from advisor_turn_subjects s using advisor_turns t
   where t.id = s.turn_id and t.thread_id = any(p_threads) and t.business_id = p_business;
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  delete from advisor_turns where thread_id = any(p_threads) and business_id = p_business;
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  delete from advisor_threads where id = any(p_threads) and business_id = p_business;
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  return v_total;
end $$;
revoke all on function advisor_replay_erasure(uuid, uuid[]) from public;

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
  union all
  -- 0130
  select l.id, l.kind, l.business_id, l.customer_id, 'an advisor turn that names them is still there'
    from erasure_ledger l
   where l.kind = 'customer' and exists (select 1 from advisor_turn_subjects s where s.client_id = l.customer_id)
  union all
  select l.id, l.kind, l.business_id, l.customer_id, 'an advisor conversation it deleted is still there'
    from erasure_ledger l
   where l.kind = 'advisor' and exists (select 1 from advisor_threads t where t.id = any(l.thread_ids))
$$;
revoke all on function erasure_ledger_unkept() from public;
