-- ---------------------------------------------------------------------------
-- 0206 — THE BUSINESS'S OWN IDENTIFIERS: ICE, IF, RC (Phase 5, E2).
--
-- Stored on the business, shown on its profile, carried into the FEC. A rule is checked only where an official
-- source publishes one (docs/PHASE-5.md, E2, quotes the sources):
--
--   · ICE — « composé de 15 positions : l'entreprise (9 positions), ses établissements (4 positions), caractères de
--     contrôle (2 positions) » (OMPIC's page on the ICE; the ICE portal's guide says the same). Fifteen positions, no
--     space. NOT checked: that they are digits (every official example is, no text says so) and the check key (no
--     official source publishes its computation).
--   · IF — no official source publishes its format (the DGI's site did not answer; the Simpl-IS EDI specification
--     defines no length). Stored as given, trimmed: no format rule.
--   · RC — the Code de commerce asks for « le numéro et le lieu de son immatriculation » (art. 49) and « le siège du
--     tribunal où il est immatriculé » (art. 154): a number is only a number at its court, so the two are kept
--     together, both or neither. No official source of today publishes the number's own format: no format rule.
--
-- The lengths below are storage bounds, not formats.
-- ---------------------------------------------------------------------------

alter table businesses add column if not exists legal_ice text;
alter table businesses add column if not exists legal_if text;
alter table businesses add column if not exists legal_rc text;
alter table businesses add column if not exists legal_rc_court text;

alter table businesses drop constraint if exists businesses_legal_ice_shape;
alter table businesses add constraint businesses_legal_ice_shape check (legal_ice is null or legal_ice ~ '^[^[:space:]]{15}$');
alter table businesses drop constraint if exists businesses_legal_if_bound;
alter table businesses add constraint businesses_legal_if_bound check (legal_if is null or (length(legal_if) between 1 and 40 and legal_if = btrim(legal_if)));
alter table businesses drop constraint if exists businesses_legal_rc_bound;
alter table businesses add constraint businesses_legal_rc_bound check (
  (legal_rc is null) = (legal_rc_court is null)
  and (legal_rc is null or (length(legal_rc) between 1 and 40 and legal_rc = btrim(legal_rc)))
  and (legal_rc_court is null or (length(legal_rc_court) between 1 and 80 and legal_rc_court = btrim(legal_rc_court))));

insert into _migrations (version, name) values (206, 'business_identifiers')
  on conflict (version) do nothing;
