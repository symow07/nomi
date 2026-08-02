# Deployment (M17.1)

Where Nomi runs, how to tell **which build** is live, and how to verify a
deploy without changing anything.

## The installation

| | |
|---|---|
| Host | Railway |
| Repo | `git@github.com:symow07/Flower.git`, branch `main` |
| Deploy trigger | push to `main` |
| Process | one Node service — Fastify (`/health` + `/app/*`) **and** the pg-boss worker in the same process (`src/main.ts` → `buildProduction`) |
| Database | Postgres (Railway), schema at migration **0021** |
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
bash .claude/skills/run-yiwuflow/verify-remote.sh https://<host> "$OWNER_ACCESS_CODE"
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

1. Merge to `main` → Railway builds and redeploys.
2. **If the change includes a migration**, apply it before/with the release:
   ```bash
   MIGRATE_DATABASE_URL='<admin url>' node tools/migrate.mjs
   ```
   Migrations are additive and forward-only (ADR-0007). Check the current version:
   ```bash
   psql "$MIGRATE_DATABASE_URL" -tAc "select max(version) from _migrations;"
   ```
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
bash .claude/skills/run-yiwuflow/smoke.sh
```

Ephemeral Postgres, migrate, seed both tenants, build, launch, and drive the full
owner walkthrough. Use this to reproduce a production problem locally — it runs
the same `buildProduction` path in `disabled` mode.
