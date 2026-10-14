# Live verification — WhatsApp, on the path Nomi runs

Rewritten 2026-10-14. The page it replaces described a reseller's sandbox (a path the owner rejected at the Phase 4
gate) and named three files that no longer exist. This one describes the Meta Cloud API path production uses
(`WHATSAPP_PROVIDER=meta`), and `tests/parity/gate-a-kit.test.ts` holds it to the tree: every file, page and tool it
names must exist.

How the path was set up the first time is `docs/META-CLOUD-API-SETUP.md`. This page is the check that it still
works — run it before each cold demo and before the pilot's first day (`docs/GATE-A-KIT.md` §1, prerequisite 5).

## 1 · Where the number stands with Meta (one minute)

```bash
railway run --service nomi -- node tools/wa-number-status.mjs
```

It prints the number's display name and its status, and nothing secret. `name_status` must read `APPROVED` or
`AVAILABLE_WITHOUT_REVIEW`; anything else means nothing sends, whoever writes it. On 2026-10-14 the installation's
number (+1 555-472-3574, name "nomi") read `AVAILABLE_WITHOUT_REVIEW`, quality GREEN, tier 250.

## 2 · The app is up and current

`curl -4 https://app.nomidoes.com/health` → `"ok":true`, `"worker":true`, `"provider":"active"`.

## 3 · The round trip (five minutes)

From the owner's phone — the one number on Westlake's allowlist:

1. Send "hello" to +1 555-472-3574.
2. Within a minute the conversation is in Westlake's Buyers (`/app/inbox`).
3. The reply arrives on the phone. On a first contact it opens with the disclosure; Westlake's capabilities are on
   auto and English is signed.
4. The conversation shows the reply delivered.

A reply goes only within 24 hours of the buyer's last message: send the "hello" first, every time.

## 4 · When something does not arrive

- **Nothing reaches Buyers:** Meta did not call the webhook, or Nomi refused it. Railway's logs for
  `/webhook/whatsapp`; on My business (`/app/business`), the channel's health.
- **The reply does not reach the phone:** the reply's error is recorded with Meta's code (`#131037`: the display name
  is not usable — step 1; `#131047`: outside the 24 hours). `railway run --service nomi -- node tools/errors.mjs`
  lists what the app reported.
- **The reply was never sent:** the conversation page says why (the send gate's reason, in the owner's words): not
  activated, not on the allowlist, the daily ceiling, Stop, a language whose disclosure is unsigned.

## 5 · A second number, for a pilot business (decision 1, A)

The owner's decision (2026-10-14): the boss's working number never moves. A spare SIM, a number the boss advertises
for the pilot only:

1. WhatsApp Manager → Phone numbers → Add: the spare number (it must not be on the WhatsApp app), verified by SMS or
   call; the display name is the boss's business.
2. Meta reviews the name. `node tools/wa-number-status.mjs --phone-number-id <its id>` (under `railway run`) says
   when it is usable.
3. Attaching it to the boss's workspace: the deployment connects ONE configured number (Westlake's). A second number
   in Nomi's own account needs an operator tool that writes the rows embedded sign-up writes — **not built yet**
   (named in the kit as mine to build, before the boss's first day).
4. Then this page's round trip, from a phone on the boss's allowlist.
