# Environment variables

Everything the running process reads. **The app validates these at boot and
exits with the names of anything missing or malformed; it never prints a value.**

> This file previously described n8n environment variables — Supabase keys, a
> Telegram bot, SendGrid, mock callback URLs. None of it applied to this
> product. Rewritten in M25 against `validateEnv` and every `process.env` read
> in `src/`.

---

## Required, always

| Variable | Shape the boot check enforces | What it is |
|---|---|---|
| `DATABASE_URL` | starts with `postgres` | The **runtime** connection, as `yiwuflow_app`. Boot refuses if this role is a superuser or bypasses RLS. |
| `ANTHROPIC_API_KEY` | ≥ 20 chars | Model calls. Never a source of prices or claims. |
| `WEBHOOK_VERIFY_TOKEN` | ≥ 16 chars | The string the provider echoes back during webhook verification. You choose it. |
| `CREDENTIAL_KEY` | 64 hex chars | Encrypts stored channel credentials, and derives the owner session secret. **Boot refuses in production if this was generated rather than supplied** — see below. |

### `CREDENTIAL_KEY` must come from the host, not from `.env`

If it is unset, boot generates one and appends it to `.env`. That file does not
survive a deploy on an ephemeral host, so the next boot generates a **different**
key. At that moment, irreversibly:

- every credential in `channel_credentials` becomes undecryptable — the
  ciphertext is intact and nothing can ever read it again, so the channel goes
  dark until it is re-authorised with the provider;
- every owner session is invalidated, because the web session secret is derived
  from this key. The owner is logged out of a product that has just stopped
  working.

`validateEnv` cannot catch this. Generation runs first and always succeeds, so
by the time validation looks the variable is present and correctly shaped.
**Presence is not stability.** In production the boot guard therefore refuses to
serve; outside production it warns.

To fix an installation that is already in this state, take the value that boot
generated *before* redeploying:

```bash
grep ^CREDENTIAL_KEY= .env     # then set it in the host environment
```

If `.env` is already gone, the stored credentials cannot be recovered and the
channel must be re-authorised — see `SECRET-ROTATION.md`.

## Required for the owner surface

| Variable | What it is |
|---|---|
| `PILOT_BUSINESS_ID` | **Which factory this deployment serves.** Boot refuses if it is unset, names a business that does not exist, or names the practice sandbox. Get it from `tools/provision-factory.mjs`. |
| `OWNER_ACCESS_CODE` | The owner's only credential. If unset a random one is generated **per boot** and logged once — set it explicitly, or the code changes on every deploy. |

## Messaging — off unless set

| Variable | What it is |
|---|---|
| `WHATSAPP_PROVIDER` | `meta`, `360dialog`, or `disabled` (the default). While disabled there is no adapter, no webhook route and no outbound worker. |
| `META_WHATSAPP_ACCESS_TOKEN` · `META_WHATSAPP_PHONE_NUMBER_ID` · `META_WHATSAPP_BUSINESS_ACCOUNT_ID` · `META_APP_SECRET` | Required when the provider is `meta`. Shapes are defined once in `core/channel/metaReadiness.ts`, so the boot check and the owner-facing readiness page cannot disagree. |
| `META_GRAPH_API_VERSION` | e.g. `v23.0`. Defaults to `v23.0`. |
| `META_TEMPLATE_NAMES` | Comma-separated names of message templates Meta has **actually approved**. Empty (the default) means a conversation older than 24 hours goes back to the owner instead of being re-opened. Nothing in the product calls Meta to check this — an operator records what was granted. |
| `D360_API_KEY` · `D360_BASE_URL` · `WEBHOOK_SECRET` | Required only when the provider is `360dialog`. |

## Optional

| Variable | Default | What it is |
|---|---|---|
| `PORT` | `8080` | HTTP port. |
| `NODE_ENV` | unset | `production` makes the three boot guards **refuse** rather than warn. |
| `SANDBOX_BUSINESS_ID` | the seeded sandbox | The practice tenant. Must never equal `PILOT_BUSINESS_ID`. |
| `SANDBOX_LIVE_AI` | unset | `1` offers Live-AI mode in the sandbox. It spends tokens; scripted is the default. |
| `EMPLOYEE_NAME` · `EMPLOYEE_AVATAR` | 小雅 · 👩 | What the owner calls her. |
| `ENGINE_VERSION` | derived | Stamped into quote audit rows. |
| `MIGRATE_DATABASE_URL` | — | **Not read by the app.** Used by `tools/migrate.mjs` and `tools/provision-factory.mjs`; an admin role that can run DDL. Runtime and migration credentials should differ. |

---

## Verifying

```bash
npm run build && npm start          # exits listing anything missing or malformed
curl -s http://localhost:8080/health
```

`/health` reports `{ok, db, worker, provider}` and deliberately leaks nothing
about the build, the schema version or the tenant.
