# PostgreSQL Migration Runbook — Supabase → standalone

Move the live data from the hosted Supabase project (`dkyfxdexdxmvbixnfqbh`)
to a standard PostgreSQL host (Railway/Neon/RDS/self-hosted — anything with a
`DATABASE_URL`). **The Supabase database is not modified or deleted at any
step here; cutover (step 8) stops for explicit approval.**

Time budget: ~45 min. Everything before step 8 is safe to rerun.

## 0 · Pre-migration backup
```bash
# From Supabase: full logical dump (needs the postgres-role connection string
# from the dashboard — Session mode, port 5432, NOT the pooler)
pg_dump "$SUPABASE_URL" --no-owner --no-privileges -Fc -f nomi-pre-cutover.dump
pg_restore -l nomi-pre-cutover.dump | head        # sanity: readable TOC
```
Keep this file. It is the rollback.

## 1 · Provision the target
- Create the PostgreSQL 16+ instance; note the superuser/admin URL.
- Extensions required: `pgcrypto`, `pg_trgm` (core contrib — available
  everywhere). Optional: `vector` (pgvector) — retrieval degrades to
  trigram-only without it, by design. On Railway: available by default image;
  verify with `select * from pg_available_extensions where name='vector'`.

## 2 · Schema: two supported paths
**Path A — clean bootstrap (preferred, exercised in CI/local):**
```bash
MIGRATE_DATABASE_URL="$ADMIN_URL" node tools/migrate.mjs        # baseline + every migration on disk
node tools/migrate.mjs --status                                  # expect: pending none
```
The migration count is deliberately not written here. It was "0001–0014" for
long enough to be wrong by twenty; `--status` prints the truth and never drifts.

**Verifying Path A locally needs a NEW CLUSTER, not a new database — see §2a.**
**Path B — restore the dump wholesale** (brings schema+data together):
```bash
pg_restore -d "$ADMIN_URL" --no-owner --no-privileges nomi-pre-cutover.dump
```
Path B note: the dump contains Supabase-side extras (`april_draft` archive
schema, `supabase_migrations` metadata, `pgboss` schema). Harmless; drop the
first two later if unwanted. Skip data-only step 3 if you used Path B.

## 2a · How to verify a fresh migrate — and why `createdb` is not enough

**Use the smoke script. It is the only local path that exercises Path A end to
end:**
```bash
bash .claude/skills/run-nomi/smoke.sh      # initdb → createdb → migrate → seed → boot
node tools/migrate.mjs --status \
  --   # against its cluster: MIGRATE_DATABASE_URL=postgresql://postgres@127.0.0.1:55440/nomi
```
It calls `initdb` into a scratch directory, which is the part that matters: a
brand-new cluster has its own role namespace.

**Why a plain `createdb` on your usual cluster cannot verify this.** Migration
0026 renames the runtime role `yiwuflow_app` → `nomi_app`, and it aborts when
BOTH names exist:

```
FAILED 0026_rename_runtime_role.sql: 0026: both yiwuflow_app and nomi_app exist on this cluster.
```

That guard is correct and must not be weakened. Two roles with the same purpose
is genuinely ambiguous — one of them owns the grants and the RLS policies, and
guessing which would hand the wrong role the ability to read every tenant.

The trap is that **roles are CLUSTER-WIDE, not per-database.** `createdb
nomi_fresh` gives you a fresh database on a cluster that still has both roles
from every previous run, so 0026 aborts on a database that has never seen a
migration. It looks like the migration is broken. It is the guard working.

Any cluster that has ever run this project is permanently in that state, which
is why the fresh path needs a fresh cluster. If you want the migration without
the app:

```bash
D=$(mktemp -d); S=$(mktemp -d /tmp/pg.XXXX)   # socket dir must be a SHORT path
initdb -D "$D" -U postgres --auth-local=trust --auth-host=trust
pg_ctl -D "$D" -o "-p 55441 -c listen_addresses=127.0.0.1 -c unix_socket_directories=$S" -w start
createdb -h 127.0.0.1 -p 55441 -U postgres nomi
MIGRATE_DATABASE_URL="postgresql://postgres@127.0.0.1:55441/nomi" node tools/migrate.mjs
MIGRATE_DATABASE_URL="postgresql://postgres@127.0.0.1:55441/nomi" node tools/migrate.mjs --status
pg_ctl -D "$D" -w stop && rm -rf "$D" "$S"
```

