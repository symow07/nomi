-- 0102 — sending alone is earned, in a workspace that signed itself up (G4,
-- the onboarding plan's phase 5; decision 8, taken as the plan recommends).
--
-- A workspace made by sign-up (`signed_up_at`, 0099) starts with every reply
-- waiting for its owner, whatever level is chosen, until `auto_earned_at` is
-- written — by the ramp (R2), or by the operator for a pilot (G7). Workspaces
-- the operator made, Westlake among them, keep their levels: for them the
-- answer is always yes. Stepping down is never refused.
--
-- sending_alone_earned() answers for current_business_id(), from the
-- workspace that pays: a practice copy has no sign-up of its own, and row
-- security would hide its owner's row from it, so Practice mirrors the
-- workspace exactly. A definer that answers only for the caller's own
-- business; outside a tenant transaction it says no.

create or replace function sending_alone_earned() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.signed_up_at is null or p.auto_earned_at is not null
      from businesses me
      join businesses p on p.id = coalesce(me.practice_of, me.id)
     where me.id = current_business_id()), false);
$$;
revoke all on function sending_alone_earned() from public;
grant execute on function sending_alone_earned() to nomi_app;

insert into _migrations (version, name) values (102, 'sending_alone_earned')
on conflict (version) do nothing;
