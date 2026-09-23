# Backup & Restore (M17.4)

> **A roles dump taken before migration 0026 restores the OLD role name.**
> `pg_dumpall --roles-only` writes `CREATE ROLE yiwuflow_app`, and restoring it
> gives you a database whose policies name a role the current build will not
> connect as — `assertSafeRuntimeRole` refuses to serve, and the failure reads
> like a configuration error rather than a restore that predates a rename.
>
> After restoring any roles file dated before the rename:
> ```bash
> psql "$MIGRATE_DATABASE_URL" -c "alter role yiwuflow_app rename to nomi_app;"
> psql "$MIGRATE_DATABASE_URL" -c "alter role nomi_app login password '<new>';"
> ```
> The password step is not optional: an md5-hashed password is salted with the
> role name and is CLEARED by the rename (verified). SCRAM survives.

**This procedure has been executed end-to-end, not just written down.** Running
it against a seeded database and restoring into a separate, empty cluster
produced matching row counts, a matching schema version, and all 47 RLS policies
intact.

## ⚠️ The trap this testing found

A plain `pg_dump` of the database **does not contain roles** — roles live at the
cluster level. Restoring that dump alone into a fresh cluster produces a database
where:

- every table still has **RLS enabled** (that is part of the table definition), but
- **every `CREATE POLICY` statement fails** with `role "nomi_app" does not exist`

The restore *appears* to succeed — row counts match perfectly — while leaving
**47 tables with RLS enabled and zero policies**. Tenant isolation is gone, and
the app role cannot read anything. Data survives; the security control does not.

**Therefore: always restore roles first.** Both steps below are mandatory.

## Backup

`tools/backup.sh` produces both artifacts as one unit. It refuses to leave a
half-pair behind: everything is staged in a temp directory and moved into place
only after both files exist and pass readback checks, so an interrupted run
leaves nothing that could be mistaken for a backup.

```bash
MIGRATE_DATABASE_URL='<admin url>' \
AGE_RECIPIENT='age1w3k5nun9q7j9vk02dv0mzjj6au0agcevd2henjp9depakzftypeqxn39kt' \
RAILWAY_BUCKET='nomi-backups' \
  bash tools/backup.sh ~/nomi-backups
```

It writes `~/nomi-backups/nomi-backup-<UTC>/` containing `roles-<ts>.sql`,
`nomi-<ts>.dump` and a `MANIFEST.txt` carrying sizes, sha256 of both, the server
version, the runtime role name, and the schema version the pair was taken at.
Then it encrypts all three with `age` and uploads only the ciphertext.

| | |
|---|---|
| Mechanism | `pg_dumpall --roles-only` + `pg_dump -Fc`, via `tools/backup.sh` |
| Destination | Railway bucket `nomi-backups` (region `iad`), plus the local copy |
| Encryption | `age`, public-key. Only the ciphertext is uploaded |
| Schedule | **Manual.** Before every migration, and before any maintenance touching roles or the database |
| Restore last proven | **2026-08-09** — 4/4 checks, from the encrypted bucket copy, on a post-0026 pair |

**Pairs taken from 2026-08-09 onward restore without the rename step.** 0026 is
applied, so their roles file creates `nomi_app` directly and the warning block
at the top of this file does not apply to them. The pre-0026 pairs are kept
deliberately: they carry `yiwuflow_app` and are the only artifacts that can
recover the state before the rename. Do not prune them because they look stale.

**Two things this destination does NOT give you.** The bucket is on Railway, the
same account as production: it survives a dropped table, a bad migration or a
deleted service, but not the loss of the Railway account itself. And `iad` is
production's own region, so there is no geographic separation. Both were
accepted deliberately in exchange for setup that needs no second vendor. If the
pilot's data ever justifies it, the fix is one off-platform bucket and a change
to `RAILWAY_BUCKET`.

