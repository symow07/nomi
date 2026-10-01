-- 0108 — the first five replies in each language wait for a person (LG, the
-- onboarding plan's phase 6; decision 16, "trust first").
--
-- Since #143 a reply goes alone only in a language whose disclosure a native
-- reader signed off; LG decides that language by fixed rules (the turn's
-- `gate`). In a workspace that signed itself up, it goes alone only once five
-- replies in that language went out as drafts someone approved or edited — a
-- conversation the owner marked "this is me testing" counts toward nothing.
--
--   · language_proven(language) — for the CURRENT business, from the
--     workspace that pays: always yes where the operator made the workspace
--     or opened it as a pilot (as `earned_rung()`); a practice copy answers
--     as its workspace. Each draft's language is the `gate` its
--     `draft_pending` event recorded, or before LG the reply's `language` —
--     counting is retroactive, as the ramp's is.

create or replace function language_proven(p_language text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
             when p.signed_up_at is null then true
             when p.auto_earned_at is not null and coalesce(p.auto_earned_by, 'operator') <> 'ramp' then true
             else (select count(*) from (
                     select 1
                       from conversation_events e
                       join drafts d on d.id::text = e.payload->>'draftId' and d.business_id = p.id
                       join conversations c on c.id = e.conversation_id
                      where e.business_id = p.id and e.type = 'draft_pending'
                        and lower(left(coalesce(e.payload->>'gate', e.payload->>'language'), 2)) = lower(left(p_language, 2))
                        and d.status in ('approved', 'edited')
                        and not coalesce(c.owner_testing, false)
                      limit 5) x) >= 5
           end
      from businesses me
      join businesses p on p.id = coalesce(me.practice_of, me.id)
     where me.id = current_business_id()), false);
$$;
revoke all on function language_proven(text) from public;
grant execute on function language_proven(text) to nomi_app;

insert into _migrations (version, name) values (108, 'language_proven')
on conflict (version) do nothing;
