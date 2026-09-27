-- 0074 · app errors — what went wrong inside the installation (CC-10).
--
-- The audit: "If the app throws at 3 a.m. nobody learns." Every failure path
-- now writes here — a page that crashed (status >= 500), a queue job that
-- failed (inbound, outbound, notify, the scheduled jobs, a dead letter), and
-- the process itself (unhandledRejection / uncaughtException) — and the
-- operator is e-mailed through the operator alert path (`app_error`,
-- src/pipeline/notify.ts).
--
-- ONE ROW PER KIND OF ERROR, not per occurrence. `fingerprint` is a hash of
-- where it happened, the error's name and the first stack frame inside this
-- repository (src/worker/appErrors.ts); a recurrence bumps `count` and
-- `last_seen`. That is what keeps a flood from burying anyone: a fingerprint
-- is alerted when first seen and again only when it recurs six hours or more
-- after its last alert, and no more than six alerts leave in any hour — the
-- rest are held (`alert_held_at`) and counted in the next one.
--
-- WHAT IS KEPT is the error's name, its message with anything secret-shaped
-- removed and cut to 500 characters, the stack frame, and for a page the route
-- PATTERN — never the address asked (it can carry a token), never a request
-- body, never a buyer's words beyond what the error message itself holds.
--
-- OPERATOR DATA. No owner page reads it: tenants must never see each other's
-- errors, and the policy below makes the table invisible inside a tenant
-- transaction, where every page runs. The recorder writes on the plain pool,
-- outside any tenant. `business_id` is context only — no foreign key, so it
-- never blocks erasing a workspace; `tools/erase-workspace.mjs` and
-- `tools/prune-test-tenants.mjs` find this table by that column and take the
-- workspace's rows with everything else, and the backup drill's RLS check
-- (every business_id table: RLS on, at least one policy) holds for it.
--
-- The app role may select, insert and update — never delete, the rule the
-- rest of the schema follows (tests/integration/grants.test.ts).

create table if not exists app_errors (
  fingerprint     text primary key check (fingerprint ~ '^[0-9a-f]{16}$'),
  "where"         text not null check ("where" ~ '^(web|process|worker:[a-z0-9._-]{1,100})$'),
  name            text not null check (length(name) between 1 and 120),
  message         text not null check (length(message) <= 1000),
  frame           text check (length(frame) <= 300),
  route           text check (length(route) <= 300),
  business_id     uuid,
  first_seen      timestamptz not null default now(),
  last_seen       timestamptz not null default now(),
  count           bigint not null default 1 check (count >= 1),
  last_alerted_at timestamptz,
  alert_held_at   timestamptz
);

comment on table app_errors is
  'CC-10: one row per kind of error the installation hit (web >= 500, a failed queue job, the process). Operator data: read by tools/errors.mjs and the alert path, never by an owner page.';

-- The operator's question is "what went wrong lately".
create index if not exists app_errors_last_seen on app_errors (last_seen desc);
-- The alert budget counts the alerts of the last hour; the sweep takes the oldest held one.
create index if not exists app_errors_alerted on app_errors (last_alerted_at) where last_alerted_at is not null;
create index if not exists app_errors_held on app_errors (alert_held_at) where alert_held_at is not null;

alter table app_errors enable row level security;
drop policy if exists app_errors_outside_a_workspace on app_errors;
create policy app_errors_outside_a_workspace on app_errors
  for all to nomi_app
  using (current_business_id() is null)
  with check (current_business_id() is null);

grant select, insert, update on app_errors to nomi_app;
revoke delete, truncate on app_errors from nomi_app;

insert into _migrations (version, name) values (74, 'app_errors')
on conflict (version) do nothing;
