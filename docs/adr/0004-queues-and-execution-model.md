# ADR-0004 — Queues & execution model

**Status:** Proposed · **Depends on:** [0002](0002-repository-and-service-boundaries.md)

## Context

The current system has three defects that are all execution-model problems:

1. **Two "yes" messages create two orders.** The webhook returns `200` immediately
   and processes async, with no per-conversation serialisation and no idempotency
   key. A customer double-tapping "yes" yields two orders, two Sheets rows, two
   confirmation emails. Message-level dedup (`external_id`) does not help — those
   are two genuinely different messages.
2. **No retries.** A SendGrid 502 loses the confirmation email permanently. The
   order is in the database, the conversation is closed, the customer was promised
   an email, and nobody ever finds out.
3. **Races on conversation state.** Two messages from one client processed
   concurrently both read the same state and both write; one silently wins.

## Decision

**pg-boss.** Queues live in Postgres.

### Why not Redis/BullMQ, SQS, or Kafka

You already run Postgres and it is already the source of truth. pg-boss gives
retries with backoff, scheduling, dead-letter queues, singleton keys, and
transactional enqueue — **with zero new infrastructure to operate, monitor, or pay
for.** For a solo operator that is not a small advantage; it is the whole argument.

Crucially, **enqueue is transactional with the business write**:

```ts
await db.transaction(async tx => {
  await tx.insertInto('orders').values(order).execute();
  await boss.send('order.confirmed', { orderId }, { db: tx });  // same tx
});
```

The order and the job to email about it commit together, or neither does. With Redis
you get the classic dual-write bug: order committed, job lost, or vice versa. Kafka
solves problems of scale you will not have for years and costs operational surface
you cannot afford today.

Revisit if a queue exceeds ~10k jobs/sec. You will not be close.

### Queues

| Queue | Idempotency / concurrency | Retry |
|---|---|---|
| `message.inbound` | `singletonKey = conversationId` | 3×, exponential |
| `message.outbound` | `singletonKey = messageId` | 5×, exponential → DLQ |
| `order.confirm` | **`singletonKey = conversationId`** | 3×, then human alert |
| `notify.lead` | none | 3× |
| `catalog.embed` | `singletonKey = productId` | 3× |

### The double-order fix — belt *and* braces

**Belt (queue):** `order.confirm` uses `singletonKey = conversationId`. pg-boss will
not run two jobs with the same singleton key concurrently.

**Braces (database):** the queue is not allowed to be the only guarantee, because a
queue is a coordination mechanism and money needs an invariant:

```sql
create unique index orders_one_open_per_conversation
  on orders (conversation_id)
  where status not in ('cancelled');
```

Now a second confirmation **cannot** succeed even if the queue is bypassed, restarted,
or wrong. The write fails, the handler catches the unique violation and treats it as
"already confirmed" — idempotent by construction.

**Rule: every money operation gets a database invariant, not just a queue guarantee.**

### Per-conversation serialisation

Two messages from one client must never process concurrently — they race on state.
`singletonKey = conversationId` on `message.inbound` handles the common case; the
handler additionally takes an advisory lock so correctness does not depend on the
queue's semantics:

```ts
await tx.raw('select pg_advisory_xact_lock(hashtextextended(?, 0))', [conversationId]);
```

Cheap, held only for the transaction, and it makes the state machine's
read-modify-write actually atomic.

### Turn pipeline

```
webhook (Fastify)              ← verify signature, resolve tenant, 200 immediately
  └─ enqueue message.inbound   ← transactional
        │
        worker:
        ├─ lock conversation (advisory)
        ├─ load state          (typed, RLS-scoped)
        ├─ retrieve candidates (trigram + pgvector, top ~20)
        ├─ analyse             (LLM)
        ├─ decideTurn()        (PURE — core/)
        ├─ compute quote       (PURE — deterministic, from SQL)
        ├─ generate reply      (LLM; numerals substituted, not invented)
        ├─ persist state + messages   ┐ one transaction
        └─ enqueue outbound + events  ┘
```

Everything between `load` and `persist` is one transaction. `decideTurn` and the
quote are pure and take no I/O — they can be replayed in a test in microseconds.

## Consequences

**Good.** Double orders become impossible. Failed deliveries retry and then surface
in a DLQ rather than vanishing. State races are gone. No new infrastructure.

**Bad.** pg-boss puts queue load on the primary database; at high volume it competes
with application queries. Acceptable for years; the escape hatch (move to a dedicated
Postgres, or to SQS) is a config change because the handler interface is ours.

**Note.** `singletonKey` prevents *concurrent* duplicates, not *sequential* ones. The
unique index is what makes sequential double-confirmation safe. Both are required.
