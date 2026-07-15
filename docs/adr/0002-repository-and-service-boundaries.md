# ADR-0002 — Repository layout & service boundaries

**Status:** Proposed · **Supersedes:** nothing · **Depends on:** [0001](0001-extract-core-from-n8n.md)

## Context

The team is **one person plus AI assistance**. That is the dominant constraint on
this decision, and it points the opposite way from most "best practice" advice,
which is written for teams of 5–50 and optimises for *coordination* cost.

A solo operator's scarce resource is **cognitive load and operational surface**, not
merge conflicts. So:

- Every additional deployable is a new thing to deploy, monitor, page on, and debug
  at 2am. **Cost: high. Benefit to a solo dev: zero.**
- Every layer of indirection (repositories over repositories, DDD aggregates, CQRS)
  buys team-scale decoupling and costs solo-scale comprehension.
- What a team gives you that a solo dev lacks is **review** — a second pair of eyes
  catching the `pending_question` field nobody wrote. That must be replaced, and the
  replacement is **types + tests**, not architecture.

## Decision

**A modular monolith. One deployable, two entrypoints, one database, one package.**

Explicitly **rejected**:

| Rejected | Why |
|---|---|
| Microservices | Solves org problems you don't have. Adds network failure modes you can't afford to debug alone. |
| Monorepo (pnpm workspaces / turbo) | Real tooling overhead, zero benefit at one package. Add it the day you have a second deployable. |
| Event sourcing / CQRS | Analytics needs an append-only event *log*, not full ES. See ADR-0008. |
| Hexagonal / DDD aggregate ceremony | The domain is 431 lines. It does not need a ubiquitous-language committee. |
| Kafka, Temporal, Redis, Kubernetes | Postgres does queues (ADR-0004). One box carries you to thousands of tenants. |

## Structure

```
src/
├── core/                  ← THE ENGINE. Pure. No I/O. No imports from below.
│   ├── types/             ── ConversationState, UnifiedMessage, branded IDs
│   ├── conversation/      ── phase machine, turn decision
│   ├── scoring/           ── problem_score / lead_score  (ADR-0003)
│   ├── commerce/          ── quoting, price tiers, order validation (ADR-0006)
│   └── safety/            ── injection filter, numeral guard
│
├── db/                    ← Postgres. Kysely. Typed queries + repositories.
│   ├── schema.ts          ── generated types
│   ├── repositories/      ── conversations, clients, products, orders
│   └── tenant.ts          ── RLS session binding (ADR-0005)
│
├── llm/                   ← Anthropic. Prompt templates, response parsers.
├── retrieval/             ← hybrid search: trigram + pgvector
├── channels/              ← one thin adapter per platform
│   ├── types.ts           ── ChannelAdapter interface
│   ├── simulated.ts       ── the current webhook (parity baseline)
│   └── whatsapp.ts        ── later
├── integrations/          ← calls OUT to n8n (sheets, email, notify)
├── queue/                 ← pg-boss job definitions + handlers (ADR-0004)
│
├── api/                   ← entrypoint 1: Fastify. Webhooks, admin, health.
└── worker/                ← entrypoint 2: pg-boss consumers.

migrations/                ← forward-only SQL (ADR-0007)
tests/
├── parity/                ← the existing 55 assertions. The contract. (ADR-0008)
├── unit/
└── shadow/                ← n8n-vs-service diff harness
n8n/                       ← RETAINED: integrations only (ADR-0001 §6)
tools/                     ← existing workflow generator + parity harness
```

## The one boundary that actually matters

**`core/` may not import from `db/`, `llm/`, `retrieval/`, `channels/`, or `queue/`.**

It is pure: no network, no filesystem, no `Date.now()`, no `Math.random()`. Clock and
IDs are injected. Everything it needs arrives as an argument; everything it decides
leaves as a return value.

```ts
// core/conversation/decide.ts — the whole engine, in one signature
export function decideTurn(input: TurnInput, deps: PureDeps): TurnDecision;

type TurnInput  = { state: ConversationState; message: UnifiedMessage;
                    analysis: Analysis; catalog: RetrievedProduct[]; quote: Quote | null };
type TurnDecision = { nextState: ConversationState; stateUpdates: StateUpdate;
                      action: TurnAction; reply: ReplyPlan };
type PureDeps   = { now: Date; newId: () => string };
```

Enforced by lint (`eslint-plugin-boundaries`), not by good intentions.

**Why this is the load-bearing rule:** it is *already accidentally true* — every one
of the 57 n8n Code nodes is a pure function of `$json`, which is the only reason
`tools/test-logic.mjs` works at all. We are not inventing this boundary. We are
**naming a property the code already has and then refusing to lose it.**

It makes the engine trivially testable with no database, no API keys, and no
network — which is what lets a solo developer move fast without breaking money.

## Consequences

**Good.** One `docker build`, one deploy, one log stream. The engine is testable in
milliseconds. The call assistant (ADR-0001 §5.2) becomes a *second caller* of
`decideTurn`, not a rewrite. Extracting a service later is mechanical, because the
boundary is already drawn.

**Bad.** A monolith can rot into a mud ball if the `core/` boundary is not enforced.
The lint rule is therefore not optional. One deployable also means one blast radius:
a bad deploy takes everything down — mitigated by the rollback story in ADR-0008.

**Deferred.** If the call assistant's latency profile turns out to need its own
process, it splits out later — cleanly, because it depends only on `core/` and `db/`.
