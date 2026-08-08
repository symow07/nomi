# M18.0 — Activation security gate

**Activation cannot proceed until the setup-era credentials are rotated.** They
were pasted into a chat transcript during setup and must be treated as
compromised. Turning on live WhatsApp traffic while they are valid would expose
real buyer conversations to whoever has that transcript.

This is enforced, not merely advised: `activate()` refuses unless the owner's
**Secrets rotated** confirmation is recorded (`onboarding_state.secrets_rotated_at`).
See M18.1.

## Rotation procedures — both verified by execution

### Database credentials (`nomi_app`, and the admin role)

Verified against a real Postgres: after `ALTER ROLE`, the **old password is
rejected**, the new one works, RLS is still enforced under the new credential,
and the role's privileges survive (still **zero** DELETE grants anywhere).

```bash
# 1. rotate the runtime role
psql "$MIGRATE_DATABASE_URL" -c "alter role nomi_app with password '<new>';"
# 2. update DATABASE_URL in Railway → redeploy
# 3. verify: old rejected, new works
psql "postgresql://nomi_app:<OLD>@<host>/yiwuflow" -c "select 1;"   # must FAIL
psql "postgresql://nomi_app:<NEW>@<host>/yiwuflow" -c "select 1;"   # must succeed
# 4. verify the security control survived
psql "postgresql://nomi_app:<NEW>@<host>/yiwuflow" -c "select count(*) from clients;"  # must be 0
```

Rotate the **admin** role the same way and update `MIGRATE_DATABASE_URL`
wherever migrations are run. The running service does not use it.

Blast radius: a brief connection reset on redeploy. No data change, no
re-encryption.

### Anthropic API key

Verified by inspection: the key is read **only** from `process.env` and handed
straight to the SDK constructor. It appears in **no migration**, is never written
to any table, and is referenced by **no renderer** — so rotation needs no
re-encryption and touches no stored data.

```bash
# 1. console.anthropic.com → create a new key
# 2. set ANTHROPIC_API_KEY in Railway → redeploy
# 3. revoke the old key in the console
# 4. verify
curl -s https://<host>/health      # {"ok":true,"db":true,...}
```

Blast radius: new calls use the new key; in-flight calls are unaffected. **While
`WHATSAPP_PROVIDER=disabled` no turn runs at all**, so rotating now is
zero-risk — which is exactly why it should be done before activation, not after.

### `CREDENTIAL_KEY` — check before touching

Safe to rotate blind **only** while no channel credential rows exist. Verify
rather than assume:

```bash
psql "$MIGRATE_DATABASE_URL" -tAc "select count(*) from channel_credentials;"   # 0 ⇒ safe
```

Non-zero means a re-encryption pass is required first — see `SECRET-ROTATION.md`.
Note that after M18.3 stores Meta credentials, this count will no longer be zero.

## Production deployment access requirements

Activation needs all four. Confirm each **before** starting M18.1:

| Requirement | How to confirm | Status |
|---|---|---|
| Railway CLI authenticated | `railway status` returns the project (not `Unauthorized`) | **Outstanding** — login is interactive |
| Production URL known | recorded in `DEPLOYMENT.md` | **Outstanding** — not recorded anywhere |
| Owner access code | set explicitly as `OWNER_ACCESS_CODE` | set at deploy |
| Ability to set env vars + redeploy | Railway → Variables | required for the provider flip |

Without the first two, no live verification is possible — every check to date has
run against a production *build*, not the deployment.

## Gate checklist

Activation is permitted only when **all** of these are true:

- [ ] Anthropic key rotated at source and the old one revoked
- [ ] `nomi_app` password rotated; old credential proven rejected
- [ ] Admin/migration password rotated
- [ ] `CREDENTIAL_KEY` checked (and re-encrypted if any credential rows exist)
- [ ] **Secrets rotated** confirmed on `/app/onboarding` — this is what unblocks `activate()`
- [ ] Railway access confirmed; production URL recorded
- [ ] `verify-remote.sh` passes against the real deployment

The last item is the one that has never been run. Until it has, "it works" means
"it works locally".
