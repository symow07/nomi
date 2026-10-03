# The product-code check — what it is, what it has done, and whether codes can pass

Investigation only (2026-10-04). Nothing was changed. Production was read, read-only, on 2026-10-04 at main `d3a7cdc` (schema 125).

## The answer

- **The check.** It is the numeral guard, `guardNumerals` (`src/core/safety/numerals.ts:233`).
  - It takes every figure out of a reply the assistant wrote, and refuses the reply if any figure cannot be traced to the quote, the conversation, the customer's own message, or a short list of the owner's own texts.
  - A product's **name and code are not on that list**. So "ZX-300" is read as the figure 300, and "Thermos 500ml" as 500. Each is refused unless the customer typed the same figure.
- **In production it has held no reply, ever.** There are no `guard_violation` events and no held drafts in any workspace.
  - Production has had very little traffic: 12 turns in the live workspace, all between 18 and 20 September.
  - The "ZX-300" concern came from reading the code during the warmth run's fix wave, not from a production event. It is real, and was reproduced on the real function below.
- **It will happen as soon as traffic returns.** All five active products of the live workspace (Westlake Canvas Co.) carry a figure above 12 in their own name or code.
- **Recommendation: product codes can be let through safely, but only by their exact text, never by their value.**
  - Before figures are taken out of a reply, remove the exact words of this business's own product names and codes.
  - Never add a code's figures to the allowed values. That would also pass "The ZX-300 is $300 each" and "Minimum order is 500", as shown below.

## What the check matches

**Where it runs.** `src/pipeline/turn.ts` calls it on every reply that could reach a customer:
- the order-status answer (`:633`);
- the owner's taught answer (`:664`);
- each of the writer's two attempts (`:710`);
- the stand-in written after two refusals (`:766`).

The trust harness holds the same rule as an invariant (`src/trust/invariants.ts:282`, `noUnsourcedSpecNumber`).

**What counts as a figure** (`extractNumerals`, `numerals.ts:122`):
- every run of digits, `\d[\d,]*(?:\.\d+)?`, wherever it stands, including inside words. "ZX-300" gives 300, "500ml" gives 500, "38x40cm" gives 38 and 40, and "A4" gives 4;
- Arabic-Indic and Persian digits, read as the figures they are (`asciiDigits`);
- Chinese numerals, when a unit or a currency follows them ("五百个", "十二元").

**A figure passes without a source** only if it is 0–12 and not in a commercial position (`isSafeSmall`, `:33`).

**A figure is in a commercial position**, and must always be sourced, when it stands beside (`COMMERCIAL_CONTEXT`, `:42`):
- a currency (symbol, code or word, in several languages);
- a percent sign or "percent";
- the words for a discount, deposit or fee;
- the words for a minimum order, in en, zh, ar, es and fr.

**Sourced figures** (`:240–258` and the allow list built at `turn.ts:552–608`):
- **the quote:** the unit price, total, discount percent, quantity, minimum and lead time;
- **the conversation:** the quantity in its state;
- **the customer:** every figure in their own message;
- **the identified product:** its taught facts (labels and contents of Knowledge entries) and its options (sizes, volumes);
- **the owner's other texts:** a sample policy she wrote, the label of a closure that withheld a date, and the assistant's and the business's names.

**Two further rules** apply on top of that:
- **the currency:** a price is sourced only in the quote's own currency (CUR, `:150–200`);
- **dot thousands:** "R$ 1.250,50" and "Rp 150.000" are read the Brazilian and Indonesian way when the quote is in their currency.

**Not a source:**
- the product's own name;
- its code (SKU);
- the business profile's text, apart from the business name;
- any other product's name or code.

## Why it exists

The file states it (`numerals.ts:7–19`): "the LLM never generates prices, MOQ values, discounts, lead times, shipping costs, or business commitments".

A figure the model made up, written to a business buyer, is a commercial and legal exposure. Prompt injection could produce one on purpose. With the guard, a number that did not come from the owner's data cannot reach a customer, so the model has no authority to commit to anything.

The guard reads figures, not meanings. It cannot tell a model number from a price, which is why a product code trips it.

## What happens when it trips

1. **The writer gets a second attempt**, told that it broke a rule (`turn.ts:690–760`).
2. **Two refusals.** The reply becomes a fixed stand-in built only from the quote's figures, which does not name the product (`guardFallbackReply`, `src/core/conversation/templates.ts:224`). If even that fails, one fixed sentence is used.
3. **The turn is held for the owner**, as a draft with the reason `guards_failed_twice`, even where that kind of reply would go out alone (`turn.ts:1194`). The owner's card says the assistant "could not write this reply within your rules, twice".
4. **Every refused attempt is written down** as a `guard_violation` event (`turn.ts:1231`), including one the second attempt repaired.
5. **Self-demotion.** If that kind of reply was set to go out alone, one refusal **moves it back to waiting for the owner** (`selfDemote`, `turn.ts:1243`; `TRUST-PLAYBOOK`). So a product code in one reply can undo the owner's autonomy choice for that kind of reply.

