# ADR-0007 — Database migration strategy

**Status:** Proposed · **Depends on:** [0003](0003-domain-model-and-typed-state.md), [0005](0005-multi-tenancy-and-rls.md)

## Context

During the shadow phase (ADR-0009), **n8n and the TypeScript service run against the
same database at the same time.** n8n keeps serving live customers; the service watches
and computes in parallel.

That imposes a hard constraint most migration plans ignore: **every schema change must
keep the old system working.** A rename, a dropped column, or a tightened `not null`
would break n8n mid-flight — and n8n is what's still answering customers.

The current schema is also applied by pasting `schema.sql` into the Supabase SQL
editor. There is no migration history, no ordering, no way to know what a given
database has had applied to it, and no way to reproduce it.

## Decision

**Forward-only numbered SQL migrations, expand/contract, additive during shadow.**

### Mechanics

```
migrations/
  0001_baseline.sql          -- current schema.sql, as-applied (no-op on existing DBs)
  0002_scores_split.sql      -- expand:  add problem_score, lead_score
  0003_assigned_to.sql       -- expand:  add conversations.assigned_to
  0004_price_tiers.sql       -- new tables (no impact on n8n)
  0005_rls_app_role.sql      -- yiwuflow_app role + policies
  ...
  0020_drop_escalation_score.sql   -- CONTRACT. Only after n8n is retired.
```

Applied by a runner (Kysely migrations or `node-pg-migrate`) in CI, as
`yiwuflow_migrate`. Never by hand, never from a SQL editor. Each migration is
idempotent where possible and recorded in a `migrations` table.

`0001_baseline` reconciles what is already deployed so existing databases and fresh
ones converge.

### Expand / contract

Every change that touches an existing column is split in two, with the cutover in
between:

| Phase | Action | n8n still works? |
|---|---|---|
| **Expand** | Add `problem_score`, `lead_score`. Keep `escalation_score`. Backfill. Dual-write. | ✅ reads the old column |
| **Migrate** | Service writes all three. n8n keeps writing the old one. | ✅ |
| **Cutover** | Service becomes authoritative (ADR-0009). | ✅ (still readable) |
| **Contract** | `0020_drop_escalation_score.sql` | ❌ — and by now n8n is gone |

**The contract migration is the last thing that happens, weeks after cutover, and only
once rollback is no longer wanted.** That ordering is what makes rollback free
(ADR-0009): while both columns exist, either engine can drive the same database.

### Rules

1. **Forward only.** No `down` migrations. A bad migration is fixed by writing the next
   one. Down-migrations are a fiction that gives false comfort — nobody tests them, and
   they cannot restore data that a destructive change deleted.
2. **Additive until n8n is retired.** No renames, no drops, no new `not null` without a
   default, during the shadow phase.
3. **Backfills are separate, batched jobs** — never inline in a migration. A migration
   that rewrites a large table takes a lock and takes the site down.
4. **`concurrently` for indexes** on any table with traffic.
5. **RLS policies ship with the table** that needs them (ADR-0005), never later.

### The M0-driven changes

```sql
-- 0002 — split the score that currently blocks the best deals from closing
alter table conversation_state
  add column problem_score integer not null default 0,
  add column lead_score    integer not null default 0;

update conversation_state set problem_score = escalation_score;  -- conservative
-- escalation_score REMAINS until n8n is retired

-- 0003 — the handoff gate that makes escalation actually escalate
alter table conversations add column assigned_to text;

-- 0004 — the double-order invariant (ADR-0004)
create unique index concurrently orders_one_open_per_conversation
  on orders (conversation_id) where status not in ('cancelled');
```

The backfill maps the old score to `problem_score` — deliberately conservative. It may
mark a few hot leads as problems; it will not let a problem through as a hot lead.
Scores recompute from signals on the next turn anyway (ADR-0003 §4), so the error is
transient.

## Consequences

**Good.** n8n and the service coexist safely. Any database's state is knowable and
reproducible. Rollback stays trivial because the old columns survive until they are
deliberately removed.

**Bad.** The schema carries dead columns for weeks, and dual-write logic is a real (if
small) tax. Forward-only means a mistake needs a new migration rather than a revert —
acceptable, because the alternative is a `down` script nobody has ever run.

**Non-negotiable.** No more pasting SQL into the Supabase editor. That is how the
current database reached a state nobody can reproduce.
