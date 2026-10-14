# Phase 4 checks: the five things (2026-10-15)

Written for the owner, answering "PHASE 4 CHECKS — REVIEW".

## Next: yours, unchanged

1. **The WhatsApp round trip.**
2. **The three cold demos.**
3. **Name the boss**, then the spare SIM.
4. **Westlake's 5 products need Chinese names.** Setup now asks for them only once you tick Chinese on the profile, or once a Chinese buyer writes in. Until then they're a suggestion (item 1).

## 1 · Check 3 was wrong: fixed (#349, migration 0160)

**New rule.** A product needs a name in a language only if:
- you chose that language (you changed the profile's language list at least once — the default en/zh/ar was nobody's choice), or
- a real buyer of yours wrote in it. Your own test conversations don't count.

**Only those languages keep the products step undone.** Every other language on the profile is a suggestion: one quiet line on the products list and a caption on a product, never an undone step. The profile's language field now says what ticking a language means.

**Westlake today:** it never changed its list, and its 5 real buyers all wrote in English. So its step no longer waits on Chinese or Arabic; both are suggestions. None of the 60 workspaces ever changed the list, so the backfill changed nothing.

**Where Russian came from.** The profile's "languages you serve" has nine checkboxes since commit `ba85431c` ("Positioning rewrite 4c: sign-up and the profile", migration 0093): en, zh, ar, es, fr, pt, de, tr, ru. #344 asked for a Cyrillic name only where Russian was ticked, never by default. Your en/zh/ar/es/fr is the owner-app languages, a different list.

## 2 · #347's two assertions

- **What they expected.** The two assertions in `tests/integration/language-hold.test.ts` expected the reply to be exactly the writer's words «أهلًا بكم، يسعدنا المساعدة.»
- **What the code does.** It sends the "I'm an assistant" disclosure, then those words. Each of those test turns opens a new conversation, and rule 3 (0079) puts the disclosure on the first automated message of every conversation.
- **Why the code is right.** The turn tests that passed had a buyer who was already told; these didn't.
- **Now:** both assertions check the exact text, disclosure plus words, not "contains" (#352).

## 3 · #346's inverse: proved, and it found a gap

- **The new test runs over Postgres, both ways.** A forbidden word, or an Arabic gendered word, that is rewritten cleanly keeps the capability on auto. The forbidden word written twice withdraws it to draft, with the assistant's own event saying so.
- **The gap.** An Arabic reply the writer gendered twice is handed to a person (0158), and that path sets no hold. So since #346 it withdrew nothing. And since 0158, it was never counted as evidence either. That's the "never demotes" direction you warned about.
- **Fixed.** A reply the writer couldn't produce without a gender now counts as a failure of the reply that was kept, and it withdraws, like the forbidden word twice (#352).
- **The tests bite.** With the fix switched off, both twice-gendered cases fail.

## 4 · Check 1: the line, and three or more products (#350)

- **The 85% line.** Through a whole turn: 0.340 against 0.400 asks; 0.339 against 0.400 is priced. The same pair is tested in the pure function.
- **Three close products.** Before, it took the best two and dropped the rest. Now every product within 85% of the best is in the question, best first, and equal scores in name order. Up to four are named. Past four: "Several fit: A, B, C, D, and 2 more. Which one do you mean?" Nothing is dropped without a word.
- **Tested:** three over the real search (无纺布购物袋 / 无纺布手提袋 / 无纺布背心袋), three through a turn, and six in every language.

## 5 · The way out of the "may be saying yes" card (#351)

It was a dead end, and I built the exit. An order existed only through a proposal, and only the turn's own "yes" could make one. A maybe hands the conversation to a person, and no turn runs while a person holds it.

**Now it's two deliberate steps, and there's still no Confirm on the maybe card.**

1. **"Prepare the order"** on the maybe card. It asks for a quantity and the buyer's e-mail.
   - The quantity is filled in with the one that was priced. Where their words name another quantity, it starts empty, so you type the one you mean.
   - The price is the one this buyer was actually given for that quantity. If they were never priced for it, it's the list price, never below your floor.
   - Nothing is confirmed or sent.
2. **The ordinary order card's Confirm.** Their words, the unit price and the total all sit above it. If the price was never sent to them, the card says so before Confirm.

**Tested over Postgres:**
- "ok, 5000 again please" after a 500 price: prepared at 5,000 at the list price ($10,500), warned as never sent, then confirmed.
- "Sounds great, let us go with that" after a 500 price: prepared at the price they were given, no warning, then confirmed.
- A bad e-mail prepares nothing. A second submit changes nothing.

## Verification

- **Every PR passed all four checks:** check, trust 40/40, build, and integration (1,562 to 1,566 tests, none skipped).
- **Pre-pilot:** 12/12 on main before, and after each change to how replies are sent (#350, #351, #352).
- **0160** was deployed after the backup `nomi-backup-20261014T030046Z` (13 hours old, PITR on). Production schema is now 160; every deploy's health check was ok.
- **One unrelated nightly flake, found on the way and root-caused.** The pilot-log test read "yesterday" from the local database's clock (Shanghai time), while the tool reads UTC, so it failed every night from 00:00 to 08:00. It now reads the tool's clock; production's database runs on UTC.

**Tests changed by design:**
- `setup-names` (rewritten for item 1).
- `maybe-yes-card` (the card now has one form, which prepares).
- `order-proposal` (the card test's "nothing to press" became "no Confirm, one form").
- `r1-evidence` (its source pin now names the kept-reply flag).
