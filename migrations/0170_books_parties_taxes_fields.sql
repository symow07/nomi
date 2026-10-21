-- ---------------------------------------------------------------------------
-- 0170 — TAX CODES, PARTIES AND CUSTOM FIELDS (Phase 5, A2.2: the rest of the books' model).
--
--   · TAX CODES are VERSIONED. A version that a posted line uses keeps its rate, its kind and its account for good:
--     history never moves (decision 13's rule, for taxes). A new rate is a new version from a new date. A line's
--     tax code must be valid on its entry's date.
--   · PARTIES are the workspace's customers and suppliers: the FEC's auxiliary account (Num_Compte_Aux,
--     Libelle_Compte_Aux, Avis 24). Morocco's ICE is fifteen digits. No link to a buyer and no contact detail
--     yet: that link arrives with the "kept until the legal date, then erased" action (A2.4, PHASE-5.md §6), and
--     parties are re-decided for erasure with it.
--   · CUSTOM FIELDS (item 9's schema): the workspace defines them, per kind of row (an entry, a line, a party); the
--     DATABASE checks every value against its definition — an unknown field, a wrong kind, a choice that is not one
--     of the choices, a required field missing. A number is exact text ("12.50"), never a JSON float.
--
-- Posted entries and their lines stay as 0169 left them: their custom values, party and tax code are part of what
-- is never changed.
-- ---------------------------------------------------------------------------

create table if not exists tax_codes (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  code        text not null check (code ~ '^[A-Z0-9_-]{1,12}$'),
  label       text not null check (length(btrim(label)) between 1 and 120),
  -- A percentage, exact: 20, 14, 10, 7, 5.5, 0.
  rate        numeric(7,4) not null check (rate >= 0 and rate <= 100),
  kind        text not null check (kind in ('collected', 'deductible', 'exempt')),
  account_id  uuid,
  valid_from  date not null,
  valid_to    date,
  created_at  timestamptz not null default now(),
  check (valid_to is null or valid_to > valid_from),
  check (kind = 'exempt' or account_id is not null),
  unique (business_id, code, valid_from),
  unique (business_id, id),
  foreign key (business_id, account_id) references accounts (business_id, id) on delete cascade
);

create table if not exists parties (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  kind        text not null check (kind in ('customer', 'supplier', 'other')),
  -- Its auxiliary account's code, as the FEC writes it (Num_Compte_Aux).
  code        text not null check (code ~ '^[0-9A-Za-z][0-9A-Za-z.\-]{0,19}$'),
  name        text not null check (length(btrim(name)) between 1 and 200),
  country     text check (country is null or country ~ '^[A-Z]{2}$'),
  -- Morocco: Identifiant Commun de l'Entreprise, fifteen digits.
  ice         text check (ice is null or ice ~ '^[0-9]{15}$'),
  -- Any other country's tax or VAT number, as written.
  tax_number  text check (tax_number is null or length(btrim(tax_number)) between 1 and 40),
  is_active   boolean not null default true,
  custom      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  unique (business_id, code),
  unique (business_id, id)
);

create table if not exists custom_field_defs (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  applies_to  text not null check (applies_to in ('entry', 'line', 'party')),
  key         text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label       text not null check (length(btrim(label)) between 1 and 80),
  kind        text not null check (kind in ('text', 'number', 'date', 'choice')),
  choices     text[] check (choices is null or (cardinality(choices) between 1 and 50)),
  required    boolean not null default false,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  check ((kind = 'choice') = (choices is not null)),
  unique (business_id, applies_to, key)
);

alter table journal_entries add column if not exists custom jsonb not null default '{}'::jsonb;
alter table journal_lines   add column if not exists party_id uuid;
alter table journal_lines   add column if not exists tax_code_id uuid;
alter table journal_lines   add column if not exists custom jsonb not null default '{}'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'journal_lines_party_fkey') then
    alter table journal_lines add constraint journal_lines_party_fkey
      foreign key (business_id, party_id) references parties (business_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'journal_lines_tax_code_fkey') then
    alter table journal_lines add constraint journal_lines_tax_code_fkey
      foreign key (business_id, tax_code_id) references tax_codes (business_id, id) on delete cascade;
  end if;
end $$;

-- ── custom values, checked against their definitions ───────────────────────────────────────────────────────────────
create or replace function custom_values_problem(p_business uuid, p_applies text, p_values jsonb) returns text
language plpgsql stable as $$
declare
  k text;
  v jsonb;
  d record;
begin
  if jsonb_typeof(p_values) <> 'object' then return 'custom values are an object'; end if;
  for k, v in select * from jsonb_each(p_values) loop
    select * into d from custom_field_defs where business_id = p_business and applies_to = p_applies and key = k;
    if d.id is null then return format('no custom field "%s" on a %s', k, p_applies); end if;
    if not d.is_active then return format('custom field "%s" is no longer in use', k); end if;
    if jsonb_typeof(v) <> 'string' then return format('custom field "%s" is written as text', k); end if;
    if d.kind = 'text' and length(v #>> '{}') > 500 then return format('custom field "%s" is longer than 500', k); end if;
    if d.kind = 'number' and (v #>> '{}') !~ '^-?[0-9]+(\.[0-9]+)?$' then
      return format('custom field "%s" is a number, written exactly ("12.50")', k);
    end if;
    if d.kind = 'date' then
      if (v #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return format('custom field "%s" is a date (YYYY-MM-DD)', k); end if;
      begin perform (v #>> '{}')::date; exception when others then return format('custom field "%s" is not a real date', k); end;
    end if;
    if d.kind = 'choice' and not ((v #>> '{}') = any(d.choices)) then
      return format('custom field "%s" is one of its choices', k);
    end if;
  end loop;
  select key into k from custom_field_defs
   where business_id = p_business and applies_to = p_applies and required and is_active and not (p_values ? key)
   order by key limit 1;
  if k is not null then return format('custom field "%s" is required', k); end if;
  return null;
end $$;

create or replace function custom_values_rules() returns trigger
language plpgsql as $$
declare why text;
begin
  -- A posted or discarded entry's rows are refused by 0169's rules before this matters; this checks what is written.
  why := custom_values_problem(new.business_id, tg_argv[0], new.custom);
  if why is not null then raise exception 'books: %', why using errcode = 'NB011'; end if;
  return new;
end $$;
drop trigger if exists custom_values_entry on journal_entries;
create trigger custom_values_entry before insert or update of custom on journal_entries
  for each row execute function custom_values_rules('entry');
drop trigger if exists custom_values_line on journal_lines;
create trigger custom_values_line before insert or update of custom on journal_lines
  for each row execute function custom_values_rules('line');
drop trigger if exists custom_values_party on parties;
create trigger custom_values_party before insert or update of custom on parties
  for each row execute function custom_values_rules('party');

-- A definition keeps its key, its row kind and its kind of value: values were written to them.
create or replace function custom_field_defs_rules() returns trigger
language plpgsql as $$
begin
  if new.key <> old.key or new.applies_to <> old.applies_to or new.kind <> old.kind or new.business_id <> old.business_id then
    raise exception 'books: a custom field keeps its key and its kind — add another' using errcode = 'NB011';
  end if;
  return new;
end $$;
drop trigger if exists custom_field_defs_rules on custom_field_defs;
create trigger custom_field_defs_rules before update on custom_field_defs
  for each row execute function custom_field_defs_rules();

-- ── tax codes: a version a posted line uses is history ─────────────────────────────────────────────────────────────
create or replace function tax_codes_rules() returns trigger
language plpgsql as $$
begin
  if (new.rate, new.kind, new.account_id, new.code, new.valid_from, new.business_id)
       is distinct from (old.rate, old.kind, old.account_id, old.code, old.valid_from, old.business_id)
     and exists (select 1 from journal_lines l join journal_entries e on e.id = l.entry_id
                  where l.tax_code_id = old.id and e.state = 'posted')
     and not books_purge_allowed() then
    raise exception 'books: tax code % (from %) is on posted entries and keeps its rate — add a new version from a new date',
      old.code, old.valid_from using errcode = 'NB012';
  end if;
  -- Closing a version (valid_to) never cuts off a day a posted line already used.
  if new.valid_to is not null and exists (select 1 from journal_lines l join journal_entries e on e.id = l.entry_id
       where l.tax_code_id = old.id and e.state = 'posted' and e.entry_date >= new.valid_to) and not books_purge_allowed() then
    raise exception 'books: tax code % is on posted entries dated on or after %', old.code, new.valid_to using errcode = 'NB012';
  end if;
  return new;
end $$;
drop trigger if exists tax_codes_rules on tax_codes;
create trigger tax_codes_rules before update on tax_codes for each row execute function tax_codes_rules();

-- 0169's line rule, again, with one more: a line's tax code is valid on its entry's date.
create or replace function journal_lines_rules() returns trigger
language plpgsql as $$
declare
  s text;
  day date;
  t record;
begin
  select state, entry_date into s, day from journal_entries where id = coalesce(new.entry_id, old.entry_id);
  if s = 'posted' and not books_purge_allowed() then
    raise exception 'books: the entry is posted, and its lines are never changed — reverse it' using errcode = 'NB005';
  end if;
  if s = 'discarded' and not books_purge_allowed() then
    raise exception 'books: the draft was discarded, and its lines stay as they were' using errcode = 'NB005';
  end if;
  if tg_op = 'UPDATE' and new.entry_id <> old.entry_id then
    raise exception 'books: a line stays on its entry' using errcode = 'NB005';
  end if;
  if tg_op <> 'DELETE' and new.tax_code_id is not null then
    select * into t from tax_codes where id = new.tax_code_id;
    if day < t.valid_from or (t.valid_to is not null and day >= t.valid_to) then
      raise exception 'books: tax code % is not in force on %', t.code, day using errcode = 'NB012';
    end if;
  end if;
  return coalesce(new, old);
end $$;

-- ── row security and grants ────────────────────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['tax_codes', 'parties', 'custom_field_defs'] loop
    execute format('alter table %I enable row level security', t);
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_tenant') then
      execute format('create policy %I on %I for all to nomi_app using (business_id = current_business_id()) with check (business_id = current_business_id())', t || '_tenant', t);
    end if;
  end loop;
end $$;
grant select, insert, update on tax_codes, parties, custom_field_defs to nomi_app;
revoke delete, truncate on tax_codes, parties, custom_field_defs from nomi_app;

-- ── the erasure contract, re-made with this migration's tables ─────────────────────────────────────────────────────
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
    ('custom_field_defs', 'unrelated', null, null, null, null)
$$;
revoke all on function customer_erasure_contract() from public;

insert into _migrations (version, name) values (170, 'books_parties_taxes_fields')
  on conflict (version) do nothing;
