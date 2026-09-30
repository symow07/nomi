-- ---------------------------------------------------------------------------
-- 0087 — WHICH COPY IS MINE, without refreshing it (P3; docs/PRACTICE.md).
--
-- `practice_refresh(live)` (0086) creates the copy and brings it in line: the
-- write a practice MESSAGE needs. Drawing the Practice page, and asking every
-- twenty seconds whether a reply has arrived, need only the copy's id — and
-- row security shows a workspace its own business row, never its copy's. So
-- one more definer, read-only, with 0086's guard: only for the workspace the
-- caller is in, and null when it has not practised yet.
-- ---------------------------------------------------------------------------

create or replace function practice_copy(p_live uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select b.id from businesses b
   where b.practice_of = p_live
     and p_live = current_business_id()
$$;
revoke all on function practice_copy(uuid) from public;
grant execute on function practice_copy(uuid) to nomi_app;

insert into _migrations (version, name) values (87, 'practice_copy')
on conflict (version) do nothing;
