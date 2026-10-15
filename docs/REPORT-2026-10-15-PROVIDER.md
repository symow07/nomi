# The model provider: an honest health check, and a fallback (2026-10-15)

Written for the owner, answering "PHASE 4 — PROVIDER OUTAGE, DEPLOYS, AND THE REST".

## Next: yours

1. **Turn deploys back on.** Before you click, look at the staged environment patch `a850b939` (09:55 UTC, empty) in the dashboard. One deploy then applies 0161–0166 in order; today's 03:00 backup exists and PITR is on. Tell me, and I'll confirm `/health` and schema 166.
2. **Choose the fallback provider and paste its key: about 10 minutes.** My recommendation is **Anthropic, Claude Haiku 5.5**. It speaks the same message format, so it's the same client at another address; it's cheap; and it isn't DeepSeek. In Railway → `nomi` → Variables:
   - `LLM_FALLBACK_BASE_URL` = `https://api.anthropic.com`
   - `LLM_FALLBACK_API_KEY` = the key (from console.anthropic.com; I can't create accounts)
   - `LLM_FALLBACK_MODEL` = `claude-haiku-5-5`
   - **Leave `LLM_FALLBACK` unset for now.** The fallback is then checked every five minutes but answers nothing. I run the golden scenarios and the language sweep against it, report both sets side by side, and you decide whether to set `LLM_FALLBACK=on`.
3. **The 48-hour mark is 2026-10-17, about 09:50 UTC.** The record only starts once 0165–0166 are deployed, so item 1 matters for this too. At the mark I run `tools/model-uptime.mjs --hours 48` and give you DeepSeek's numbers.
4. **Yours, from your list:** the reply check for #3, the Resend setup, the Mac's disk, the WhatsApp round trip, the three cold demos, naming the boss, the spare SIM, Westlake's Chinese names.

## 1 · The health check: honest now (#361, migration 0165)

- **What `/health` says comes from real calls.** Every five minutes (and at boot), the smallest real call to each provider, timed. Every real call the app makes counts too: a turn that times out says so the moment it does.
- **The states:**
  - `answering`;
  - `slow`: a check over 5 s, or a real call over 20 s;
  - `not_answering`, with why: timeout, overloaded, billing, auth, rate limit, server error, no connection;
  - `refusing`: billing, as before;
  - `unknown`: nothing checked in 12 minutes, or the record is about another model.
- **Never `answering` without a call that answered.** The same reading drives the heartbeat, which pings `/fail` whenever no reply can be written.
- **Proved against today:** no billing refusal on record and every call timing out reads `not_answering` / `timeout`. With the old rule put back, that test fails.
- **Cost:** about 290 eight-token calls a day per provider. These are counted on the check's own row and on no workspace's ledger, since they would eat Westlake's daily allowance.
- `/health` doesn't call the model itself: it's public, and anyone could make us spend.

## 1 · The fallback, behind a flag (#362, migration 0166)

- **Three settings plus a switch** (above). Configured, the fallback is checked; switched on, it answers.
- **It fails over when** the primary times out, refuses (billing included), is overloaded, rate-limits, has a dead key, errors on its side, or can't be reached. It **never** fails over on a 400, because that was our request.
- **No double waiting:** while failing over is on, the primary is asked once, with no retries (the fallback is the retry). After a failure, calls go straight to the fallback for two minutes, or until the primary answers again. The five-minute check moves that breaker too.
- **Said everywhere:**
  - the logs ("DeepSeek did not answer (timeout): failing over to Anthropic for 2 minutes", "DeepSeek answers again");
  - `/health` gains `fallback`, `fallback_on`, and `serving`: `primary`, `fallback` or `none`;
  - the heartbeat fails only on `none`.
- **The privacy page names the fallback company while it is on**, since a buyer's message may go there.
- **Measured before it's needed:** `tools/capability-sweep.mjs --fallback` and `tools/check-person-model.mjs --fallback` run the same measurements against the fallback alone.
- **The record for the 48-hour call:** every check is kept 30 days (`model_check_log`); `tools/model-uptime.mjs` prints each provider's share answering, slow and down, median latency, longest outage, and why.

## The numbers side by side

The golden scenarios with a real model **are** the language sweep's model layer: every scenario in en, zh and ar, three runs each. `npm run trust` runs the same scenarios with a scripted model, so it measures our code, not a provider.

| | DeepSeek (primary), today 11:15 UTC | DeepSeek, 2026-10-14 after the fixes | Fallback |
|---|---|---|---|
| Turns, failed twice | 588, 0 | 588, 0 | **not run: no key yet** |
| Goes alone in one language, waits in another, as production runs it | 1 (Arabic, a product with no Arabic name: a data step) | 1 (the same) | — |
| The same split in the model-only rows | 2 (Chinese ties a product it is handed; production doesn't hand it one) | 2 (the same) | — |
| Different kind of reply, same send-or-wait | 1 | 3 | — |
| A language wobbles between runs | 2 | 2 | — |
| Golden scenarios, scripted (`npm run trust`) | 44/44 | 44/44 | provider-independent |

DeepSeek answers again since 10:30 UTC, and today's run matches yesterday's. The fallback's column fills in the hour after its key is pasted: `tools/capability-sweep.mjs --fallback`, plus `tools/check-person-model.mjs --fallback` for the "wants a person" layer.

## 2 · Deploys

- **Reversible:** all four (0161–0164; and 0165–0166 add only tables). None deletes data. The catch is **0162**: once two workspaces each hold a 2026-0001, going back to one global counter means renumbering. Today, with zero orders, it's as cheap as it will ever be. For the minute between the migrations and the new code starting, the old code can't confirm an order (0162 closes its counter); with no traffic, that touches nothing.
- **What switched it off: not found.**
  - Railway's API says auto-deploy is **on**, branch `main`, no watch paths, no plan limit.
  - Yet `nomi` recorded nothing for six pushes, while `backup` recorded each one.
  - My earlier "the trigger is off" was an inference from that silence, not something I saw.
  - Only the dashboard's activity log can show who or what changed something. I never change Railway settings.

## 3 · The e-mail fix: recorded as PARTIAL

PROGRESS and the decisions report now say "PARTIAL, blocked on the provider". DeepSeek answers again since 10:30 UTC, so the analysis-prompt change can now be made with the live check before and after. It isn't in this round because you said nothing else while you wait. Say the word and it's next.

## 4 · Order numbers: the strict rule is what's built

- **A number is given back only when the transaction that writes its order rolls back.** Until that transaction commits, nothing outside has seen the number: the buyer's confirmation is queued only after the commit (`src/pipeline/orderProposal.ts`), and a proforma can only be made for a committed order.
- **Once committed, a number is never given again.** Cancelling an order keeps its number, and the next order gets the next one.
- **Now guarded:**
  - a cancelled 2026-0006 is followed by 2026-0007;
  - a source test fails if the confirmation is ever queued inside the transaction.

## Verification

| PR | unit | trust | build | integration | pre-pilot (scripted) |
|---|---|---|---|---|---|
| #361 health | 8345 | 44 | ok | 1587 / 1587 | 12/12 before (main) · 12/12 after |
| #362 fallback | 8361 | 44 | ok | 1590 / 1590 | 12/12 before (#361) · 12/12 after |

Negative control (#361): with the old rule put back ("not refusing" = answering), 5 tests fail, including the one that replays today. #361 merged on two green CI checks (423afb21). #362's CI runs on its PR.
