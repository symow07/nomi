-- ---------------------------------------------------------------------------
-- 0045 — the SPF state the code has returned since G14, which the column has
-- always refused.
--
-- WHAT WAS WRONG. G14 added a fourth answer to "is her SPF record right?":
-- `no_sender`, meaning her record is fine and we cannot confirm it because no
-- sending provider is configured yet — the honest answer, and the one that
-- stops the page telling her to fix DNS that is already correct. The TYPE
-- gained the value; this CHECK did not:
--
--   spf_state text check (spf_state in ('missing','malformed','unauthorized','ok'))
--
-- `SENDING_SPF_INCLUDE` is unset in production (it arrives with the sending
-- provider, M52), so `checkSpf` returns `no_sender` for every well-formed
-- record — and `recordDomainCheck` writes the state unconditionally. Pressing
-- "check my domain" on /app/channels therefore raises a check-constraint
-- violation and a 500, on an owner action, in exactly the configuration
-- production is in today. No test caught it because every test sets the
-- include (tests/integration/sending-domain.test.ts) and so never produces the
-- state the column rejects.
--
-- WHAT THIS DOES. Widens all three columns to the code's own vocabulary. All
-- three share one `RecordState` type, so they get one list — a column that
-- accepts a subset of what its type can hold is the same defect waiting on a
-- different record. `RECORD_STATES` is now an exported array and an
-- integration test compares it against these constraints, so the two cannot
-- drift again.
--
-- Additive and forward-only (ADR-0007): no state is removed, and every row
-- already stored remains valid.
-- ---------------------------------------------------------------------------

alter table sending_domains drop constraint if exists sending_domains_spf_state_check;
alter table sending_domains add constraint sending_domains_spf_state_check
  check (spf_state in ('missing','malformed','unauthorized','no_sender','ok'));

alter table sending_domains drop constraint if exists sending_domains_dkim_state_check;
alter table sending_domains add constraint sending_domains_dkim_state_check
  check (dkim_state in ('missing','malformed','unauthorized','no_sender','ok'));

alter table sending_domains drop constraint if exists sending_domains_dmarc_state_check;
alter table sending_domains add constraint sending_domains_dmarc_state_check
  check (dmarc_state in ('missing','malformed','unauthorized','no_sender','ok'));

insert into _migrations (version, name) values (45, 'sending_domain_no_sender')
on conflict (version) do nothing;
