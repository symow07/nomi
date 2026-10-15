-- ---------------------------------------------------------------------------
-- 0163 — A WITHDRAWAL IS NARROWED TO THE LANGUAGE IT HAPPENED IN (the owner,
-- 2026-10-15: "Narrow it to the language it happened in… Leave the
-- earned-rung part alone for now.")
--
-- Before: a reply the assistant kept that failed its guards (twice over, or an
-- Arabic reply it could not write without a gender) dropped the capability to
-- "waits" in `autonomy_policy`, which is keyed (workspace, capability) — so one
-- Arabic reply made English and Chinese buyers wait too.
--
-- Now the turn records the withdrawal for (capability, language) here and
-- leaves `autonomy_policy` as the owner set it; the send decision reads both.
-- A withdrawal stays until the owner chooses a level again, or grants the
-- capability, on the assistant's page (`lifted_at`, `lifted_by`). A reply
-- whose language nobody could tell still withdraws the capability everywhere,
-- as before: such a reply never goes alone anyway, so there is no narrower
-- place to put it.
--
-- Unchanged, on purpose: the earned rung is cleared as before (the owner:
-- "leave it alone for now"), and a spot check's withdrawal (the owner's verdict
-- on work sent alone) still spans every language.
-- ---------------------------------------------------------------------------

create table if not exists language_withdrawals (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references businesses(id) on delete cascade,
  capability       text not null,
  language         text not null check (language ~ '^[a-z]{2,3}$'),
  withdrawn_at     timestamptz not null default now(),
  reasons          text[] not null default '{}',
  lifted_at        timestamptz,
  lifted_by        text,
  check ((lifted_at is null) = (lifted_by is null))
);

-- One open withdrawal per capability and language: a second failure while one
-- stands changes nothing.
create unique index if not exists language_withdrawals_open
  on language_withdrawals (business_id, capability, language) where lifted_at is null;

alter table language_withdrawals enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'language_withdrawals' and policyname = 'language_withdrawals_tenant') then
    create policy language_withdrawals_tenant on language_withdrawals
      for all to nomi_app
      using (business_id = current_business_id())
      with check (business_id = current_business_id());
  end if;
end $$;

grant select, insert, update on language_withdrawals to nomi_app;
revoke delete, truncate on language_withdrawals from nomi_app;

-- The language the system's own step back was narrowed to; null = every language.
alter table capability_events add column if not exists language text
  check (language is null or language ~ '^[a-z]{2,3}$');

-- The five-minute alert names the language: each untold step back narrowed to
-- one as 'capability:language' (`narrowed`), and the capabilities that stepped
-- back in every language (`everywhere`), beside the list it always returned.
-- The return type changes, so the function is dropped and made again; the app
-- reads it by column name.
drop function if exists claim_self_demotions();
create function claim_self_demotions()
returns table (business_id uuid, capabilities text[], reasons text[], narrowed text[], everywhere text[])
language plpgsql volatile security definer set search_path = public as $$
begin
  return query
  with told as (
    update capability_events ce set alerted_at = now()
     where ce.actor = 'system_self_demoted' and ce.alerted_at is null
    returning ce.business_id, ce.capability, ce.reasons, ce.language
  )
  select t.business_id,
         array_agg(distinct t.capability order by t.capability),
         coalesce((select array_agg(distinct r order by r) from told t2, unnest(t2.reasons) r
                    where t2.business_id = t.business_id and r <> ''), '{}'),
         coalesce(array_agg(distinct t.capability || ':' || t.language order by t.capability || ':' || t.language)
                    filter (where t.language is not null), '{}'),
         coalesce(array_agg(distinct t.capability order by t.capability) filter (where t.language is null), '{}')
    from told t
    join businesses b on b.id = t.business_id and b.practice_of is null and b.is_active
   group by t.business_id;
end $$;
revoke all on function claim_self_demotions() from public;
grant execute on function claim_self_demotions() to nomi_app;

-- 0162's contract, and the new table in it (D19, 0144): without it every customer erasure would refuse.
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
    ('language_withdrawals', 'unrelated', null, null, null, null)
$$;

revoke all on function customer_erasure_contract() from public;

insert into _migrations (version, name) values (163, 'language_withdrawals')
  on conflict (version) do nothing;
