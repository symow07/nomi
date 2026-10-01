-- 0101 — the daily allowance, held to (G3, the onboarding plan's phase 5).
--
-- A workspace made since 0100 has a budget row with a hard cap. Until now the
-- cap was read only at the send gate — after the model had been paid. From
-- here it is asked BEFORE: a customer who writes once the day's allowance is
-- used is recorded, handed to a person in silence (`allowance_used`, the path
-- Stop takes), and no model is called.
--
--   · 'allowance_used' joins the hand-off reasons (both checks).
--   · usage_ledger.photo_reads — catalogue photos read today, for the limit of
--     20 a day (a refused read counts: it was paid for).
--   · allowance_today() — the day's numbers for the CURRENT business, read
--     from the workspace that pays: a practice copy spends its owner's
--     allowance (P5), and row security would hide that row from the copy. A
--     definer that answers only for current_business_id(), so no workspace
--     can read another's.
--   · allowance_alerts + claim_allowance_alerts() — the owner's e-mail at the
--     soft-warn line (80%) and at 100%, each once a UTC day: the claim writes
--     the row and returns it, so two sweeps never send one twice.

alter table conversation_signals drop constraint if exists conversation_signals_kind_check;
alter table conversation_signals add constraint conversation_signals_kind_check
  check (kind in (
    'human_requested','complaint','repeated_ambiguity',
    'low_confidence_image','high_value','customization_requested',
    'logistics_discussed','moq_accepted','price_acknowledged',
    'audio_unheard','media_unreadable','unlisted_number','email_reply',
    'assistant_stopped','ops_silenced','deletion_requested','not_answered','price_to_owner',
    'allowance_used'));

alter table escalation_events drop constraint if exists escalation_events_trigger_reason_check;
alter table escalation_events add constraint escalation_events_trigger_reason_check
  check (trigger_reason in (
    'high_value','unclear_product','customization','complex_negotiation',
    'repeated_ambiguity','client_request','logistics_payment','manual',
    'low_confidence_image','audio_unheard','media_unreadable','unlisted_number','email_reply',
    'assistant_stopped','ops_silenced','deletion_requested','not_answered','price_to_owner',
    'allowance_used'));

alter table usage_ledger add column if not exists photo_reads integer not null default 0;

create or replace function allowance_today()
returns table (daily_llm_calls integer, daily_tokens bigint, soft_warn_pct integer, on_exceeded text,
               used_calls integer, used_tokens bigint, photo_reads integer)
language sql stable security definer set search_path = public as $$
  select b.daily_llm_calls, b.daily_tokens, b.soft_warn_pct, b.on_exceeded,
         coalesce(u.llm_calls, 0), coalesce(u.input_tokens, 0) + coalesce(u.output_tokens, 0),
         coalesce(u.photo_reads, 0)
    from businesses me
    left join tenant_budgets b on b.business_id = coalesce(me.practice_of, me.id)
    left join usage_ledger u on u.business_id = coalesce(me.practice_of, me.id)
                            and u.day = (now() at time zone 'UTC')::date
   where me.id = current_business_id();
$$;
revoke all on function allowance_today() from public;
grant execute on function allowance_today() to nomi_app;

create table if not exists allowance_alerts (
  business_id uuid not null references businesses(id),
  day date not null,
  -- 'warn' at the budget's soft-warn line, 'used' at 100%.
  level text not null check (level in ('warn', 'used')),
  sent_at timestamptz not null default now(),
  primary key (business_id, day, level)
);
alter table allowance_alerts enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'allowance_alerts' and policyname = 'allowance_alerts_tenant') then
    create policy allowance_alerts_tenant on allowance_alerts for all to nomi_app
      using (business_id = current_business_id()) with check (business_id = current_business_id());
  end if;
end $$;
grant select on allowance_alerts to nomi_app;
revoke insert, update, delete, truncate on allowance_alerts from nomi_app;

-- Every workspace with a hard cap that crossed a line today and was not yet
-- told: the rows are written here and returned once. 'used' implies 'warn'
-- (both rows are written), so a workspace that went past both between two
-- sweeps hears only the one that matters.
create or replace function claim_allowance_alerts()
returns table (business_id uuid, used boolean, pct integer)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_day date := (now() at time zone 'UTC')::date;
begin
  return query
  with pct as (
    select b.business_id, b.soft_warn_pct,
           greatest(100.0 * coalesce(u.llm_calls, 0) / nullif(b.daily_llm_calls, 0),
                    100.0 * (coalesce(u.input_tokens, 0) + coalesce(u.output_tokens, 0)) / nullif(b.daily_tokens, 0)) as p
      from tenant_budgets b
      join businesses z on z.id = b.business_id and z.practice_of is null and z.is_active
      left join usage_ledger u on u.business_id = b.business_id and u.day = v_day
     where b.on_exceeded = 'pause'
  ), due as (
    select pct.business_id, 'warn'::text as level from pct where pct.p >= pct.soft_warn_pct
    union all
    select pct.business_id, 'used'::text from pct where pct.p >= 100
  ), claimed as (
    insert into allowance_alerts (business_id, day, level)
    select due.business_id, v_day, due.level from due
    on conflict do nothing
    returning allowance_alerts.business_id, allowance_alerts.level
  )
  select claimed.business_id, bool_or(claimed.level = 'used'), floor(max(pct.p))::integer
    from claimed join pct on pct.business_id = claimed.business_id
   group by claimed.business_id;
end $$;
revoke all on function claim_allowance_alerts() from public;
grant execute on function claim_allowance_alerts() to nomi_app;

insert into _migrations (version, name) values (101, 'allowance')
on conflict (version) do nothing;
