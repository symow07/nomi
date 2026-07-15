# ADR-0003 — Domain model & typed conversation state

**Status:** Proposed · **Depends on:** [0002](0002-repository-and-service-boundaries.md)

## Context

Milestone 0 found three fields that **nothing ever wrote** — `pending_question`,
`product_confirmed_by_client`, `client_email_collected` — which made order
confirmation *structurally impossible*. The system could converse but never close.

That is not a coding mistake. It is the signature failure of an **untyped record
passed through 119 nodes**. To n8n, `$json` is `any`, permanently. Nothing could
have caught it: not review, not the GUI, not more care.

Separately, `escalation_score` **accumulates monotonically and never decays**, while
order validation blocks the close at `>= 70`. `high_value` (order > $10k) adds +60.
So a large order that also discusses logistics (+25) reaches 85 and **can never be
confirmed.** The system is built to prevent its best deals from closing.

Both are the same class of bug: **state that no type system was watching.**

## Decision

Model the conversation so that **the Milestone 0 bugs cannot be written**, and split
the score that is currently sabotaging the close.

### 1. Branded IDs — no more `string`

```ts
type BusinessId     = Brand<string, 'BusinessId'>;
type ConversationId = Brand<string, 'ConversationId'>;
type ProductId      = Brand<string, 'ProductId'>;
type Email          = Brand<string, 'Email'>;   // only via parseEmail()
```

Passing a `ClientId` where a `ConversationId` belongs stops compiling. In a system
where `business_id` is the tenant boundary (ADR-0005), this is a security control,
not a nicety.

### 2. Conversation state — every close-critical field is explicit

```ts
type Phase =
  | 'warm_intake' | 'clarification' | 'qualification'
  | 'commercial_discussion' | 'confirmation' | 'escalated' | 'closed';

type PendingQuestion = 'product_confirmation' | 'order_confirmation';

type ProductMatch = {
  productId: ProductId;
  confidence: number;              // 0..1
  confirmedByClient: boolean;      // ← the M0 bug. Now impossible to omit.
};

type ConversationState = {
  readonly conversationId: ConversationId;
  readonly businessId: BusinessId;
  readonly clientId: ClientId;

  phase: Phase;
  turnCount: number;

  scores: Scores;                        // split — see §3
  product: ProductMatch | null;
  quantity: { value: number; unit: string } | null;
  contact: { email: Email | null };      // ← the other M0 bug
  pendingQuestion: PendingQuestion | null;

  assignedTo: AgentId | null;            // non-null ⇒ AI MUST NOT REPLY
};
```

`ProductMatch` is the key move: you **cannot construct a product match without
saying whether the client confirmed it.** The M0 bug is now a compile error.

`assignedTo` is the handoff gate. Today escalation fires Telegram, sets
`phase = 'escalated'` — and the AI keeps replying. Nothing checks. With this field,
the reply path begins `if (state.assignedTo) return NoReply;` and human handoff
actually hands off.

### 3. Split the score. `escalation_score` is deleted.

```ts
type Scores = {
  problem: number;   // 0..100 — gates the close, triggers handoff
  lead: number;      // 0..100 — a BUYING signal. Never gates anything.
};
```

| Signal | Score | Rationale |
|---|---|---|
| explicit human request | **problem** 100 | Stop the AI. |
| complaint / anger | problem +40 | |
| repeated ambiguity | problem +35 | The AI is failing; a human should look. |
| **high value (>$10k)** | **lead +60** | This is the *best* outcome, not a problem. |
| customization requested | lead +30 | Buying signal. |
| logistics / payment terms discussed | lead +25 | Late-funnel buying signal. |
| MOQ accepted, price acknowledged | lead +20 | |

**Only `problem` may block confirmation.** `lead` notifies the sales team and, if
anything, *accelerates* the close.

### 4. Scores are **derived**, never accumulated

The monotonic bug exists because the old code seeded from the stored score and only
added. Instead, store the **signals**; compute the score:

```ts
// pure, total, testable
export function computeScores(signals: Signal[], state: ConversationState): Scores;
```

A resolved problem (human replied, client satisfied) drops out of the signal set and
the score falls. Scores become a *function of the conversation*, not a ratchet.

### 5. Legal-only transitions

```ts
const ALLOWED: Record<Phase, Phase[]> = {
  warm_intake:           ['clarification', 'qualification', 'escalated', 'closed'],
  clarification:         ['qualification', 'escalated', 'closed'],
  qualification:         ['commercial_discussion', 'escalated', 'closed'],
  commercial_discussion: ['confirmation', 'escalated', 'closed'],
  confirmation:          ['closed', 'escalated'],
  escalated:             ['closed'],
  closed:                [],          // terminal
};
export function advance(from: Phase, to: Phase): Phase;  // illegal ⇒ stays put
```

Forward-only is now a property of the type table, not a convention someone remembers.

### 6. Readiness to close is a **parse**, not a boolean

```ts
type ConfirmableOrder = Brand<{
  productId: ProductId; quantity: number; unit: string;
  unitPriceUsd: number; totalUsd: number; email: Email;
}, 'ConfirmableOrder'>;

export function toConfirmableOrder(
  s: ConversationState, product: Product, quote: Quote,
): Result<ConfirmableOrder, BlockingReason[]>;
```

**You cannot create an order without a `ConfirmableOrder`, and you cannot obtain one
except by passing every rule.** The M0 failure — an unclosable close — becomes
unrepresentable rather than merely tested-for.

This also **deletes the `Claude - Order Validation` LLM call entirely.** All nine of
its rules are mechanical (is the UUID present, is qty ≥ MOQ, does the email match a
regex, is `total == qty × price`). We were paying a model to do arithmetic and regex
— slower, costlier, occasionally wrong, and reachable by prompt injection. See
ADR-0006.

## Consequences

**Good.** The entire M0 bug class is eliminated at compile time. Hot leads can close.
Handoff actually pauses the AI. Order creation is gated by a type, not a hope. The
engine remains pure and testable in milliseconds.

**Bad.** `conversation_state` needs a migration (`escalation_score` → `problem_score`
+ `lead_score`; add `assigned_to`). Done additively so n8n keeps running during the
shadow phase (ADR-0007).

**Tradeoff accepted.** Branded types and `Result` add ceremony that a solo developer
must live with daily. Worth it: they are precisely the review a missing team would
have provided, and they catch the exact bugs that have already bitten this project.