**The age private key is the single point of failure.** It lives at
`~/nomi-backups/age-key.txt` (mode 600) and must also be in the password
manager. Every uploaded backup is unreadable without it — a laptop failure that
takes the key with it turns the entire bucket into noise. The key must never be
stored in the bucket it protects.

**From a machine outside Railway**, `MIGRATE_DATABASE_URL` points at
`postgres.railway.internal`, which does not resolve. Use the public TCP proxy
host from `railway variables -s Postgres` instead. That path drops connections
intermittently; the script retries each dump up to four times, and a dropped
connection is a retry, not corruption.

Railway also takes volume backups, and can be given continuous archiving
(`railway postgres pitr enable`, pgBackRest, WAL to a bucket). Neither is a
substitute for this pair: a physical snapshot restores as a whole new service
and cannot be inspected or selectively restored before you commit to it.

## Scheduled backups (Railway cron, since 2026-09-23)

The dump above is also taken **every day at 03:00 UTC** by a Railway cron
service in the project (`backup/`), on the private network — the public proxy,
which accepts a connection and then goes silent, is not on its path. One run:

1. dumps roles + database over `postgres.railway.internal`;
2. **restores the pair into a throwaway cluster in the container and runs the
   four checks below** (`tools/verify-restore.sh`, unchanged) — a dump that does
   not restore is not uploaded;
3. encrypts with the age public key; the private key never lives on Railway;
4. uploads to `nomi-backups` under `daily/<name>/` and reads the listing back;
5. prunes dailies older than 60 days (manual pairs at the bucket root are
   never touched);
6. writes one row to `backup_runs` (0069), then pings the dead-man's switch.

Setup, variables (all references, nothing typed) and the schedule are in
`backup/README.md`. **`tools/backup.sh` stays** as the fallback for manual
runs before a migration, and the layout is identical, so this page's restore
steps apply to either.

**Two proofs, one automatic and one that must stay by hand.** Step 2 proves,
every day, that the dump restores with RLS intact and isolation denying. What
it cannot prove is that the *encrypted copy in the bucket* opens with the key
you hold — the key is deliberately not on Railway. So, **monthly**:

```bash
bash tools/fetch-backup.sh              # newest daily/ pair → ~/nomi-backups/<name>/, decrypted
bash tools/verify-restore.sh ~/nomi-backups/<name>   # must say 4/4
```

**What tells you it stopped.** The app looks at `backup_runs` daily at 06:30
UTC; with no completed run younger than 36 hours it sends the owner
`notify.backup_stale` — **by e-mail to the sign-in address always**, and by
WhatsApp too where a channel is live (that channel is the thing that can be
down, so the alert does not depend on it). Getting ready shows "Backup tested
· Checked for you · date" from the same table. Independently, Healthchecks.io
alerts when the job's ping is late, and Railway marks a failed run `FAILED`.

## Restore

> **The target cluster must have `pgvector` BEFORE you start, and must not be
> older than the source.** Migration 0007 adds `products.embedding` of type
> `vector` wherever the extension exists, and production has it. Restoring into
> a cluster without pgvector does not fail loudly: the `vector` type cannot be
> created, so the `products` table fails, and everything depending on it follows
> — including the RLS policies on `price_tiers`, `product_aliases` and
> `product_images`. You are left with **three tables carrying RLS and zero
> policies**, which is the same open-and-silent end state as a roles-less
> restore, reached by a different road. Measured on 2026-08-09: 49 tables and 49
> policies with pgvector present, 48 and 45 without it.
>
> `tools/verify-restore.sh` checks for pgvector and warns before it starts.
> `tools/backup.sh` refuses to dump with a `pg_dump` older than the server.

If the artifacts came from the bucket, decrypt them first:

```bash
age -d -i ~/nomi-backups/age-key.txt -o roles-<date>.sql roles-<date>.sql.age
age -d -i ~/nomi-backups/age-key.txt -o nomi-<date>.dump nomi-<date>.dump.age
```

