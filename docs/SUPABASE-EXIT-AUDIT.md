# Supabase Exit Audit

Verdict up front: **the v1.0 runtime never depended on Supabase.** ADR-0005
mandated plain `pg` + Kysely against a standard `DATABASE_URL`, and the code
kept that promise — the audit found zero Supabase client code in `src/`. The
real dependencies were operational (hosting, my migration tooling) plus two
latent defects that only surfaced when a clean standalone PostgreSQL was
actually bootstrapped. Both are fixed.

## Inventory (every category from the audit brief, inspected not assumed)

| Dependency | Where | Standard PG? | Action |
|---|---|---|---|
| Supabase client libraries / `createClient` | **nowhere** — `package.json` deps are pg, kysely, pg-boss, fastify, zod, @anthropic-ai/sdk | — | none needed |
| Supabase REST (PostgREST) calls | `n8n/*.json` workflows + `tools/build-workflows.mjs`, `tools/test-logic.mjs` | no | **legacy engine only** — not part of the v1.0 runtime (TS service). Left untouched; if the n8n shadow is ever revived on standalone PG it needs a PostgREST substitute (out of scope, deliberate) |
| Supabase RPC | n8n workflows call `resolve_tenant`/`search_product_by_text` via PostgREST RPC; **the TS service calls the same functions via parameterized SQL** (`src/db/repos.ts`, `src/retrieval/hybrid.ts`) | functions are plain PL/pgSQL | none — already ordinary SQL calls |
| service_role usage | n8n only (`SUPABASE_SERVICE_KEY` in `docs/env-checklist.md`) | no | legacy; the TS service connects as `yiwuflow_app` (no BYPASSRLS) and never had a service-role concept |
| anon key usage | none (rls_policies.sql exists to *neutralize* it) | — | n/a |
| Supabase Auth / Storage / Realtime / Edge Functions | **not used anywhere** — verified by grep across src/, tools/, tests/, docs/ | — | nothing to replace; stated per brief §6 |
| RLS policies | `migrations/0005` etc.: `current_business_id()` + `set_config('app.business_id', …, true)` + per-table policies for role `yiwuflow_app` | **yes — pure PostgreSQL** | kept as-is; this is the tenant-isolation mechanism and it is portable (verified live on PG16) |
| `supabase/rls_policies.sql` | hardening against Supabase's `anon`/`authenticated` roles | no (roles don't exist elsewhere) | applied by the runner **only when those roles exist**; on plain PG the threat doesn't exist and 0005 provides isolation |
| Supabase env vars | `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` in `docs/env-checklist.md` (n8n-era doc) | no | doc marked legacy; service env is `DATABASE_URL` + pool vars only |
| Supabase CLI / dashboard / MCP migrations | how I applied 0001–0014 to the hosted DB; `supabase_migrations` schema is hosted-side metadata | no | replaced by `tools/migrate.mjs`; canonical history is our own `_migrations` table (portable, inside the migrations themselves) |
| pgvector | `migrations/0007`, guarded `DO` block | yes (extension) | already optional by design — absence degrades to trigram-only with a NOTICE (exactly what happened on local PG16) |
| Extensions | `pgcrypto`, `pg_trgm` in `supabase/schema.sql` (`create extension if not exists`) | yes | portable as-is |
| Connection pooling assumptions | `set_config(..., true)` is transaction-scoped — safe under PgBouncer transaction pooling AND direct connections | yes | none; pool knobs now env-tunable |

## Defects found by the clean-PostgreSQL bootstrap (both fixed)

1. **Migration 0008 hardcoded the n8n-era business id** in its `claims_policy`
   and `tenant_budgets` seeds → FK violation on any database that doesn't
   contain that business. Now `insert … select … where exists`; a no-op on
   databases where it already ran.
2. **`parseBusinessId` rejected the real pilot tenant.** zod's `.uuid()`
   enforces RFC-4122 version bits; the legacy business id `a0000000-…-01` has
   version nibble 0, so the API boundary would have 400'd the actual live
   tenant. Latent because the integration suite had *always* been skipped
   (no `DATABASE_URL` in any prior run). Parser is now a shape check
   (8-4-4-4-12 hex); injection-shaped input still rejected; regression tests
   added and the integration suite now runs for real (394 passed, 0 skipped).

## What changed (complete list)
- `tools/migrate.mjs` — portable runner: baseline detect → schema.sql →
  role-guarded rls_policies → pending `migrations/*.sql`, one transaction per
  unit, rollback-and-stop on failure, `--status` mode. Admin credentials via
  `MIGRATE_DATABASE_URL`, separate from runtime.
- `tools/seed-demo.mjs` — seed as a separate command, rendered from the
  fixture source of truth, idempotent.
- `src/db/client.ts` — `DATABASE_POOL_MAX` / `DATABASE_CONNECT_TIMEOUT_MS` /
  `DATABASE_QUERY_TIMEOUT_MS` (server-side `statement_timeout`), safe defaults.
- `migrations/0008` seed guards; `src/core/types/ids.ts` parser fix.
- `.env.example` — provider-independent DATABASE_URL + pool vars.
- Docs: this file, `POSTGRES-MIGRATION-RUNBOOK.md`, OPS-RUNBOOK provider notes.

## Verified on standalone PostgreSQL 16 (local, from zero)
initdb → `migrate.mjs` applies baseline + all 14 → `seed-demo.mjs` →
`retrieve_products('canvas tote bag cotton')` returns **ZX-100 first** →
integration suite passes **as the `yiwuflow_app` role** (RLS zero-rows,
cross-tenant deny, order idempotency) → full check 394/394, zero skips →
Fatima photo e2e byte-identical (ZX-100, 5,000 pcs, $0.92, $4,600.00,
queued→sending→sent, delivered→read, late-status ignored, digest).

## Remaining Supabase footprint
Runtime: **none.** Repo: the legacy n8n generator/workflows and the
`supabase/` directory name (contents are portable SQL; the baseline schema
file is loaded by the runner). The currently hosted Supabase database remains
untouched as the data source for cutover — see the migration runbook.
