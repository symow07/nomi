-- ---------------------------------------------------------------------------
-- 0149 — Phase 1 (the owner's roadmap, 2026-10-13): THE OPERATOR SEES WHAT THE
-- SIGN-UP CHECK DID.
--
-- A refused sign-up is told how to reach a person (0148). The operator should
-- not learn of a wrong refusal only when someone writes in: every refusal is
-- counted, with the reasons the score gave and its points — nothing a person
-- typed, no mark, no address — and the daily sign-up digest says how many
-- sign-ups were asked for a card first and how many were refused, and why.
-- Kept 30 days (the daily ops.signup_expiry job).
--
-- Forward-only (ADR-0007). An older build records no refusal; the digest then
-- counts none.
-- ---------------------------------------------------------------------------

create table if not exists signup_refusals (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  points  integer not null check (points >= 0),
  reasons text[] not null default '{}'
          check (reasons <@ array['repeat_device', 'repeat_email', 'repeat_fingerprint', 'repeat_network', 'fresh_email', 'velocity']::text[])
);
create index if not exists signup_refusals_at on signup_refusals (at);
alter table signup_refusals enable row level security;
revoke all on signup_refusals from public, nomi_app;
revoke all on sequence signup_refusals_id_seq from public, nomi_app;

create or replace function signup_mark_refused(p_points integer, p_reasons text[])
returns void
language sql volatile security definer set search_path = public as $$
  insert into signup_refusals (points, reasons) values (greatest(p_points, 0), coalesce(p_reasons, '{}'))
$$;
revoke all on function signup_mark_refused(integer, text[]) from public;
grant execute on function signup_mark_refused(integer, text[]) to nomi_app;

-- The day's check, for the digest: how many were asked for a card first, how many refused, and each reason's count.
create or replace function signup_check_since(p_since timestamptz)
returns table (outcome text, reason text, n integer)
language sql stable security definer set search_path = public as $$
  select 'card', null::text, count(*)::int from signup_risk where tier = 'medium' and scored_at >= p_since
  union all
  select 'refused', null, count(*)::int from signup_refusals where at >= p_since
  union all
  select 'card', r, count(*)::int from signup_risk, unnest(reasons) r where tier = 'medium' and scored_at >= p_since group by r
  union all
  select 'refused', r, count(*)::int from signup_refusals, unnest(reasons) r where at >= p_since group by r
$$;
revoke all on function signup_check_since(timestamptz) from public;
grant execute on function signup_check_since(timestamptz) to nomi_app;

-- 0148's, also forgetting a refusal after 30 days.
create or replace function signup_marks_forget()
returns integer
language plpgsql volatile security definer set search_path = public as $$
declare n integer; r integer;
begin
  delete from signup_marks where (what = 'attempt' and at < now() - interval '2 days')
                              or (what = 'workspace' and at < now() - interval '180 days');
  get diagnostics n = row_count;
  delete from signup_refusals where at < now() - interval '30 days';
  get diagnostics r = row_count;
  return n + r;
end $$;

insert into _migrations (version, name) values (149, 'signup_refusals')
  on conflict (version) do nothing;
