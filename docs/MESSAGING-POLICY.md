# Messaging policy: what every send obeys, and the audit of 2026-10-10

Each send to a buyer on WhatsApp, Instagram, Messenger or e-mail was checked against four things:
- **the 24-hour window**;
- **opt-in and opt-out**;
- **templates**;
- **the AI disclosure**.

What failed was fixed in five PRs. The owner decided the four points marked **D1–D4**.

## The rules, as the code now holds them

**1. The 24-hour window** (`core/channel/window.ts`, `sendGate.ts`)
- **Per buyer:** the window is that buyer's own last message on that channel (`client_channels.last_inbound_at`).
- **WhatsApp:** inside the 24 hours, free text. After them, only an approved template.
- **Instagram and Messenger:** inside the 24 hours or not at all. No message tag is ever sent, and every send says `messaging_type: RESPONSE`.
- **E-mail:** has no window, and is held to its own consent and footer rules (0133).

**2. The reopening template** (WhatsApp, "we have a reply for you")
- **Only for something a person decided should go:**
  - the owner's own words;
  - a draft the owner sent (`outbound_messages.approved`, 0136).
- **Only within 7 days** of the buyer's last message (D4, `reopenAllowed`).
- **Never for:** a reply the assistant sent alone, a follow-up, a first message, a picture, or a notice.

**3. Opt-out** (0135, `core/safety/optOut.ts`, `db/optOuts.ts`)
- **What counts as a stop:** "Stop messaging me", STOP, 别再发了, «لا تراسلني», «ماتبقاش تصيفط ليا» and the other forms in `tests/parity/opt-out-corpus.ts`. They are read before any model and recorded per buyer and per channel.
- **What happens next:**
  - the conversation goes to a person;
  - the buyer gets one fixed line (D1), then nothing until they write again — the owner's own reply included.
- **After they write again (D2):** replies inside their 24 hours may go. Nothing is ever sent first: no follow-up, no outreach, no reopening template.
- **Lifting it:** only the owner, on the buyer's page, because the buyer asked to hear from the business again.
- **Not a stop:**
  - a request for a person is the hand-off, never an opt-out;
  - anything that mixes or blurs the two goes to a person, with nothing recorded.
- **Opt-in:** a buyer who writes first may be answered. Nothing is sent first on WhatsApp, Instagram or Messenger. Outreach is e-mail only, under its own consent gate.

**4. The AI disclosure** (`core/conversation/disclosure.ts`, `core/safety/identity.ts`)
- **When it is sent:** the first message sent alone in a conversation carries it, counted by delivery (0079). It is sent again whenever the buyer asks what is answering them.
- **Per language:** a reply goes alone only in a language whose sentence a native reader signed off — the customer's language and the reply's own (G8).
  - Signed off: en, zh.
  - Not signed off: ar (D3), es, fr, pt.
- **Counting as an answer:** an answer to "are you a bot?" must be the assistant speaking of itself (G4). This holds whoever writes the reply (G4b).

**5. Notices** (`outbound_messages.notice`, `drafts.notice`)
- Two fixed sentences may reach a buyer the assistant no longer speaks to:
  - **the line that answers a stop:** whoever holds the conversation, and through a pause;
  - **"someone from our team will reply":** only while the buyer waits for a person.
- Stop, the ops switch, a closed window and a template still bind both.

## The audit's findings

**Fixed, by risk** (the owner's order):

| # | Finding | Fixed in |
|---|---|---|
| 2 | No opt-out in chat: a STOP ran an ordinary turn, and in auto the assistant answered it | #270 (0135) |
| 1 | "Someone from our team will reply" never reached the buyer: the hand-off gave the conversation to a person in the same turn, and the gate cancelled the sentence as `handed_off` | #271 |
| 5 | "Are you a bot?" passed with a product word ("machine-washable", «غسيل آلي»), and was not checked at all on taught answers, the order line or fixed replies | #272 |
| 3 | The reopening template could carry a reply nobody approved | template PR (0136) |
| 4 | 改 with the draft's own words sent a reply the disclosure replaced | template PR |
| — | Instagram/Messenger without `messaging_type`; the reply's own language not gated; the disclosure-instead past "draft only"; an identity failure that a later attempt corrected still held the turn | small-fixes PR |

**Left as they are, on purpose:**
- **The owner's alerts on WhatsApp outside the owner's own 24 hours** fail at Meta. E-mail and push still go, so no rule is broken.
- **Owner alerts and follow-ups** do not run in the deployment's own mode. Unchanged.

## Decisions

**The owner, 2026-10-10:**
- **D1:** one fixed line after a stop, then silence ("silence after STOP reads as broken").
- **D2:** writing again lifts the reply block, not the do-not-contact.
- **D3:** `ar: false`. The Arabic sentence sent is not the one signed off; the owner will read it and sign it again.
- **D4:** the reopening template only within 7 days of the buyer's last message.
- **Lifting a stop:** the owner, on the buyer's page.
- **Sending during a stop:** a stop binds everyone, the owner included.

**Claude's calls, reported:**
- **Deletion and stop in the same words** ("remove me from your list"): the deletion rule wins on what is said (nothing, rule 18), and the stop is still recorded.
- **The line obeys the send-alone rules.** It goes alone where a reply would; otherwise it is a draft the owner sends with one tap.
  - In a draft-only workspace, or a language not signed off (Arabic now), the buyer hears the line only when the owner sends it.
- **A bare "cancel", 取消, «إلغاء», "annuler", «خلاص», "safi":** go to a person, never recorded as a stop.
