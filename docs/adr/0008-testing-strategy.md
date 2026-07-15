# ADR-0008 — Testing strategy

**Status:** Proposed · **Depends on:** [0002](0002-repository-and-service-boundaries.md)

## Context

There is no team. Nobody reviews the diff. **Tests and types are the review**, and they
have to be good enough to substitute for a second pair of eyes on money-handling code.

Two hard facts shape the design:

- **The engine is pure** (ADR-0002), so the interesting logic can be tested with no
  database, no API key, and no network — in milliseconds.
- **The LLM is not deterministic.** Any strategy that asserts on generated prose will
  be flaky, will be muted, and will then be worthless. We must assert on **decisions**,
  never on wording.

`tools/test-logic.mjs` already exists: 55 assertions that run the current n8n Code
nodes against the real payloads and prove the close loop completes. That file is the
most valuable artefact in the repository, because it is an **executable specification
of the behaviour we must not break.**

## Decision

Four layers, each with a different job.

### 1. Parity tests — the migration contract

The existing 55 assertions are ported to run against the **new TypeScript core** and
must stay green throughout. They define "feature parity" operationally.

```
tests/parity/close-loop.test.ts     ← the 4-turn conversation that must close
tests/parity/injection.test.ts      ← incl. "ignore all previous instructions"
tests/parity/escalation.test.ts     ← flags must satisfy the DB CHECK constraint
tests/parity/phase-machine.test.ts  ← never regresses
tests/parity/dedup.test.ts
```

**A red parity test blocks the migration.** This is the only definition of done that
matters; nothing else is negotiable.

### 2. Unit tests — the pure core

Everything in `core/` is a total function, so this is cheap and fast. Priority order
follows blast radius:

| Module | Why it's first |
|---|---|
| `commerce/quote` | **money.** Floor price, tiers, MOQ, discount clamping. |
| `commerce/confirmable` | **money.** All 9 close rules. |
| `safety/numeral-guard` | **money.** A wrong price must not reach a customer. |
| `scoring` | Hot leads must not be blocked; problems must not be missed. |
| `conversation/phase` | Property-based: *no input sequence ever moves a phase backwards.* |
| `safety/injection` | Adversarial corpus, grown every time one gets through. |

Property tests earn their keep on the phase machine and on quoting: "for all tier
tables and all quantities, the quoted price is never below the floor" is a stronger
statement than any number of examples.

### 3. Integration tests — real Postgres, no mocks

Testcontainers (or a local Postgres) with migrations applied. **The database is never
mocked** — the things we most need to verify *are* database behaviours:

- RLS actually blocks cross-tenant reads. *Write a test that tries to read another
  tenant's orders and asserts it gets zero rows.* This is a security control; it needs
  a test that fails loudly if someone disables a policy.
- The `orders_one_open_per_conversation` unique index actually stops the second order.
- Advisory locks actually serialise two concurrent turns on one conversation.
- Transactional enqueue: order + job commit together, or neither.

### 4. LLM tests — contract, not content

The model is mocked in CI with **recorded fixtures**. We assert on the *contract*:

- The parser handles fenced JSON, unfenced JSON, and prose-wrapped JSON.
- Malformed output falls back safely and never throws.
- The prompt renders with the retrieved catalog, not the whole catalog.

We do **not** assert that the model said something nice. A small **live** suite
(~20 cases, run manually / nightly, not in CI) checks the things only a real model
reveals: does it reply in Arabic to Arabic, does it refuse to quote before
`commercial_discussion`, does it obey the numeral guard. Those are evals, and they are
allowed to be judged by a human or a rubric — not by string equality.

### CI

```
typecheck → lint (incl. core/ import boundary) → unit → integration → parity
```

Fast enough to run on every commit. No live API keys in CI, so it works on a fork and
costs nothing.

## Consequences

**Good.** The engine is testable in milliseconds without any external service, which is
what lets a solo developer refactor fearlessly. Security controls (RLS) and money
invariants (unique index, floor price) have tests that fail loudly when broken. The
migration has an objective, executable definition of "done".

**Bad.** Integration tests need Docker and are slower. Fixture-based LLM tests drift
from reality — mitigated by the nightly live evals, and by accepting that the fixtures
test *our* code, not the model's behaviour.

**The trap we are explicitly avoiding.** Asserting on generated prose. It looks like
thorough testing, produces flaky failures, gets muted within a fortnight, and then
provides false confidence. **Assert on decisions — phase, product, score, quote,
action. Those are deterministic and they are what actually make or lose money.**
