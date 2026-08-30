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

> **Status, 2026-08-18.** Blocks A, B and D are BUILT and deployed — fourteen
> milestones, M34 through M49, plus the structural checks the work kept
> needing: module and symbol reachability, CSS that must parse, a
> populated-tenant surface walk, a CI gate that fails on a skipped integration
> suite, and an integration runner that keeps its evidence when it fails.
>
> What remains is **M51** (everything that was held rather than decided), then
> **Block C built offline**, then **M52** — the accounts and keys only the
> owner can create, deliberately last, so that reviewers see a finished product
> and the build never waits on a credential.
>
> **One milestone at a time, and every migration is reviewed before it goes
> near a push** — the Railway pre-deploy command applies migrations
> automatically, so an unfinished migration is a production change rather than
> a local mistake.

### M34 — She can hear ✅ BUILT (2026-08-11)

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

### M35 — The proof link ✅ BUILT (2026-08-12)

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

### M37.5 — The words she may never say ✅ BUILT (2026-08-13)

The owner flags terms 小雅 must never use with a buyer, from her own settings.
This is `claims_policy` for LANGUAGE: she already controls what may be CLAIMED,
and this adds what may be SAID — same shape, same default-deny posture, same
"absence is a refusal, not a default" rule.

A FLOOR SHE CAN EXTEND BUT NEVER REMOVE: never curse, never disrespect a buyer.
The owner adds to that floor; she cannot delete it. A tenant that could switch
off "do not insult the customer" is a tenant that will, by accident, on the day
someone pastes a competitor's phrasing into the catalogue.

**NOT `BANNED_OWNER_TERMS`, and whoever builds this will conflate the two.**
`BANNED_OWNER_TERMS` (core/owner/vocabulary.ts) governs what the PRODUCT shows
the OWNER — no "model", no "confidence", no "系统". It is about our register when
we speak to her. This governs what SHE says to a BUYER, in the buyer's language,
and the two lists share neither contents nor purpose. They will want to be one
function; they must not be.

Enforcement belongs beside `guardClaims` in the reply path, not in the prompt: a
prompt is a request and a guard is a refusal, and this repo has been paying for
that distinction all year.

### M36 — The consistency guard ✅ BUILT (2026-08-12)

She refuses to quote a returning buyer a price that contradicts what she already
gave them, without telling the owner first. Quoting $0.38 in March and $0.44 in
May destroys a relationship; a human salesperson remembers.

`quotes` exists. `isReturning` exists (`cards.ts:38`). The guard does not.

**Build it as `below_floor`'s sibling** — same mechanic in `quote.ts`, same
fail-closed posture, new axis: history rather than policy. The owner is asked,
with both numbers and both dates in front of her. She may approve the new price;
she may not be surprised by it.

---

### M37 — Photograph the price list ✅ BUILT (2026-08-13)

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
| **WeChat** | later | See M48. |

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

### M43a — Money becomes a pair ✅ BUILT (2026-08-13)

`{ amount, currency }` replacing bare numbers; additive columns; types renamed
off `Usd`. **USD stays the only currency** — this milestone changes no
behaviour. Mechanical and compiler-guided: rename the type, follow the errors.

**Measured, 2026-08-12:** 30 files touch a `*Usd` identifier — `unitPriceUsd`
(32 uses), `totalUsd` (16), `floorUsd` (11), `floorPriceUsd` (9) — while only
THREE schema columns do: `unit_price_usd`, `total_usd`, `floor_price_usd`. That
asymmetry is the whole reason this splits from M43b. The type churn is large and
safe; the product decision is small and delicate, and combining them puts a
refactor and a feature in one migration — which is how M35's LATERAL defect got
through.

**Do this BEFORE any further pricing work.** Every milestone that adds a `*Usd`
identifier makes it bigger. M36 already added three.

### M43b — The owner's rate ✅ BUILT (2026-08-13)

