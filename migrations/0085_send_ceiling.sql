-- ---------------------------------------------------------------------------
-- 0085 — CEIL (the one-month build order, 2026-09-30): a send ceiling per
-- workspace, and Meta's error rate per workspace for the operator.
--
-- One stranger's spam can get our Meta app restricted, and then EVERY
-- workspace loses Instagram and Messenger at once. Two defences here:
--
--   · `businesses.daily_send_ceiling` — how many of the assistant's messages a
--     workspace may send in a day. It was one number for everybody, 200
--     (DAILY_OUTBOUND_CEILING). A workspace made from now on starts at 50; the
--     ones that exist keep 200. The operator raises it (tools/send-ceiling.mjs).
--     The owner's own replies are never counted, as before.
--
--   · `meta_error_rates(since)` — per workspace, how many messages went to
--     Meta's channels since then and how many Meta refused or lost, with the
--     provider's own words. The hourly check alerts the operator when a
--     workspace crosses the line (src/core/ops/metaErrors.ts). Our own gate's
--     refusals (`canceled: …`) are not Meta's errors and are not counted. A
--     definer function, like deletion_requests_due(): row security rightly
--     hides each workspace's sends from every other, and this question
--     belongs to whoever runs the installation.
-- ---------------------------------------------------------------------------

alter table businesses add column if not exists daily_send_ceiling integer;
update businesses set daily_send_ceiling = 200 where daily_send_ceiling is null;
alter table businesses alter column daily_send_ceiling set default 50;
alter table businesses alter column daily_send_ceiling set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'businesses_daily_send_ceiling_range') then
    alter table businesses add constraint businesses_daily_send_ceiling_range
      check (daily_send_ceiling between 1 and 10000);
  end if;
end $$;

create or replace function meta_error_rates(p_since timestamptz)
returns table (business_id uuid, business_name text, attempted integer, failed integer, errors text[])
language sql stable security definer set search_path = public as $$
  select o.business_id, b.name,
         count(*)::int as attempted,
         count(*) filter (where o.status in ('failed', 'uncertain'))::int as failed,
         coalesce((array_agg(distinct left(o.last_error, 60))
                    filter (where o.status in ('failed', 'uncertain') and o.last_error is not null))[1:5], '{}') as errors
    from outbound_messages o
    join businesses b on b.id = o.business_id
   where coalesce(o.channel, 'whatsapp') in ('whatsapp', 'instagram', 'messenger')
     and o.status in ('sent', 'delivered', 'read', 'failed', 'uncertain')
     and o.created_at >= p_since
   group by o.business_id, b.name
$$;
revoke all on function meta_error_rates(timestamptz) from public;
grant execute on function meta_error_rates(timestamptz) to nomi_app;

insert into _migrations (version, name) values (85, 'send_ceiling')
on conflict (version) do nothing;
