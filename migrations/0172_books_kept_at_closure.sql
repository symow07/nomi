-- ---------------------------------------------------------------------------
-- 0172 — A CLOSING WORKSPACE KEEPS ITS BOOKS, AND ITS OWNER LEAVES WITH THEM (Phase 5, A2.4; PHASE-5.md §6).
--
-- The duty: France "dix ans" (Code de commerce L123-22), Morocco "dix (10) ans" (CGI art. 211); GDPR art. 17(3)(b)
-- lets a legal obligation stand against erasure. The owner's rule (2026-10-22): the books must never be held
-- hostage — so the export at closure is MANDATORY and comes FIRST, and closure does not finish without it.
--
--   · `books_retention`: years per country, counted from the END of the fiscal year (the later of the readings,
--     so never too short). `books_keep_until(workspace)`: the last fiscal year with a posted entry, plus its years.
--   · `books_exports`: a receipt each time the owner downloads the books — what it covered (the last posting it
--     includes), how many entries and lines, its SHA-256. `books_export_covers(workspace)`: no posted entry, or a
--     receipt that covers the last one.
--   · `erase_workspace_rows` (0126, re-made): with posted books, the owner's closure and the operator's erasure
--     REFUSE without a covering export, and nothing changes. With one, everything else of the workspace is erased
--     as before, and the books, with the business row they hang on, are HELD: switched off, `books_held_until`
--     the legal date. Without posted books, nothing is held: drafts and settings are not the record.
--   · `books_retention_due()`: held workspaces past their date, for the operator's purge
--     (tools/books-retention.mjs). `erasure_ledger_unkept` (0130's, re-made) knows a held workspace is not an erasure
--     that failed to hold — unless something besides its books is still there.
-- ---------------------------------------------------------------------------

alter table businesses add column if not exists books_closed_at timestamptz;
alter table businesses add column if not exists books_held_until date;

create table if not exists books_retention (
  country     text primary key check (country = '*' or country ~ '^[A-Z]{2}$'),
  years       integer not null check (years between 1 and 30),
  law         text not null check (length(btrim(law)) between 1 and 300)
);
insert into books_retention (country, years, law) values
  ('MA', 10, 'Code Général des Impôts, art. 211: dix (10) ans'),
  ('FR', 10, 'Code de commerce, art. L123-22: dix ans'),
  ('*', 10, 'ten years: the longest duty this product knows, for a country it has none on record for')
on conflict (country) do nothing;
grant select on books_retention to nomi_app;
revoke insert, update, delete, truncate on books_retention from nomi_app;

create or replace function books_keep_until(p_business uuid) returns date
language sql stable security definer set search_path = public as $$
  select (max(f.ends_on) + make_interval(years => coalesce(r.years, d.years)))::date
    from fiscal_years f
    join businesses b on b.id = f.business_id
    left join books_retention r on r.country = b.country
    cross join (select years from books_retention where country = '*') d
   where f.business_id = p_business
     and exists (select 1 from journal_entries e where e.fiscal_year_id = f.id and e.state = 'posted')
   group by r.years, d.years
$$;
revoke all on function books_keep_until(uuid) from public;
grant execute on function books_keep_until(uuid) to nomi_app;

create table if not exists books_exports (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses(id) on delete cascade,
  made_at        timestamptz not null default now(),
  made_by        text not null check (length(btrim(made_by)) between 1 and 120),
  kind           text not null check (kind in ('books_csv')),
  -- The last posting the file includes; null when nothing was posted yet.
  covers_through timestamptz,
  entries        integer not null check (entries >= 0),
  lines          integer not null check (lines >= 0),
  sha256         text not null check (sha256 ~ '^[0-9a-f]{64}$')
);
alter table books_exports enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'books_exports' and policyname = 'books_exports_tenant') then
    create policy books_exports_tenant on books_exports for all to nomi_app
      using (business_id = current_business_id()) with check (business_id = current_business_id());
  end if;
end $$;
grant select, insert on books_exports to nomi_app;
revoke update, delete, truncate on books_exports from nomi_app;

