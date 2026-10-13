-- ---------------------------------------------------------------------------
-- 0150 — Phase 2a (the owner's roadmap, 2026-10-13): THE MORNING SUMMARY.
--
-- Each morning Nomi tells the owner who is waiting, who went quiet and what
-- sold — at 08:00 in the business's own time zone, never inside the owner's
-- quiet hours, once a day, and not at all on a day with nothing to say. On by
-- default; the owner turns it off, or sets quiet hours, on Notifications. It
-- is the fourth way a notification can be classed (the owner's word,
-- 2026-10-13): neither an interruption nor quiet in the app, but a daily
-- letter the owner can stop.
--
-- `people.morning_summary` (the owner's switch), `people.quiet_from` /
-- `quiet_until` (whole hours in the business's zone; both or neither; the
-- window may run past midnight). `morning_summaries` records each claim, one
-- per person per local day, and what came of it — kept 30 days.
--
-- Forward-only (ADR-0007). An older build reads none of it and sends none.
-- ---------------------------------------------------------------------------

alter table people add column if not exists morning_summary boolean not null default true;
alter table people add column if not exists quiet_from smallint check (quiet_from between 0 and 23);
alter table people add column if not exists quiet_until smallint check (quiet_until between 0 and 23);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'people_quiet_hours_pair') then
    alter table people add constraint people_quiet_hours_pair
      check ((quiet_from is null) = (quiet_until is null) and (quiet_from is null or quiet_from <> quiet_until));
  end if;
end $$;

create table if not exists morning_summaries (
  person_id   uuid not null references people(id) on delete cascade,
  day         date not null,
  business_id uuid not null references businesses(id) on delete cascade,
  claimed_at  timestamptz not null default now(),
  -- sent: it left; nothing: there was nothing to say; failed: no way could carry it.
  outcome     text check (outcome in ('sent', 'nothing', 'failed')),
  way         text check (way in ('email', 'browser', 'whatsapp')),
  primary key (person_id, day)
);
create index if not exists morning_summaries_business on morning_summaries (business_id, day);
alter table morning_summaries enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'morning_summaries' and policyname = 'morning_summaries_tenant') then
    create policy morning_summaries_tenant on morning_summaries for select to nomi_app using (business_id = current_business_id());
  end if;
end $$;
revoke all on morning_summaries from public, nomi_app;
grant select on morning_summaries to nomi_app;

-- The summaries due now, each claimed once: owners who keep it on, at or past 08:00 in the business's zone (an
-- unknown zone reads as UTC), outside their quiet hours, in a workspace that is not a practice copy and not
-- suspended. Claims older than 30 days are forgotten on the way.
create or replace function claim_morning_summaries()
returns table (business_id uuid, person_id uuid, day date)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
begin
  delete from morning_summaries where day < (now() at time zone 'UTC')::date - 30;
  return query
  with zones as materialized (select name from pg_timezone_names),
  here as (
    select b.id as business_id, p.id as person_id, p.quiet_from, p.quiet_until,
           now() at time zone coalesce(z.name, 'UTC') as local
      from businesses b join people p on p.business_id = b.id and p.is_owner and p.archived_at is null and p.morning_summary
      left join zones z on z.name = b.timezone
     where b.practice_of is null
       and not exists (select 1 from workspace_suspensions s where s.business_id = b.id and s.restored_at is null)
  ), ready as (
    select h.business_id, h.person_id, h.local::date as day from here h
     where extract(hour from h.local) >= 8
       and not (h.quiet_from is not null and case
             when h.quiet_from < h.quiet_until then extract(hour from h.local) >= h.quiet_from and extract(hour from h.local) < h.quiet_until
             else extract(hour from h.local) >= h.quiet_from or extract(hour from h.local) < h.quiet_until end)
  ), ins as (
    insert into morning_summaries (person_id, day, business_id)
    select r.person_id, r.day, r.business_id from ready r
    on conflict (person_id, day) do nothing
    returning morning_summaries.business_id, morning_summaries.person_id, morning_summaries.day
  )
  select i.business_id, i.person_id, i.day from ins i;
end $$;
revoke all on function claim_morning_summaries() from public;
grant execute on function claim_morning_summaries() to nomi_app;

-- What came of one claim.
create or replace function morning_summary_done(p_person uuid, p_day date, p_outcome text, p_way text)
returns void
language sql volatile security definer set search_path = public as $$
  update morning_summaries set outcome = p_outcome, way = p_way where person_id = p_person and day = p_day
$$;
revoke all on function morning_summary_done(uuid, date, text, text) from public;
grant execute on function morning_summary_done(uuid, date, text, text) to nomi_app;

-- 0148's contract, with the summary's claims decided.
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
    ('orders', 'keep', array['client_email','shipping_address','notes','tracking_reference'], null, null, null),
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
    ('morning_summaries', 'unrelated', null, null, null, null)
$$;

revoke all on function customer_erasure_contract() from public;

insert into _migrations (version, name) values (150, 'morning_summary')
  on conflict (version) do nothing;
