-- One owner-written follow-up after an unanswered quote. This stores drafts, never sends.
-- Observers are AFTER ROW, fail open, and only write these tables or supersede their own draft.
create table follow_up_rules (
  business_id uuid primary key references businesses(id) on delete cascade,
  enabled boolean not null default false,
  delay_days smallint not null default 2 check (delay_days between 1 and 7),
  wording text not null default '' check (char_length(wording) <= 500),
  enabled_at timestamptz,
  updated_at timestamptz not null default now(),
  check (not enabled or (enabled_at is not null and length(trim(wording)) > 0))
);

-- An accepted quote and the rule as it stood then. A warning has no customer or words.
create table follow_up_observations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  kind text not null check (kind in ('quote', 'warning')),
  client_id uuid references clients(id),
  conversation_id uuid references conversations(id),
  quote_id uuid references quotes(id),
  outbound_id uuid unique references outbound_messages(id),
  episode_message_id uuid references messages(id),
  quoted_at timestamptz,
  delay_days smallint check (delay_days between 1 and 7),
  wording text check (char_length(wording) <= 500),
  processed_at timestamptz,
  diagnostic_code text,
  created_at timestamptz not null default now(),
  check (kind <> 'quote' or (client_id is not null and conversation_id is not null and quote_id is not null
    and outbound_id is not null and quoted_at is not null and delay_days is not null and wording is not null))
);
create index follow_up_observations_pending on follow_up_observations(business_id, quoted_at, id)
  where kind = 'quote' and processed_at is null;
create index follow_up_observations_client on follow_up_observations(client_id);

create table follow_up_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  client_id uuid not null references clients(id),
  conversation_id uuid not null references conversations(id),
  source_quote_id uuid not null references quotes(id),
  source_outbound_id uuid not null references outbound_messages(id),
  episode_message_id uuid references messages(id),
  episode_key uuid not null,
  channel text not null,
  quoted_at timestamptz not null,
  due_at timestamptz not null,
  delay_days smallint not null check (delay_days between 1 and 7),
  wording text not null check (char_length(wording) between 1 and 500),
  state text not null default 'scheduled' check (state in ('scheduled', 'draft', 'window_closed', 'canceled', 'skipped')),
  reason text,
  draft_id uuid unique references drafts(id),
  presented_at timestamptz,
  checked_at timestamptz,
  answered_after_approval boolean not null default false,
  created_at timestamptz not null default now(),
  unique (business_id, client_id, episode_key)
);
create index follow_up_runs_due on follow_up_runs(business_id, due_at, id) where state = 'scheduled';
create index follow_up_runs_sweep on follow_up_runs(business_id, checked_at nulls first, id)
  where state in ('scheduled', 'draft', 'window_closed');
create index follow_up_runs_customer on follow_up_runs(client_id, state);
create index follow_up_runs_conversation on follow_up_runs(conversation_id, created_at desc);

-- The approval and its outbound row are linked inside the existing approval transaction.
-- A matching text in another transaction is never a link. Observer failures never invent one.
create table follow_up_approvals (
  draft_id uuid primary key references drafts(id),
  run_id uuid not null unique references follow_up_runs(id),
  business_id uuid not null references businesses(id) on delete cascade,
  conversation_id uuid not null references conversations(id),
  approval_xid text not null,
  outbound_id uuid unique references outbound_messages(id),
  approved_at timestamptz not null,
  accepted_at timestamptz
);
create index follow_up_approvals_transaction on follow_up_approvals(business_id, conversation_id, approval_xid)
  where outbound_id is null;

