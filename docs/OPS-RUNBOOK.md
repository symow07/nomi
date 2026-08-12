# Ops Runbook (M8)

## Monitoring (wire at deploy — thresholds fixed here)
| Signal | Source | Alert when |
|---|---|---|
| Webhook ack latency | ingress logs | p95 > 3s (contract: <5s) |
| Outbound dead letters | `outbound_messages.dead_lettered_at` | any new row |
| pg-boss dead-letter queues | `*.dead` | any new job |
| LLM failure streak | worker logs | ≥3 consecutive (degradation engaged) |
| Channel degraded | `channels.status` | any tenant in needs_attention/degraded > 10 min |
| Budget throttles | `tenant_budgets` | any tenant at pause |
| Cost per conversation | `usage_ledger` × `computeCosts` | > $0.15 |
| Activation funnel | `onboarding_state` | signup without done after 24h |

Alert channel: Telegram (existing `notify.team` queue). Status page: static
page updated by hand at first — honesty over automation.

## Backup / restore drill (run once per hosting provider, record here)
Database is provider-independent PostgreSQL (see SUPABASE-EXIT-AUDIT.md);
migration between hosts: POSTGRES-MIGRATION-RUNBOOK.md.
1. Confirm the host's automated backup schedule and whether PITR exists —
   do NOT claim either until seen in the provider console (Railway: daily
   backups on volumes; PITR varies by plan).
2. Manual logical backup any time: `pg_dump "$URL" -Fc -f backup.dump`
   (cron this daily to off-host storage regardless of provider promises).
3. Restore to a FRESH database (never in place):
   `pg_restore -d "$NEW_URL" --no-owner backup.dump`
4. Against the restored copy: `DATABASE_URL=... npm run check` (full suite green, 0 skips — 529 as of 2026-07-28)
   + the retrieve_products ZX-100 check; compare row counts.
5. Time it. Target < 30 min. Record: date, duration, row counts, issues.
- [ ] DRILL PERFORMED: ____ (date, duration, provider, by)

## Reliability sweep — network call inventory (all covered)
| Call site | Retry story |
|---|---|
| Provider send (`whatsapp/client`) | 429/5xx/network retryable → worker backoff (2s→4min, 6 attempts) → dead-letter |
| Media download (`whatsapp/media`) | same classification; 4xx = ask buyer to resend |
| Webhook ingress | provider retries ≤7 days; wamid dedup makes replays no-ops |
| LLM calls (`llm/anthropic`) | SDK retries → the turn throws → pg-boss retry ×5 with backoff → dead-letter → owner alert. **No degradation ladder is wired** — see INCIDENT-PLAYBOOK §1 |
| DB | pg pool reconnect; jobs are transactional; ingress 5xx → provider retry |
| Owner notifications | pg-boss `notify.team` retries ×5 → dead-letter |

Offline/poor-connection queueing on the owner side is **not built**. There is no
PWA: the owner surface is server-rendered HTML, so a tap made with no connection
is lost, not queued and replayed. Treat it as an open gap, not a solved one.

## Performance budgets (`core/ops/perf.ts` — enforced by tests, not on device)
`perf.ts` is a constants table read only by `tests/parity/m8-ops.test.ts`, which
measures the two compute budgets in CI: **quote compute < 50ms** (pure
SQL+arithmetic — no LLM in the loop, which is why "instant" is honest) and
render < 16ms. Nothing enforces **approval card open < 1000ms**: that is an
on-device budget and there is no device build. The render budget is also
measured against `core/owner/digest.ts`, a renderer no live surface uses.
