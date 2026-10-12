-- ---------------------------------------------------------------------------
-- 0148 — Phase 1 (the owner's roadmap, 2026-10-13): TRIAL-ABUSE SCORING.
--
-- Every sign-up leaves marks — its browser's sign-up cookie, its browser
-- fingerprint with its network, its network, its e-mail as a mailbox — each
-- only as a one-way code the app makes with its own key (never the address,
-- the e-mail or the header itself). A new sign-up is scored on how many
-- workspaces signed up within 180 days share a mark with it, and on how many
-- attempts its network and browser made in a day (core/owner/signupRisk.ts):
--
--   low     a free trial, where the installation offers one
--   medium  a card before the first channel, and no free trial
--   high    refused, said plainly, with a way to reach a person
--
-- The marks hold no business: a workspace that closes leaves them, which is
-- the point (the second trial comes after the first workspace is gone). They
-- are forgotten by age — an attempt after two days, a workspace's after 180 —
-- by the daily ops.signup_expiry job. The privacy and cookie pages say so.
--
-- What the score decided for a workspace is its own row (`signup_risk`), read
-- by billing: medium needs a card whatever the installation's switch says,
-- and gets no free trial. And the installation's free trial
-- (`self_serve_trial_days`), which the billing page and /refunds already
-- showed, is now what a low (or unscored) workspace's subscription starts
-- with: until here only a trial the operator granted by name was applied.
--
-- Forward-only (ADR-0007). An older build writes no marks and reads no risk;
-- every function below keeps its name and arguments.
-- ---------------------------------------------------------------------------

create table if not exists signup_marks (
  id      bigserial primary key,
  kind    text not null check (kind in ('device', 'fingerprint', 'network', 'email')),
  -- The app's keyed SHA-256 of the mark, in hex. Never the thing itself.
  digest  text not null check (digest ~ '^[0-9a-f]{64}$'),
  what    text not null check (what in ('attempt', 'workspace')),
  at      timestamptz not null default now()
);
create index if not exists signup_marks_lookup on signup_marks (kind, digest, what, at);
create index if not exists signup_marks_age on signup_marks (what, at);
alter table signup_marks enable row level security;
revoke all on signup_marks from public, nomi_app;
revoke all on sequence signup_marks_id_seq from public, nomi_app;

create table if not exists signup_risk (
  business_id uuid primary key references businesses(id) on delete cascade,
  tier        text not null check (tier in ('low', 'medium')),
  points      integer not null check (points >= 0),
  reasons     text[] not null default '{}'
              check (reasons <@ array['repeat_device', 'repeat_email', 'repeat_fingerprint', 'repeat_network', 'fresh_email', 'velocity']::text[]),
  scored_at   timestamptz not null default now()
);
alter table signup_risk enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'signup_risk' and policyname = 'signup_risk_tenant') then
    create policy signup_risk_tenant on signup_risk for select to nomi_app using (business_id = current_business_id());
  end if;
end $$;
revoke all on signup_risk from public, nomi_app;
grant select on signup_risk to nomi_app;

-- What a sign-up shares with the workspaces before it (180 days), and its attempts (a day), this one not counted.
create or replace function signup_marks_seen(p_device text, p_fingerprint text, p_network text, p_email text)
returns table (earlier_device integer, earlier_email integer, earlier_fingerprint integer, earlier_network integer,
               attempts_network integer, attempts_device integer)
language sql stable security definer set search_path = public as $$
  select
    (select count(*)::int from signup_marks where kind = 'device' and digest = p_device and what = 'workspace' and at > now() - interval '180 days'),
    (select count(*)::int from signup_marks where kind = 'email' and digest = p_email and what = 'workspace' and at > now() - interval '180 days'),
    (select count(*)::int from signup_marks where kind = 'fingerprint' and digest = p_fingerprint and what = 'workspace' and at > now() - interval '180 days'),
    (select count(*)::int from signup_marks where kind = 'network' and digest = p_network and what = 'workspace' and at > now() - interval '180 days'),
    (select count(*)::int from signup_marks where kind = 'network' and digest = p_network and what = 'attempt' and at > now() - interval '24 hours'),
    (select count(*)::int from signup_marks where kind = 'device' and digest = p_device and what = 'attempt' and at > now() - interval '24 hours')
$$;
revoke all on function signup_marks_seen(text, text, text, text) from public;
grant execute on function signup_marks_seen(text, text, text, text) to nomi_app;

-- An attempt: the form was sent and scored. Its network and its browser, for the day's count.
create or replace function signup_mark_attempt(p_device text, p_network text)
returns void
language sql volatile security definer set search_path = public as $$
  insert into signup_marks (kind, digest, what)
  select k, d, 'attempt' from (values ('device', p_device), ('network', p_network)) v(k, d) where d is not null
$$;
revoke all on function signup_mark_attempt(text, text) from public;
grant execute on function signup_mark_attempt(text, text) to nomi_app;

