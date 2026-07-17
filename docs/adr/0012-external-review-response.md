# ADR-0012 — Response to the external architecture review ("Replacing n8n with a Self-Hosted YiwuFlow Platform")

**Status:** Proposed · **Date:** 2026-07-17
**Input:** external research document (ChatGPT deep-research PDF, 23 pp.)

## Verdict in one paragraph

The document is competent, well-sourced, and **~80% of it re-derives decisions
we already made, built, tested, and applied to the live database** (ADRs
0001–0009). Its central recommendation — replace n8n with a TypeScript modular
monolith over Postgres, RLS-enforced tenancy, outbox + advisory locks instead
of Redis, thin channel adapters, approval bridge as the trust surface, boring
containerized deploys — *is the running system*. Its n8n migration plan
targets a state we exited two weeks ago (n8n is archived; the engine is the
only decision path). The remaining ~20% contains four genuinely new,
genuinely valuable external facts, adopted below — and the prompt attached to
the document contains one large strategic error, rejected below.

## What the document gets right that we already have

| Document recommendation | Where it already exists |
|---|---|
| TS modular monolith, two processes (edge-api + worker) | ADR-0002; `src/api` + `src/worker` |
| Postgres-first orchestration, no Redis day one | ADR-0004 (pg-boss, advisory locks, transactional enqueue) |
| Shared-table tenancy, forced RLS, no BYPASSRLS app role, session-bound tenant context | ADR-0005; migration 0005; **proven live 2026-07-14** |
| Deterministic quote path, guards before send | ADR-0006; `core/commerce`, `core/safety`; 99 tests |
| Approval bridge as the product surface (card with back-translation, why-line, guard visibility, invoice-style quote card, revoke) | TRUST-PLAYBOOK / TRUST-PSYCHOLOGY — near-verbatim convergence |
| Replay testing as first-class ("same or safer decision class") | `turns` table (migration 0006), parity suite, EVALS.md |
| Expansion/contraction migrations, forward-only | ADR-0007; migrations 0001–0009 applied live |
| Job sheet / VIP / presence / one-tap revoke / repair protocol / confidentiality guard | Trust primitives, migrations 0008–0009 |
| "Dashboard overbuilding" as a named risk | The 50/80/90% cut exercises |

Independent convergence by a second model is meaningful validation, not
redundancy — noted and welcomed. But it is validation, not new work.

## What is genuinely new — ADOPTED

**A. WhatsApp platform policy constraint (critical, strategic).** Reports the
document cites state that from 2026-01-15 Meta blocks *general-purpose AI
chatbots* from the WhatsApp Business API while business customer-support/sales
use remains allowed. **Decision:** YiwuFlow is positioned, documented, and
*technically constrained* as a merchant-owned sales assistant operating on the
merchant's own number for the merchant's own customers — never a
general-purpose assistant. This was already our product truth (the employee
frame); it now becomes a compliance guardrail: template pack wording, website
copy, and the 360dialog application all frame it this way. *Verification task
added to the existing 360dialog email in LEARNING-PLAN.*

**B. Partner-led Meta verification (critical, collapses our critical path).**
360dialog offers partner-led verification: no website required, up to 20
numbers, potentially **5 minutes–48 hours** after validation — versus the
standard path's SSL website + corporate email + up-to-14-business-days that
our GTM-READINESS assumed. Plus a **free, immediate sandbox**. **Decision:**
pursue partner-led verification; start sandbox integration immediately (no
verification needed). The WABA critical-path estimate shrinks from weeks to
days.

**C. Delivery-ordering correctness rule (real engineering gap).** WhatsApp
does not guarantee outbound ordering; dependent messages must await the
`delivered` status webhook. Webhooks must be acked in <5s and retry for up to
7 days (dedup mandatory — ours exists). **Decision:** the outbound dispatcher
becomes a small state machine: per-conversation send queue where a dependent
send waits on the prior message's delivered status; `deliveries` table gains
`provider_message_id` + status-transition columns for correlation. This was
not in our design and would have produced out-of-order replies under load.

**D. Canonical channel-event formalization (adopt, mostly exists).** The
document's `channel-events` ingress contract is our `message_fragments` +
dedup + tenant-from-credential, formalized. **Decision:** adopt the shape
(provider, external event id, occurred-at, payload-hash) as the ingress table
contract when building the WABA adapter; statuses flow to `deliveries`.

## What is REJECTED, with reasons

**1. The stack swap (NestJS, Drizzle, BullMQ, Redis, Better Auth, Next.js
admin, Playwright).** The attached prompt's stack — not the document's; the
document itself says plain Node/TS and explicitly defers Redis.

- **NestJS**: DI-container ceremony is team-coordination tooling (ADR-0002
  rejected this class of complexity for a solo founder). Our engine is pure
  functions + ports — *more* testable than NestJS modules, with 99 tests in
  ~150 ms. A rewrite converts a working, live-validated codebase into an
  unvalidated one for zero customer-visible value. Rejected.
