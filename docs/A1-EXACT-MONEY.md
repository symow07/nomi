# A1 · Exact money — the migration notes

Phase 5, block A, item A1 (`docs/PHASE-5.md` §2.1 and §3). For whoever deploys the build that carries it, and for
the owner. Written 2026-10-22.

## What was wrong

Amounts were stored exactly (Postgres `numeric`) and then turned into floating-point numbers to be discounted,
multiplied and rounded. **$5.30 less 5% is exactly $5.035; Nomi quoted $5.03**, where any rounding rule gives $5.04.

- Measured on 2026-10-21 over 700,000 price × discount pairs: **1.34% a cent wrong.**
- **Every wrong cent was DOWN.** Nomi under-charged, on about **one discounted quote in 75**. None was over-charged.
- On an order, that cent was multiplied by the quantity.

## What changes on the day A1 is deployed

1. **A quote can come out one cent higher than the same inputs gave before.** It's the corrected figure: half a cent
   rounds up (half away from zero), as every rounding rule in commerce does. The direction is always up, to the exact
   figure, and never more than one cent per unit.
   - Then the total is that unit price times the quantity, rounded to the cent. So a 5,000-piece order quoted
     $5.03 before is $5.04 × 5,000 = $25,200.00 now, not $25,150.00.
   - **Production has had zero turns since 2026-09-20** (the owner, 2026-10-21), so no buyer will see a
     price move this time. In any week with traffic, this would be a customer-facing change and would need telling.
2. **Nothing stored is rewritten.** Quotes and orders already sent are what the buyer saw, and they stay as they are.
   There is no data migration for A1's arithmetic: `numeric` was always exact.
   - `tools/money-sums.mjs` proves it on the day (below).
3. **JSON payloads.** Events, draft notes, import drafts and audit details written before A1 hold amounts as JSON
   numbers. They're read as the number that was written (`storedDecimal`). Payloads written after A1 hold the
   amount as exact text ("5.04"). Both read the same.
4. **The audit trail of a price edit** now says `{ "from": "1.05", "to": "0.98" }` (text) where it said
   `{ "from": 1.05, "to": 0.98 }`. Nothing in the app reads those fields back; an export does, as written.
5. **The owner's exchange rate** is kept exactly as typed, to six decimals. A rate written with an exponent (`1e3`)
   or a sign (`+6.9`) is refused, where it used to be read as a number. A rate that rounds to zero at six decimals is
   refused, where it used to be stored as 0.
6. **New currencies (0168):** the Moroccan dirham (MAD), the euro (EUR) and the pound sterling (GBP) join the eight.
   Every currency's minor unit comes from ISO 4217, and all eleven have two. A shop signing up in Morocco, the
   euro area or the United Kingdom now gets its own money without being asked.

7. **A figure is read one way, or refused (the owner, 2026-10-22).** No meaning is taken from the separator, and
   none from the currency. This holds in every money box (price, larger-order prices, lowest price, sample, rate,
   a corrected import row) and in the price-list reader.
   - **Refused as ambiguous:** one separator before exactly three digits, after a whole part of one to three digits
     that is not zero: `1.250`, `1,250`, `15.000`. Before, the currency settled it: reais and rupiah read `15.000`
     as fifteen thousand, every other currency read `1,250` as one thousand two hundred and fifty, and the rate box
     read `15.000` as fifteen. A silent misread could be a thousand times too high or too low. Now the box says,
     in the owner's language: *"A figure like 1.250 or 1,250 can be read two ways. Type 1.25, or 1250 with no
     separator."* A price-list line with such a figure gets no price and is flagged for the owner.
   - **Read one way:** `1.25` and `1,25` (decimals; no thousands group is two digits long); `0.4500` and `0.450`;
     `1 250` (a space is never a decimal mark); `1.250.000` (a decimal mark appears once); `1.250,50` and
     `1,250.50` (both marks: the last is the decimal); the rupee's `1,50,000`.
   - **The reply guard** credits a figure in a euro or dirham reply only when it reads one way: `0,45 €`,
     `4.500,00 €` and `4 500 €` pass for a quote of 4,500, and `4.500 €` is held for the owner. Reais and rupiah
     keep their rule (`Rp 150.000`).
   - The owner's five cases are tests in every box and in each currency (`tests/parity/a1-ambiguous-figures.test.ts`).

## The check on the day (before and after)

The plan's done-criterion for A1: *stored amounts, with a before-and-after sum per table per workspace that matches
exactly.*

```bash
# before the deploy (with the day's backup taken, docs/LAUNCH-CHECKLIST.md)
railway run --service Postgres -- sh -c 'MIGRATE_DATABASE_URL="$DATABASE_PUBLIC_URL" node tools/money-sums.mjs' > ~/nomi-private/money-before.tsv
# … deploy, /health, schema_version = 168 …
railway run --service Postgres -- sh -c 'MIGRATE_DATABASE_URL="$DATABASE_PUBLIC_URL" node tools/money-sums.mjs' > ~/nomi-private/money-after.tsv
node tools/money-sums.mjs --compare ~/nomi-private/money-before.tsv ~/nomi-private/money-after.tsv
```

- **Identical** (exit 0) is the only acceptable result. Run it while nothing is being sold, which is true today.
- A difference names its table, column and workspace. Something wrote money during the deploy: find out what before
  going on.
- The files hold workspace ids and money sums. Keep them in `~/nomi-private/`, never in the repo.

## What proves A1

- `tests/parity/exact-decimal.test.ts`: a million random quotes (price to four decimals, discount to two,
  rounded at 0–3 places) against an exact-fraction reference: **0 wrong.** The same inputs through floating point
  are not all exact (a negative control).
- `tests/parity/exact-quote.test.ts`: 200,000 random quotes through the real `computeQuote` and the order check
  (half in whole cents and whole percent, half anywhere in the stored range; the owner's discount and authority; a
  floor sometimes above the price): **0 wrong** unit prices, totals, discounts or refusals. On the same inputs the
  old floating-point path is **790 times a cent wrong.**
- `tests/parity/exact-money.test.ts`: no floating point touches money anywhere in `src`; the scan can fail.
- `tests/parity/a1-currencies.test.ts`: the eleven currencies, their ISO 4217 minor units, 0168's checks, the
  reply guard and the price-list reader in each new one.
- §2.1's three examples are regression tests ($5.30 less 5%, $5.10 less 15%, $5.48 less 12.5%).
- **Golden scenarios: no figure changed.** All 41 pass with the expectations they had. None of their prices lands
  on a half cent.
