# The isolation sweep: what is scoped wider than it should be (2026-10-15)

Written for the owner, answering "Before the pilot, sweep for the rest". It is a report only: nothing was changed.

## Next: yours

**Decide which of the twelve below get fixed before the pilot.** The "Pilot week" column says when each one can actually happen in the next week.

## Your two direct questions

**#354: was the mail scope only the test's view, or is the mailer global in production?** Both, in different senses.

- **In production there is one mailer for the whole installation.**
  - Every workspace's sign-in codes, owner alerts and morning summaries leave from one address, through Westlake's connected Gmail.
  - `SYSTEM_SMTP_*` is the only mail configuration set in production; there is no dedicated sender.
  - So the test's catch-all outbox was a faithful picture of production: one path for everyone.
- **What is per workspace is the address on each letter.** Each alert is addressed to its own workspace's owner (or colleagues who opted in). I found no path where workspace A's letter reaches workspace B's owner.
- **#354 changed only what the test checks; production is unchanged.**
- The single shared mailer is behind findings 2, 3 and 6.

**#351: is the buyer's e-mail required to prepare an order?** Required.

- **Not new in #351.** The order gate has required an e-mail for every order since the port from the old system (`src/core/commerce/confirmable.ts:78`, "Rule 7"). The turn's own path asks the buyer for one before proposing.
- **Nothing sends to that address today.** The confirmation goes to the buyer in the chat; the address is only stored on the order and printed on the proforma.
- **The database doesn't need it:** `orders.client_email` is nullable.
- **The consequence:** a WhatsApp or Instagram buyer who never gives an e-mail cannot have an order recorded, by either path.

## Wrongly global (12, each checked in the code)

| # | What | Where | What happens | Pilot week |
|---|---|---|---|---|
| 1 | **An inbound e-mail is recognised by its Message-ID alone, across all workspaces** | `message_fragments.id` and `turns.message_id` are primary keys on the external id (0009, 0006); `recordFragment` does `on conflict (id) do nothing` (`src/db/fragments.ts:35`) | The sender's Message-ID is the same for every recipient. When one e-mail reaches two workspaces, the second records the message on its timeline but never answers it and never hands it to a person. It is a silent loss. Its drafts can also point at the other workspace's turn record. | Only if one e-mail reaches both workspaces (a buyer writes to both, or one mailbox is connected to both, see 12) |
| 2 | **All installation mail rides one workspace's mailbox** | System mail goes out through `PILOT_BUSINESS_ID`'s live Gmail row (`src/main.ts:675`, `1187`) | Every workspace's sign-in codes, alerts and summaries depend on Westlake's mailbox staying connected and healthy. If that mailbox is disconnected, codes stop for everyone: the SMTP fallback is blocked on Railway. Two refused sends can also mark Westlake's own mailbox dead. Westlake's outreach shares that one Gmail account's daily quota. | **Yes**: the boss's sign-in codes and alerts go this way |
| 3 | **A reply to a Nomi e-mail can land in Westlake's inbox as a buyer** | The inbox reader skips only automatic mail and mail *from* the system addresses (`src/channels/email/inboxReader.ts:145`); Westlake's mailbox reads its inbox (checked read-only) | If someone replies to an alert or a morning summary, the reply goes to the system's From address. If that address delivers into Westlake's Gmail, the reply is recorded as a Westlake buyer's message, and Westlake's assistant may answer it. **Likely, not proven:** where the From address delivers is a Google setting I can't see. You can check by replying to one Nomi e-mail and seeing whether it appears under Westlake's Buyers. | **Yes**, if the boss replies to a Nomi e-mail |
| 4 | **Order numbers come from one installation counter, with the old "YW-" prefix** | `generate_order_reference()` = `'YW-' + YYYY-MM + nextval('order_seq')` (baseline schema); it overrides the per-business proforma number (`src/api/web/orders.ts:246`) | Every workspace's orders read "YW-2026-10-0042". Each workspace's numbers have gaps, and the number tells a buyer roughly how many orders the whole installation has made. As a fact, not advice: some tax regimes want an issuer's invoice numbers sequential; this is a proforma. | **Yes**: every order the boss confirms |
| 5 | **Instagram and Messenger fall back to the installation's Page** | `if (!account) return metaMessaging;` (`src/main.ts:1208`); `META_PAGE_ID` and `META_PAGE_ACCESS_TOKEN` are set in production | A workspace with no Page connected of its own sends its Instagram and Messenger replies with the installation Page's token. WhatsApp got exactly this guard on 2026-10-14; Meta channels didn't. Meta would probably refuse such a send, since a buyer's id belongs to one Page, but the code tries. | Only if a workspace has Instagram or Messenger buyers and no live Page (for example, after disconnecting) |
| 6 | **Mail caps are shared by every workspace** | 1,000 codes and 3,000 alerts a day for the whole installation (`src/db/mailCaps.ts:15`, 0112) | The cap itself suits one shared sender. But it has no per-workspace share: a burst of sign-up spam, or one workspace's alert storm, uses it up. Then every workspace's codes or alerts are refused for the rest of the day, deletion-request alerts included. Operator alerts aren't capped. | Only under a flood |
| 7 | **Three stuck mailboxes can stop everyone's inbox reading** | 3 inbox reads a minute for the whole installation (`src/main.ts:1001`); the list is ordered by last read (0063) | A mailbox that can never finish a read never moves forward: a billing-held workspace, one without the reading permission, or one Google won't answer. Three of them keep the head of the line and take every read, every minute. | No: there is 1 live mailbox today |
| 8 | **Outbound sends and alerts are first-come across all workspaces** | `boss.work` for outbound and notify have no per-workspace group (`src/main.ts:1312`, `1441`); inbound got one in FAIR because of exactly this | One workspace's burst (the follow-up sweep can queue up to 100 sends a minute) delays every other workspace's replies and hand-off alerts. | Low at pilot volume |
| 9 | **A capability is withdrawn for every language, and on a self-signed-up workspace, the earned rung too** | `autonomy_policy` is keyed (workspace, capability), with no language; `clearRungFor` (`src/db/ramp.ts:132`) | #352 narrowed *what* counts (only a reply that really failed). It didn't narrow *where* the withdrawal applies: one Arabic reply that can't be written without a gender drops that capability to "waits" for English and Chinese buyers too. On a workspace that signed itself up, it also clears the earned rung, so everything waits. | Westlake answers Arabic today, so yes there; the boss's workspace holds Arabic, and an operator-made workspace keeps its rung |
| 10 | **The owner's advisor is never metered** | `answerFollowUp` (`src/advisor/answer.ts`) makes up to 2 model calls a question. No allowance check and no spend record. | One workspace's staff can spend without limit. It isn't counted against their workspace, and the installation's spend breaker can't see it. Every other paid call is metered. | Yes, if the boss's people use the advisor |
| 11 | **A number or Page stays taken after it's disconnected** | `channel_credentials` is unique on (channel, external_ref) including switched-off rows (0005); disconnecting only switches the row off | A WhatsApp number or Page that one workspace dropped can never be connected by another: it gets "number taken". The account tables free the id on archive; this table never does. `tools/attach-number.mjs` treats it as intended. | Only if the spare SIM's number ever has to move between workspaces |
| 12 | **A mailbox can be connected to two workspaces at once** | `mail_accounts` is unique per workspace but not by address (0050) | Two workspaces can read and send from the same Gmail. Both read the same mail, which is exactly what triggers 1. Numbers and Pages are unique among live rows; mailboxes are the odd one out. | Only if someone connects the same mailbox twice |

