# M10.1 — Production Readiness Checklist

Operational hardening before the Gate A pilot. No features; verification +
documentation. Audited 2026-07-28 against `main` @ M9-complete.

Legend: ✅ verified in code/tests/drill · ⚠️ needs a manual action (below).

## 1 · Secrets
- ✅ No real secret in git history — scanned all refs; only placeholders
  (`sk-ant-not-real-…`, `postgresql://u:p@h/db`) and redacted docs (`sk-ant-api03-…`).
- ✅ `.env` gitignored (`.env`, `.env.*`, `!.env.example`); `.env.example` is
  placeholders only (`CHANGE_ME`).
- ✅ Never logged: `validateEnv` prints variable *names* only (fail-closed path
  now covered by a leak test); generated secrets return names, not values, and
  append to `.env` at `0600`, never overwriting; `redactSecrets` +
  `credentialFingerprint` guard app logs and audit rows.
- ✅ Never rendered in UI: no Command Center route reads `process.env`/config;
  `/` → `/login`; `/health` returns `{ok,db,worker,provider}` only.
- ✅ Encrypted credentials survive key handling: AES-256-GCM with `keyVersion`;
  round-trip, wrong-key, and tamper cases tested (`m3-worker.test.ts`).
- ✅ Rotation documented: `SECRET-ROTATION.md` (per-secret blast radius; the
  `CREDENTIAL_KEY` re-encrypt procedure).
- ⚠️ Rotate the chat-exposed `ANTHROPIC_API_KEY` and Railway admin `DATABASE_URL`
  at source before production (see §Remaining).

## 2 · Database safety
- ✅ Reproducible from empty — drill run 2026-07-28: fresh DB → `tools/migrate.mjs`
  (baseline + 15 migrations) → `tools/seed-demo.mjs` (12 products / 6 buyers /
  5 conversations / 2 trust events) → verified as the **runtime** `nomi_app`
  role under RLS (demo tenant sees rows; a different tenant sees 0) → re-migrate
  idempotent (0 new) → dropped. Clean pass.
- ✅ Restore procedure documented — `OPS-RUNBOOK.md` (pg_dump `-Fc` → restore to a
  FRESH db → `npm run check` + retrieval check → time it) and
  `POSTGRES-MIGRATION-RUNBOOK.md`.
- ⚠️ Confirm Railway automated backups/PITR in the console and perform the
  pg_dump/restore drill against the live host once (record date/duration in
  OPS-RUNBOOK). Needs the live DB URL — do after rotating it.

## 3 · Deployment reliability
- ✅ Env validation fail-closed: unknown provider, placeholder, missing, or
  wrong-shape → non-zero exit with names only (`validateEnv`, tested).
- ✅ `/health` probes the DB live and returns `503` when down.
- ✅ Worker starts with the process (`startWorker` owns pool + pg-boss; ingress
  reuses both); disabled mode brings up health + worker infra, no messaging.
- ✅ Graceful shutdown: SIGTERM/SIGINT → stop accepting → stop pg-boss → destroy
  pool; idempotent; 10s force-exit so a deploy never hangs.
- ✅ Railway deploy verified live earlier (health `200`, disabled mode).

## 4 · Observability
- ✅ Startup logs: mode + port + provider; generated-secret and login-code notices
  (names/one-time only).
- ✅ Worker/provider failures: pg-boss retries with backoff (`retryLimit` 5/3).
- ✅ Dead-letter visibility: every queue has a `<name>.dead` target; the worker
  consumes `.dead` and emits a `dead_letter` notification (`worker/main.ts`).
- Runbooks in place: `OPS-RUNBOOK.md`, `INCIDENT-PLAYBOOK.md`, `WABA-RUNBOOK.md`.
  No new monitoring system added (per milestone).

## 5 · Recovery
- ✅ Migrations + seed reproduce from clean (drill above).
- ✅ Rollback path documented (`POSTGRES-MIGRATION-RUNBOOK.md §9`).
- ⚠️ Live backup/restore drill against Railway — see §2.

## Remaining manual actions (outside the code)
1. **Rotate at source**: `ANTHROPIC_API_KEY` and the Railway admin `DATABASE_URL`
   (both exposed in a setup chat). `SECRET-ROTATION.md`.
2. **Runtime DB role**: point the Railway service at `nomi_app` (RLS-enforced)
   instead of the `postgres` superuser used for initial bring-up.
3. **Backups**: confirm Railway backup schedule/PITR; run one pg_dump/restore
   drill and record it in `OPS-RUNBOOK.md`.
4. **Set explicit `OWNER_ACCESS_CODE`** in the host so the login code is never
   generated-and-logged.
5. **Provider go-live**: supply the 4 Meta credentials to flip
   `WHATSAPP_PROVIDER=disabled` → `meta` (`META-CLOUD-API-SETUP.md`).
