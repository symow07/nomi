-- ---------------------------------------------------------------------------
-- 0154 — Phase 4 gate, decision 2 (the owner, 2026-10-14): THE PILOT'S OWN
-- DECISIONS, ON THE PILOT LOG, EACH WITH THE DAY IT ENDS.
--
-- "Exempt, with two conditions: the exemption is recorded in the pilot log
-- with an end date, and it exempts BILLING only." The pilot log (0012) records
-- what the owner of the pilot business did and said; this lets it also carry
-- what the operator decided for the pilot — the billing exemption first — and
-- the day that decision ends, so the weekend triage says when one is due to be
-- undone (`tools/pilot-log.mjs decision`, `triage`). A decision's `kind` is
-- 'pilot_decision', apart from the nineteen observation kinds.
--
-- One column, nullable: every row written before has none, and an observation
-- never has one.
-- ---------------------------------------------------------------------------

alter table pilot_log add column if not exists ends_on date;

insert into _migrations (version, name) values (154, 'pilot_decisions')
  on conflict (version) do nothing;
