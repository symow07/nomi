# Deployment (M17.1)

Where Nomi runs, how to tell **which build** is live, and how to verify a
deploy without changing anything.

## The installation

| | |
|---|---|
| Host | Railway |
| Repo | `git@github.com:symow07/nomi.git`, branch `main` |
| Deploy trigger | push to `main` |
| Process | one Node service — Fastify (`/health` + `/app/*`) **and** the pg-boss worker in the same process (`src/main.ts` → `buildProduction`) |
| Database | Postgres 18 (Railway). The schema version this build requires is `REQUIRED_SCHEMA_VERSION` in `src/db/schemaVersion.ts` — read it there rather than from a number written down here, which is how this row came to say 0021 while the build needed 24. |
| Database name | `railway` — Railway's default, and the only application database on this cluster. The cluster holds exactly `postgres`, `railway`, `template0`, `template1`; there is no `yiwuflow` database and there never was one here. Earlier revisions of this row described one, and a rename procedure for it. |
| Messaging | `WHATSAPP_PROVIDER=disabled` — no Meta credentials, no webhook mounted |

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
- while messaging is disabled, `/webhook/whatsapp` is **404** (not mounted)
- the session cookie is `Secure` + `HttpOnly` + `SameSite=Lax` (over https)
- Today, My factory, Buyers, the go-live runbook and Knowledge all render for a logged-in owner
- reports the running version

It refuses to log in over plain `http` to a non-local host, so the access code
cannot leak. Without an access code it runs the public checks only and exits 0.

Exit 0 = all checks passed; exit 1 = first failure, with detail.

## Deploy

1. Merge to `main` → Railway builds, **runs the migrator, then redeploys.**
2. **Migrations apply automatically, before the new build boots.** `railway.json`
   sets a pre-deploy command:

   ```json
   { "deploy": { "preDeployCommand": ["node tools/migrate.mjs"] } }
   ```

   It runs between build and deploy, inside Railway's private network, with the
   service's own variables — so it reaches `postgres.railway.internal` directly
   and needs no TCP proxy. **A non-zero exit aborts the deploy**: Railway does
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
