-- 0109 — supervision after promotion (R5, the onboarding plan's phase 6).
--
-- Spot checks sampled decided drafts only, and were offered only when a
-- draft was decided: supervision dropped to nothing exactly when work went
-- out alone. A self-demotion showed only on the assistant's timeline. And the
-- level page said "a mix" without saying which level the owner chose, or what
-- changed it.
--
--   · businesses.autonomy_level_chosen / _at — the level the owner last chose
--     on the assistant's page (waits, talks, sells), shown beside what is in
--     force. Null where the owner never chose one there.
--   · capability_events.alerted_at — when the owner was told of the system's
--     own demotion. Every row already written counts as told: only what
--     happens from now is news.
--   · claim_self_demotions() — the five-minute sweep's claim, on the plain
--     connection (there is no tenant to bind): each workspace's untold
--     demotions, marked told as they are returned, so two sweeps never send
--     one twice. Practice copies and switched-off workspaces are marked and
--     not returned.
--   · spot_check_workspaces() — the workspaces whose replies went out alone
--     in the last seven days (`auto_sent` events), for the daily sweep that
--     offers spot checks on that work.

alter table businesses
  add column if not exists autonomy_level_chosen text
    check (autonomy_level_chosen is null or autonomy_level_chosen in ('waits', 'talks', 'sells')),
  add column if not exists autonomy_level_chosen_at timestamptz;

alter table capability_events add column if not exists alerted_at timestamptz;
update capability_events set alerted_at = at where alerted_at is null;
create index if not exists capability_events_untold on capability_events (business_id)
  where alerted_at is null and actor = 'system_self_demoted';

create or replace function claim_self_demotions()
returns table (business_id uuid, capabilities text[], reasons text[])
language plpgsql volatile security definer set search_path = public as $$
begin
  return query
  with told as (
    update capability_events ce set alerted_at = now()
     where ce.actor = 'system_self_demoted' and ce.alerted_at is null
    returning ce.business_id, ce.capability, ce.reasons
  )
  select t.business_id,
         array_agg(distinct t.capability order by t.capability),
         coalesce((select array_agg(distinct r order by r) from told t2, unnest(t2.reasons) r
                    where t2.business_id = t.business_id and r <> ''), '{}')
    from told t
    join businesses b on b.id = t.business_id and b.practice_of is null and b.is_active
   group by t.business_id;
end $$;
revoke all on function claim_self_demotions() from public;
grant execute on function claim_self_demotions() to nomi_app;

create or replace function spot_check_workspaces()
returns table (business_id uuid)
language sql stable security definer set search_path = public as $$
  select distinct e.business_id
    from conversation_events e
    join businesses b on b.id = e.business_id and b.practice_of is null and b.is_active
   where e.type = 'auto_sent' and e.created_at >= now() - interval '7 days';
$$;
revoke all on function spot_check_workspaces() from public;
grant execute on function spot_check_workspaces() to nomi_app;

insert into _migrations (version, name) values (109, 'supervision')
on conflict (version) do nothing;
