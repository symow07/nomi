# Architecture Decision Records

Decisions, with their tradeoffs, for the YiwuFlow AI sales operating system.
Read in order — each builds on the last.

| ADR | Decision | Why it matters |
|---|---|---|
| [0001](0001-extract-core-from-n8n.md) | **Extract the core engine from n8n.** Keep n8n as an integration surface. | 431 lines of business logic were running in a 119-node GUI with 65% plumbing overhead and 1 actual connector node. |
| [0002](0002-repository-and-service-boundaries.md) | **Modular monolith.** One deployable, one package, a pure `core/`. | The team is one person + AI. Microservices/monorepo/DDD solve team problems we don't have and cost cognitive load we can't spare. |
| [0003](0003-domain-model-and-typed-state.md) | **Typed state; split `problem_score` / `lead_score`.** | Makes the Milestone-0 bug class *unrepresentable*, and stops the escalation score from blocking the biggest deals from closing. |
| [0004](0004-queues-and-execution-model.md) | **pg-boss.** Postgres-backed queues, advisory locks, DB invariants. | Two "yes" messages currently create two orders, two emails. No retries. No serialisation. |
| [0005](0005-multi-tenancy-and-rls.md) | **RLS enforced by the database**; tenant from the credential, never the payload. | `business_id` is currently read from the request body — spoofable. Service key bypasses RLS entirely. |
| [0006](0006-deterministic-commercial-engine.md) | **Postgres owns the numbers.** Price tiers, floor price, numeral guard. Delete the LLM order-validator. | The AI can currently invent prices, and an LLM is being paid to do arithmetic on a money gate that prompt injection can reach. |
| [0007](0007-database-migrations.md) | **Forward-only, expand/contract.** Additive while n8n still runs. | Keeps rollback free. Ends the "paste SQL into the editor" era. |
| [0013](0013-testing-strategy.md) | **Assert on decisions, never on prose.** Parity suite is the migration contract. | Tests and types replace the code review a solo dev doesn't get. LLM prose diffs are flaky and worthless. |
| [0009](0009-shadow-run-cutover-rollback.md) | **Shadow-run on real traffic, per-channel cutover, rollback = one flag.** | Prove the engine is right before it can touch a customer. |

## The four rules everything else follows from

1. **Postgres owns business facts.** The LLM writes prose; it never invents a number.
2. **`core/` is pure.** No I/O. Testable in milliseconds. Already accidentally true —
   we're just refusing to lose it.
3. **Money operations get a database invariant**, not just a queue guarantee.
4. **Tenant isolation is enforced by the database**, never by remembering to type a filter.

## Status

All ADRs are **Proposed**. No implementation code has been written. Milestone 0 is
complete and the current n8n system remains the only running engine.

Next: `M0.5` — first live run of the existing n8n stack (needs Supabase + Anthropic
credentials), which also produces the first real traffic for the shadow phase.
