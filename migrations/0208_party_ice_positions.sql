-- ---------------------------------------------------------------------------
-- 0208 — ONE RULE FOR THE ICE: a party's is checked as the business's (Phase 5, E2; the owner, 2026-10-23).
--
-- 0170 checked a party's ICE as fifteen DIGITS; 0206 checks the business's own as fifteen POSITIONS, none a space.
-- OMPIC says « composé de 15 positions » and no official text says the positions are digits, so 0206's rule is the
-- source's. Two rules for one identifier in one system is its own defect, whichever is right: a party's ICE now
-- holds to the business's rule, exactly. Every party stored under 0170 already meets it (fifteen digits are fifteen
-- positions), so nothing is refused that was kept.
-- ---------------------------------------------------------------------------

alter table parties drop constraint if exists parties_ice_check;
alter table parties drop constraint if exists parties_ice_shape;
alter table parties add constraint parties_ice_shape check (ice is null or ice ~ '^[^[:space:]]{15}$');

insert into _migrations (version, name) values (208, 'party_ice_positions')
  on conflict (version) do nothing;
