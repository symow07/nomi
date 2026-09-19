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
| `ANTHROPIC_API_KEY` | ≥ 20 chars | Model calls. Never a source of prices or claims. Still required by the boot check when another provider is selected below; it is then unused. |
| `LLM_BASE_URL` · `LLM_API_KEY` · `LLM_MODEL` | **all three or none** — an `https://` address, a key of ≥ 16 chars, a model name | N6a — another model provider that speaks Anthropic's message format at its own address. DeepSeek: `https://api.deepseek.com/anthropic` and `deepseek-flash`. A half-set trio is treated as unset: a warning names the missing part and Anthropic keeps being used. Unset, nothing changes. **Buyers' messages are then sent to that company, under its terms and in its country — the privacy notice must name it.** The cost estimate in `tools/answer-paths.mjs` reads *unknown* for a model with no listed price. |
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
| `PILOT_BUSINESS_ID` | **The one factory the access code below opens.** Boot refuses if it is unset, names a business that does not exist, or names the practice sandbox. Get it from `tools/provision-factory.mjs`. Since A1 it is no longer the only factory: others sign themselves up (`SIGNUP_MODE`) and sign in with their own e-mail and password. |
| `OWNER_ACCESS_CODE` | The credential of THAT factory's owner, and only hers. If unset a random one is generated **per boot** and logged once — set it explicitly, or the code changes on every deploy. Factories that signed up never use it. |
| `SIGNUP_MODE` | A1 — who may create a workspace at `/signup`: `invite` (the default, and what unset or anything unrecognised means) needs a single-use link from `tools/invite-factory.mjs`; `open` lets anyone who reaches the page; `closed` shows a sentence and no form. Every workspace shares this installation's reply-writing key, so `open` is a decision about who may spend it. |
| `SYSTEM_SMTP_HOST` · `SYSTEM_SMTP_PORT` · `SYSTEM_SMTP_USER` · `SYSTEM_SMTP_PASSWORD` · `SYSTEM_SMTP_FROM` | A3 — mail from the INSTALLATION: the six-digit code sent when an account is made and when an unknown browser signs in. **All five or none** (the port defaults to 587); a half-set sender is treated as unset and a warning names the missing part. **Unset, nothing ever asks for a code** and sign-in works as before. Never used for a business's outreach — that is `SMTP_*` or her connected mailbox. With Google Workspace: `smtp.gmail.com`, port `465`, a mailbox such as `no-reply@…` with 2-step verification on, and an **app password** as the password. **On a host that blocks outgoing SMTP (Railway's Free, Trial and Hobby plans do) SMTP can never connect**, so the code is tried FIRST over HTTPS through the operator's connected mailbox: the mailbox connected in the `PILOT_BUSINESS_ID` workspace, and only if its address equals `SYSTEM_SMTP_USER`; it is sent FROM `SYSTEM_SMTP_FROM`, which must then be an alias of that mailbox with a "Send mail as" entry. SMTP is the fallback. When neither can send, one log line (`system mail could not be sent`) names each way and why. |

## Messaging — off unless set

| Variable | What it is |
|---|---|
| `WHATSAPP_PROVIDER` | `meta`, `360dialog`, or `disabled` (the default). While disabled there is no WhatsApp adapter and no `/webhook/whatsapp`. Deployment mode — no outbound worker at all — is only when no other channel is configured either; with `META_PAGE_*` set, Instagram and Messenger run without a number (2026-09-17). |
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
| `META_SOCIAL_APP_ID` | digits | The id of the Meta app whose secret is `META_SOCIAL_APP_SECRET` (this installation: `nomi-social`). With `META_LOGIN_CONFIG_ID` it turns on **Connect your Facebook Page and Instagram** (C10): a business connects its OWN Page through Meta's login and answers as itself. Needs `PUBLIC_BASE_URL`: the redirect is `<PUBLIC_BASE_URL>/app/connect/meta/callback`, which must be listed under the app's *Facebook Login for Business → Settings → Valid OAuth Redirect URIs*. |
| `META_LOGIN_CONFIG_ID` | digits | The *Facebook Login for Business* configuration (app dashboard → Facebook Login for Business → Configurations) carrying the seven scopes in `docs/META-SOCIAL-SETUP.md` § 6, token type *User access token*. Unset (or `META_SOCIAL_APP_ID` unset), the channels page offers no login and the C9 host-account button is what remains. |
| `MICROSOFT_OAUTH_TENANT` | a tenant GUID or verified domain, warned at boot | The Entra directory the app is registered in. **Required when the app is single-tenant** ("Accounts in this organizational directory only"), which Microsoft refuses at `/common`. Unset uses `common`, which serves only a multitenant app. See `docs/EMAIL-SETUP.md`. |
| `META_SOCIAL_APP_SECRET` | not checked at boot | The app secret of the Meta app that owns Instagram and Messenger, when that is a DIFFERENT app from WhatsApp's (this installation: `nomi-social` vs `nomi-pilot`). Each app signs its own webhooks, so the wrong secret rejects every payload with a 401. Unset, `META_APP_SECRET` is used — correct when one app carries all three. |
| `META_PAGE_ACCESS_TOKEN` | not checked at boot | The Page access token, which authorises BOTH Messenger and the Instagram account connected to that Page (C9). Unset, neither channel is built and both say "not connected". Set with `WHATSAPP_PROVIDER=disabled`, the service runs messaging for these two alone. |
| `META_PAGE_ID` | digits | The Facebook Page buyers message. With it (and the token) the Messenger webhook mounts at `/webhook/messenger` and the owner gets a Connect button. |
| `META_IG_ACCOUNT_ID` | digits | The Instagram professional account id. Same as above for `/webhook/instagram`, and it needs `META_PAGE_ID` too: Instagram replies leave through the Page. |
| `SMTP_HOST` | all five or none, warned at boot | Her own mail provider's submission host (`smtp.zoho.com`, `smtp.fastmail.com`, …). **Set, this is what sends, in place of a connected Gmail/Outlook mailbox** — an operator who names a server means that server. Unset, the mailbox path (C6) runs. |
| `SMTP_PORT` | 1–65535, default `587` | `587` connects and upgrades with STARTTLS; `465` connects already wrapped in TLS. A server on any other port must still offer STARTTLS, or the send is refused rather than downgraded. |
| `SMTP_USER` | all five or none | The login for that host — usually the full address. |
| `SMTP_PASSWORD` | all five or none | Its password, or an app-specific password where the host issues one. Sent only over TLS; never logged. |
| `SMTP_FROM` | an e-mail address | The address every mail leaves as. **It must be on the verified sending domain**, or each send is refused saying so, exactly as a mailbox off the domain is. |
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
| `LEGAL_CONTACT_EMAIL` | an address, optional | Named on the public `/privacy` and `/data-deletion` pages as where a person writes to ask what is kept or to have it removed. Unset, the pages say to write to the business from the account used — never a blank. Whoever reads that mailbox must answer within the thirty days the page promises (see `docs/LEGAL.md`). |
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