A taught answer or an order-status answer that trips the guard is not sent; the turn falls through to the writer, which is also guarded.

**What is not recorded:**
- **which guard refused an attempt.** Numerals, claims, forbidden words and identity all count as one `guard_violation`; only forbidden words and identity are named;
- **the refused text and the figures that tripped it.**

So even with traffic, numeral refusals could not be told apart from claims refusals afterwards.

## What production shows (read-only, 2026-10-04)

`conversation_events`, `drafts`, `turns` and `products`, live workspaces and practice copies (`businesses.practice_of`) counted apart:

| | Live | Practice |
|---|---|---|
| `guard_violation` events (refused attempts) | **0** | **0** |
| Drafts held with any reason (`draft_pending.heldBecause`) | **0** | **0** |
| Turns recorded | 12 (2026-09-18 to 09-20): 9 by the model, 1 silent, 2 from before the answer path was recorded | 0 in `turns` |
| Drafts | 2, both approved | — |

The live workspace's event log has 33 events, the last on 2026-09-19:
- 8 `resume_ai`, 7 `owner_reply`, 4 `handed_to`, 4 `takeover`, 2 `handoff`;
- 2 `draft_pending`, 2 `draft_resolved`;
- 1 each of `wrote_first`, `knowledge_used`, `sandbox_turn` and `buyer_renamed`.

So the check has held nothing in production, on anything.

**Exposure.** Active products whose own name or code carries a figure above 12:

| Workspace | Active products | With such a figure |
|---|---|---|
| Westlake Canvas Co. (live) | 5 | **5** |
| 义乌宏发日用品厂 (demo) | 648 | 648 |

Every product the live workspace sells would trip the guard if a reply named it and the customer had not typed the same figure.

## Reproduced on the real function

The local build of main (`dist/core/safety/numerals.js`), with no allowed values unless stated:

| Reply | Customer's message | Result |
|---|---|---|
| Yes, the ZX-300 comes in blue. | — | **held** (300) |
| The Thermos 500ml keeps drinks hot for 12 hours. | — | **held** (500) |
| Yes, the ZX-300 comes in blue. | Do you have the ZX-300 in blue? | passes (the customer's own figure) |
| For 5,000 pcs of the ZX-300 it is $1.45 each, $7,250 in all. | — (a quote of 5,000 at $1.45) | **held** (300) |
| For 5,000 pcs it is $1.45 each, $7,250 in all. | — (the same quote) | passes |
| It is $300. | — | held (300): correct |
| ZX-300 有蓝色的。 | — | **held** (300) |
| نعم، يتوفر ZX-300 باللون الأزرق. | — | **held** (300) |

**The unsafe shortcut**, with the codes' figures added as allowed values (`allow: [300, 500]`):

| Reply | Result |
|---|---|
| Yes, the ZX-300 comes in blue. | passes |
| The ZX-300 is $300 each. | **passes**: an invented price |
| We can do 300 pieces by Friday. | **passes**: an invented commitment |
| Minimum order is 500. | **passes**: an invented minimum |

## Recommendation

**Yes, product codes and the figures inside product names can be let through safely**, with this shape and no other:

1. **Exempt by text, never by value.** Before figures are taken out of a reply, remove every exact occurrence of this business's own active product names and codes. Matching is case-insensitive and Unicode-normalised, with digits made ASCII as the guard already does. The figures that remain are checked exactly as today. "The ZX-300 comes in blue" then passes; "The ZX-300 is $300 each" is still held for its $300.
2. **Only the owner's own catalogue.** A code the model invented matches no product and stays held.
3. **Leave out a name that itself carries a currency, a percent or a minimum** (for example "Gift box $5 special"). Its figures stay checked, so the exemption can never carry a price.
4. **Keep everything else:** the commercial-position rule, the currency rule, the two attempts, the stand-in and the hold.
5. **Record which guard refused and the figures that tripped it** (no customer text), so that the next investigation can count numeral refusals separately.
6. **Tests to hold it:**
   - every held row of the first table above passes;
   - every row of the "unsafe shortcut" table stays held, with the code present in the same reply;
   - en, zh, ar, es and fr;
   - the trust harness's `noUnsourcedSpecNumber` stays green.

This is a change to the send path, so it is the owner's decision. Nothing has been changed.
