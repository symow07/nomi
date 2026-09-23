# The scheduled backup

A Railway **cron service** in the `nomi` project, built from this directory
(`RAILWAY_DOCKERFILE_PATH=backup/Dockerfile`, repository root as context),
running `run.sh` once a day at **03:00 UTC** on the project's private network.
The laptop script `tools/backup.sh` stays as the fallback for manual,
pre-migration runs; both write the same pair, so `tools/verify-restore.sh`
reads either.

## What one run does

1. **Dump** roles + database over `postgres.railway.internal` — no public proxy.
2. **Drill**: restore the pair into a throwaway cluster *in the container* and
   run the four checks of `tools/verify-restore.sh` (schema version = manifest ·
   every `business_id` table has RLS with ≥1 policy · runtime role attributes ·
   isolation denies with no tenant). A dump that fails is **not uploaded**.
3. **Encrypt** with the age public key. The private key never lives on Railway.
4. **Upload** to the `nomi-backups` bucket under `daily/<name>/`, read the
   listing back.
5. **Prune** dailies older than `RETENTION_DAYS` (60). Manual pairs at the
   bucket root are never touched.
6. **Record** a row in `backup_runs`, then **ping** the dead-man's switch.

Any failure exits non-zero (the run shows as failed on Railway) and pings
`…/fail`.

## Variables (all references — nothing is typed by hand)

| Name | Value |
|---|---|
| `PGHOST` | `${{Postgres.RAILWAY_PRIVATE_DOMAIN}}` |
| `PGPORT` `PGUSER` `PGPASSWORD` `PGDATABASE` | `${{Postgres.PGPORT}}` … from the Postgres service |
| `ACCESS_KEY_ID` `SECRET_ACCESS_KEY` `ENDPOINT` `BUCKET` `REGION` | `${{nomi-backups.ACCESS_KEY_ID}}` … from the bucket |
| `AGE_RECIPIENT` | the age **public** key (in `docs/BACKUP-RESTORE.md`) |
| `RETENTION_DAYS` | `60` |
| `BACKUP_PING_URL` | optional — the Healthchecks.io check URL |

Service settings: **Cron Schedule** `0 3 * * *`, **Dockerfile path**
`backup/Dockerfile`, **Watch paths** `backup/**` and `tools/verify-restore.sh`.

## How we know it works

- **Every run** proves the dump restores (step 2) before anything is uploaded.
- **Monthly, on the laptop**: `bash tools/fetch-backup.sh` pulls the newest
  daily pair and decrypts it; `bash tools/verify-restore.sh <dir>` must say
  4/4. This is the only proof that the *encrypted, uploaded* copy is usable
  with the key you hold.
- **If it stops running**: the app checks `backup_runs` daily at 06:30 UTC and,
  with nothing younger than 36 h, e-mails the owner (and WhatsApps too where a
  channel is live). Healthchecks.io, if configured, alerts independently when
  the ping is late.