```bash
# 0. target cluster, empty database
createdb -h <host> -U postgres nomi_restored

# 1. ROLES FIRST — without this, every RLS policy silently fails to restore
psql -h <host> -U postgres -d postgres -f roles-<date>.sql
#    "role postgres already exists" is expected and harmless

# 2. the database
pg_restore -d "postgresql://postgres@<host>/nomi_restored" --no-owner nomi-<date>.dump

# 3. the app role must be able to log in (migration 0005 creates it NOLOGIN)
psql "postgresql://postgres@<host>/nomi_restored" -c "alter role nomi_app login password '<new>';"
```

## Verify — a restore is not done until these pass

`tools/verify-restore.sh` does all of this automatically, against a throwaway
cluster it builds and destroys itself. It never takes a URL, so it cannot reach
production even by accident.

```bash
bash tools/verify-restore.sh ~/nomi-backups/nomi-backup-<ts>
```

It runs the four checks below and exits non-zero unless all four pass. Run it on
a pair that came **from the destination**, decrypted — not on the local copy the
dump script just wrote. Restoring the file you still have on disk proves nothing
about the copy you will actually reach for.

Proven on 2026-08-09 against the encrypted bucket copy: schema 25 · 40
`business_id` tables, all with RLS and ≥1 policy, of 49 · 49 policies ·
`yiwuflow_app` canlogin/no-superuser/no-bypassrls · **0 businesses** as the
runtime role. Identical to production's live numbers the same day.

The manual equivalent, if you are doing it by hand:

```bash
DST="postgresql://postgres@<host>/nomi_restored"

# schema version matches the source
psql "$DST" -tAc "select max(version) from _migrations;"

# RLS policies survived — this is the check that catches the trap above.
# Must be non-zero and equal to the source count (47 at schema 0020).
psql "$DST" -tAc "select count(*) from pg_policies;"

# every business-scoped table still has RLS enabled
psql "$DST" -tAc "
  select count(*) from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname='public'
   where c.relkind='r' and c.relrowsecurity;"

# the app role exists
psql "$DST" -tAc "select count(*) from pg_roles where rolname='nomi_app';"

# tenant isolation actually denies: no tenant context ⇒ zero rows
psql "postgresql://nomi_app@<host>/nomi_restored" -tAc "select count(*) from clients;"   # must be 0

# spot-check the data
psql "$DST" -tAc "select (select count(*) from businesses), (select count(*) from messages);"
```

Then point a **non-production** instance at the restored database and open
`/app` — the Operations Home rendering with real counts is the end-to-end proof.

## What "backup tested" means on the readiness page

`/app/onboarding` has an owner attestation **Backup tested**. It records that
*you* confirmed it — it is not system-detected, and the page says so ("Confirmed
by you" vs "Verified by system"). Only tick it after running the verify block
above against a real restore. Re-test after any migration that adds a table.

What satisfies it: `bash tools/verify-restore.sh <pair>` exiting 0 with 4/4, on
a pair fetched from the bucket and decrypted. That is what makes
FIRST-FACTORY-WORKFLOW §4's **backup tested** exit condition meetable — it was
not meetable at all before 2026-08-09, because no backup existed.

## Point-in-time expectations

**There is still no continuous archiving.** The recovery point is the age of the
last dump, and dumps are manual — so the honest number to give the factory is
"everything since the last time someone ran the script". Take one before every
migration and before any maintenance touching roles.

Railway can close this gap: `railway postgres pitr enable` turns on pgBackRest
WAL archiving to a bucket, giving continuous recovery with a weekly full plus
daily incrementals and roughly a four-week window. It has no separate licence
fee — you pay bucket storage and egress — but the window **starts at the first
base backup after enabling** and is not retroactive. It restores by creating a
new sibling Postgres service, which auto-promotes and cannot be inspected before
promotion. That is why it complements these dumps rather than replacing them.