A production target is a fresh cluster by definition, so it never meets this —
the papercut is local only, and it costs an hour every time somebody rediscovers
it.

## 3 · Data (with Path A schema)
```bash
pg_dump "$SUPABASE_URL" --data-only --no-owner --disable-triggers \
  --schema=public -Fc -f nomi-data.dump
pg_restore -d "$ADMIN_URL" --data-only --disable-triggers nomi-data.dump
```
Restore order is handled by pg_restore's TOC; `--disable-triggers` avoids FK
ordering issues. Then repair sequences (identity columns):
```sql
-- one per identity table:
select setval(pg_get_serial_sequence('capability_events','id'),   (select coalesce(max(id),1) from capability_events));
select setval(pg_get_serial_sequence('channel_audit','id'),       (select coalesce(max(id),1) from channel_audit));
select setval(pg_get_serial_sequence('outbound_transitions','id'),(select coalesce(max(id),1) from outbound_transitions));
select setval(pg_get_serial_sequence('pilot_log','id'),           (select coalesce(max(id),1) from pilot_log));
select setval(pg_get_serial_sequence('ops_flags','id'),           (select coalesce(max(id),1) from ops_flags));
```

## 4 · Roles (runtime ≠ migration credentials)
Migration 0005 creates the runtime role as `yiwuflow_app` (nologin, no
BYPASSRLS) with grants; migration 0026 renames it to `nomi_app`. A full
`npm run migrate` therefore leaves you with `nomi_app`, and every command below
uses that name — but `yiwuflow_app` is what you will find if you read 0005
itself, which is applied history and is never rewritten (ADR-0007).
Give it login on the target:
```sql
alter role nomi_app login password '<generated>';
```
Runtime `DATABASE_URL` uses `nomi_app`. Keep the admin URL only in
`MIGRATE_DATABASE_URL` for future migrations. The app user must not be
superuser — verify: `select rolsuper from pg_roles where rolname='nomi_app';` → f.

## 5 · Verification (all must pass before cutover)
```bash
# row counts vs source (run the same on both, diff the output)
psql "$URL" -c "select relname, n_live_tup from pg_stat_user_tables order by relname;"
```
```sql
-- constraints & functions present
select count(*) from pg_constraint where connamespace = 'public'::regnamespace;   -- compare to source
select proname from pg_proc where pronamespace='public'::regnamespace
 and proname in ('current_business_id','resolve_tenant','retrieve_products','search_product_by_text','record_usage');
-- demo retrieval (the canonical check)
select sku from retrieve_products('de300000-0000-4000-8000-0000000000b1'::uuid,
  'canvas tote bag cotton'::text, null, 3);   -- ZX-100 first
```
```bash
# app-level: integration suite as the app role + full check
DATABASE_URL="postgresql://nomi_app:...@target/db" npm run check   # full suite green
DATABASE_URL="postgresql://nomi_app:...@target/db" node tools/run-integration.mjs   # 0 skipped, enforced
```
Representative-data validation: spot-check Ahmed's conversation (messages
count, thermos quote at $2.10 in message text), one closed repair record,
capability_events reasons non-empty.

## 6 · Point the app
Update `.env` `DATABASE_URL` to the target (app role). Restart. Run the local
e2e driver — the Fatima flow must produce ZX-100 / $0.92 / $4,600.00.

## 7 · Ops on the new host
Per OPS-RUNBOOK: confirm the provider's backup schedule + PITR **and run one
restore drill before Gate A** — do not claim backups exist until performed.

## 8 · ⛔ CUTOVER — stops here for approval
Only after live traffic exists (post-Phase-2): freeze writes (kill switch
`global_silence` platform-wide), final incremental dump/restore of rows newer
than the migration, re-run step 5, flip `DATABASE_URL`, unfreeze. Supabase
project is then paused — **never deleted** until 30 days of clean operation.

## 9 · Rollback
Any failure before step 8: nothing happened to the source — just fix and
rerun. After a cutover: flip `DATABASE_URL` back to Supabase (still intact),
unfreeze, investigate with the dumps from steps 0/8.