-- A workspace was made: its marks, and what the score decided. Only for a workspace that signed itself up, once.
create or replace function signup_mark_workspace(p_business uuid, p_device text, p_fingerprint text, p_network text,
                                                 p_email text, p_tier text, p_points integer, p_reasons text[])
returns boolean
language plpgsql volatile security definer set search_path = public as $$
begin
  if not exists (select 1 from businesses where id = p_business and signed_up_at is not null and practice_of is null)
     or exists (select 1 from signup_risk where business_id = p_business) then
    return false;
  end if;
  insert into signup_marks (kind, digest, what)
  select k, d, 'workspace' from (values ('device', p_device), ('fingerprint', p_fingerprint), ('network', p_network), ('email', p_email)) v(k, d)
   where d is not null;
  insert into signup_risk (business_id, tier, points, reasons) values (p_business, p_tier, p_points, coalesce(p_reasons, '{}'));
  return true;
end $$;
revoke all on function signup_mark_workspace(uuid, text, text, text, text, text, integer, text[]) from public;
grant execute on function signup_mark_workspace(uuid, text, text, text, text, text, integer, text[]) to nomi_app;

-- Forgotten by age, every day (ops.signup_expiry): an attempt after two days, a workspace's marks after 180.
create or replace function signup_marks_forget()
returns integer
language plpgsql volatile security definer set search_path = public as $$
declare n integer;
begin
  delete from signup_marks where (what = 'attempt' and at < now() - interval '2 days')
                              or (what = 'workspace' and at < now() - interval '180 days');
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function signup_marks_forget() from public;
grant execute on function signup_marks_forget() to nomi_app;

-- The free trial a workspace's subscription starts with: the operator's grant by name, else the installation's,
-- unless the sign-up scored medium (a card, no trial).
create or replace function trial_days_for(p_business uuid) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select w.trial_days from workspace_billing w where w.business_id = p_business),
    case when exists (select 1 from signup_risk r where r.business_id = p_business and r.tier = 'medium') then null
         else (select s.self_serve_trial_days from billing_settings s where s.id) end)
$$;
revoke all on function trial_days_for(uuid) from public;

-- 0117's, with the risk: a medium sign-up needs a card whatever the installation's switch says.
create or replace function billing_card_needed() returns boolean
language sql stable security definer set search_path = public as $$
  select (exists (select 1 from ops_flags where flag = 'billing_required' and cleared_at is null)
          or exists (select 1 from signup_risk r where r.business_id = current_business_id() and r.tier = 'medium'))
     and billed_workspace(current_business_id()) = current_business_id()
     and not exists (select 1 from workspace_billing w where w.business_id = current_business_id() and w.card_saved_at is not null)
$$;

-- 0117's, with the trial the subscription will really start with.
create or replace function billing_state()
returns table (billed boolean, exempt boolean, plan_id text, status text, card_saved_at timestamptz,
               trial_days integer, trial_started_at timestamptz, trial_ends_at timestamptz,
               current_period_end timestamptz, has_customer boolean, customers_this_month integer,
               first_channel_at timestamptz, self_serve_trial_days integer)
language sql stable security definer set search_path = public as $$
  select billed_workspace(current_business_id()) is not null,
         exists (select 1 from workspace_billing x where x.business_id = current_business_id() and x.exempt_by is not null),
         w.plan_id, coalesce(w.status, 'none'), w.card_saved_at,
         trial_days_for(current_business_id()),
         w.trial_started_at, w.trial_ends_at, w.current_period_end, w.stripe_customer_id is not null,
         (select count(*)::int from customers_answered a where a.business_id = current_business_id()
             and a.month = date_trunc('month', now() at time zone 'UTC')::date),
         first_channel_at(current_business_id()),
         (select s.self_serve_trial_days from billing_settings s where s.id)
    from (select current_business_id() as id) me
    left join workspace_billing w on w.business_id = me.id
$$;

-- 0117's, starting each subscription with that same trial.
create or replace function billing_to_subscribe()
returns table (business_id uuid, customer text, price text, trial_days integer, first_channel_at timestamptz)
language sql stable security definer set search_path = public as $$
  select w.business_id, w.stripe_customer_id, pl.stripe_price_id, trial_days_for(w.business_id), first_channel_at(w.business_id)
    from workspace_billing w join plans pl on pl.id = w.plan_id
   where w.card_saved_at is not null and w.stripe_customer_id is not null and w.stripe_subscription_id is null
     and w.exempt_by is null and first_channel_at(w.business_id) is not null
$$;

-- 0147's contract, with the workspace's risk row decided.
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
    ('signup_risk', 'unrelated', null, null, null, null)
$$;

revoke all on function customer_erasure_contract() from public;

insert into _migrations (version, name) values (148, 'signup_marks')
  on conflict (version) do nothing;