She states the rate she will honour, per currency, with the date she set it.
Nomi converts at that rate or refuses. **Never a live rate she did not approve** —
that is a number from outside her rules, and the whole engine exists to stop
those. Small once M43a has landed.

### M43.5 — Why did this month change  → M51.5

> Assigned, 2026-08-18. It sat unassigned for six weeks with a note saying it
> should not; it is now part of M51, which is where everything that was in
> limbo goes to be decided one way or the other.

`core/insights/questions.ts` answered exactly this and was deleted in M34.10
rather than wired: it ranked its drivers BY PERCENTAGE ("询盘多了67%",
"报价成单率升到23%"), and the product banned percentages and conversion rates
afterwards. Strip them and the ranking mechanism goes with them, so there was
nothing left to port.

The QUESTION is still worth answering — an owner who can see that orders fell
because fewer buyers wrote, not because she priced badly, makes a different
decision. **Rendered without rates:** name the driver and give the two counts
("询盘从 40 变成 25"), rank by the size of the change, and end each line in
something to tap, per the insight rule. Nothing else on this list needs it
first.

### M44 — The factory closure calendar ✅ BUILT (2026-08-13)
Nothing knows about Chinese New Year. Every lead time quoted in January is a lie
stated with confidence. Ramadan matters symmetrically for Gulf buyers.
**A refusal feature: she declines to promise a date the factory cannot hit, and
says why.** Seasonal — worthless in June, essential in December.

### M45 — Samples ✅ BUILT (2026-08-14)
"Can you send a sample?" is the second question in nearly every Yiwu
conversation. Sample cost, whether it is credited against the first order,
courier account, address collection. She meets this on day one of the pilot.

### M46 — After the order ✅ BUILT (2026-08-14)
`confirmable.ts` and `invoice.ts` exist; the trail stops at confirmation. Three
weeks later "where is my order?" is unanswerable. Production state, shipment,
tracking. For a Yiwu supplier this is the half that produces repeat business.

### M47 — More than one human ✅ BUILT (2026-08-14)
The access code is a single owner. Real factories have a boss and two or three
sales staff. `ownershipOf(assigned_to)` handles "a human holds this" but not
*which* human, so takeover cannot be routed. First thing that breaks on success.

### M48 — WeChat
For Yiwu, arguably the bigger channel. `src/channels/contract.ts` is already
abstract. Strategically it is also the answer to WABA risk: one channel is a
single point of failure for a business built on messaging.

---

### M51 — Nothing left in limbo  ← the whole of Phase 3.5

Four things have been held rather than decided, and holding is what makes a
codebase feel unfinished long after the features are done. Each has a note in
`tools/check-reachable.mjs` explaining why it was held; none of them has a
reason that still applies.

**M51.1 — debounce-and-batch.** The one with a deadline. `batching.ts` is
exempted as EXPIRES AT META GO-LIVE, and ASSUMPTIONS P1 says plainly: buyers
send four fragments in ten seconds — "hello" / "price?" / "the bags" /
"5000pcs" — each analysed alone is meaningless, **build before shadow.** 92
lines of core exist; `message_fragments` has existed since 0009 with no writer.
This bites on the first real buyer, and the pilot is the next thing that
happens.

**M51.2 — the budget gate.** `budget.ts` was meant to run BEFORE the analyzer
call, the expensive one. It never runs. Its pause rule is meanwhile
re-implemented in SQL in `db/channels.ts` — the same rule in two places, one
enforced and one merely tested. That is this repository's most expensive
recurring defect, and it is sitting in the open.

**M51.3 — the degrade ladder.** `degrade.ts` models a night-shift hold ack and
a five-minute owner alert. What runs today is: the turn throws, pg-boss retries
five times, dead-letters, alerts the owner. The modelled behaviour is better
than the running behaviour. Wire it or delete it — a module that is better than
production and not in production is a lie about what the product does.

**M51.4 — `editScope.ts`.** Held to see whether it could weigh spot-check
evidence by edit size. It classifies the SCOPE of what an edit teaches, not the
SIZE of one, and every input it needs is a signal nothing derives.

