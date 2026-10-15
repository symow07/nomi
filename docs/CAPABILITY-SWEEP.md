# Does the kind of reply depend on the buyer's language?

The owner's question (2026-10-14), asked before Arabic may join the pilot. In
Practice the same question was read as "understanding needs" (`qualify`) in
Arabic and "recommending" (`recommend`) in English, and in that workspace one
of the two went out alone and the other waited. Whether a reply waits for the
owner must not depend on the language it was asked in.

`tools/capability-sweep.mjs` runs every golden scenario (`src/trust/scenarios.ts`)
in en, zh and ar (`tools/capability-sweep.languages.mjs`) against the real analyser,
and reports where the kind of reply — or whether it goes out alone — differs by
language. Two layers:

- **the model** — the scenario's own world, the product offered as a candidate
  whatever the words say, only the analysis made real;
- **the catalogue** — as production runs it: a product is a candidate only when
  the buyer's words are close to one of its names (`retrieve_products`, trigram
  similarity above 0.15 over `product_aliases`; production's Postgres answers
  `similarity()` identically). The names used are the ones a workspace that
  typed English and Chinese names has: "Non-woven shopping bag", «无纺布购物袋»,
  "shopping bag", "non woven bag".

Each policy question is asked three ways: the scenario's own grants (the turn's
real effect), "talks" and "sells" (`src/core/conversation/autonomyLevel.ts`),
each after the turn's own holds.

```bash
npm run build && SWEEP_TRGM_URL=postgresql://postgres@127.0.0.1:55451/nomi \
  railway run --service nomi -- node tools/capability-sweep.mjs --json sweep.json
```

## 2026-10-14 — deepseek-flash, 41 scenarios × 3 languages × 3 runs, 591 turns, none failed

**Not clean.** Three causes, two of them deterministic and both reaching
**Chinese** as well as Arabic:

1. **"Yes" confirms an order only in the exact words on a short list**
   (`YES` in `src/core/conversation/fastpath.ts`). English's plainest words are on
   it (yes, ok, sure); Chinese's and Arabic's are not: «好的», «是的», «可以»,
   «确认», «تمام», «موافق» — and «نعم أكد الطلب», "yes please", "go ahead". Any
   of those goes to the model, which never proposes an order: the buyer is
   quoted again, and under a grant that lets prices go alone, that goes alone.
   In the sweep: en "yes" and ar «نعم» → the order waits for the owner, 3/3;
   zh «好的» → a price sent alone, 3/3 (both order scenarios, both layers).
2. **A product is found only from words close to its own names.** Arabic never
   finds a product that has no Arabic name; Chinese misses a shorter name
   («无纺布袋» against «无纺布购物袋»: 0.038). With nothing found, the reply asks
   what the buyer wants (`qualify`, alone under "talks") where the English one
   prices it (`quote`, waits under "talks"). In the sweep:
   `low-confidence-match-asks-to-confirm`, en found (0.302), zh and ar not.
   This is most likely the Practice case that opened this: no product of that
   workspace had an Arabic name, so the Arabic question could only be `qualify`.
3. **The model ties a message that names no product to the one on offer — in
   Chinese, not in English or Arabic.** "We can commit to 5000 units. What is the
   very best price you can do?" with the bag on offer: zh `quote` 3/3, en and ar
   `qualify` 3/3; probed again with a second wording, 5 runs each: zh 8/10,
   en 1/10, ar 0/10. In production the name search runs first and finds nothing
   for these words in any language, so all three ask (the catalogue layer is the
   same in every language) — it shows when the words do find the product.

Also seen, sending the same way in every language: `unsupported-ce-fda-claim`
is `recommend` in ar and `qualify` in en/zh (model layer only);
`knowledge-untaught-number` wobbles in ar (qualify ×2 / greet ×1); two
scenarios wobble once in one language. 32 of the 41 scenarios come back the same
in every language, every run, in both layers — the hand-offs (a person, a
deletion) among them, in all three.

What no case showed: a reply going out alone that the owner's own level forbids
for that kind of reply. The language changes WHICH kind of reply is chosen; the
owner's rules for that kind still decide.

## 2026-10-14, after the fixes — 588 turns, none failed

The owner's decisions: build 1 (order confirmation) and 2 (Chinese names), leave 3 with a mandatory re-measure.

- **Fix 2 (0156, #340)** and **fix 1 (0157, #341)** in, the same 41 × 3 × 3. As production runs it (the catalogue
  layer where a scenario has one): **send-alone / waits splits 3 → 1; scenarios where English and Chinese differ 3
  → 0.** The one left is `low-confidence-match` in Arabic — a product with no Arabic name is never found from Arabic
  words: a data step for the owner (docs/GATE-A-KIT.md, row 13), not code.
- **Finding 3, re-measured against the new matcher before anything moved:** its own phrasings, 5 runs each, the
  product offered only where `alias_match` finds it — **0/10 tied in en, zh and ar** (none names the product; none
  finds it). The model-only rows still show it (zh ties an unnamed product it is handed), and in production it is not
  handed one.
- Also: «好的» proposes the order like "yes" and «نعم» (the order-"yes" splits are gone); two scenarios wobble once in
  one language, three differ in kind with the same send-or-wait — all in the model-only layer.

## 2026-10-15 — deepseek-flash again, after a day of outage (588 turns, none failed)

DeepSeek answered again from 10:30 UTC; the same 41 × 3 × 3 at 11:15 UTC, as the primary column beside the fallback
(docs/REPORT-2026-10-15-PROVIDER.md). **The same as 2026-10-14 after the fixes:** as production runs it, one
send-alone / waits split (`low-confidence-match`, Arabic: no Arabic name); in the model-only rows the Chinese tie of
finding 3 (2); one scenario differs in kind with the same send-or-wait; two wobble once in English. The fallback's
run waits for its key (`--fallback`).
