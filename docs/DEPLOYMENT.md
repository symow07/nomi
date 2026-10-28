# Deployment (M17.1)

Where Nomi runs, how to tell **which build** is live, and how to verify a
deploy without changing anything.

## The installation

| | |
|---|---|
| Host | Railway. Project `nomi`, service `nomi` (renamed from `Flower` on 2026-08-12; the service ID is unchanged, so the GitHub trigger and every variable that is not derived from the name were unaffected). |
| Repo | `git@github.com:symow07/nomi.git`, branch `main` |
| Deploy trigger | push to `main` |
| Generated domain | **Does not follow the service name.** Renaming the service left the generated `*.up.railway.app` host exactly as it was — it is a separate resource, minted once at creation. `RAILWAY_SERVICE_NAME` and the derived `RAILWAY_SERVICE_<NAME>_URL` changed; `RAILWAY_PUBLIC_DOMAIN`, `RAILWAY_STATIC_URL` and `RAILWAY_PRIVATE_DOMAIN` did not. Nothing in this repo reads any of them. |
| Process | one Node service — Fastify (`/health` + `/app/*`) **and** the pg-boss worker in the same process (`src/main.ts` → `buildProduction`) |
| Database | Postgres 18 (Railway). The schema version this build requires is `REQUIRED_SCHEMA_VERSION` in `src/db/schemaVersion.ts` — read it there rather than from a number written down here, which is how this row came to say 0021 while the build needed 24. |
| Database name | `railway` — Railway's default, and the only application database on this cluster. The cluster holds exactly `postgres`, `railway`, `template0`, `template1`. |
| Messaging | `WHATSAPP_PROVIDER=meta` since 2026-09-18: a Meta-issued `+1 555` number on the Cloud API, signed by its own Meta app (`META_APP_SECRET`), reached the way `docs/META-CLOUD-API-SETUP.md` §8 describes because the WhatsApp product tile is hidden for this developer account. Instagram and Messenger run beside it from the owner's self-connected Page and `META_SOCIAL_APP_SECRET` (a different Meta app). WhatsApp receives; replying waits on the workspace's own activation checklist. |

> **Not recorded here on purpose:** the production URL, the owner access code,
> and every secret value. Fill in the URL below once, locally — do not commit it
> if the deployment is not meant to be discoverable.
>
> ```
> PROD_URL = ____________________________
> ```

### Access the host

The Railway CLI needs an interactive browser login:

```bash
railway login          # opens a browser; `railway status` fails with "Unauthorized" until you do
railway status         # project / environment / service
railway domain         # the public URL
railway variables      # env var NAMES (values are secrets — do not paste them anywhere)
```

## Which build is running?

Deliberately **not** on `/health` — a public probe should not advertise the
commit. It is on the owner-authenticated **Pilot readiness** page
(`/app/onboarding` → *This installation*):

| Field | Source | When missing |
|---|---|---|
| Running version | `RAILWAY_GIT_COMMIT_SHA` (short) + `RAILWAY_GIT_BRANCH` | *Not reported* |
| Environment | `RAILWAY_ENVIRONMENT_NAME`, else `NODE_ENV`, else `local` | — |
| Messaging | `WHATSAPP_PROVIDER` | *Not active* when `disabled` |
| Running since | process uptime | — |

Railway sets the `RAILWAY_*` variables automatically. Nothing is inferred: if the
host does not report a value, the page says *Not reported* rather than guessing.

`/health` stays minimal and public:

```json
{"ok":true,"db":true,"worker":true,"provider":"disabled"}
```

## Verify a deployment (read-only)

```bash
bash .claude/skills/run-nomi/verify-remote.sh https://<host> "$OWNER_ACCESS_CODE"
```

Only GETs plus one login POST — it never posts an owner action, never touches
the sandbox, and never sends a message. Safe against production. It checks:

- `/health` is `ok` **and** `db:true`, and leaks no build information
- every owner surface (`/app`, `/app/inbox`, `/app/factory`, `/app/onboarding`, `/app/sandbox`) redirects when signed out
- an owner **action** rejects anonymous callers
- while WhatsApp is disabled, `/webhook/whatsapp` is **404** (not mounted); `/webhook/messenger` and `/webhook/instagram` answer the handshake (403 on a wrong token) once `META_PAGE_*` is set
- the session cookie is `Secure` + `HttpOnly` + `SameSite=Lax` (over https)
- Today, My factory, Buyers, the go-live runbook and Knowledge all render for a logged-in owner
- reports the running version