-- A single-column FK proves existence, not workspace ownership. Check every customer
-- reference on our own rows, using each parent's primary-key index. The message's
-- workspace belongs to its conversation. Invoker rights retain the caller's RLS.
-- These checks never run on the send-path tables; their AFTER observers still catch
-- every error, so a rejected observation cannot reject the message or approval.
create function check_follow_up_references() returns trigger
language plpgsql set search_path = public as $$
declare ref record; parent_id uuid; same_workspace boolean;
begin
  for ref in select * from (values
    ('follow_up_observations', 'client_id', 'clients'),
    ('follow_up_observations', 'conversation_id', 'conversations'),
    ('follow_up_observations', 'quote_id', 'quotes'),
    ('follow_up_observations', 'outbound_id', 'outbound_messages'),
    ('follow_up_observations', 'episode_message_id', 'messages'),
    ('follow_up_runs', 'client_id', 'clients'),
    ('follow_up_runs', 'conversation_id', 'conversations'),
    ('follow_up_runs', 'source_quote_id', 'quotes'),
    ('follow_up_runs', 'source_outbound_id', 'outbound_messages'),
    ('follow_up_runs', 'episode_message_id', 'messages'),
    ('follow_up_runs', 'draft_id', 'drafts'),
    ('follow_up_approvals', 'draft_id', 'drafts'),
    ('follow_up_approvals', 'run_id', 'follow_up_runs'),
    ('follow_up_approvals', 'conversation_id', 'conversations'),
    ('follow_up_approvals', 'outbound_id', 'outbound_messages')
  ) as refs(tbl, col, parent) where tbl = tg_table_name loop
    parent_id := (to_jsonb(new) ->> ref.col)::uuid;
    if parent_id is null then continue; end if;
    if ref.parent = 'messages' then
      select exists(select 1 from messages m join conversations c on c.id = m.conversation_id
        where m.id = parent_id and c.business_id = new.business_id) into same_workspace;
    else
      execute format('select exists(select 1 from %I where id = $1 and business_id = $2)', ref.parent)
        into same_workspace using parent_id, new.business_id;
    end if;
    if not same_workspace then
      raise exception 'Follow-up reference %.% must belong to its workspace', tg_table_name, ref.col
        using errcode = '23503';
    end if;
  end loop;
  return new;
end $$;
revoke all on function check_follow_up_references() from public;
grant execute on function check_follow_up_references() to nomi_app;
create trigger check_follow_up_observation_references before insert or update of
  business_id, client_id, conversation_id, quote_id, outbound_id, episode_message_id
  on follow_up_observations for each row execute function check_follow_up_references();
create trigger check_follow_up_run_references before insert or update of
  business_id, client_id, conversation_id, source_quote_id, source_outbound_id, episode_message_id, draft_id
  on follow_up_runs for each row execute function check_follow_up_references();
create trigger check_follow_up_approval_references before insert or update of
  business_id, draft_id, run_id, conversation_id, outbound_id
  on follow_up_approvals for each row execute function check_follow_up_references();

