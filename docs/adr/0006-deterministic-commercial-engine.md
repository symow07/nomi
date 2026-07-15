# ADR-0006 — The deterministic commercial engine

**Status:** Proposed · **Depends on:** [0003](0003-domain-model-and-typed-state.md)

> **Postgres owns the numbers. The LLM writes prose and is never permitted to invent
> a figure.**

## Context

Three problems, one root cause.

**1. The AI can invent prices, and nothing stops it.** Core Principle 2 says the AI
must never invent business information. Nothing enforces it: the response model is
handed price and MOQ in context and generates free-form prose. A hallucinated unit
price, sent in writing to a B2B buyer, is a commercial and legal exposure. Prompt
injection makes it reachable *on purpose*.

**2. Order validation is an LLM call.** `Claude - Order Validation` asks a model to
check nine rules — is the UUID present, is qty ≥ MOQ, does the email contain `@`, does
`total == qty × price`. **We are paying a language model to do arithmetic and regex**:
slower, costlier, occasionally wrong, and injectable. A model deciding whether an
order is valid is a model that can be *talked into* deciding an order is valid.

**3. You cannot negotiate with one number.** `products.price_usd_per_unit` is a single
scalar. No volume tiers, no MOQ breaks, no floor price, no discount authority. "Negotiate
according to business rules" is currently unimplementable — there are no rules, so the
model improvises, which is problem 1 again.

## Decision

**Every number in every customer-facing message is computed by SQL and TypeScript.
The LLM receives a finished quote and is asked only to phrase it.**

### 1. Pricing schema

```sql
create table price_tiers (                    -- volume breaks
  product_id   uuid not null references products(id) on delete cascade,
  min_qty      integer not null,
  max_qty      integer,                       -- null = unbounded
  unit_price_usd numeric(10,4) not null,
  primary key (product_id, min_qty)
);

create table pricing_policy (                 -- the guardrail the AI may never cross
  business_id  uuid not null,
  product_id   uuid,                          -- null = business-wide default
  floor_price_usd            numeric(10,4) not null,   -- hard floor. Never crossed.
  max_discount_pct           numeric(5,2)  not null,   -- the AI's authority
  human_required_above_pct   numeric(5,2)  not null    -- beyond this ⇒ handoff
);

create table negotiation_rules (              -- "3% off above 10k units"
  business_id uuid not null,
  condition   jsonb not null,                 -- {qty_gte: 10000}
  action      jsonb not null,                 -- {discount_pct: 3}
  priority    integer not null
);
```

### 2. Quoting is a pure function

```ts
export function computeQuote(
  product: Product, tiers: PriceTier[], policy: PricingPolicy,
  rules: NegotiationRule[], request: { qty: number; askedFor?: Discount },
): Result<Quote, QuoteRefusal>;

type Quote = {
  unitPriceUsd: number;   // from tiers
  discountPct: number;    // from rules, clamped to policy.maxDiscountPct
  totalUsd: number;       // computed
  moq: number;
  leadTimeDays: number;
  requiresHuman: boolean; // discount > human_required_above_pct
};
```

Total function. No LLM. Fully unit-testable. **The floor price is enforced in code**,
so no prompt — however cleverly injected — can discount below it. A request the policy
won't allow returns a `QuoteRefusal`, which the AI is then asked to communicate
gracefully ("I can't go below X, but at 10,000 units I can do Y").

### 3. Order validation becomes a parse, and the LLM call is deleted

The nine rules are mechanical. `toConfirmableOrder()` (ADR-0003 §6) implements them as
a total function returning `Result<ConfirmableOrder, BlockingReason[]>`. **You cannot
construct an order without one.**

Removing `Claude - Order Validation` saves a round trip (~1–2s), removes a per-order
cost, and — the real win — **makes the money gate unreachable by prompt injection.**
Nothing a customer types can talk arithmetic into a different answer.

### 4. The numeral guard — the rule that makes principle 2 real

The response model is given a rendered quote and instructed to use placeholders. Before
any reply is sent:

```ts
export function guardNumerals(reply: string, allowed: Quote): Result<string, Violation>;
```

Extract every numeral from the generated text. If a figure is not present in the quote,
the state, or a small allowlist (dates, "24 hours", quantities the client themselves
stated), the reply is **rejected and regenerated**; on a second failure it falls back
to a deterministic template.

This is the enforcement point for "the LLM never invents business numbers." Without it,
that principle is a comment. **With it, a hallucinated price cannot physically reach a
customer** — and prompt injection largely stops mattering, because the model has no
authority to commit to anything.

## Consequences

**Good.** Hallucinated prices become structurally impossible, not merely unlikely.
Injected discounts hit a floor enforced in code. Margin cannot be given away beyond
policy. Order validation is faster, cheaper, deterministic and testable. Real
negotiation becomes possible for the first time, because there are now rules to
negotiate within.

**Bad.** More schema, and business owners must supply floor prices and discount
authority (a real onboarding cost — but a factory that cannot state its floor price
should not be letting an AI quote on its behalf). The numeral guard will produce false
positives early and needs a tuned allowlist.

**Tradeoff accepted.** Replies become slightly less fluent than an unconstrained model
would produce. That is the correct trade: **fluency is worth nothing if the number is
wrong.**
