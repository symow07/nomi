# Secret Rotation Runbook (M10.1)

Proactive rotation of every production secret. For a *suspected compromise*,
start with `INCIDENT-PLAYBOOK.md` (rotate at source FIRST); this doc is the
planned, no-surprise procedure and, critically, the blast radius of each key.

## Ground rules
- Rotate at the **source** (Anthropic console, Postgres, Meta) before touching env.
- Secrets live only in the host environment. Never in git (`.env` is gitignored),
  never in logs (boot prints variable *names* only; app logging goes through
  `redactSecrets`), never rendered in the Command Center.
- After rotation, confirm `/health` is `200` and audit `channel_audit` for the
  `rotate_credential` fingerprint (`credentialFingerprint`, not the value).

## Inventory — blast radius and steps

| Secret | Used by | Blast radius on rotation | Steps |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Worker LLM calls | New calls use the new key; in-flight calls unaffected. No DB impact. | New key in Anthropic console → set env → redeploy → revoke old. |
| `DATABASE_URL` (runtime, `nomi_app`) | Service (RLS-scoped, no superuser) | Brief connection reset on redeploy. | `ALTER ROLE nomi_app WITH PASSWORD '…'` → update env → redeploy. |
| `MIGRATE_DATABASE_URL` (admin/`postgres`) | `tools/migrate.mjs` only | None on the running service. | Rotate the admin password → update wherever migrations are run. |
| `META_WHATSAPP_ACCESS_TOKEN` | Meta Graph send (provider=meta) | Sends fail until updated. | New token in Meta console → set env → redeploy → confirm a test send. |
| `META_APP_SECRET` | Inbound webhook signature check | Inbound webhooks rejected until updated on both sides. | Rotate in Meta app → set env → redeploy. |
| `WEBHOOK_VERIFY_TOKEN` | Meta webhook GET handshake | Only matters at (re)subscription. | Set env → redeploy → re-verify the webhook in Meta. Generated if unset. |
| `WEBHOOK_SECRET` | 360dialog HMAC (provider=360dialog) | Inbound HMAC fails until updated. | Rotate in 360dialog → set env → redeploy. |
| `OWNER_ACCESS_CODE` | Command Center login | Old code stops working; existing cookies stay valid to TTL. | Set a new value → redeploy. Always set it explicitly (else it is generated and logged once at boot). |
| **`CREDENTIAL_KEY`** | **(a)** web-session HMAC **and (b)** AES-256-GCM of `channel_credentials` | **(a)** all owner sessions invalidated → re-login. **(b)** existing encrypted credentials become undecryptable unless re-encrypted. | See below — do NOT rotate blind. |

## Rotating `CREDENTIAL_KEY` (verified 2026-08-12)

**Today, rotation is a one-liner, because nothing is encrypted with this key.**

`src/security/credentials.ts` can encrypt and decrypt channel credentials, and
`CREDENTIAL_KEY` is also the web-session HMAC. But **no application code calls
`encryptSecret` or `decryptSecret`, and no application code writes
`channel_credentials`** — the only INSERT anywhere is the demo seed, and the
live channel routes only flip `is_active`. So the key currently protects exactly
one thing: owner sessions.

```bash
# Verify the premise rather than trusting this document.
psql "$MIGRATE_DATABASE_URL" -tAc "select count(*) from channel_credentials;"
```

- **Count is 0** — set the new `CREDENTIAL_KEY` and redeploy. Owners re-login,
  because the session HMAC changed. Nothing else happens. This is the current
  pilot state.
- **Count is non-zero** — STOP. Those rows were written by something outside the
  application (a seed, or a hand-run script). Find out what wrote them and
  whether the ciphertext matters before touching the key.

### What this section used to say, and why it was wrong

It gave a four-step re-encryption procedure whose second step was
`decryptSecret(packed, oldKey)` → `encryptSecret(plain, newKey, keyVersion+1)`.
Both functions exist; neither has a caller. There is no re-encryption tool, no
script, and no route that writes an encrypted credential — so an operator
following those steps during an incident would have been searching for a program
that was never written, at the worst possible moment.

**When a credential-writing path lands (Embedded Signup / per-tenant outbound —
the same milestone `security/credentials.ts` is exempted for), the re-encryption
tool ships WITH it, and this section gets rewritten around a command that
exists.** A procedure is not a plan until something runs it.

## Immediate rotation owed (from build history)
The temporary `ANTHROPIC_API_KEY` and the Railway admin `DATABASE_URL` were pasted
into a chat transcript during setup — treat both as **compromised** and rotate at
source before real production traffic. See `M10-PRODUCTION-READINESS.md`.

**Status: STILL OWED.** Rotation happens in the Anthropic console and Railway, so
it cannot be done from the repo. Exact steps, in order:

```bash
# 1. Anthropic — console.anthropic.com → API keys → Create key, then Revoke the old one.
#    Set the new value in Railway (Variables → ANTHROPIC_API_KEY) and redeploy.

# 2. Postgres runtime role (the app; RLS-scoped, no superuser)
psql "$MIGRATE_DATABASE_URL" -c "alter role nomi_app with password '<new-strong-password>';"
#    → update DATABASE_URL in Railway → redeploy.

# 3. Postgres admin role (migrations only; not used by the running service)
psql "$MIGRATE_DATABASE_URL" -c "alter role postgres with password '<new-strong-password>';"
#    → update MIGRATE_DATABASE_URL wherever migrations are run.

# 4. Confirm
curl -s https://<prod-host>/health      # expect {"ok":true,"db":true,...}
```

`CREDENTIAL_KEY` rotation is still safe to do blind **only** while no channel
credential rows exist — verify before rotating, do not assume:

```bash
psql "$MIGRATE_DATABASE_URL" -tAc "select count(*) from channel_credentials;"   # 0 ⇒ safe
```

## M17.3 verification — what was actually checked

These claims are no longer taken on faith:

| Claim | How it was verified | Result |
|---|---|---|
| `.env` never reached git | `git log --all -- .env`, `git ls-files`, history scan for `sk-ant-…` | **Clean** — never committed, no live key in any tracked blob |
| Boot logs names, not values | read `main.ts` env validator | **Holds** — problems are `${name}: missing/placeholder/invalid shape` only |
| Logs pass through `redactSecrets` | present and exercised in the outbound worker + its tests | **Holds** |
| Secrets never rendered in the Command Center | grepped every `src/api/web` renderer | **Holds** — no secret value is referenced |
| `CREDENTIAL_KEY` rotation is mechanically possible | packed format is `v1.<keyVersion>.…`, so a re-encrypt pass is detectable | **Holds** |
| Tenant isolation on the post-M13 tables | new RLS denial tests (`tests/integration/db.test.ts`) | **Holds** — read *and* write denial proven |
| Production cookie flags | new tests asserting the emitted `Set-Cookie` | **Holds** — `HttpOnly; Secure; SameSite=Lax; Path=/` |
