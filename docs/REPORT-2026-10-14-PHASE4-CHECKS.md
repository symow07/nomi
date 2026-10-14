# Phase 4: the three checks, and Arabic (2026-10-14)

The answer to "PHASE 4 — AFTER #340–#342". All of it is live: production at schema 159, health `ok`.

## Next: yours, unchanged

1. **The WhatsApp round trip** (kit row 5).
2. **The three cold demos** on Westlake.
3. **Name the boss**, then the spare SIM.
4. **Chinese and Arabic product names on Westlake.** It has 5 products, and none has either name yet. Setup now lists them (check 3 below).

## The three checks: built and live

| Check | What you'll see | PR |
|---|---|---|
| **1 · Two products fit equally** | «无纺布袋多少钱？» in a shop with 无纺布购物袋 and 无纺布手提袋 gets «请问您指的是哪一款：无纺布购物袋，还是无纺布手提袋？» and nothing is priced. The whole name, or «无纺布袋» against 帆布袋, is priced as before. | #343 |
| **2 · The "may be saying yes" card** | First the buyer's words, verbatim. Then the last price they were given: product, quantity, unit price, total, and when. Then, if the quantities differ: **"Check the quantity: their message says 5000; the price was for 500 boxes."** **There is no Confirm button on this card.** The order card for a real yes now shows the buyer's words and the unit price above Confirm. | #345 |
| **3 · Names in onboarding** | The products step of setting up stays undone until every product has a name in each served language that has its own script: Chinese, Arabic, Russian. Getting started, Home, the products list and each product say which names are missing. | #344 |

- **Check 1 was tested both ways.** A genuinely ambiguous pair asks (0.400 against 0.400). A clear lead doesn't ask (1.0 against 0.4, and 0.40 against 0.25). It asks when the second product scores at least 85% of the first. English works the same way.
- **What check 3 changes for Westlake.** Westlake serves English, Chinese and Arabic, so its products step shows undone again: "no name in Chinese: 5 of 5", and the same for Arabic. Nothing is blocked; it's a to-do.

## Arabic: your conditional word, wired

1. **The pilot workspace holds Arabic from the day it exists** (#347, migration 0159). An Arabic buyer goes to a person and hears "someone from our team will reply". They never get silence, and the assistant never answers them. English and Chinese are untouched.
2. **(a) is checked by the tool.** It refuses to run while any product has no Arabic name, and it lists those products.
3. **(b) is one command** (kit row 14). It exports the boss's real catalogue read-only and runs it through the real engine and model on a local copy. That means at least 60 Arabic turns, compared step by step with English and Chinese.
4. **Pass: I release Arabic and say so in the next report. Fail: Arabic stays held and I tell you what failed.** I won't ask you either way.
5. **Today there is nothing to release.** The boss's workspace doesn't exist yet.

**A first look, on a made-up 3-product catalogue (this is not the (b) run).** On today's code:

- 71 Arabic turns: 59 replies sent, 12 handed over with the buyer told.
- Nothing gendered was sent. Nothing was held or silent.
- No step split from English (72 turns) or Chinese (72 turns).
- Once, a greeting was handed over because the writer addressed the buyer as a man twice. The buyer was told.

## Found by that run: fixed and live

**One caught Arabic word could switch off sending alone for everyone** (#346).

- When the gender guard caught a word and the rewrite fixed it, the turn still counted a violation.
- One violation withdraws that capability for the whole workspace: every buyer, every language.
- In the first run, after an Arabic greeting was caught and fixed, "Hello there" in English waited for you.
- Your rule R1 already says a clean rewrite is not evidence against the assistant. The turn now follows it.
- Production, read-only: no self-demotion in the last 45 days, so it never fired.

## Verification

- **Every PR passed all four checks:** check, trust 40/40, build, and integration (1,553 to 1,561 tests, none skipped).
- **Exception in #347:** two of its new integration tests asserted the wrong reply text; I fixed the assertions and reran that file alone (3/3).
- **Pre-pilot:** 12/12 before and after each change to how replies are sent (#343, #345, #346, #347).
- **0159 was deployed after today's backup:** `nomi-backup-20261014T030046Z`, restore drill passed, PITR on.

**Tests changed by design:**

- `product-code-exemption` (#343): the turn now reads the product names once and shares them.
- `a5-names` (#344): the setup cache is now also cleared when a name is taken off a product.

## Still yours (no change)

The round trip, the three cold demos, naming the boss, the spare SIM, and the Chinese and Arabic product names on Westlake before you ask for Arabic.
