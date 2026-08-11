# Nomi — feature roadmap

Fourteen features in three phases. Written to be handed to Claude Code one
milestone at a time. Milestone numbers start after the redesign (M30–M33), so
these are **M34 onward**.

Everything here was checked against the code. Where a claim is about the outside
world — Meta's messaging rules — it was verified, and the sources are at the end.

---

## 0. The rule every milestone is measured against

The moat is **refusal**: she says "I have not been told that" instead of
guessing. Every invariant in this repo protects that.

> Does this give her something more she can be **certain** about, or does it ask
> her to **claim** more?

Reach features are legitimate — but they must be built so that reach never
borrows against certainty. The mechanism for that is already in the repo and it
generalises perfectly, which is the central architectural idea of this roadmap:

**`claims_policy` says what may be claimed, and every claim carries provenance.
`contact_consent` will say who may be contacted, and every contact carries
provenance.** Same shape, same fail-closed posture, new axis.

---

## 1. Architecture that must hold across every milestone below

These are not suggestions. Breaking one is a defect.

**One send path, still.** Outreach does NOT get its own sender. Cold email, a
WhatsApp template, an Instagram reply — every one goes through
`enqueueOutboundRow` and `gateOutbound`. If outreach grows a second path, the
product loses the only thing that makes it trustworthy. The gate learns new
refusal reasons; it does not gain a bypass.

**Channels declare their own capability.** The repo already does this twice —
`sendMedia` is optional on the adapter (M26), and `templateState` is derived
from the installation (M25). Extend it: each channel declares whether it can
carry `cold`, `warm_only`, or `template_only` traffic. Nothing asks a channel to
do what it has said it cannot.

**Consent has provenance or it does not exist.** Every contactable identity
carries how consent was obtained, when, and the evidence. No row, no contact —
absence is the only honest representation of "not asked yet", exactly as
`pricing_policy` now works after M29.

**Suppression is permanent and archive-only.** Unsubscribes, bounces and
complaints are never deleted and never overridden. The application role holds no
`DELETE`; this is no exception.

**Owner-activated per channel.** Connected ≠ activated ≠ *allowed to initiate*.
That is a third state, and it is the owner's decision, made once per channel,
recorded, reversible in one tap — the M20 pattern applied to outreach.

---

## PHASE 1 · CERTAINTY
*Four features that make her more sure. Build these first: they are what the
outbound engine will be selling.*

### M34 — She can hear ★ highest-value gap

**The finding.** `src/channels/whatsapp/parse.ts:90` already recognises
`'audio' | 'voice'` and captures the `mediaId`. Grep the pipeline, ingress and
`src/llm/` — audio appears nowhere downstream. A buyer's voice note arrives as
empty text and she answers as though they said nothing.

In Gulf and Chinese B2B WhatsApp, voice notes are frequently the *primary*
medium. She is deaf on the channel she lives on, and the hard half is written.

**Build.** Fetch the media, transcribe, feed the transcript into the same turn
pipeline as text. Record the transcript alongside the message so the owner can
read what the buyer said, and so a mistranscription is auditable rather than
invisible.

**The rule this adds — the M26 shape.** An untranscribable voice note is
**refused, never treated as silence**. New refusal reason `audio_unheard`, with
what / why / what-to-do in all three locales, flowing through the M22 surfaces
unchanged. A buyer whose question was never heard must not receive a confident
answer to a question she invented.

**Also:** show the owner the transcript beside the audio, and let her correct it
— a correction supersedes, like every other correction in this product.

---

### M35 — The proof link ★ the differentiator

Every quote she sends carries a link. The buyer opens it and sees the price, the
tier, the MOQ, the lead time — **and where each fact came from**: the owner's
catalogue, her stated price rules, a certification she explicitly authorised.

No competitor can ship this, because no competitor tracks provenance. This repo
already does, and it is currently visible only to the owner. This turns the
invariant that makes Nomi *safe* into the artifact that makes the factory look
*serious* — something a buyer forwards to their boss.

**Mostly rendering over data that exists.** `product_knowledge`, `claims_policy`,
`pricing_policy`, `price_tiers`, `quotes`.

**Constraints.** Public URL, unguessable token, no login, no tenant data beyond
that one quote — and it must pass the same review as `/health`: it leaks nothing
about the installation. Expires or is revocable by the owner. Three locales,
RTL, and the buyer's locale is chosen from the conversation, not the owner's.

**No invented numbers, on a buyer-facing surface for the first time.** Every
figure is a real count or a real price from a real row. This is where that rule
earns its keep.

---

### M36 — The consistency guard

She refuses to quote a returning buyer a price that contradicts what she already
gave them, without telling the owner first. Quoting $0.38 in March and $0.44 in
May destroys a relationship; a human salesperson remembers.

`quotes` exists. `isReturning` exists (`cards.ts:38`). The guard does not.

**Build it as `below_floor`'s sibling** — same mechanic in `quote.ts`, same
fail-closed posture, new axis: history rather than policy. The owner is asked,
with both numbers and both dates in front of her. She may approve the new price;
she may not be surprised by it.