**M51.5 — why did this month change.** Formerly M43.5, unassigned. Name the
driver and give the two counts ("询盘从 40 变成 25"), rank by the size of the
change, end each line in something to tap. No percentages — that is why the
first version was deleted rather than wired.

**M51.6 — the map matches the ground.** This file said M37 was NEXT after it
shipped, carried no status on eight built milestones, and pointed WeChat at
M47. A roadmap that lies about the past cannot be trusted about the future.

---

## PHASE 4 · THE THINGS THAT MAKE IT SELLABLE

### M49 — The design pass ✅ BUILT (2026-08-13)

Diagnosed from live screenshots, not from taste. The product reads as
unpolished, and the cause is structural: **restraint without alignment reads as
unfinished, not confident.**

1. **One content measure.** Four unrelated widths currently share one page —
   rules to ~1650px, text wrapping ~1030px, inputs at 455px, `main` capped at
   1040px in a 2000px viewport. Pick ONE column; rules, cards, inputs, buttons
   and prose all align to it. Prose may be narrower *within* that column, but
   nothing gets its own arbitrary max-width.
2. **Decide where the column sits** — centred beside the nav, or left-aligned
   with an intentional right rail. Either is defensible; the accidental middle
   is not.
3. **One vertical rhythm**, from the spacing scale only. Today's section gaps
   are ~100px, ~40px, ~180px.
4. **The two-voice rule is on the wrong axis.** Serif is landing on PRODUCT
   headings — "No buyer can reach Lily yet", "Lily is learning from your
   corrections", "Before she talks to real buyers". Serif is for what a PERSON
   says: her drafts, a buyer's words. Everything else is sans. Inconsistent
   serif/sans is the loudest unpolished signal on these pages. **A test must pin
   it**, because the current rule was applied by hand and drifted immediately.
5. **Colour once or twice per screen.** My factory currently spends green on the
   nav slab, a panel, every link, the language pill and the button. Desaturate,
   and spend it only on state. The nav's active item needs weight and a
   background change, not a saturated slab.
6. **Buttons sized to their content**, not to the input above them.
7. **Empty states align like everything else** — they are centred while the page
   around them is left-aligned.

Add a LAYOUT test that catches what typography tests cannot: one measure, one
alignment, spacing drawn from the scale. Screenshots at three widths, three
locales, reviewed by eye — five defects in this project have now been caught by
a screenshot and missed by a green suite.

### M50 — The connect surface

