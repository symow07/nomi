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

## Backup / restore drill (run once with credentials, record here)
1. Supabase: confirm PITR enabled + daily backups on the project.
2. Restore latest backup to a NEW project (never in place).
3. Run against restored copy: `npm test` integration suite with its DATABASE_URL;
   verify counts: businesses, products, conversations, outbound_messages.
4. Time it. Target < 30 min end-to-end. Record: date, duration, row counts, issues.
- [ ] DRILL PERFORMED: ____ (date, duration, by)

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
