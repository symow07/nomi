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

Two artifacts, always taken together:

```bash
# 1. cluster roles (nomi_app and its attributes)
pg_dumpall -d "$MIGRATE_DATABASE_URL" --roles-only -f roles-$(date +%F).sql

# 2. the database itself (custom format — compressed, selective restore)
pg_dump -Fc -d "$MIGRATE_DATABASE_URL" -f nomi-$(date +%F).dump
```

Store both together; a database dump without its roles file is not a usable
backup. Treat them as sensitive — they contain every buyer message.

Railway also takes its own volume backups; that is not a substitute, because a
volume snapshot cannot be restored selectively or inspected before use.

## Restore

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

## Point-in-time expectations

There is no continuous archiving configured. The recovery point is the age of
the last dump, so schedule dumps to match how much conversation history the
pilot can afford to lose. State this honestly to the factory before go-live.