One settings page where every account links: WhatsApp, Google/Microsoft,
Instagram, Facebook, Apollo. Each shows connected / not connected / needs
attention, **and what that channel can actually do** (M39's registry, rendered).

This is the page the whole niche rests on, so it gets designed, not assembled.
The owner is not technical and may have no IT support: she connects everything
with a few clicks. Built against dev-mode platform apps with test accounts;
paste-credentials stays as the fallback path for factory #1.

---

### M52 — The things only the owner can provide  ⛔ LAST, ALWAYS

Every account, credential and external review, in one place, so that the build
never waits on one and the owner is never asked for them piecemeal.

**Nothing in this milestone is code.** It is the list of what must exist in the
world before what is already built can reach a buyer. It is deliberately LAST:
every milestone before it is written so that an absent credential is a
first-class state — "not configured", said honestly — exactly as M34's
transcriber and M37's page reader already are. Nothing is blocked on this; it
is what turns built into live.

| # | What | Who creates it | What it unblocks |
|---|---|---|---|
| 1 | **Meta app** (one app covers WhatsApp, Instagram, Messenger) | Owner | M50's connect flow, M39's live capability probe |
| 2 | **The pilot factory's own WhatsApp Business signup** | Factory #1 | Going live at all. 1–5 days plus display-name review, and the only clock nobody here controls. **Start it first; it depends on nothing.** |
| 3 | **Google Cloud project + OAuth client** (`gmail.send`) | Owner | M40's send path on a Gmail domain |
| 4 | **Microsoft Entra app** (Graph `Mail.Send`) | Owner | M40's send path on an Outlook domain |
| 5 | **Her own sending domain, SPF/DKIM/DMARC** | Owner | M40. The domain's reputation is hers, which is the point |
| 6 | **Apollo API key** | Owner | M41's live enrichment. The connector runs against a fake without it |
| 7 | **WeChat Official Account** (verified business) | Owner | M48 |
| 8 | **Meta App Review** | Owner, after the build | Self-serve onboarding for factory #2 onward. NOT needed for the pilot |
| 9 | **Google OAuth verification** | Owner, after the build | Same: `gmail.send` is a sensitive scope |

**Creating an app is not submitting it.** Both are free and instant, and the
OAuth code is built and tested in dev mode long before review. Only the REVIEW
waits — and reviewers see a finished product, which is the whole reason this
milestone is last.

---

## 2. Order, and why

Five blocks. Platform-app **registration and review are deliberately last**:
Meta and Google review the working product, and submitting a half-built one
invites a rejection that makes resubmission harder.

Two clarifications that sharpen that sequencing rather than change it:

- **Creating a platform app is not submitting it.** Both are free and instant,
  and you need one to build against — a connect flow needs a client ID. The
  OAuth code is built and tested in dev mode during Block C. Only the REVIEW
  waits.
- **The pilot does not need review.** Factory #1 completes its own WhatsApp
  business verification and hands over credentials, which the operator pastes.
  Tech Provider review only buys self-serve onboarding for factory #2 onward.
  A real pilot can run — and teach you things — before anything is submitted.

### BLOCK A · Finish the certainty features ✅ DONE (2026-08-13)

M37 photograph · M37.5 forbidden words · M43a money becomes a pair ·
M43b the owner's rate · M44 the closure calendar.

### BLOCK B · The design pass ✅ DONE (2026-08-13)

M49. One measure, one rhythm, one voice per speaker, colour spent only on
state — with a layout test that catches what the typography tests cannot.

### BLOCK D · Depth ✅ DONE except M48 (2026-08-14)

M45 samples · M46 after the order · M47 more than one human. M48 WeChat waits
on an Official Account (M52 #7).

### BLOCK F · Nothing left in limbo  ← NEXT

**M51.** Four held decisions, one unassigned insight, and a roadmap that had
stopped matching the code. Small, and it is what stands between "the features
are built" and "the build is finished".

### BLOCK C · The outbound engine — BUILT OFFLINE, PLUGGED IN AT M52

The correction that reshaped this plan: **most of Block C needs no credential
at all.** It was deferred as "blocked", and it is not.

| # | Milestone | Credential needed to BUILD |
|---|---|---|
| C1 | **M38 contacts, consent, suppression** | None. Schema and owner surfaces. |
| C2 | **M39 channel capability registry** | None — it is the thing that TELLS the owner what each channel can do. |
| C3 | **M42 the outreach gate** | None. `gateOutbound` learns four refusals over C1 and C2. |
| C4 | **M40 email from her own address** | Only the final send. The sequence engine, the SPF/DKIM/DMARC verification, one-click unsubscribe writing to `suppressions`, bounce and complaint handling — all offline. |
| C5 | **M41 Apollo behind a connector** | Only the live call. The connector, the enrichment surface and the rule that 小雅 may never SPEAK enrichment are testable against a fake. |
| C6 | **M50 the connect surface** | Only the OAuth handshake. The page, and M39's registry rendered on it, are what the owner reads BEFORE she connects anything. |

Built in that order, each one ships with "not configured" as an honest state —
the same shape M34 and M37 already use. When M52's credentials arrive they are
pasted into a product that already knows what to do with them.

### BLOCK E · Go-live

`FIRST-FACTORY-WORKFLOW.md` §4 onward: rotate secrets, prove the backup
restores, allowlist, activation. Everything here is procedure, not code.

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