- **Drizzle over Kysely**: lateral churn. Both are typed SQL; ours is written,
  tested, and RLS-aware. Rejected.
- **BullMQ + Redis**: contradicts ADR-0004 *and the attached document itself*
  ("treat Redis as an optimization you earn later"). pg-boss gives
  transactional enqueue with the business write — Redis cannot. Rejected
  until a measured queue bottleneck exists.
- **Better Auth / Next.js admin**: there are no web users. The owner surface
  is chat (TRUST-EMPLOYEE-DESIGN: "delete the app; settings are sentences").
  A minimal web admin may earn its place post-pilot; Playwright arrives with
  it, not before. Deferred.

**Revisit triggers, written down now:** a second engineer joining (NestJS-class
structure becomes arguable), >10k jobs/sec sustained (Redis conversation),
multi-operator businesses (web admin + real authn).

**2. "We are NOT building an MVP — V1 for thousands of companies."** Rejected
as sequencing, embraced as quality bar. The platform-grade parts that must be
built early because retrofits are brutal — RLS tenancy, money invariants,
audit/replay, forward-only migrations, guards — **are already built and live.**
That is precisely why we can refuse to build the rest early. What "V1 for
thousands" adds beyond the current system is *surface area* (channels,
dashboards, RBAC, tiered tenancy) whose correct shape is unknowable before
customers exist. Two days ago the standing directive was a 30-day
no-new-features learning plan with a day-30 kill gate, and "delete 90% if it
increases PMF probability." Building V1-for-thousands before one customer
conversation is how the wrong thing gets built extremely well. The document's
own risk table names "dashboard overbuilding"; its own cut-90% row — *inbound
→ guarded draft/quote → approval/send → status/audit* — **is our pilot
kernel.** Quality is not the disagreement; sequencing is.

**3. Twenty pre-implementation documents.** Sixteen of twenty already exist
(mapping below). Producing fresh versions is strategy-production — the failure
mode LEARNING-PLAN exists to stop. The four genuinely missing ones (adapter
API contract, delivery state machine, WABA runbook, minimal owner-bridge
contract) are produced *as part of building them*, this sprint.

## Deliverables mapping (requested 20 → existing artifacts)

| # | Requested | Status |
|---|---|---|
| 1–2 | Architecture review, improvements | This ADR + ADRs 0001–0011 |
| 3–4 | Folder structure, module map | ADR-0002 (built: `src/`) |
| 5 | Database schema | migrations 0001–0009 (live) + `src/db/schema.ts` |
| 6 | API contracts | **Partially new** — adapter/approval endpoints adopted from the document's drafts, finalized during the sprint |
| 7–8 | AuthN/AuthZ | ADR-0005 (tenant-from-credential, RLS); web authn deferred with trigger |
| 9 | AI pipeline | `src/pipeline/turn.ts` + ADR-0006 (documented in code, tested) |
| 10–12 | Events, queues, workers | ADR-0004 + migrations 0005/0006 (events, outbox, pg-boss) |
| 13 | WebSockets | Rejected for pilot — owner surface is WhatsApp/WeChat chat |
| 14 | Deployment | ADR-0009 + document's pilot tier adopted (1 VM app+worker, managed PG = Supabase) |
| 15–16 | Logging, monitoring | ADR-0008/0009; document's metric names adopted as the naming sheet when OTel lands (sprint 2) |
| 17 | Testing | ADR-0008 (99 tests, parity, replay); E2E added with sandbox |
| 18 | Scaling | ADR-0010 Q6 (1,000-tenant plan) |
| 19–20 | Security, risk | ADR-0005 + RISK-REVIEW.md + advisor-driven hardening (live) |

## The actual plan this produces (unchanged in strategy, improved in detail)

The pilot build = the document's cut-90 kernel = our TRUST-PLAYBOOK stack:

1. **360dialog sandbox adapter** (ingress: <5s ack, dedupe, tenant-from-
   credential, fragments; egress: outbox dispatcher **with the new
   delivery-ordering state machine**) — ~4–6 days.
2. **Approval bridge** (draft card: back-translation, why-line, invoice-style
   quote card, 发送/改一下/不回, voice-note edits; revoke) — ~3–5 days.
3. **Digest v1** — ~1–2 days.

Total ≈ **8–13 days** against the document's 21–39-day estimate for the same
scope — the difference *is* the already-built engine. Interleaved with, not
replacing, LEARNING-PLAN's interviews and pre-sell: the WoZ pilot can begin
on the sandbox before the bridge is finished.

## Consequences

The external review cost nothing and delivered four real upgrades (policy
positioning, partner-led verification, delivery ordering, event-contract
formalization) plus independent confirmation of the architecture. Its
surrounding prompt, taken literally, would have converted a validated
8–13-day pilot path into a multi-month rewrite-plus-platform build with zero
additional customer evidence. Adopted the facts; rejected the frame.