It refuses to log in over plain `http` to a non-local host, so the access code
cannot leak. Without an access code it runs the public checks only and exits 0.

Exit 0 = all checks passed; exit 1 = first failure, with detail.

## After paying Railway — in this order, all before 2026-12-01

Production is stopped (found 2026-10-27, read-only): the `nomi` and `Postgres` services' last deployments are
REMOVED (`nomi`'s is #353), the `backup` cron's runs are SKIPPED, and `app.nomidoes.com` answers Railway's
"Application not found". The Postgres volume (`postgres-volume`, `/var/lib/postgresql/data`, 774 MB of 5,000) is Ready
and not pending deletion. Railway stops reading `railway.json` on **2026-12-01**, so the move off it rides on the same
return (the owner's order, 2026-10-27):

1. **Pay; bring Postgres back; take a fresh backup** (`BACKUP-RESTORE.md`, both parts — the dump and the roles, drill
   passed). The newest laptop copy is 2026-10-16. Nothing else starts before this backup.
1. **Done 2026-10-27:** Railway paid, Postgres back, backup `nomi-backup-20261027T170007Z` (drill 4/4).
2. **Done 2026-10-28, by the API:** the two deploy settings written on the service itself. The dashboard could not
   take them: while `railway.json` set them, both fields read "The value is set in /railway.json" and were locked.
   The service held neither underneath, so removing the file first would have deployed with no migration and no
   health check. Railway's `update-service` (MCP), on `nomi` in production only, live (not staged):
   - Pre-deploy Command: `node tools/migrate.mjs`
   - Healthcheck Path: `/health`

   It started no deploy and staged nothing. Before and after, the same 54 variable names, the same source
   (`symow07/nomi`, `main`), domains, builder and region; only those two fields changed.
3. **Done 2026-10-28, read-only:** the service's config shows both under `deploy`.
4. **One PR removes `railway.json`** (this one), with `tests/parity/uptime-heartbeat.test.ts` holding that no config
   file comes back. Merged through `tools/gated-merge.sh` on the owner's word. Its merge deploys: check that the
   deployment's settings show both values from the service (no file icon), that its log shows the migrator ran with
   nothing to apply, SUCCESS, `/health`, and `schema_version` equal to `REQUIRED_SCHEMA_VERSION`.
5. **Done 2026-10-27, unasked:** the merge of #395 deployed #354–#395 (0161–0217) by itself; Railway auto-deploys
   `main`, and the owner keeps it on (2026-10-28). Every merge to `main` is a deploy from now on.

**THE TRAP — `railway config apply` wipes the service's variables.** Do not move `railway.json` to Railway's
Infrastructure as Code (`.railway/railway.ts`). Seen twice:
- **2026-09-16:** `railway config plan` proposed deleting all twenty of the service's variables (`CREDENTIAL_KEY` and
  `DATABASE_URL` among them) and unlinking its GitHub source. The format describes a service completely, and a file
  in a public repository cannot hold the secrets, so it does not declare them; applying it would have removed them.
- **2026-10-27:** `railway config migrate` (dry run) again wrote the pre-deploy command as a comment only, so applying
  its file would also have dropped the migrations before each deploy.
Nothing was applied either time. `railway config migrate --apply` also clears the service's Config File setting on
Railway: it is a production change, not a file conversion. The service settings of step 2 replace `railway.json`
with nothing to apply.

### Where the two deploy settings live

On the `nomi` service itself (Railway → `nomi` → Settings → Deploy), since 2026-10-28:
- Pre-deploy Command: `node tools/migrate.mjs`
- Healthcheck Path: `/health`

No `railway.json` or `railway.toml` may come back: a config file overrides the service for every deploy it is in.
Read them back with the Railway MCP's `get-service-config` (the `deploy` section) or the dashboard.

## Deploy

1. Merge to `main` → Railway builds, **runs the migrator, then redeploys.**
2. **Migrations apply automatically, before the new build boots.** The service's
   Pre-deploy Command is `node tools/migrate.mjs` ("Where the two deploy
   settings live", above).

   It runs between build and deploy, inside Railway's private network, with the
   service's own variables — so it reaches `postgres.railway.internal` directly
   and needs no TCP proxy.

   **Proof it ran (since 2026-10-28):** the log is not proof. #396's deploy ran
   with the command and its log held no "done" line, and Railway shows no
   pre-deploy log of its own. So every run prints `migrate: start · commit … ·
   deployment …` before it connects, and leaves its MARK on the database: the
   comment on `_migrations` names the time, Railway's commit
   (`RAILWAY_GIT_COMMIT_SHA`) and deployment (`RAILWAY_DEPLOYMENT_ID`), and how
   many migrations it applied (`tools/lib/migrate-mark.mjs`). After every
   deploy, read-only:

   ```bash
   railway run --service Postgres -- sh -c 'MIGRATE_DATABASE_URL="$DATABASE_PUBLIC_URL" node tools/migrate-mark.mjs --expect <merge sha>'
   ```

   Exit 0 and "✓ The pre-deploy step ran for <sha>" is the proof; exit 4 means
   the last run was for another commit (or none), so the step did not run for
   this deploy. A mark that cannot be written is said in the log and does not
   fail the deploy: the migrations are what the deploy waits on.

   Until 2026-10-28 it came from `railway.json`, which Railway stops reading on
   2026-12-01; the move is "After paying Railway" above. **Do NOT migrate a
   config file with `railway config migrate`**,
   which was tried on 2026-09-16 and is a trap in two ways: the file it writes
   drops the pre-deploy command to a comment, and the format describes a service
   EXHAUSTIVELY — `railway config plan` proposed deleting all twenty environment
   variables (`CREDENTIAL_KEY` and `DATABASE_URL` among them) and unlinking the
   GitHub source, because a repository file cannot hold the secrets and so does
   not declare them. Nothing was applied; the plan output is the whole warning. **A non-zero exit aborts the deploy**: Railway does
   not retry it and does not start the new build, so a failed migration leaves
   the PREVIOUS build serving rather than a crashed one.

   You do not apply migrations by hand any more. That instruction lived here
   from M19 to M34.12 and took production down twice — 0025 and 0027 — because a
   step a human must remember is a step a human eventually forgets. The rule is
   the same; what changed is that the deploy enforces it instead of the runbook
   asking for it.

   `assertSchemaCurrent` STAYS as the backstop. It has now fired correctly twice
   and is the reason both outages were a refusal to boot rather than a service
   running against a schema it did not understand.

   **This is a real change to the deploy contract**, made deliberately: a bad
   migration now applies without a human in the loop. That is acceptable because
   migrations are additive and forward-only (ADR-0007) — an older build runs
   fine against a newer schema — and the runtime role holds no DDL, so nothing
   the application does can alter the schema afterwards.

   Back up first, both parts (`BACKUP-RESTORE.md`): a dump without its roles
   file restores with RLS enabled and zero policies.

### When the pre-deploy fails

The deploy stops and the previous build keeps serving. `/health` stays 200 — the
failure is in the deploy log, not in the service, so nothing pages you.

```bash
railway logs --deployment       # the migrator's own output: which file, which error
```

The migrator runs each file in a transaction and rolls back on error, so a
failed run leaves the schema where it was. Confirm before retrying:

```bash
node tools/migrate.mjs --status  # applied vs pending; expect the failed one still pending
```

Fix the migration, push again. Do not apply it by hand to "unblock" the deploy —
that puts the schema ahead of what any build has been tested against, and it is
how this file accumulated the manual step in the first place.

### If a deployment is CRASHED for some other reason

Railway does not retry a crashed deployment when the cause is fixed outside it.
The service stays down, still serving 502, until something pushes it:

```bash
railway redeploy -s <service> -y      # same commit; the environment is what changed
```

Observed 2026-08-08 with `0025`, and again 2026-08-12 with `0027`: the schema
reached the required version and `/health` stayed 502 until the redeploy was
issued by hand. A correct database and a down service is the expected
intermediate state there, not a second fault.

3. Verify: `verify-remote.sh https://<host> <code>` and confirm *Running version*
   on `/app/onboarding` matches the commit you just shipped.

## Rollback

Redeploy the previous commit from the Railway dashboard (Deployments → the last
good one → Redeploy). **Migrations do not roll back** — they are additive, so an
older build runs fine against a newer schema. Never hand-edit the schema to undo
a release.

If the problem is messaging rather than the build, disconnect the channel instead
of rolling back the app: `/app/channels` → Disconnect sets `channels.status =
'disconnected'`, which suppresses outbound at send time (see
`docs/GO-LIVE.md`).

## Local equivalent

```bash
bash .claude/skills/run-nomi/smoke.sh
```

Ephemeral Postgres, migrate, seed both tenants, build, launch, and drive the full
owner walkthrough. Use this to reproduce a production problem locally — it runs
the same `buildProduction` path in `disabled` mode.
