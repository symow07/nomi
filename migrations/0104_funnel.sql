-- 0104 — the cohort's funnel, read from what is already on record (G9, the
-- onboarding plan's phase 5; decision 33's exit criteria).
--
-- Every step a stranger takes already leaves a dated row: the sign-up
-- (`signed_up_at`), each list imported and confirmed (`catalog_imports`), each
-- Practice item seen (`practice_checks.seen_at`), the name confirmed, the
-- first channel connected (channels, meta_accounts, mail_accounts — archived
-- or not), the first customer message, every draft decided or expired, the
-- first reply sent. So the funnel is a reading of those rows, never a second
-- record that could disagree with them.
--
--   · funnel_workspaces() — one row per workspace that signed itself up
--     (never a practice copy): its milestones and its drafts' figures, and
--     whether the operator acted on it before its first reply (a suspension,
--     the ramp lifted by hand, a password link) — decision 33's "with no
--     operator action they had to wait for".
--   · signup_forms_since(t) — sign-up forms sent since t, and how many came
--     back with their code. Counts only: never an address.
-- Both definers, on the plain connection (the operator's tools and the daily
-- list): there is no tenant to bind. No customer's words, ever.

create or replace function funnel_workspaces()
returns table (
  business_id uuid, name text, kind text, signed_up_at timestamptz,
  first_import_at timestamptz, first_import_confirmed_at timestamptz,
  checks jsonb, named_at timestamptz, connected_at timestamptz,
  first_customer_at timestamptz, first_reply_at timestamptz,
  drafts_decided integer, drafts_expired integer, median_decision_seconds double precision,
  operator_before_first_reply boolean
)
language sql stable security definer set search_path = public as $$
  with w as (
    select b.id, b.name, b.kind, b.signed_up_at, b.auto_earned_at, b.auto_earned_by
      from businesses b where b.signed_up_at is not null and b.practice_of is null
  ), m as (
    select w.*,
           (select min(created_at) from catalog_imports ci where ci.business_id = w.id) as first_import_at,
           (select min(confirmed_at) from catalog_imports ci where ci.business_id = w.id) as first_import_confirmed_at,
           coalesce((select jsonb_object_agg(pc.item, pc.seen_at) from practice_checks pc where pc.business_id = w.id), '{}'::jsonb) as checks,
           (select assistant_named_at from onboarding_state os where os.business_id = w.id) as named_at,
           least((select min(connected_at) from channels ch where ch.business_id = w.id and ch.connected_at is not null),
                 (select min(connected_at) from meta_accounts ma where ma.business_id = w.id),
                 (select min(connected_at) from mail_accounts mm where mm.business_id = w.id)) as connected_at,
           (select min(msg.sent_at) from messages msg join conversations c on c.id = msg.conversation_id
             where c.business_id = w.id and msg.direction = 'inbound') as first_customer_at,
           (select min(om.sent_at) from outbound_messages om
             where om.business_id = w.id and om.status in ('sent', 'delivered', 'read')) as first_reply_at,
           (select count(*)::int from drafts d where d.business_id = w.id and d.status in ('approved', 'edited', 'rejected')) as drafts_decided,
           (select count(*)::int from drafts d where d.business_id = w.id and d.status = 'expired') as drafts_expired,
           (select percentile_cont(0.5) within group (order by extract(epoch from d.decided_at - d.created_at))
              from drafts d where d.business_id = w.id and d.status in ('approved', 'edited', 'rejected') and d.decided_at is not null) as median_decision_seconds
      from w
  )
  select m.id, m.name, m.kind, m.signed_up_at, m.first_import_at, m.first_import_confirmed_at, m.checks, m.named_at,
         m.connected_at, m.first_customer_at, m.first_reply_at, m.drafts_decided, m.drafts_expired, m.median_decision_seconds,
         (exists (select 1 from workspace_suspensions s where s.business_id = m.id
                   and s.suspended_at < coalesce(m.first_reply_at, 'infinity'::timestamptz))
          or (m.auto_earned_by is not null and m.auto_earned_by <> 'ramp'
              and m.auto_earned_at < coalesce(m.first_reply_at, 'infinity'::timestamptz))
          or exists (select 1 from login_setups l where l.business_id = m.id
                      and l.created_at < coalesce(m.first_reply_at, 'infinity'::timestamptz))) as operator_before_first_reply
    from m
   order by m.signed_up_at;
$$;
revoke all on function funnel_workspaces() from public;
grant execute on function funnel_workspaces() to nomi_app;

create or replace function signup_forms_since(p_since timestamptz)
returns table (forms integer, codes_used integer)
language sql stable security definer set search_path = public as $$
  select count(*)::int, count(consumed_at)::int
    from login_codes where purpose = 'signup' and created_at >= p_since;
$$;
revoke all on function signup_forms_since(timestamptz) from public;
grant execute on function signup_forms_since(timestamptz) to nomi_app;

insert into _migrations (version, name) values (104, 'funnel')
on conflict (version) do nothing;
