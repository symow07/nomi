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
| **`CREDENTIAL_KEY`** | **(a)** web-session HMAC **and (b)** AES-256-GCM of every stored token: Page tokens (`meta_accounts`), mailbox refresh tokens (`mail_accounts`), connector keys (`connector_credentials`), channel secrets (`channel_credentials`) | **(a)** all owner sessions invalidated → re-login. **(b)** every sealed token stops opening unless re-sealed. | See below: with `CREDENTIAL_KEY_PREVIOUS` and `tools/rekey.mjs` — never blind. |
| **`ADVISOR_KEY`** (0130) | AES-256-GCM of the advisor's stored conversations (`advisor_threads`, `advisor_turns`) — and nothing else | Missing or wrong: nothing new is kept; stored conversations show "could not be opened". Never a crash. | Below: with `ADVISOR_KEY_PREVIOUS`; the app re-seals as conversations are opened — no tool opens them. |

## Rotating `CREDENTIAL_KEY` (REKEY, 2026-09-30)

`CREDENTIAL_KEY` does two jobs: **(a)** it signs owner sessions, and **(b)**
it seals (AES-256-GCM) every token the app keeps: a connected Facebook Page's
token (`meta_accounts`), a connected mailbox's refresh token (`mail_accounts`),
a prospect-source API key (`connector_credentials`) and any channel secret
(`channel_credentials`). Change it blind and every one of those stops opening:
Instagram and Messenger stop sending, mail stops, and each owner has to
reconnect.

**Before rotating, check.** The same command without a previous key only
counts: how many sealed tokens the current key opens, and which it does not
(on 2026-09-30, production: 4 sealed tokens, all open with the current key).
It writes nothing.

So a rotation has the app read with BOTH keys for as long as it takes to
re-seal what the old one sealed. `CREDENTIAL_KEY_PREVIOUS` is the old key: the
app opens tokens with it but never seals with it (`acceptRetiredKeys`,
`src/security/credentials.ts`), and `tools/rekey.mjs` re-seals them.

1. **Backup first** (a backup younger than the day — `backup_runs`, or
   `tools/backup.sh`).
2. **The owner makes a new key and sets two variables** in Railway, on the
   `nomi` service, in one change:
   - `CREDENTIAL_KEY_PREVIOUS` = the value `CREDENTIAL_KEY` has now (copy it);
   - `CREDENTIAL_KEY` = the new key, 64 hex characters (for example from
     `openssl rand -hex 32` on the owner's own machine).
   Railway redeploys. The app now seals with the new key and still opens
   everything sealed with the old one; the boot log says
   `CREDENTIAL_KEY_PREVIOUS is set`. Owners sign in again (the session key
   changed); nothing else is felt.
3. **Re-seal.** From the checkout Railway is linked to — a dry run first, then
   `--yes`. The admin address comes from the Postgres service; the two keys
   from `nomi`. No key or password appears on the command line:
   ```bash
   railway run --service Postgres -- sh -c 'export ADMIN_DATABASE_URL="$DATABASE_PUBLIC_URL"; railway run --service nomi -- node tools/rekey.mjs'
   railway run --service Postgres -- sh -c 'export ADMIN_DATABASE_URL="$DATABASE_PUBLIC_URL"; railway run --service nomi -- node tools/rekey.mjs --yes'
   ```
   (`railway run` adds the service's variables to the environment it is given,
   so the admin address the outer one exports reaches the tool —
   `ADMIN_DATABASE_URL`, because the `nomi` service has a
   `MIGRATE_DATABASE_URL` of its own on the private network.) It prints
   counts, never a token: how many are already under the new key, how many it
   re-sealed, and — by table and id — any that neither key opens (the app
   cannot open those either; the owner reconnects that account).
4. **Run it once more** without `--yes`: it must say "Nothing to re-seal".
5. **Remove `CREDENTIAL_KEY_PREVIOUS`** in Railway; it redeploys without it.

The order matters: never remove the old key before step 4 says nothing is
left, and never re-seal before the app holds the new key — a token re-sealed
with a key the running app does not have cannot be opened until it does.

## `ADVISOR_KEY` — the advisor's history (0130, 2026-10-07)

**What it is.** The advisor's stored conversations (`advisor_threads`, `advisor_turns`) are sealed with AES-256-GCM under `ADVISOR_KEY`, a key of their own, beside `CREDENTIAL_KEY` and never the same. Each sealed value carries the key's fingerprint (`sealed_with`), never the key.

**Making it.**
1. Run `openssl rand -hex 32 | pbcopy` on your own machine.
2. Paste the result into the `nomi` service as `ADVISOR_KEY`. It never appears in a chat, a command line or a log.
3. Keep it the way you keep `CREDENTIAL_KEY`: a lost key leaves every stored conversation unopenable.

**Missing or wrong** (D8): the advisor keeps answering. Nothing new is kept. A stored conversation the key cannot open says "this conversation could not be opened". The page and the ask never fail because of it. The app says which at boot (`[advisor] ADVISOR_KEY is …`).

**Rotating it.** No tool opens this history, `tools/rekey.mjs` included. The app re-seals it:
1. Set the new key as `ADVISOR_KEY`, and the old one as `ADVISOR_KEY_PREVIOUS`. Deploy.
2. Each conversation is sealed again with the new key the first time it is opened.
3. At every boot the app counts the rows still under an earlier key (`advisor_seal_census()`, counts only).
4. When that count reaches 0, remove `ADVISOR_KEY_PREVIOUS`. A conversation never opened again is deleted after 12 months unopened anyway (D5). Removing the old key sooner leaves those rows unopenable, which is safe: they are shown as "could not be opened".

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
