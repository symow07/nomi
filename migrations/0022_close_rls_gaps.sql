-- ---------------------------------------------------------------------------
-- 0022 — close the three objects that sat outside tenant isolation.
--
-- Found by the release security audit, empirically: scoped to tenant A as
-- `yiwuflow_app`, these three returned tenant B's rows — buyer display name,
-- buyer email, conversation summary, draft text and human-corrected sent text.
-- With no tenant set at all the views still returned everything, while the base
-- tables correctly returned nothing.
--
-- WHY the views leaked: a view runs with the privileges of its OWNER unless it
-- is declared `security_invoker`. Both were created by `postgres`, so RLS on
-- `conversations` / `drafts` was evaluated against a superuser and skipped —
-- the base tables were never the problem.
--
-- Nothing in src/ queries either view today (`training_examples` appears only
-- in a test, and shadow.turn_decisions is written by a route main.ts refuses to
-- mount), so this closes a latent hole rather than an active leak. ADR-0005
-- says the DATABASE refuses, not the developer; that has to be true of every
-- object the runtime role can reach, not just the ones the app happens to use.
--
-- Additive and forward-only (ADR-0007): no data is touched, no column dropped.
-- ---------------------------------------------------------------------------

-- (a) Views evaluate RLS as the CALLER, so the same policies that protect the
--     base tables now protect anything selected through them.
alter view active_conversations_summary set (security_invoker = true);
alter view training_examples            set (security_invoker = true);

-- (b) The shadow diff table carries business_id and was granted to the runtime
--     role with no row security at all. Same tenant pattern as every other
--     table (0005 §c): enabled, forced, one policy keyed on current_business_id().
alter table shadow.turn_decisions enable row level security;
alter table shadow.turn_decisions force row level security;
drop policy if exists tenant_isolation_app on shadow.turn_decisions;
create policy tenant_isolation_app on shadow.turn_decisions
  for all to yiwuflow_app
  using (business_id = current_business_id())
  with check (business_id = current_business_id());

insert into _migrations (version, name) values (22, '0022_close_rls_gaps')
  on conflict (version) do nothing;
