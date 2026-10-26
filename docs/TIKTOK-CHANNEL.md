# TikTok — the channel plan (PLAN ONLY, nothing built)

**Status (2026-10-26): surface A BUILT against a recorded fake (0215); nothing has met TikTok.** No account exists, nothing
was applied for, and no TikTok API was called. TikTok is a recipient the privacy page does NOT yet name, so the boot
refuses its variables until the owner reads its privacy line (§4). What was built is §6.

TikTok is in 100% (PHASE-5.md decision 8, the owner's override of 2026-10-23).

**Decided (the owner, 2026-10-26): the DIRECT-MESSAGE path only (surface A).**
- **TikTok Shop chat (B) is OUT:** its Customer Service API is partner-gated (1,000 authorised sellers), and Morocco
  is not a TikTok Shop market.
- **Comment replies (C) are not in this plan either.**
- The owner is taking the access steps (§4) personally. When the data security and privacy review is reached, Claude
  drafts its answers from this page and from the code, for the owner to read; nothing is submitted by Claude.
- B and C stay below as what was read, for the record.

**How it was read:** TikTok's two developer sites draw their pages with script. The same text was read from each
site's own public documentation endpoint (no login, no product API): TikTok API for Business
(`business-api.tiktok.com/portal/docs?id=…`) and TikTok Shop Partner Center (`partner.tiktokshop.com/docv2/page/…`).
Each fact below names its page. **NOT CONFIRMED** means no TikTok page said it.

---

## 1 · Which surface

There are three TikTok surfaces with an official API. They are separate: the Business Messaging API itself says
"Integration with the TikTok Business Messaging API does not allow management of TikTok Shop Messages."

| Surface | What it is | Official API | The gate |
|---|---|---|---|
| **A · Business Messaging** | Direct messages to a business's TikTok account | **Yes** (Business Messaging API, open beta) | A data security and privacy review; not available for accounts signed up in the EEA, Switzerland or the UK |
| **B · TikTok Shop customer service** | The buyer–seller chat inside TikTok Shop | **Yes** (Customer Service API, a "custom" scope) | **A partner-size gate**: 1,000+ authorised sellers, or 1 million API calls a day |
| **C · Comment replies** | Comments on the business's own videos | **Yes** (Accounts API) | An access application form (since 2026-03-20) |

**A only (decided 2026-10-26).** A is the only surface a new app like Nomi can reach. B is out: blocked on scale
(1,000 sellers on TikTok Shop) and not offered in Morocco. C is not in this plan: it would answer in public, which
would need its own decision about what Nomi may say there. **The owner's guess, checked:** "messaging access is partner-gated, and
that's the real blocker" is **right for TikTok Shop chat (B)**. It is **not quite right for direct messages (A)**,
which are gated by a review and by region, not by partner size. A is reachable.

## 2 · Access requirements

### A · Business Messaging (Business API docs `1832184145137922`, "Access to Business Messaging API")
- **Steps:** an approved developer app on TikTok API for Business; then the Business Messaging intake form. TikTok
  "initiate[s] the review process within 10 working days".
- **Reviews:** outside the US, the **data security and privacy review**. For accounts signed up in the US, also the
  **US data security review** and the USDS Addendum.
- **Regions:** "not yet available in the European Economic Area, Switzerland or the UK market. For TikTok accounts
  signed up in those regions, developers cannot call the Business Messaging API on behalf of these accounts."
  Messages from accounts in those regions also cannot be retrieved. The overview calls it an "Open Beta in APAC,
  LATAM, METAP, and North America" (seen as a search snippet of TikTok's page, not read in full).
  - **Morocco:** in METAP (the Middle East, Turkey, Africa and Pakistan), so in the beta's area. A Moroccan business
    account is not excluded by any line read. NOT CONFIRMED that it works until it is tried.
  - **Mainland China:** TikTok is not offered in mainland China; Douyin is a separate product with its own API (common
    knowledge, not read on TikTok's pages for this plan). A China-based business with an overseas TikTok account: NOT
    CONFIRMED.
- **Accounts:** "Advanced Access or Verified Business Accounts"; the account owner must be over 18.
- **Cost:** no fee on any page read. NOT CONFIRMED that there is none.

### B · TikTok Shop Customer Service (Partner Center `659645f9a46cdd02bc8aeacf`, `access-scope`, `app-review-process`)
- "Customer Service is a custom API … it requires specific approval." The scope is off by default ("Customer Service
  API access is inactive by default").
- **The gate:** "1,000 or more authorized sellers; OR … 1 million API calls per day". Exception: a seller in the
  "TikTok Shop Seller" app category (its own development team) "may" be granted special approval. That route is for
  a seller building for itself, not for Nomi.
- **The review also needs:** an in-app chat window shown in screenshots and a screen recording, and the Order,
  Fulfillment and After-Sales APIs already integrated.
- **Markets** (`regions-and-languages`, updated 2026-07-06): BR, FR, DE, ID, IE, IT, JP, MY, MX, PH, SG, ES, TH, GB, US,
  VN. **Morocco is not a TikTok Shop market.** Mainland China sellers take part through "Global Selling".
- **Time:** registration "several business days"; app review "5–10 business days"; the data security and privacy
  review "about 2 weeks"; the scope's own approval "is not fixed". **Cost:** NOT CONFIRMED.
- **Without the API:** US sellers can route buyer messages to e-mail (Zendesk or Gorgias "email-to-case"). Nomi
  already answers e-mail, so this is a path to look at for US shops (NOT CONFIRMED outside the US Seller Center).

### C · Comments (Business API docs `1737944384433218`, `1776065099288577`)
- The "TikTok Accounts" permission. "Starting March 20, 2026 … developers must complete the Accounts API Access
  Application Form." "Moderating comments" is a permitted use; TikTok "reserves the right to revoke … access at any
  time". Regions and cost: NOT CONFIRMED.

## 3 · How it plugs in (as Telegram did in S7)

The channel shape is the one Telegram and Instagram already use. For surface A, each part:

| Part | What TikTok gives (A) | What Nomi adds |
|---|---|---|
| **Connecting** | OAuth for the business account; access token 1 day, refresh token 1 year; revoke `/tt_user/oauth2/revoke/` | A `tiktok` channel (the five channel CHECKs, one migration); the grant sealed with `CREDENTIAL_KEY` (rekey's `SEALED` list); owner-only (`messaging_activation`); KS6's first-connection approval and the billing card gate, as the Page connect asks them |
| **Inbound** | Webhook `DIRECT_MESSAGE` (`im_receive_msg`; `im_receive_msg_eu` for EEA users), signed `Tiktok-Signature: t=…,s=…` = HMAC-SHA256 of `timestamp.body` with the app secret, plus a timestamp age check | Refuse an unsigned or stale request before reading it (as Meta's and Telegram's); one inbound job per message, grouped by workspace (FAIR) |
| **Outbound** | `/business/message/send/` — text up to 6,000 characters, image, post card | An adapter in `src/channels/tiktok/`; the one send gate |
| **The window** | "You are prohibited from initiating a conversation." Up to **10 messages in the 48 hours after the user's first message**; after each user reply, unlimited for 48 hours; after 48 hours of silence, at most **three** more | `CHANNEL_REGISTRY.tiktok`: `coldInitiate: 'never'`, `replyWindowHours: 48`. **New:** the send gate counts messages per window (the 10 and the 3), which no channel needs today |
| **Media** | `/media/download/` exists | As Telegram first: named and handed to a person, never opened; reading them later is its own item |

**Each guard, answering the owner's question:**

| Guard | On A (Business Messaging) | On B (Shop chat) |
|---|---|---|
| **Strict mode** | **Works.** It decides the text before any channel sees it, per language; A sends text. | Works the same, once B is reachable. |
| **Hand-over** | **Works.** `im_send_msg` reports every message the account sent, with `message_tag.source` = `APP` / `WEB` / `API` / `OTHERS`. A message from `APP` or `WEB` is the owner typing in TikTok, so the assistant stops (CH3's rule). Assigning a conversation to a person through the API: NOT CONFIRMED, and not needed (Nomi holds who answers). | Likely works. The new-message event carries `sender.role` (BUYER / SHOP / CUSTOMER_SERVICE / SYSTEM / ROBOT); Nomi would tell its own replies by the ids it recorded, as CH3 does. Whether the event carries that id: NOT CONFIRMED. |
| **Buyer erasure** | **Nomi's side works** (`erase_customer` takes the identities, messages and conversations as for any channel). **TikTok's side cannot be promised:** no API to delete messages at TikTok was found, so `/data-deletion` must say what it says for Instagram, that Nomi deletes its own copy. TikTok requires the developer to delete personal data "upon request" and when the user withdraws authorisation (`1832184206708737`), which `erase_customer` and erase-workspace already do. A deauthorisation webhook for A: NOT CONFIRMED, so a revoked grant is noticed when a call is refused (as Meta's). | The same; B's partner review also asks for "deletion logs" (`erasure_ledger` is one). |
| **Roles** | **Works.** One grant per business account; connecting is the owner's (`messaging_activation`), and staff answer inside Nomi. | **A limit:** "The owner account is the only one supported in the Customer Service API". That fits, since connecting is the owner's anyway. |
| **The AI disclosure** (rule 3) | No TikTok rule on automated replies was found. Nomi's own rule applies anyway: the first message nobody approved carries it. | The same. |
| **Stop, silence, the allowance, billing** | Channel-blind already (`assistantHold`, the send gate). | The same. |

**None of the four guards fails on A.** The one thing TikTok makes new is the per-window message count.

## 4 · Everything that needs the owner

1. **Accounts:** a TikTok for Business developer account and app (Nomi's), and a TikTok Business account with
   "Advanced Access" or verified, to test with. Claude creates none of them.
2. **Applications:**
   - the Business Messaging intake form;
   - the data security and privacy review: its questionnaire needs the deletion process, which exists (rule 15), and
     who can reach the data;
   - for US accounts, the US data security review and the USDS Addendum: an agreement, so the owner's decision and
     counsel's.
3. **The privacy page** (D18): TikTok named as a recipient in five languages before the boot allows the channel, the
   same as Telegram. The owner's words with counsel's.
4. **Money:** none found on any page read. NOT CONFIRMED that there is none. If any review or tier turns out to
   cost, decision 9's bar applies.
5. **Out (2026-10-26):** TikTok Shop chat (B) and comment replies (C). Nothing to apply for.
6. **The data security and privacy review:** when the owner reaches it, Claude drafts the answers (the deletion
   process, deletion logs, who can reach the data, where it is kept) from this page and from the code, for the owner
   to read and submit.

## 5 · The build estimate, and what blocks it

- **Blocks it:** TikTok's approval of A (the intake form, then the review: "within 10 working days" to start, then
  the review itself, about two weeks on the Shop side's figure). Nothing can be tested live before it. Testing
  against a recorded fake of TikTok's documented answers (as Xero's and Intuit's) can start before approval.
- **The build, once started:** about **5–7 working days** for A:
  - the channel and the connect: OAuth, sealed grant, owner-only, approvals, 1 day;
  - the signed webhook and inbound: 1 day;
  - the adapter, and the window with its message counts: 1–2 days;
  - the echo and hand-over: 1 day;
  - the privacy page, the registry, Channels' card, the help page: 1 day;
  - the fake, pre-pilot scenario 15 and the integration tests: 1 day.
- **Then live:** the bar of decision 9 — built, tested against TikTok's sandbox if one is offered (NOT CONFIRMED that
  one is), proven live on deploy day.
- **B (Shop chat), C (comments):** out of the plan (2026-10-26).

## 6 · What was built (0215, 2026-10-26)

Against a recorded fake of TikTok's documented answers (`tests/channels/tiktok-fake.ts`), on the owner's order (the
direct-message path only; item 1 of three).

- **The channel:** `tiktok` on all six channel lists; `CHANNEL_REGISTRY.tiktok` (never writes first, no receipts).
- **The account:** `tiktok_accounts` holds a business's account (`open_id`, username) and ONE sealed grant (both
  tokens and when each ends; `tools/rekey.mjs` knows the column). One live account per business and per account; row
  security; no delete; a practice copy is refused one. `channel_credentials` routes `open_id` → the business.
- **Connecting** (`/app/connect/tiktok/{start,callback,disconnect}`, owner only, behind the operator's stop and
  first-connection approval):
  - TikTok's own authorization URL with our state and `disable_auto_auth=1`;
  - the code exchanged;
  - all four messaging permissions required — fewer, and the grant is given straight back;
  - an account another workspace holds is refused and given back;
  - disconnecting revokes and says whether TikTok confirmed.
- **Inbound** (`/webhook/tiktok`): the app's `Tiktok-Signature` checked (five minutes' tolerance) before anything is
  read.
  - A customer's text runs the one turn; an image or a shared post is named and handed to a person.
  - The account's own sends are echoes: Nomi's own by the id recorded; the owner typing in TikTok (`APP`, `WEB`)
    takes the conversation, as CH3; TikTok's automatic messages (`OTHERS`) are dropped.
  - A message from the EEA, Switzerland or the UK carries no content: it is counted on the account (definer
    `tiktok_note_delivery`) and the TikTok screen says so. The username is learnt the same way.
- **Sending:** text through `/business/message/send/` from the business's own grant.
  - The access token is renewed first when under five minutes are left, and the renewed grant kept at once.
  - A token TikTok calls dead (40105, not confirmed from its appendix) is marked once, and nothing more goes from
    it (`channel_unavailable`).
- **TikTok's limits** (`src/core/channel/tiktokLimits.ts`): 10 after a first message; any number for 48 hours
  after each reply; three after 48 hours of silence. Counted from the conversation's own messages, the owner's
  included, and held by the send gate for everyone with its own reason, `tiktok_limit` (its words in five languages).
- **The privacy page:** `legal.privacy.who.tiktok` written in five languages and shown only where the app is
  configured. `recipients.ts` keeps TikTok `named: false` until the owner reads it.
- **The operator's step:** `tools/tiktok-webhook.mjs` (dry run unless `--yes`) sets the app's DIRECT_MESSAGE
  callback. Never run.
- **Tests:**
  - `tests/parity/tiktok.test.ts` (18);
  - `tests/integration/tiktok.test.ts` (8, production composition);
  - `tests/integration/tiktok-connect.test.ts` (8, the routes).
  - The count's guard switched off fails its test.
- **Not built:** reading images (`/media/download/`); assigning a conversation at TikTok; anything for surfaces B
  and C (out).
