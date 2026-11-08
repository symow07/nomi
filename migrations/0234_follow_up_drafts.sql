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
  answered_after_approval boolean not null default false,
  created_at timestamptz not null default now(),
  unique (business_id, client_id, episode_key)
);
create index follow_up_runs_due on follow_up_runs(business_id, due_at, id) where state = 'scheduled';
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
create function follow_up_workspaces() returns table(business_id uuid)
language sql stable security definer set search_path = public as $$
  select distinct x.business_id from (
    select business_id from follow_up_observations where kind = 'quote' and processed_at is null
    union select business_id from follow_up_runs where state in ('scheduled', 'draft')
  ) x join businesses b on b.id = x.business_id where b.is_active and b.practice_of is null
$$;
revoke all on function follow_up_workspaces() from public;
grant execute on function follow_up_workspaces() to nomi_app;

-- Additions to the exact 0231 contract and 0226 edges/erasure definitions.
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
    -- 0224 — a practice photo or voice note hangs off its practice conversation: goes with it.
    ('practice_media', 'erase', null, null, null, null),
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
    ('orders', 'keep', array['client_email','shipping_address','notes','tracking_reference','proforma_token'], null, null, null),
    ('order_updates', 'keep', array['note','tracking_reference'], null, null, null),
    ('email_confirmations', 'keep', array['subject','body_html'], array['to_email'], null, null),
    ('sequence_enrollments', 'erase', null, null, null, 'identity'),
    ('sequence_sends', 'erase', null, null, null, null),
    ('contacts', 'erase', null, null, null, 'identity'),
    ('contact_consent', 'erase', null, null, null, 'identity'),
    ('pilot_allowlist', 'erase', null, null, null, 'phone'),
    ('suppressions', 'keep', array['detail'], null, null, 'identity'),
    ('opt_outs', 'keep-standing', null, null, null, 'any-identity'),
    ('deletion_requests', 'keep', array['subject_note'], null, null, null),
    ('deletion_asks', 'erase', null, null, null, null),
    ('customers_answered', 'erase', null, null, null, null),
    ('order_proposals', 'erase', null, null, null, null),
    ('promised_dates', 'erase', null, null, null, null),
    ('client_faces', 'erase', null, null, null, null),
    ('channel_events', 'receipts', null, null, null, null),
    ('channel_audit', 'redact', null, null, null, null),
    ('logins', 'unrelated', null, null, null, null),
    ('login_codes', 'unrelated', null, null, null, null),
    ('advisor_turn_subjects', 'erase', null, null, null, null),
    ('advisor_turns', 'erase', null, null, null, null),
    ('advisor_threads', 'erase', null, null, null, null),
    -- D19 (0144) — the workspace's own settings and rules.
    ('autonomy_policy', 'unrelated', null, null, null, null),
    ('bundle_rules', 'unrelated', null, null, null, null),
    ('claims_policy', 'unrelated', null, null, null, null),
    ('factory_closures', 'unrelated', null, null, null, null),
    ('forbidden_terms', 'unrelated', null, null, null, null),
    ('negotiation_rules', 'unrelated', null, null, null, null),
    ('onboarding_state', 'unrelated', null, null, null, null),
    ('outreach_settings', 'unrelated', null, null, null, null),
    ('owner_rates', 'unrelated', null, null, null, null),
    ('pricing_policy', 'unrelated', null, null, null, null),
    ('sample_policy', 'unrelated', null, null, null, null),
    ('selling_answers', 'unrelated', null, null, null, null),
    ('substitution_rules', 'unrelated', null, null, null, null),
    ('trade_terms', 'unrelated', null, null, null, null),
    ('tenant_budgets', 'unrelated', null, null, null, null),
    ('assistants', 'unrelated', null, null, null, null),
    -- D19 (0144) — its catalogue and what the owner taught.
    ('products', 'unrelated', null, null, null, null),
    ('product_knowledge', 'unrelated', null, null, null, null),
    ('catalog_imports', 'unrelated', null, null, null, null),
    ('catalog_import_photos', 'unrelated', null, null, null, null),
    ('knowledge_proposals', 'unrelated', null, null, null, null),
    -- D19 (0144) — its channels and connections.
    ('channels', 'unrelated', null, null, null, null),
    ('channel_credentials', 'unrelated', null, null, null, null),
    ('channel_sources', 'unrelated', null, null, null, null),
    ('connector_credentials', 'unrelated', null, null, null, null),
    ('connection_approvals', 'unrelated', null, null, null, null),
    ('mail_accounts', 'unrelated', null, null, null, null),
    ('meta_accounts', 'unrelated', null, null, null, null),
    -- 0215 — a business's own TikTok account and its grant: the business's, no customer in it (a customer's TikTok
    -- handle is a client_channels row, erased as every channel's is).
    ('tiktok_accounts', 'unrelated', null, null, null, null),
    ('whatsapp_accounts', 'unrelated', null, null, null, null),
    ('whatsapp_templates', 'unrelated', null, null, null, null),
    ('sending_domains', 'unrelated', null, null, null, null),
    -- D19 (0144) — the people who work there, and their own records.
    ('people', 'unrelated', null, null, null, null),
    ('agents', 'unrelated', null, null, null, null),
    ('login_setups', 'unrelated', null, null, null, null),
    ('push_subscriptions', 'unrelated', null, null, null, null),
    ('advisor_consents', 'unrelated', null, null, null, null),
    -- D19 (0144) — outreach sequences as written, before anyone is enrolled.
    ('sequences', 'unrelated', null, null, null, null),
    ('sequence_steps', 'unrelated', null, null, null, null),
    -- D19 (0144) — billing, usage and plan.
    ('payments', 'unrelated', null, null, null, null),
    ('stripe_events', 'unrelated', null, null, null, null),
    ('subscriptions', 'unrelated', null, null, null, null),
    ('workspace_billing', 'unrelated', null, null, null, null),
    ('workspace_suspensions', 'unrelated', null, null, null, null),
    ('usage_ledger', 'unrelated', null, null, null, null),
    ('allowance_alerts', 'unrelated', null, null, null, null),
    ('retention_notices', 'unrelated', null, null, null, null),
    -- D19 (0144) — operations: flags, practice counts, the assistant's capability history (counts), the erasure ledger (ids and counts).
    ('ops_flags', 'unrelated', null, null, null, null),
    ('practice_checks', 'unrelated', null, null, null, null),
    ('practice_totals', 'unrelated', null, null, null, null),
    ('capability_events', 'unrelated', null, null, null, null),
    ('erasure_ledger', 'unrelated', null, null, null, null),
    -- 0217 — an operator alert or an account letter that reached nobody, kept until it does: never a customer's.
    ('undelivered_alerts', 'unrelated', null, null, null, null),
    -- D19 (0144) — words the owner or the operator wrote, never linked to a customer: a calendar entry, the pilot's log.
    ('calendar_entries', 'unrelated', null, null, null, null),
    ('pilot_log', 'unrelated', null, null, null, null),
    -- D19 (0144) — a company's public facts, looked up by its domain.
    ('organization_enrichments', 'unrelated', null, null, null, null),
    -- D19 (0144) — errors, with no value they carried (D19: messages stored without quoted values).
    ('app_errors', 'unrelated', null, null, null, null),
    -- D4 (0147) — the record that a waiting deletion request was chased: ids and dates, Nomi's own.
    ('deletion_chases', 'unrelated', null, null, null, null),
    -- Phase 1 (0148) — how the workspace signed up, as the abuse score decided it: the workspace's own, never a
    -- customer's. (`signup_marks` holds no business at all.)
    ('signup_risk', 'unrelated', null, null, null, null),
    -- Phase 2a (0150) — the morning summary's claims: a day and what came of it, the owner's own, never a customer's.
    ('morning_summaries', 'unrelated', null, null, null, null),
    -- 0162 — the workspace's count of its own orders: numbers, never a customer's.
    ('order_numbers', 'unrelated', null, null, null, null),
    -- 0229 — the owner's procedures: the assistant's instructions, no customer in them.
    ('procedures', 'unrelated', null, null, null, null),
    -- 0230 — the checks run before a change goes live: the staged change and case REFERENCES, never a customer's words.
    ('case_checks', 'unrelated', null, null, null, null),
    -- 0163 — a capability withdrawn in one language: the assistant's record, no customer in it.
    ('language_withdrawals', 'unrelated', null, null, null, null),
    -- 0169 (Phase 5, A2.1) — the workspace's own books: its settings, chart, journals, fiscal years and numbering,
    -- and its entries and lines. No customer is linked to them yet; the parties (A2.2) arrive with the "kept until the
    -- legal date, then erased" action (A2.4, docs/PHASE-5.md §6), and these are re-decided with them.
    ('books_settings', 'unrelated', null, null, null, null),
    ('accounts', 'unrelated', null, null, null, null),
    ('journals', 'unrelated', null, null, null, null),
    ('fiscal_years', 'unrelated', null, null, null, null),
    ('journal_counters', 'unrelated', null, null, null, null),
    ('journal_entries', 'unrelated', null, null, null, null),
    -- 0227 — spending: the owner's categories, bills, recurring costs and their proposals; nothing of a customer.
    ('spending_categories', 'unrelated', null, null, null, null),
    ('spending_bills', 'unrelated', null, null, null, null),
    ('recurring_costs', 'unrelated', null, null, null, null),
    ('spending_proposals', 'unrelated', null, null, null, null),
    ('journal_lines', 'unrelated', null, null, null, null),
    -- 0170 (A2.2) — tax codes and custom-field definitions: the workspace's own settings. Parties: its customers and
    -- suppliers, with no link to a buyer and no contact detail yet; re-decided with that link in A2.4.
    ('tax_codes', 'unrelated', null, null, null, null),
    ('parties', 'unrelated', null, null, null, null),
    ('custom_field_defs', 'unrelated', null, null, null, null),
    -- 0172 (A2.4) — the receipts of the owner's book downloads: what was downloaded, when, by whom; no customer.
    ('books_exports', 'unrelated', null, null, null, null),
    -- 0174 (A4) — the papers behind the books (receipts, invoices, bills) and their sealed bytes: the workspace's
    -- record, linked to its entries; no customer link (A2.4's note on parties holds for them too).
    ('documents', 'unrelated', null, null, null, null),
    ('document_blobs', 'unrelated', null, null, null, null),
    -- 0178 (Phase 5, B2) — what each connected system last said of each books record: a key and a digest, the
    -- workspace's own plumbing; no customer in it.
    ('connector_records', 'unrelated', null, null, null, null),
    -- 0179 (B3–B5) — which of the shop's systems the books are connected to, and how the last read went: the
    -- workspace's own settings, no customer in them (the grant itself is in connector_credentials, sealed).
    ('books_connections', 'unrelated', null, null, null, null),
    -- 0181 (C0) — the start dates the owner confirmed for taxes a system gave none: the workspace's own facts.
    ('tax_start_dates', 'unrelated', null, null, null, null),
    -- 0184 (C2) — invoices and their payments: the workspace's statutory record, made out to a PARTY of the books
    -- (no link to a buyer yet — a party is the books' own record); held at closure with the books.
    ('invoice_counters', 'unrelated', null, null, null, null),
    ('invoices', 'unrelated', null, null, null, null),
    ('invoice_lines', 'unrelated', null, null, null, null),
    ('invoice_payments', 'unrelated', null, null, null, null),
    -- 0185 (C3) — bank statements read in, their lines, and the matches a person made: the workspace's books.
    ('statement_imports', 'unrelated', null, null, null, null),
    ('statement_lines', 'unrelated', null, null, null, null),
    ('statement_matches', 'unrelated', null, null, null, null),
    -- 0188 (D1b) — credit notes against issued invoices, their lines and their counter: the workspace's books.
    ('credit_note_counters', 'unrelated', null, null, null, null),
    ('credit_notes', 'unrelated', null, null, null, null),
    ('credit_note_lines', 'unrelated', null, null, null, null),
    -- 0189 (D2) — every lock and reopening of the books' periods, who and why: the workspace's books.
    ('period_locks', 'unrelated', null, null, null, null),
    -- 0191 (D6) — what a reader read from a receipt, invoice or bill of the books, and the draft made from it.
    ('document_readings', 'unrelated', null, null, null, null),
    -- 0195 (S1) — the workspace's saved replies: words its people wrote to reuse, never a customer's.
    ('saved_replies', 'unrelated', null, null, null, null),
    -- 0196 (S2) — the workspace's labels: its own words; a label on a buyer is the buyer's, and goes with them.
    ('labels', 'unrelated', null, null, null, null),
    ('buyer_labels', 'erase', null, null, null, null),
    -- 0199 (S5) — the owner's decisions on answers people gave: a digest of the question's words, never the words.
    ('answer_decisions', 'unrelated', null, null, null, null),
    -- 0202 (S6) — what a buyer was asked after an order, and what they answered: theirs, and goes with them.
    ('survey_asks', 'erase', null, null, null, null),
    -- 0226 — an invoice's public link (a token and its expiry, pointing at the business's own invoice): no customer in it.
    ('invoice_links', 'unrelated', null, null, null, null),
    -- 0226 — that an invoice went to a customer, and the reminders about it: the record of the business's invoice stays
    -- (when, on which channel, how many reminders), the keys to the customer's conversation, message and draft go.
    ('invoice_sends', 'detach', null, null, array['conversation_id','outbound_id'], null),
    ('invoice_reminders', 'detach', null, null, array['conversation_id','outbound_id','draft_id'], null),
    -- 0231 — that a month's report went to the owner, and when: the workspace's own, no customer in it.
    ('month_report_sends', 'unrelated', null, null, null, null),
    ('follow_up_rules', 'unrelated', null, null, null, null),
    ('follow_up_observations', 'erase', null, null, null, null),
    ('follow_up_runs', 'erase', null, null, null, null),
    ('follow_up_approvals', 'erase', null, null, null, null)
$$;
revoke all on function customer_erasure_contract() from public;

create or replace function customer_erasure_edges()
returns table (child text, col text, parent text, pcol text)
language sql immutable set search_path = public as $$
  values
    ('client_channels', 'client_id', 'clients', 'id'),
    ('client_faces', 'client_id', 'clients', 'id'),
    -- 0196 (S2) — a label on a buyer: theirs.
    ('buyer_labels', 'client_id', 'clients', 'id'),
    -- 0202 (S6) — a survey asked of a buyer, about one of their conversations: theirs.
    ('survey_asks', 'client_id', 'clients', 'id'),
    ('survey_asks', 'conversation_id', 'conversations', 'id'),
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
    -- 0224 — a practice photo or voice note hangs off its practice conversation.
    ('practice_media', 'conversation_id', 'conversations', 'id'),
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
    -- 0224 — the quote a reply carried, on the draft, the outbound row and the sent message.
    ('drafts', 'quote_id', 'quotes', 'id'),
    ('messages', 'quote_id', 'quotes', 'id'),
    ('outbound_messages', 'quote_id', 'quotes', 'id'),
    ('outbound_transitions', 'outbound_id', 'outbound_messages', 'id'),
    ('promised_dates', 'outbound_id', 'outbound_messages', 'id'),
    ('sequence_sends', 'outbound_id', 'outbound_messages', 'id'),
    ('sequence_sends', 'enrollment_id', 'sequence_enrollments', 'id'),
    -- 0130 — the advisor's link to each customer a turn named.
    ('advisor_turn_subjects', 'client_id', 'clients', 'id'),
    -- 0226 — an invoice sent in a conversation, and its reminders.
    ('invoice_sends', 'conversation_id', 'conversations', 'id'),
    ('invoice_sends', 'outbound_id', 'outbound_messages', 'id'),
    ('invoice_reminders', 'conversation_id', 'conversations', 'id'),
    ('invoice_reminders', 'outbound_id', 'outbound_messages', 'id'),
    ('invoice_reminders', 'draft_id', 'drafts', 'id'),
    ('follow_up_observations', 'client_id', 'clients', 'id'),
    ('follow_up_observations', 'conversation_id', 'conversations', 'id'),
    ('follow_up_observations', 'quote_id', 'quotes', 'id'),
    ('follow_up_observations', 'outbound_id', 'outbound_messages', 'id'),
    ('follow_up_observations', 'episode_message_id', 'messages', 'id'),
    ('follow_up_runs', 'client_id', 'clients', 'id'),
    ('follow_up_runs', 'conversation_id', 'conversations', 'id'),
    ('follow_up_runs', 'source_quote_id', 'quotes', 'id'),
    ('follow_up_runs', 'source_outbound_id', 'outbound_messages', 'id'),
    ('follow_up_runs', 'episode_message_id', 'messages', 'id'),
    ('follow_up_runs', 'draft_id', 'drafts', 'id'),
    ('follow_up_approvals', 'draft_id', 'drafts', 'id'),
    ('follow_up_approvals', 'run_id', 'follow_up_runs', 'id'),
    ('follow_up_approvals', 'conversation_id', 'conversations', 'id'),
    ('follow_up_approvals', 'outbound_id', 'outbound_messages', 'id')
$$;
revoke all on function customer_erasure_edges() from public;

create or replace function erase_customer_rows(p_business uuid, p_client uuid, p_request uuid, p_restored boolean default false)
returns jsonb
language plpgsql volatile security definer set search_path = public set row_security = off as $$
declare
  v_counts jsonb;
  v_follow_approvals bigint;
  v_follow_runs bigint;
  v_follow_observations bigint;
  v_sends bigint;
  v_reminders bigint;
begin
  delete from follow_up_approvals where business_id = p_business and run_id in
    (select id from follow_up_runs where business_id = p_business and client_id = p_client);
  get diagnostics v_follow_approvals = row_count;
  delete from follow_up_runs where business_id = p_business and client_id = p_client;
  get diagnostics v_follow_runs = row_count;
  delete from follow_up_observations where business_id = p_business and client_id = p_client;
  get diagnostics v_follow_observations = row_count;
  update invoice_sends set conversation_id = null, outbound_id = null
   where business_id = p_business
     and (conversation_id in (select c.id from conversations c where c.client_id = p_client and c.business_id = p_business)
          or outbound_id in (select o.id from outbound_messages o join conversations c on c.id = o.conversation_id
                              where c.client_id = p_client and c.business_id = p_business));
  get diagnostics v_sends = row_count;
  update invoice_reminders set conversation_id = null, outbound_id = null, draft_id = null
   where business_id = p_business
     and (conversation_id in (select c.id from conversations c where c.client_id = p_client and c.business_id = p_business)
          or outbound_id in (select o.id from outbound_messages o join conversations c on c.id = o.conversation_id
                              where c.client_id = p_client and c.business_id = p_business)
          or draft_id in (select d.id from drafts d join conversations c on c.id = d.conversation_id
                           where c.client_id = p_client and c.business_id = p_business));
  get diagnostics v_reminders = row_count;
  v_counts := erase_customer_rows_before_0226(p_business, p_client, p_request, p_restored);
  v_counts := jsonb_set(v_counts, '{erased}', erasure_add(coalesce(v_counts -> 'erased', '{}'::jsonb), 'follow_up_observations', v_follow_observations));
  v_counts := jsonb_set(v_counts, '{erased}', erasure_add(coalesce(v_counts -> 'erased', '{}'::jsonb), 'follow_up_runs', v_follow_runs));
  v_counts := jsonb_set(v_counts, '{erased}', erasure_add(coalesce(v_counts -> 'erased', '{}'::jsonb), 'follow_up_approvals', v_follow_approvals));
  v_counts := jsonb_set(v_counts, '{changed}', erasure_add(coalesce(v_counts -> 'changed', '{}'::jsonb), 'invoice_sends', v_sends));
  return jsonb_set(v_counts, '{changed}', erasure_add(coalesce(v_counts -> 'changed', '{}'::jsonb), 'invoice_reminders', v_reminders));
end $$;
revoke all on function erase_customer_rows(uuid, uuid, uuid, boolean) from public;

insert into _migrations (version, name) values (234, 'follow_up_drafts') on conflict (version) do nothing;
