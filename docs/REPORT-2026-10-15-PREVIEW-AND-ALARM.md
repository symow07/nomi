# A local preview, the fallback model, the deploy alarm, the e-mail prompt (2026-10-15)

Written for the owner, answering "PHASE 4 — FALLBACK, DEPLOYS, AND A LOCAL PREVIEW".

## Next: yours

1. **Look at the preview: 15–30 minutes.** Open `http://127.0.0.1:8787` on this Mac. Choose "I have an access code" and enter `smoke-code`. The pages are in §0. Tell me when you're done and I'll stop it, since it holds the DeepSeek key in memory.
2. **The fallback key: about 10 minutes, whenever you choose.** In Railway → `nomi` → Variables:
   - `LLM_FALLBACK_BASE_URL` = `https://api.anthropic.com`
   - `LLM_FALLBACK_API_KEY` = your key
   - `LLM_FALLBACK_MODEL` = `claude-haiku-4-5-20251001`. That's your string, and it's right. §1 says why it's not Haiku 5.5.
   - Leave `LLM_FALLBACK` unset. Then I make one real call with it, inside Railway's environment so the key never shows, and report what came back. After that I run the side-by-side, and you decide on `on`.
3. **Discard the staged patch `a850b939`:** 1 minute (Railway → the project's staged changes). It's empty and not the cause (§2).
4. **From your list:** the reply check for #3, the Resend setup, the Mac's disk, the WhatsApp round trip, the three cold demos, naming the boss, the spare SIM, Westlake's Chinese names.

## 0 · The local preview

- **Address:** `http://127.0.0.1:8787`. **Sign-in:** "I have an access code", then `smoke-code`.
- **Code:** main through #362, the same code as the merge of #362. Production stays on #353.
- **Database:** a local one only (the smoke cluster, port 55440), migrated to schema 166. 0161–0166 ran there and nowhere else.
- **Seeded with** the demo workspace, the Practice sandbox and the usability script's data.
- **The model:** real (DeepSeek, deepseek-flash). The host passes on only the three `LLM_*` variables from Railway, and nothing else of production's. Every other secret is a local dummy.

**Where to look**

| What | Where |
|---|---|
| The new site | `/site/next` |
| The onboarding path | `/app/onboarding` (Getting ready); new buyers in Practice: `/app/sandbox` |
| An order card, numbered per workspace | `/app/orders/da59d44c-905f-439f-a349-0d9833f4eb74`, which shows **2026-0001**: this workspace's first order this year (0162). I made it locally through the app's own order code. |
| Buyers | `/app/inbox` |
| The honest health check | `/health` |

What `/health` said just now:

```
{"ok":true,"db":true,"worker":true,"provider":"disabled","model":"answering","model_ms":2133,
 "model_checked_at":"2026-10-15T14:05:05.732Z","fallback":"off","fallback_on":false,"serving":"primary"}
```

- `model: answering` comes from a real call 2.1 s long, not from a setting.
- `provider: disabled` means no messaging channel is connected locally.

**What you CAN'T test locally, and why**

1. **WhatsApp, Instagram, Messenger.** No Meta credentials and no public address, so no webhook is mounted: nothing arrives and nothing sends. Practice runs the same turn without a channel.
2. **E-mail out**: sign-in codes, owner and operator alerts, Resend. No mailbox is connected locally, so nothing can leave this Mac.
3. **The deploy alarm.** It's #363, after this build. It also needs `RAILWAY_GIT_COMMIT_SHA`, which only Railway sets. Locally it logs that it's off.
4. **The fallback.** No fallback key exists yet, so `/health` says `fallback: off`.
5. **Production's data and jobs:** Westlake's real conversations, the 03:00 backup, the heartbeat ping, and how 0161–0166 behave on production's rows. The local data is seeded.

## 1 · The fallback model string

**The model string:**
- **You were right that a Haiku string was the issue, but not about which one is wrong.** Anthropic's own model list names `claude-haiku-5-5` as the current Haiku (released 2026-10-07), and it exists.
- **The real problem was my claim, not the string.** I said "the app's client can call it with no new code". For Haiku 5.5 that was wrong:
  - Anthropic's migration guide says Haiku 5.5 returns **400** for any `temperature` other than 1, any `top_p` other than 0.99, any `top_k`, and an assistant prefill.
  - The app's analysis and writer send `temperature` 0, 0.2 and 0.3.
  - So every call would be refused, and since a 400 never fails over, the fallback would never answer.
- **`claude-haiku-4-5-20251001` is listed as Active** and accepts those requests as they are. It's the one to use, and no code change is needed.

**The headers:** "Anthropic's native API wants an x-api-key header and an anthropic-version header". Proved with one real call from the app's own client (`llmClient` in `src/llm/provider.ts`), with a dummy key:

```
POST https://api.anthropic.com/v1/messages
headers: accept, anthropic-version, content-type, user-agent, x-api-key
anthropic-version: 2023-06-01 · no Bearer authorization
body: model, thinking {type: disabled}, max_tokens, temperature 0.2, messages
→ 401 authentication_error "invalid x-api-key"
```

- **What worked:** the address, both headers and the body shape. Anthropic read the request and refused only the key.
- **Not yet proven:** an answer. That needs your key. Once it's pasted, I make the same call with it, from the same client, inside Railway's environment, and report the result before anything else. (The app's own five-minute check of the fallback is #362's code, so it runs only once deploys are back on.)

## 2 · The deploy alarm (#363, migration 0167)

**What it does:**
- Every 10 minutes the app compares the commit it runs (`RAILWAY_GIT_COMMIT_SHA`, set by Railway on every deployment from git) with `main`'s head on GitHub (public, no token).
- When main's head is more than an hour old and production runs something else: one operator alert, `deploy_behind`, by e-mail always. It names both commits, how long, main's commit title, and where to look in Railway.
- Once per head; a new merge tells again. When production catches up: `deploy_caught_up`, once.
- `deploy_lag` keeps each head (seen, alerted, caught up).

**What it can't do:** it's code, so it starts working only once a deploy brings it in. Until you turn deploys on, nothing watches.

**Tested** on the day it was missed:
- main moves, 30 minutes says nothing, 72 minutes tells once, the next sweep stays quiet, catching up tells once;
- GitHub not answering says nothing;
- with the alarm's verdict switched off, two tests fail.

**The lead, checked:** you asked whether a staged change blocks the trigger.
- The staged patch `a850b939` was created **2026-10-15 09:55 UTC**. The last deploy was **2026-10-14 18:11 UTC**, so the stop began 16 hours earlier, and the patch can't be what started it.
- It's empty. I think one of my own read-only Railway queries created it, but that's a guess; the dashboard's activity log would say.
- So the stop is still **unexplained**. Railway's API says auto-deploy is on, branch `main`, no watch paths. Only the activity log can say more.

## 3 · The e-mail analysis prompt: the PARTIAL is closed

**What changed:** three lines of `prompts/analysis.txt`.
- e-mail is out of the `missing_fields` example;
- confirmation is "collecting final confirmation", not "+ email";
- "Never list email, and never suggest asking for one: an order does not need an email address."

**The live check, before and after**, on production's model (deepseek-flash), run inside Railway's environment.

| | Before (main) | After |
|---|---|---|
| E-mail probe: the analysis's next question or missing fields mention an e-mail | **18 of 21** | **0 of 21** |
| Person check: named sentences answered the other way | 1 of 49 | 1 of 49 (the same one) |
| Person check: unreadable or failed | 0 | 0 |
| Person check: median answer | 2243 ms | 2250 ms |

- **The probe** is seven conversations at confirmation or negotiation, in en/zh/ar, three times each.
- **Before**, every confirming conversation asked, for example "Great — could you share your email so I can send the order confirmation?", «好的，麻烦您提供一下邮箱» and «هل يمكنك تزويدي ببريدك الإلكتروني لإتمام الطلب؟». Only the negotiation case didn't.
- **After**, "yes, go ahead" gets no next question at all. "What do you need from me?" now asks for the delivery address and a contact name or number.
- **The person check's one miss** is «Appelez-moi Marie» ("call me Marie", French), read as asking for a person. It was the same before and after, so this change didn't cause it.
- **Held by** `tests/parity/prompts-ask-no-email.test.ts`: a line of either prompt that names e-mail must say never. It fails on the old prompt.

## 4 · Accepted, as built

- the honest `/health` (#361);
- the strict order-number rule: given back only when its own transaction rolls back (#357, #360);
- never taking over on a malformed request: a 400 never fails over (#362);
- naming the fallback company on the privacy page while it's on (#362).

## 5 · The 48-hour mark

- Kept at **2026-10-17 09:50 UTC**, as you said.
- **The honest date:** the record starts only when 0165–0166 are live, so the first full 48 hours end 48 hours after you turn deploys on.
  - Turned on tomorrow (2026-10-16) at 09:00 UTC, that's 2026-10-18 09:00 UTC.
  - Still off at the mark, there's nothing to read. At 09:50 on the 17th I run `tools/model-uptime.mjs --hours 48` regardless and say how many hours it actually covers.

## Verification

| | Deploy alarm (#363) | E-mail prompt |
|---|---|---|
| `npm run check` | passed (8371 tests) | passed (8374 tests) |
| `npm run trust` | passed | passed (44 tests) |
| `npm run build` | passed | passed |
| integration | 1592 of 1592, none skipped | 1592 of 1592, none skipped |
| pre-pilot `--scripted`, before → after | 12/12 → 12/12 | 12/12 → 12/12 |
| live model check, before → after | not touched | above (§3) |