create or replace function books_export_covers(p_business uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when not exists (select 1 from journal_entries where business_id = p_business and state = 'posted') then true
    else exists (select 1 from books_exports x where x.business_id = p_business
                   and x.covers_through >= (select max(posted_at) from journal_entries where business_id = p_business and state = 'posted'))
  end
$$;
revoke all on function books_export_covers(uuid) from public;
grant execute on function books_export_covers(uuid) to nomi_app;

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
  -- A2.4 — the books a closing workspace must keep (0169–0172), and until when.
  v_books text[] := array['books_settings', 'accounts', 'journals', 'fiscal_years', 'journal_counters', 'journal_entries',
                          'journal_lines', 'tax_codes', 'parties', 'custom_field_defs', 'books_exports'];
  v_hold boolean;
  v_keep date;
begin
  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception 'erasure: the role % is subject to row-level security, so it cannot see every row it must erase', current_user
      using errcode = 'NE009';
  end if;
  if not exists (select 1 from businesses where id = p_business) then
    raise exception 'erasure: no workspace %', p_business using errcode = 'NE004';
  end if;
  v_ids := array(select id from businesses where practice_of = p_business order by id) || p_business;
  -- A2.4 — posted books are the statutory record: they stay until the legal date, with the business row they hang
  -- on; everything else of the workspace goes. And the owner leaves with them FIRST (the owner, 2026-10-22): no
  -- export covering the last posting, no closure.
  v_hold := exists (select 1 from journal_entries e where e.business_id = p_business and e.state = 'posted');
  v_keep := books_keep_until(p_business);
  if v_hold and not p_dry and not books_export_covers(p_business) then
    raise exception 'books: this workspace keeps books, and they were not downloaded since the last entry was posted — download them first; nothing was changed'
      using errcode = 'NE011';
  end if;
  if not v_hold then
    -- Nothing posted: drafts, accounts and settings are not the record, and go with the rest.
    perform set_config('nomi.books_purge', 'workspace-erasure', true);
  end if;
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
      if v_hold and v_id = p_business and (v_step.label = any(v_books) or v_step.label = 'businesses') then
        continue;
      end if;
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
  if v_hold and not p_dry then
    update businesses set is_active = false, books_closed_at = now(), books_held_until = v_keep where id = p_business;
  end if;
  if not p_dry and exists (select 1 from businesses where id = any(v_ids) and not (v_hold and id = p_business)) then
    raise exception 'erasure: the workspace is still there after the erasure. Rolled back; nothing changed.' using errcode = 'NE010';
  end if;
  return jsonb_build_object('tables', v_tables, 'copies', v_copies,
                            'rows', erasure_total(v_tables) + erasure_total(v_copies))
      || case when v_hold then jsonb_build_object('books_held_until', v_keep) else '{}'::jsonb end;
end $$;
revoke all on function erase_workspace_rows(uuid, boolean, boolean) from public;

create or replace function books_retention_due()
returns table (business_id uuid, name text, held_until date)
language sql stable security definer set search_path = public set row_security = off as $$
  select id, name, books_held_until from businesses
   where books_held_until is not null and books_held_until < current_date order by books_held_until, id
$$;
revoke all on function books_retention_due() from public;

create or replace function erasure_ledger_unkept()
returns table (ledger_id uuid, kind text, business_id uuid, customer_id uuid, reason text)
language sql stable security definer set search_path = public set row_security = off as $$
  select l.id, l.kind, l.business_id, l.customer_id, 'the workspace is still there'
    from erasure_ledger l
   where l.kind = 'workspace'
     and exists (select 1 from businesses b where b.id = l.business_id and b.books_held_until is null)
  union all
  -- A2.4 — held for its books (0172): the row and the books stay; nobody signs in and no customer is left.
  select l.id, l.kind, l.business_id, l.customer_id, 'the workspace is held for its books, and something else of it is still there'
    from erasure_ledger l join businesses b on b.id = l.business_id
   where l.kind = 'workspace' and b.books_held_until is not null
     and (b.is_active or exists (select 1 from logins g where g.business_id = b.id)
          or exists (select 1 from clients c where c.business_id = b.id)
          or exists (select 1 from conversations v where v.business_id = b.id))
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
    ('journal_lines', 'unrelated', null, null, null, null),
    -- 0170 (A2.2) — tax codes and custom-field definitions: the workspace's own settings. Parties: its customers and
    -- suppliers, with no link to a buyer and no contact detail yet; re-decided with that link in A2.4.
    ('tax_codes', 'unrelated', null, null, null, null),
    ('parties', 'unrelated', null, null, null, null),
    ('custom_field_defs', 'unrelated', null, null, null, null),
    -- 0172 (A2.4) — the receipts of the owner's book downloads: what was downloaded, when, by whom; no customer.
    ('books_exports', 'unrelated', null, null, null, null)
$$;
revoke all on function customer_erasure_contract() from public;

insert into _migrations (version, name) values (172, 'books_kept_at_closure')
  on conflict (version) do nothing;
