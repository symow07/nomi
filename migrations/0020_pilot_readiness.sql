-- =============================================================================
-- 0020 — Pilot Management (M15.1)
--
-- Additive only. onboarding_state already holds lifecycle metadata (M11.2);
-- M15 adds the OWNER ATTESTATIONS the app cannot detect (backup tested, secrets
-- rotated, owner ready) plus the sandbox validation summary. Everything else in
-- the readiness hub is DERIVED from real data — no columns needed.
--
-- Attestations are timestamps ("confirmed by you · DATE"), kept clearly separate
-- in the UI from system-detected readiness. No scores, no percentages.
-- =============================================================================

alter table onboarding_state add column if not exists backup_tested_at    timestamptz;
alter table onboarding_state add column if not exists secrets_rotated_at   timestamptz;
alter table onboarding_state add column if not exists owner_ready_at       timestamptz;
alter table onboarding_state add column if not exists claims_reviewed_at   timestamptz;

-- Sandbox validation summary (M12.1 golden scenarios replayed through the real
-- engine). Summary only — no per-scenario history yet.
alter table onboarding_state add column if not exists last_validation_at    timestamptz;
alter table onboarding_state add column if not exists last_validation_pass  integer;
alter table onboarding_state add column if not exists last_validation_total integer;

insert into _migrations (version, name) values (20, 'pilot_readiness')
on conflict (version) do nothing;
