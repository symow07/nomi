# Environment variables

Everything the running process reads. **The app validates these at boot and
exits with the names of anything missing or malformed; it never prints a value.**

> This file previously described n8n environment variables — Supabase keys, a
> Telegram bot, SendGrid, mock callback URLs. None of it applied to this
> product. Rewritten in M25 against `validateEnv` and every `process.env` read
> in `src/`, and checked against both again in G21 (2026-09-12), which is when
> the `PORT` default here stopped saying 8080 and the pool settings stopped
> being undocumented.
>
> `tests/parity/g21-env-docs.test.ts` now fails if a variable the code reads is
> missing from this table, so the next drift is caught rather than noticed.

---

## Required, always

| Variable | Shape the boot check enforces | What it is |
|---|---|---|
| `DATABASE_URL` | starts with `postgres` | The **runtime** connection, as `nomi_app`. Boot refuses if this role is a superuser or bypasses RLS. |
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

## Hearing voice notes and seeing photos

Voice notes and photos are downloaded with the **messaging provider's own
credential** — the Meta token or the 360dialog key above. There is no separate
media setting to keep in step with it.

| Variable | Shape the boot check enforces | What it is |
|---|---|---|
| `TRANSCRIBE_API_KEY` | ≥ 20 chars, when set | Speech-to-text (Whisper). **Unset, she refuses every voice note** and tells the owner she could not hear it — never an answer to a question nobody heard. The one media setting that is its own account. |
| `TRANSCRIBE_BASE_URL` | starts with `https://`, when set | Only for a Whisper-compatible provider other than OpenAI's. |
| `SENDING_SPF_INCLUDE` | not checked at boot | The sending provider's own SPF mechanism (M40.1). Unset, it is taken from the mailbox she connected (`_spf.google.com` for Gmail, `spf.protection.outlook.com` for Outlook, C6); with neither, SPF reads as `no_sender` — present but unconfirmable — and sending stays refused. |
| `GOOGLE_OAUTH_CLIENT_ID` | both or neither, warned at boot | The installation's Google Cloud OAuth client, for "Connect Gmail" (C6). Needs `PUBLIC_BASE_URL`: the redirect is `<PUBLIC_BASE_URL>/app/connect/google/callback`. Scopes asked: `openid email gmail.send` — nothing that reads her mailbox. **Unset, Gmail shows "not set up here yet"** and no Connect button. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | both or neither, warned at boot | The secret of that client. Never shown; used only in the code exchange and token refresh. |
| `MICROSOFT_OAUTH_CLIENT_ID` | both or neither, warned at boot | The installation's Microsoft Entra app, for "Connect Outlook" (C6). Redirect `<PUBLIC_BASE_URL>/app/connect/microsoft/callback`; scopes `openid email offline_access Mail.Send`. **Unset, Outlook shows "not set up here yet".** |
| `MICROSOFT_OAUTH_CLIENT_SECRET` | both or neither, warned at boot | The secret of that app. |
| `EMAIL_WEBHOOK_SECRET` | not checked at boot | Shared secret for the provider's callbacks: bounce/complaint events at `/hooks/email` (M40.2) and buyers' replies at `/hooks/email/inbound` (C4.c). **Unset mounts neither.** The signature is HMAC-SHA256 over the raw bytes, base64url, in `x-webhook-signature` (G14). |
| `PUBLIC_BASE_URL` | starts with `https://`, when set | The address buyers reach this installation at. Every quote carries a proof link built on it (G11). **Unset, no link is attached** and the owner is told why on the conversation. https only: the link is forwarded to a stranger's phone. |

> Until G2b (2026-09-10) the worker was never given these, however the host was
> configured, so she refused every voice note and every photo in production.

## Optional

| Variable | Default | What it is |
|---|---|---|
| `PORT` | `8787` | HTTP port. (`Number(env.PORT) || 8787` in `validateEnv` — this table said 8080 for four months, which is the shape of drift G21 exists to remove.) |
| `NODE_ENV` | unset | `production` makes the three boot guards **refuse** rather than warn. |
| `SANDBOX_BUSINESS_ID` | the seeded sandbox | The practice tenant. Must never equal `PILOT_BUSINESS_ID`. |
| `SANDBOX_LIVE_AI` | unset | `1` offers Live-AI mode in the sandbox. It spends tokens; scripted is the default. |
| `EMPLOYEE_NAME` · `EMPLOYEE_AVATAR` | 小雅 · the Nomi mark | What the owner calls her. When `EMPLOYEE_AVATAR` is unset the header shows the brand mark (inline SVG, small cut); setting it to an emoji still wins, unchanged. |
| `ENGINE_VERSION` | `dev` | Stamped into quote audit rows (`db/repos.ts`). |
| `DATABASE_POOL_MAX` | `10` | Connections in the pool (`db/client.ts`). |
| `DATABASE_CONNECT_TIMEOUT_MS` | `10000` | How long a connection attempt waits. |
| `DATABASE_QUERY_TIMEOUT_MS` | `30000` | Server-side `statement_timeout`: a hung query returns an error instead of holding a pool slot for ever. |
| `MIGRATE_DATABASE_URL` | — | **Not read by the app.** Used by `tools/migrate.mjs` and `tools/provision-factory.mjs`; an admin role that can run DDL. Runtime and migration credentials should differ. |

---

## Verifying

```bash
npm run build && npm start          # exits listing anything missing or malformed
curl -s http://localhost:8787/health
```

`/health` reports `{ok, db, worker, provider}` and deliberately leaks nothing
about the build, the schema version or the tenant.