---

### M37 — Photograph the price list

The owner points her phone at her printed price sheet and the catalogue is
built. Both halves exist and nothing joins them: M4 vision for image analysis,
`core/onboard/catalogImport.ts` for parsing product lines.

This collapses the largest friction in the whole product — stage 2 of
`FIRST-FACTORY-WORKFLOW.md` is "a few hours over a few days" and the catalogue
is most of it.

**Staged → diffed → confirmed, exactly like the paste flow.** Nothing is
learned that she did not confirm, and after M29 nothing arrives sellable: a
product still needs her price rules before 小雅 may quote it.

---

## PHASE 2 · REACH
*The outbound engine. Built on Phase 1, and gated so it can never spend the
trust Phase 1 creates.*

### M38 — Contacts, consent, and suppression

The foundation for everything after it. No outreach until this exists.

**Schema.**
- `contacts` — identity per channel (email, phone, IG handle), the company,
  where the record came from (`apollo`, `csv`, `inbound`, `manual`), and when.
- `contact_consent` — how consent was obtained, when, and the evidence
  (`replied_to_email`, `inbound_message`, `form_submission`,
  `owner_attestation`). **No row means no consent.** Absence is the only honest
  representation, per M29.
- `suppressions` — unsubscribed, bounced, complained. Permanent, archive-only,
  and checked before every send regardless of channel.
- `outreach_log` — every attempt, its channel, its outcome. The audit trail is
  what keeps a WABA alive when Meta asks.

**Surfaces.** The owner sees her contact list, where each came from, who may be
contacted and why, and who never may be again. Owner language throughout — no
"lead", no "prospect", no score. A score is an invented number.

---

### M39 — The channel capability registry

Each channel declares what it can carry. This is the M25/M26 pattern generalised,
and it is what stops the product promising something an API cannot do.

| Channel | Cold-initiate | Reality |
|---|---|---|
| **Email** | ✅ yes | The only true cold channel. |
| **WhatsApp** | ⚠️ template + opt-in | Approved template AND recorded opt-in. Business Verification and a published privacy-policy URL are required before any template sends at all (Meta, Jan 2026). |
| **Instagram DM** | ❌ impossible | The API can only reply within 24h of a user-initiated message. Message tags are non-promotional only; one-time notifications do not exist for Instagram. |
| **Messenger** | ❌ impossible | Same 24-hour window. Human-agent tag extends replies to 7 days, still not cold. |
| **WeChat** | later | See M47. |

**This is not a policy preference, it is what the APIs permit.** Any tool that
appears to cold-DM on Instagram is automating the consumer app, and the accounts
get banned. Build the registry so the product tells the owner the truth about
each channel on the connection screen, rather than letting her discover it after
her account is gone.

**What Instagram and Facebook CAN do, and it is genuinely valuable:**
comment-to-DM and click-to-WhatsApp ads. The buyer initiates — a comment, an ad
tap — and 小雅 engages inside the window. That is inbound-triggered, which is
precisely what this product is already built for. Ship that as the IG/FB story
instead of a cold DM that cannot exist.

---

### M40 — Email as the cold channel

The real outbound engine. Owner connects her own sending domain — she provides
the credentials, as you want, and it is her domain's reputation, not ours.

**Build.** SPF/DKIM/DMARC verification before the first send (refuse if
unverified — a misconfigured domain burns her reputation permanently), sequences
with kill-conditions in code rather than judgement, one-click unsubscribe writing
straight to `suppressions`, bounce and complaint handling.

**Draft-first applies here too.** She proposes the sequence; the owner approves
it. Autonomy is granted per capability and revocable in one tap, exactly as it
works for replies today.

**The reply is the opt-in.** When a contact answers an email, that writes a
`contact_consent` row with evidence — and *that* is what legitimately opens
WhatsApp for them later. This is the mechanism that makes the whole thing safe,
and it costs nothing because the reply had to happen anyway.

---

### M41 — Apollo, and the connector shape

Apollo is one source behind a generic interface, not a special case — so a
second source (Lusha, Clay, a CSV, her own trade-show list) costs a file rather
than a rewrite.

**Three jobs, in this order:**

1. **Enrichment on inbound — build first, zero risk.** A buyer messages; the
   owner learns they are a real importer, 60 staff, Dubai. That changes which of
   eleven waiting conversations she opens first. Information, not outreach.
   **Hard rule: enrichment is shown to the OWNER only. 小雅 may never use it in a
   message.** She cannot say "I see you import homeware" to someone who never
   told her. Enrichment directs attention; it never becomes a claim. Assert this
   at source level, the way M26 asserted that `gateOutbound` never learned what
   an image is.
2. **Target lists.** Apollo search filtered to her categories and markets,
   presented as a list she decides about — never a queue that sends itself.
   Draft-first, applied to prospecting.
3. **Sequence enrolment**, into M40's email engine only.

Owner supplies her own Apollo API key, stored with `encryptSecret` like every
other credential.

---

### M42 — The outreach gate

Where reach meets the invariant. Cold outreach goes through `gateOutbound`, and
the gate learns four refusals:

| Refusal | Meaning |
|---|---|
| `outreach_not_enabled` | The owner has not turned on initiating for this channel. |
| `no_consent` | No `contact_consent` row. Fail closed — absence is "no". |
| `suppressed` | Unsubscribed, bounced or complained. Permanent. |
| `outreach_ceiling` | Daily cap for this channel, separate from the reply ceiling. |

Each with what / why / what-to-do in three locales, flowing through the M22
refusal surfaces unchanged.

**Enabling outreach is its own decision**, separate from activation, made per
channel, recorded, reversible in one tap. On the WhatsApp channel the screen
states plainly what she is accepting: that cold messages without recorded opt-in
risk permanent loss of the number. Said once, honestly, on the screen where the
decision is made — not buried in terms.

---

## PHASE 3 · DEPTH
*Real gaps. Each becomes urgent the moment the pilot succeeds.*

### M43 — Multi-currency
`unitPriceUsd`, `floorPriceUsd`, `orderValueUsd` — USD is baked into type names
throughout `core/commerce`. A schema and type change, so it gets more expensive
every month. **Do it the product's way: the owner states the rate she will
honour, or Nomi refuses to convert.** Never a live rate she did not approve —
that is a number from outside her rules.

### M44 — The factory closure calendar
Nothing knows about Chinese New Year. Every lead time quoted in January is a lie
stated with confidence. Ramadan matters symmetrically for Gulf buyers.
**A refusal feature: she declines to promise a date the factory cannot hit, and
says why.** Seasonal — worthless in June, essential in December.

### M45 — Samples
"Can you send a sample?" is the second question in nearly every Yiwu
conversation. Sample cost, whether it is credited against the first order,
courier account, address collection. She meets this on day one of the pilot.

### M46 — After the order
`confirmable.ts` and `invoice.ts` exist; the trail stops at confirmation. Three
weeks later "where is my order?" is unanswerable. Production state, shipment,
tracking. For a Yiwu supplier this is the half that produces repeat business.

### M47 — More than one human
The access code is a single owner. Real factories have a boss and two or three
sales staff. `ownershipOf(assigned_to)` handles "a human holds this" but not
*which* human, so takeover cannot be routed. First thing that breaks on success.

### M48 — WeChat
For Yiwu, arguably the bigger channel. `src/channels/contract.ts` is already
abstract. Strategically it is also the answer to WABA risk: one channel is a
single point of failure for a business built on messaging.

---

## 2. Order, and why

| # | Milestone | Why here |
|---|---|---|
| 1 | **M34 voice** | She is deaf on her own channel; half is built. |
| 2 | **M35 proof link** | Turns the moat into something a buyer can see. Mostly rendering. |
| 3 | **M37 photograph catalogue** | Removes the biggest barrier for every future customer. |
| 4 | **M36 consistency guard** | Cheap; prevents the failure that loses a repeat buyer. |
| 5 | **M38 contacts & consent** | Foundation. Nothing in Phase 2 is safe without it. |
| 6 | **M39 capability registry** | Tells the owner the truth per channel before she connects. |
| 7 | **M40 email** | The real cold engine, and the mechanism that earns WhatsApp consent. |
| 8 | **M41 Apollo** | Enrichment first (zero risk), then lists, then sequences. |
| 9 | **M42 outreach gate** | Ships with, not after, the first outbound send. |
| 10 | **M43 currency** | Calcifies further every month. |
| 11 | **M44 closure calendar** | Ship before December. |
| 12–14 | **M45–M48** | Urgent the moment the pilot succeeds, not before. |

**M34 and M35 before any outbound work.** The outbound engine sells certainty;
build the certainty first, or you are scaling a promise you have not yet kept.

---

## 3. Standing instructions for every milestone

- One send path. One approval path. One ownership model. One knowledge source.
- No invented numbers — no scores, no ratings, no lead scores, no
  percentages-as-performance. Every figure a real count.
- Archive, never erase. The application role holds no `DELETE`.
- Fail closed. An unresolved input is "no".
- Draft-first. Turning a capability on does not grant permission to send.
- Owner language only — check `tests/parity/owner-language.test.ts` before
  writing a string.
- Three locales, RTL, every surface.
- Migrations additive and forward-only; bump `REQUIRED_SCHEMA_VERSION` when the
  build *requires* the migration, not only when it reads a new column.
- Tests assert structure and provenance, never literal markup or transcribed
  values. That failure has cost this repo six times.

**Sources:**
[WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/) ·
[Messenger Platform and IG Messaging API policy](https://developers.facebook.com/documentation/business-messaging/messenger-platform/policy) ·
[Instagram Messaging API 24-Hour Window Policy (2026)](https://www.keyapi.ai/blog/instagram-messaging-api-policy/) ·
[WhatsApp Business API Opt-In Rules (2026)](https://wetarseel.ai/whatsapp-business-api-opt-in-rules/) ·
[WhatsApp Business API Compliance Guide (2026)](https://www.allyncai.com/blog/whatsapp-business-api-compliance-guide)