**Smaller, same shape (low):**

- **The Meta error-rate alert is keyed by kind in 6-hour windows.** A second workspace crossing the line in the same window is reported up to 6 hours late.
- **The follow-up sweep walks workspaces in no fixed order, with a 40-second budget and no rotation.** A busy workspace early in that order can starve later ones.
- **Error recording runs at most 4 at a time, installation-wide.** One workspace's error flood crowds others' errors out of the operator's record.
- **The provider check's cost is charged to the pilot workspace.**
- **The WhatsApp template list is installation-wide.** It only changes which refusal reason is shown.
- **A practice copy takes a snapshot of its workspace's operator flags when it is made.**
- **The send ceiling counts e-mail replies too**, though its stated reason is Meta's shared app.
- **Not cross-workspace, but false:** the comments on most job "dedupe keys" (hand-offs, inbound, outbound). pg-boss enforces those keys only with a time window, which these don't set. What actually prevents duplicates is the database claims, the per-conversation lock and inbound's per-workspace group.

## Correctly global (one line each)

- **Inbound routing.** WhatsApp number, Page and Instagram id each name one workspace. An unknown one is dropped; there's no fallback to the pilot workspace.
- **WhatsApp numbers and Pages** are unique among live connections.
- **Provider ids** that belong to one sender are unique everywhere: WhatsApp and Meta message ids, the Message-IDs Nomi mints, and Stripe ids.
- **Random tokens** (proforma, proof, product photo, login setup) are 32 random bytes. Unsubscribe links are signed and name their workspace.
- **Owner login by e-mail** is one per address, by design (rule 22). The cost: one address can't sign in to two workspaces.
- **Staff codes** name their own workspace. `OWNER_ACCESS_CODE` opens only the pilot workspace.
- **Pre-sign-in limits:** door throttles by caller address, and the sign-up guard by caller and company domain.
- **Installation-wide by nature:** the error log, provider health, the kill switches (unset means everyone, set means one workspace) and the spend breaker (installation bill; pilots never held).
- **The jobs scheduled with the pilot's id** sweep every workspace and alert the operator. "The operator" is the pilot workspace's owner.

## Correctly per workspace (one line each)

- **Buyers:** addresses (since 0155), contacts, STOP and opt-outs, suppressions, consent, the allowlist and deletion requests. A STOP to workspace A doesn't touch B.
- **Caches:** workspace facts (per workspace, 60 s), sign-in liveness and mail tokens (per mailbox). The rest are static.
- **Limits:** the daily model allowance, photo reads, the send ceiling, Practice, "first five in a language", "first quote of a product", plan limits and the export throttle.
- **Locks** are per conversation.
- **Files:** nothing a workspace uploads goes to disk. Photos, faces and imports are stored in the database with their workspace and row security. Writes check the product belongs to the workspace.
- **Row security** is on for all 99 tables that carry a workspace (0 without).

## How this was done

- **Five read-only sweeps**, run in parallel:
  - the database's unique keys;
  - buyer identity and routing;
  - caches, limits and budgets;
  - queues, locks and jobs;
  - mail, files and numbering.
- **Every "wrongly global" above was checked in the code by me**, at the lines given.
- **Production was read only for facts:** mail variable names, one live mailbox reading its inbox, no orders yet, and one live Page.
- **No fixes were made.**