-- No accountant reads the sales side. The app never borrows a definer to read another workspace.
do $$ declare t text; begin
  foreach t in array array['follow_up_rules', 'follow_up_observations', 'follow_up_runs', 'follow_up_approvals'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_isolation on %I for all to nomi_app using (business_id = current_business_id()) with check (business_id = current_business_id())', t);
    execute format('create policy not_for_accountants on %I as restrictive for all using (not (select viewer_is_accountant())) with check (not (select viewer_is_accountant()))', t);
    execute format('revoke all on %I from public', t);
    execute format('grant select, insert, update on %I to nomi_app', t);
  end loop;
end $$;

-- Last-resort diagnostics contain only an observer name and SQLSTATE, never customer words.
-- A warning row is best effort too: a broken reader must never cost a message its sent state.
create function follow_up_warning(p_business uuid, p_observer text, p_code text) returns void
language plpgsql volatile set search_path = public as $$
begin
  begin
    lock table follow_up_observations in row exclusive mode nowait;
    perform 1 from businesses where id = p_business for key share nowait;
    insert into follow_up_observations(business_id, kind, diagnostic_code)
      values (p_business, 'warning', p_observer || ':' || p_code);
  exception when others then
    raise warning 'Follow-up observer % skipped (SQLSTATE %); its warning row could not be kept', p_observer, p_code;
  end;
end $$;
revoke all on function follow_up_warning(uuid, text, text) from public;
grant execute on function follow_up_warning(uuid, text, text) to nomi_app;

create function observe_follow_up_quote() returns trigger
language plpgsql volatile set search_path = public as $$
declare r follow_up_rules%rowtype; c conversations%rowtype; m uuid;
begin
  begin
    select * into r from follow_up_rules where business_id = new.business_id and enabled;
    if not found or new.sent_at is null or new.sent_at < r.enabled_at then return new; end if;
    select c0.* into c from conversations c0 join businesses b on b.id = c0.business_id
      where c0.id = new.conversation_id and c0.business_id = new.business_id
        and not c0.owner_testing and b.practice_of is null;
    if not found then return new; end if;
    -- Check every referenced parent without waiting for erasure or another writer.
    perform 1 from businesses where id = new.business_id for key share nowait;
    perform 1 from clients where id = c.client_id for key share nowait;
    perform 1 from conversations where id = c.id for key share nowait;
    perform 1 from quotes where id = new.quote_id and conversation_id = c.id and business_id = new.business_id for key share nowait;
    if not found then return new; end if;
    select ms.id into m from messages ms join conversations cc on cc.id = ms.conversation_id
      where cc.client_id = c.client_id and cc.business_id = new.business_id and ms.direction = 'inbound'
      order by ms.sent_at desc, ms.id desc limit 1;
    if m is not null then perform 1 from messages where id = m for key share nowait; end if;
    lock table follow_up_observations in row exclusive mode nowait;
    insert into follow_up_observations(business_id, kind, client_id, conversation_id, quote_id, outbound_id,
      episode_message_id, quoted_at, delay_days, wording)
    values (new.business_id, 'quote', c.client_id, c.id, new.quote_id, new.id, m, new.sent_at, r.delay_days, r.wording)
    on conflict (outbound_id) do nothing;
  exception when others then
    perform follow_up_warning(new.business_id, TG_NAME, SQLSTATE);
  end;
  return new;
end $$;
create trigger follow_up_quote_insert after insert on outbound_messages for each row
  when (new.status = 'sent' and new.quote_id is not null) execute function observe_follow_up_quote();
create trigger follow_up_quote_sent after update of status on outbound_messages for each row
  when (new.status = 'sent' and old.status is distinct from new.status and new.quote_id is not null)
  execute function observe_follow_up_quote();

create function observe_follow_up_approval() returns trigger
language plpgsql volatile set search_path = public as $$
declare r follow_up_runs%rowtype;
begin
  begin
    select * into r from follow_up_runs where draft_id = new.id;
    if not found then return new; end if;
    -- Key-share is compatible with a run state update; fail rather than wait for its erasure.
    perform 1 from follow_up_runs where id = r.id for key share nowait;
    perform 1 from businesses where id = new.business_id for key share nowait;
    perform 1 from conversations where id = new.conversation_id for key share nowait;
    lock table follow_up_approvals in row exclusive mode nowait;
    insert into follow_up_approvals(draft_id, run_id, business_id, conversation_id, approval_xid, approved_at)
      values (new.id, r.id, new.business_id, new.conversation_id, pg_current_xact_id()::text, new.decided_at)
      on conflict (draft_id) do nothing;
  exception when others then
    perform follow_up_warning(new.business_id, TG_NAME, SQLSTATE);
  end;
  return new;
end $$;
create trigger follow_up_draft_approved after update of status on drafts for each row
  when (old.status = 'pending' and new.status in ('approved', 'edited') and new.capability = 'follow_up')
  execute function observe_follow_up_approval();

create function observe_follow_up_outbound() returns trigger
language plpgsql volatile set search_path = public as $$
declare a follow_up_approvals%rowtype;
begin
  begin
    if TG_OP = 'INSERT' then
      select fa.* into a from follow_up_approvals fa join drafts d on d.id = fa.draft_id
        where fa.business_id = new.business_id and fa.conversation_id = new.conversation_id
          and fa.approval_xid = pg_current_xact_id()::text and fa.outbound_id is null
          and d.sent_text = new.body and d.status in ('approved', 'edited')
        for no key update of fa skip locked;
      if found then
        update follow_up_approvals set outbound_id = new.id,
          accepted_at = case when new.status = 'sent' then new.sent_at else null end where draft_id = a.draft_id;
      end if;
    else
      select * into a from follow_up_approvals where outbound_id = new.id for no key update skip locked;
      if found then update follow_up_approvals set accepted_at = new.sent_at where draft_id = a.draft_id; end if;
    end if;
  exception when others then
    perform follow_up_warning(new.business_id, TG_NAME, SQLSTATE);
  end;
  return new;
end $$;
create trigger follow_up_outbound_link after insert on outbound_messages for each row
  when (new.approved and new.origin = 'employee') execute function observe_follow_up_outbound();
create trigger follow_up_outbound_accepted after update of status on outbound_messages for each row
  when (new.status = 'sent' and old.status is distinct from new.status and new.approved and new.origin = 'employee')
  execute function observe_follow_up_outbound();

create function observe_follow_up_answer() returns trigger
language plpgsql volatile set search_path = public as $$
declare c conversations%rowtype; r follow_up_runs%rowtype; d drafts%rowtype;
begin
  begin
    select * into c from conversations where id = new.conversation_id;
    if not found then return new; end if;
    for r in select * from follow_up_runs where business_id = c.business_id and client_id = c.client_id
      and state in ('scheduled', 'draft', 'window_closed') and new.sent_at >= quoted_at
      for no key update skip locked loop
      if r.draft_id is not null then
        select * into d from drafts where id = r.draft_id for update skip locked;
        if not found then
          -- The owner already holds the draft. Their existing approval wins; do not touch it.
          update follow_up_runs set answered_after_approval = true, reason = 'answer_during_approval' where id = r.id;
          continue;
        elsif d.status in ('approved', 'edited') then
          update follow_up_runs set answered_after_approval = true, reason = 'answer_after_approval' where id = r.id;
          continue;
        elsif d.status = 'pending' then
          update drafts set status = 'superseded' where id = d.id;
        end if;
      end if;
      update follow_up_runs set state = 'canceled', reason = 'customer_answered' where id = r.id;
    end loop;
  exception when others then
    perform follow_up_warning(c.business_id, TG_NAME, SQLSTATE);
  end;
  return new;
end $$;
create trigger follow_up_customer_answer after insert on messages for each row
  when (new.direction = 'inbound') execute function observe_follow_up_answer();

-- The sweep only discovers workspaces here; their rows are read under their own tenant transaction.
create function follow_up_workspaces(p_now timestamptz) returns table(business_id uuid)
language sql stable security definer set search_path = public as $$
  select x.business_id from (
    select business_id, null::timestamptz as checked_at from follow_up_observations
      where kind = 'quote' and processed_at is null and quoted_at <= p_now
    union all select r.business_id, r.checked_at from follow_up_runs r where r.state in ('scheduled', 'window_closed')
      or (r.state = 'draft' and exists(select 1 from drafts d where d.id = r.draft_id and d.status = 'pending'))
  ) x join businesses b on b.id = x.business_id where b.is_active and b.practice_of is null
  group by x.business_id order by min(coalesce(x.checked_at, '-infinity'::timestamptz)), x.business_id
$$;
revoke all on function follow_up_workspaces(timestamptz) from public;
grant execute on function follow_up_workspaces(timestamptz) to nomi_app;

-- Wrap whichever earlier migration is installed; no previous contract is overwritten.
alter function customer_erasure_contract() rename to customer_erasure_contract_before_0234;
create function customer_erasure_contract()
returns table(tbl text, action text, clear text[], blank text[], detach text[], match text)
language sql immutable set search_path = public as $$
  select * from customer_erasure_contract_before_0234()
  union all select t, 'unrelated', null::text[], null::text[], null::text[], null::text
    from unnest(array['follow_up_rules']) t
  union all select t, 'erase', null::text[], null::text[], null::text[], null::text
    from unnest(array['follow_up_observations', 'follow_up_runs', 'follow_up_approvals']) t
$$;
revoke all on function customer_erasure_contract() from public;
revoke all on function customer_erasure_contract_before_0234() from public;

alter function customer_erasure_edges() rename to customer_erasure_edges_before_0234;
create function customer_erasure_edges() returns table(child text, col text, parent text, pcol text)
language sql immutable set search_path = public as $$
  select * from customer_erasure_edges_before_0234()
  union all select 'follow_up_observations', 'client_id', 'clients', 'id'
  union all select 'follow_up_observations', 'conversation_id', 'conversations', 'id'
  union all select 'follow_up_observations', 'quote_id', 'quotes', 'id'
  union all select 'follow_up_observations', 'outbound_id', 'outbound_messages', 'id'
  union all select 'follow_up_observations', 'episode_message_id', 'messages', 'id'
  union all select 'follow_up_runs', 'client_id', 'clients', 'id'
  union all select 'follow_up_runs', 'conversation_id', 'conversations', 'id'
  union all select 'follow_up_runs', 'source_quote_id', 'quotes', 'id'
  union all select 'follow_up_runs', 'source_outbound_id', 'outbound_messages', 'id'
  union all select 'follow_up_runs', 'episode_message_id', 'messages', 'id'
  union all select 'follow_up_runs', 'draft_id', 'drafts', 'id'
  union all select 'follow_up_approvals', 'draft_id', 'drafts', 'id'
  union all select 'follow_up_approvals', 'run_id', 'follow_up_runs', 'id'
  union all select 'follow_up_approvals', 'conversation_id', 'conversations', 'id'
  union all select 'follow_up_approvals', 'outbound_id', 'outbound_messages', 'id'
$$;
revoke all on function customer_erasure_edges() from public;
revoke all on function customer_erasure_edges_before_0234() from public;

alter function erase_customer_rows(uuid, uuid, uuid, boolean) rename to erase_customer_rows_before_0234;
create function erase_customer_rows(p_business uuid, p_client uuid, p_request uuid, p_restored boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = public set row_security = off as $$
declare result jsonb; approvals bigint; runs bigint; observations bigint;
begin
  delete from follow_up_approvals where business_id = p_business and run_id in
    (select id from follow_up_runs where business_id = p_business and client_id = p_client);
  get diagnostics approvals = row_count;
  delete from follow_up_runs where business_id = p_business and client_id = p_client;
  get diagnostics runs = row_count;
  delete from follow_up_observations where business_id = p_business and client_id = p_client;
  get diagnostics observations = row_count;
  result := erase_customer_rows_before_0234(p_business, p_client, p_request, p_restored);
  result := jsonb_set(result, '{changed}', erasure_add(coalesce(result->'changed', '{}'::jsonb), 'follow_up_approvals', approvals));
  result := jsonb_set(result, '{changed}', erasure_add(coalesce(result->'changed', '{}'::jsonb), 'follow_up_runs', runs));
  return jsonb_set(result, '{changed}', erasure_add(coalesce(result->'changed', '{}'::jsonb), 'follow_up_observations', observations));
end $$;
revoke all on function erase_customer_rows(uuid, uuid, uuid, boolean) from public;
revoke all on function erase_customer_rows_before_0234(uuid, uuid, uuid, boolean) from public;

insert into _migrations (version, name) values (234, 'follow_up_drafts') on conflict (version) do nothing;
