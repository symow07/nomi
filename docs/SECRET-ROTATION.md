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
| `DATABASE_URL` (runtime, `yiwuflow_app`) | Service (RLS-scoped, no superuser) | Brief connection reset on redeploy. | `ALTER ROLE yiwuflow_app WITH PASSWORD '…'` → update env → redeploy. |
| `MIGRATE_DATABASE_URL` (admin/`postgres`) | `tools/migrate.mjs` only | None on the running service. | Rotate the admin password → update wherever migrations are run. |
| `META_WHATSAPP_ACCESS_TOKEN` | Meta Graph send (provider=meta) | Sends fail until updated. | New token in Meta console → set env → redeploy → confirm a test send. |
| `META_APP_SECRET` | Inbound webhook signature check | Inbound webhooks rejected until updated on both sides. | Rotate in Meta app → set env → redeploy. |
| `WEBHOOK_VERIFY_TOKEN` | Meta webhook GET handshake | Only matters at (re)subscription. | Set env → redeploy → re-verify the webhook in Meta. Generated if unset. |
| `WEBHOOK_SECRET` | 360dialog HMAC (provider=360dialog) | Inbound HMAC fails until updated. | Rotate in 360dialog → set env → redeploy. |
| `OWNER_ACCESS_CODE` | Command Center login | Old code stops working; existing cookies stay valid to TTL. | Set a new value → redeploy. Always set it explicitly (else it is generated and logged once at boot). |
| **`CREDENTIAL_KEY`** | **(a)** web-session HMAC **and (b)** AES-256-GCM of `channel_credentials` | **(a)** all owner sessions invalidated → re-login. **(b)** existing encrypted credentials become undecryptable unless re-encrypted. | See below — do NOT rotate blind. |

## Rotating `CREDENTIAL_KEY` (the dangerous one)
`src/security/credentials.ts` encrypts channel credentials with a `keyVersion`.
A naive swap breaks messaging. Procedure:

1. Keep the **old** key available. Set the **new** key as a second value.
2. For each stored secret: `decryptSecret(packed, oldKey)` → `encryptSecret(plain, newKey, keyVersion+1)` → write back. (Decrypt-with-old / re-encrypt-with-new; the packed format carries `keyVersion` so a read-miss is detectable.)
3. Only after every row is re-encrypted, swap `CREDENTIAL_KEY` to the new value and redeploy.
4. Owners re-login (session HMAC changed) — expected.

If there are **no** live channel credentials yet (pilot pre-onboarding), rotation is safe: only sessions reset. That is the current pilot state.

## Immediate rotation owed (from build history)
The temporary `ANTHROPIC_API_KEY` and the Railway admin `DATABASE_URL` were pasted
into a chat transcript during setup — treat both as **compromised** and rotate at
source before real production traffic. See `M10-PRODUCTION-READINESS.md`.
