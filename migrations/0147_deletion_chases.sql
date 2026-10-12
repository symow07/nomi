-- ---------------------------------------------------------------------------
-- 0147 — D4 (the owner's decision, 2026-10-12): A DELETION REQUEST NOBODY
-- ANSWERS IS CHASED, AND NEVER CARRIED OUT BY NOMI.
--
-- The business is the controller: only its owner deletes a customer's data.
-- A request that waits — noted from a customer's message (`deletion_asks`,
-- 'waiting') or recorded and not carried out (`deletion_requests`, 'open') —
-- is chased: the owner is reminded at 7 days and again at 30; at 60 the app
-- flags it. Nothing is ever erased by a timer. Every chase is recorded here,
-- ids and dates only, so it can be shown that the business was told.
--
-- One step per request per run, the furthest one due: a request already 45
-- days old the first time this runs is reminded once (the 30-day reminder),
-- not twice. A request recorded from a noted message carries the message's
-- chases with it (its `asked_at` is the message's).
-- ---------------------------------------------------------------------------

create table if not exists deletion_chases (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  subject     text not null check (subject in ('ask', 'request')),
  -- deletion_asks.id or deletion_requests.id. No key: the record outlives the erasure that answers the request.
  subject_id  uuid not null,
  step        text not null check (step in ('7d', '30d', '60d')),
  asked_at    timestamptz not null,
  at          timestamptz not null default now(),
  unique (subject, subject_id, step)
);
create index if not exists deletion_chases_business on deletion_chases (business_id, at);
alter table deletion_chases enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'deletion_chases' and policyname = 'deletion_chases_tenant') then
    create policy deletion_chases_tenant on deletion_chases for select using (business_id = current_business_id());
  end if;
end $$;
revoke all on deletion_chases from public, nomi_app;
grant select on deletion_chases to nomi_app;

-- The chases due now, each written as it is returned (so two runs never chase twice), the furthest step only.
create or replace function claim_deletion_chases()
returns table (business_id uuid, subject text, subject_id uuid, step text, asked_at timestamptz, conversation_id uuid)
language plpgsql volatile security definer set search_path = public as $$
-- The result's columns share the tables' names (subject, step, asked_at …): a name means the column.
#variable_conflict use_column
begin
  return query
  with waiting as (
    select 'ask'::text as subject, a.id, a.business_id, a.asked_at, a.conversation_id, null::uuid as request_id
      from deletion_asks a where a.state = 'waiting'
    union all
    select 'request', r.id, r.business_id, r.asked_at,
           (select v.id from conversations v where v.client_id = r.client_id order by v.created_at desc, v.id limit 1),
           r.id
      from deletion_requests r where r.scope = 'buyer' and r.state = 'open' and r.client_id is not null
  ), steps(step, after, rank) as (
    values ('7d'::text, interval '7 days', 1), ('30d', interval '30 days', 2), ('60d', interval '60 days', 3)
  ), furthest as (
    select distinct on (w.subject, w.id) w.subject, w.id, w.business_id, w.asked_at, w.conversation_id, w.request_id, s.step, s.rank
      from waiting w join steps s on w.asked_at <= now() - s.after
     order by w.subject, w.id, s.rank desc
  ), due as (
    select f.* from furthest f
     where not exists (
       select 1 from deletion_chases c join steps s on s.step = c.step
        where s.rank >= f.rank
          and ((c.subject = f.subject and c.subject_id = f.id)
               -- a request recorded from a noted message: the message's chases count
               or (f.subject = 'request' and c.subject = 'ask'
                   and c.subject_id in (select a.id from deletion_asks a where a.request_id = f.request_id))))
  ), ins as (
    insert into deletion_chases (business_id, subject, subject_id, step, asked_at)
    select d.business_id, d.subject, d.id, d.step, d.asked_at from due d
    on conflict (subject, subject_id, step) do nothing
    returning deletion_chases.subject_id, deletion_chases.subject, deletion_chases.step
  )
  select d.business_id, d.subject, d.id, d.step, d.asked_at, d.conversation_id
    from due d join ins i on i.subject_id = d.id and i.subject = d.subject and i.step = d.step;
end $$;
revoke all on function claim_deletion_chases() from public;
grant execute on function claim_deletion_chases() to nomi_app;

-- 0144's contract, with the chase record decided.
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
    ('deletion_chases', 'unrelated', null, null, null, null)
$$;

revoke all on function customer_erasure_contract() from public;

insert into _migrations (version, name) values (147, 'deletion_chases')
  on conflict (version) do nothing;
