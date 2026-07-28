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
| LLM calls (`llm/anthropic`) | SDK retries + degradation ladder (`core/ops/degrade.ts`) |
| DB | pg pool reconnect; jobs are transactional; ingress 5xx → provider retry |
| Owner notifications | pg-boss `notify.team` retries ×5 → dead-letter |

Offline/poor-connection queueing on the owner side is a PWA concern: the shell
must queue taps (发送/不回) locally and replay — spec'd for the PWA build,
enforced there.

## Performance budgets (as data in `core/ops/perf.ts`, PWA enforces on device)
approval card open < 1000ms · quote compute < 50ms (pure SQL+arithmetic — no
LLM in the loop, which is why "instant" is honest) · digest render < 16ms.
