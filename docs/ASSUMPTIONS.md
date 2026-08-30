# Assumptions Register — what breaks when real buyers arrive

Every entry: the assumption as built, why real traffic violates it, how we'll
*detect* the violation (never "we'll notice"), and the pre-planned response.
Review weekly during shadow; move entries to "confirmed" or "fixed".

## Prompts

| # | Baked-in assumption | Reality risk | Detection | Response |
|---|---|---|---|---|
| P1 | One message = one intent, analysed in isolation (`recentMessages` currently wired empty in the service path) | Buyers send 4 fragments in 10s: "hello" / "price?" / "the bags" / "5000pcs". Each analysed alone is meaningless | `turns` where conversation gets >2 inbound/min; parity churn on those | **Debounce-and-batch** ✅ BUILT (M51.1, 2026-08-18): fragments persist to `message_fragments`, `decideBatch` closes the batch on quiet or on a cap, and one turn answers the merged text. Per-tenant knobs; media is never merged into text, but it flushes a pending batch first so replies keep his order. |
| P2 | The analysis prompt's JSON contract survives mixed-language input | Arabizi ("3ndkom shanat?"), zh/en code-switching, voice-note transcript fragments | `analysis_parse_error` rate per language in `turns` | Fallback already safe; if >5% per language, per-language prompt examples |
| P3 | Buyers state quantities as digits | "two containers", "٥٠٠٠", "5k", "half a 40ft" | `quantityMentioned=null` while qty words present (eval sample) | Deterministic qty normaliser (unit lexicon: container/carton/CBM/k) BEFORE the model — code over prompts |
| P4 | The reply prompt's tone suits all markets | GCC buyers expect relationship talk before business; German buyers the opposite | Human eval sample (EVALS.md §weekly) | Per-market style block in `business_settings`, not prompt forks |

## Retrieval

| # | Assumption | Reality risk | Detection | Response |
|---|---|---|---|---|
| R1 | Trigram over aliases covers how buyers name products | Real buyers: "the bags like Carrefour uses", "same as last photo", brand names we've never aliased | retrieval-empty rate; `repeated_ambiguity` signals | Embeddings (Voyage key) turn on the semantic half already shipped; alias auto-suggest from missed queries |
| R2 | 15 seed aliases ≈ real coverage | A real factory's catalog has 10× the ambiguity ("bag" matches 40 SKUs) | precision@5 on eval set | Category-scoped retrieval + clarifying-question templates per category |
| R3 | Query = the message text verbatim | Messages are 90% pleasantries, 10% product | relevance scores near threshold | Extract product-phrases deterministically (noun-phrase around known category words) before querying |

## Scoring & handoff

| # | Assumption | Reality risk | Detection | Response |
|---|---|---|---|---|
| S1 | `human_requested` phrase list is complete for en/ar/zh | "let me talk to your boss", "transfer me", French/Russian/Turkish entirely absent | **missed-escalation review** (EVALS.md) — sample convs where client repeated themselves 3× | Grow lists from transcripts; add analyzer-detected `human_requested` intent as a SECOND source (code list stays authoritative for score 100) |
| S2 | high_value threshold ($3k/$10k) fits all tenants | A commodity-bag factory's normal order is $30k; a electronics tenant's is $800 | lead_score ≥60 on >50% of a tenant's conversations = threshold is noise | Move thresholds to `tenant_budgets`-style per-tenant config row — schema over code |
| S3 | 15-min SLA is achievable | Solo owner sleeps; Yiwu is UTC+8, buyers are UTC-5 | `handoffs` where holding_sent_at is not null (rate) | Working-hours-aware SLA (pause the timer outside business hours, tell the client the local-time expectation) |
| S4 | `repeated_ambiguity` at turn ≥2 is a problem signal | Exploring buyers ("ideas for my gift shop") legitimately have no product for 5+ turns | handoffs with reason=repeated_ambiguity that agents release in <2 min | Exempt `explore`-intent conversations from the ambiguity signal |

## Claims policy

| # | Assumption | Reality risk | Detection | Response |
|---|---|---|---|---|
| C1 | The pattern list covers the claims models actually make | Models paraphrase: "meets EU standards" ≠ /CE certified/ | **Weekly claim-mining**: run detector over all outbound; human-scan a sample of NON-flagged replies for missed commitments | Grow patterns from misses (same corpus discipline as injection) |
| C2 | Default-deny won't strangle usefulness | With 4 policy rows, most certification questions → template fallback → robotic | guard rejection rate per kind (now measured per turn) | Onboarding must capture certs/incoterms up front (GTM-READINESS §onboarding) — the fix is data entry, not loosening the guard |
| C3 | English patterns catch claims in ar/zh replies | "معتمد CE" matches; "食品级" (food-grade) does NOT | Per-language guard-rejection asymmetry | Add zh/ar claim lexemes before cutting over those languages |

## Latency & cost (measured from today via `timings`/`usage` on every turn)

| # | Assumption | Reality risk | Detection | Response |
|---|---|---|---|---|
| L1 | 2 sequential LLM calls fit chat expectations | p95 could be 8–12s; buyers double-send, which re-queues serially | `timings.totalMs` distribution | Typing indicator (cheap); debounce (P1) absorbs double-sends; only then consider merging analyze+reply into one call |
| L2 | Guard retries are rare | If violation rate >20%, every reply costs 2–3 generations | guardViolations per turn (now recorded) | Tighten reply prompt with quote-only examples; template rate is the backstop, not the norm |

## Meta-assumption (the honest one)

The 18 TC payloads were written by the same people who wrote the system. They
test what we imagined; real buyers will do what we didn't. The eval framework
(EVALS.md) exists precisely because this register is *guaranteed incomplete* —
its weekly review agenda item is "what happened that isn't in this table?"
