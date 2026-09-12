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

### M38 — Contacts, consent, and suppression ✅ BUILT

The foundation for everything after it. No outreach until this exists.
Migration 0036; `src/core/outreach/consent.ts`, `src/db/contacts.ts`,
`/app/contacts`. `REQUIRED_SCHEMA_VERSION` 36.

**Schema, as built.**
- `contacts` — one row per identity per channel, the company, where the record
  came from, and when. `email` and `whatsapp`; `inbound` and `manual`. `csv` and
  `apollo` arrive WITH their importers — M43a's rule, that a value nothing can
  write is a value nothing can display honestly.
- `contact_consent` — how consent was obtained, when, and who stands behind it.
  `inbound_message` and `owner_attestation`; `replied_to_email` arrives with
  M40 and `form_submission` with a form. **No row means no consent.** Absence is
  the only honest representation, per M29. Append-only; the app role holds no
  UPDATE.
- `suppressions` — unsubscribed, bounced, complained. Permanent: the app role
  holds neither UPDATE nor DELETE, and this is the one table in the product
  where that is true.

**Two decisions that shape the rest of Block C.**

1. **Consent and suppression are keyed on (channel, identity), never on a
   contact row's id.** An unsubscribe therefore survives archiving the row and
   re-importing the same address tomorrow — which is exactly how a suppressed
   buyer gets written to again. `normalizeIdentity` delegates to M18.2's
   `normalizePhone` so the key is a wa_id and not a second phone format.

2. **A buyer who wrote first is DERIVED, never copied.** His consent is his own
   message, found on every read from `clients.phone`. Copying it into a row
   would create a second answer to "did he write to us" that goes stale. It
   lands the legally correct answer for free: he messaged her on WhatsApp, so
   the derivation only ever produces WhatsApp consent — his e-mail address is
   untouched and needs its own evidence.

   *The first version joined `client_channels`, which exists to hold exactly
   this and is the wrong table: it is written `on conflict do nothing` against
   an index unique GLOBALLY, so a number another business already claimed
   silently produces no row. A screenshot of the seeded demo factory — six
   buyers mid-conversation, an empty list — is what caught it. `clients.phone`
   is written unconditionally and is tenant-scoped.*

**Surfaces.** `/app/contacts`, reached from Buyers: her list, where each came
from, who may be contacted and why, and who never may be again. Owner language
throughout — no "lead", no "prospect", no score, asserted over the catalogue.
Suppression takes two presses, on a page where going back is the primary
button: it is the only permanent action in the product, and the first version
put it one stray click away on every row of a list of live buyers.

**NOT here: `outreach_log`.** It ships with M42, the thing that writes it.
`message_fragments` sat in migration 0009 with no writer for eleven milestones
and the batching it existed for was never wired; a table created ahead of its
writer is that mistake with a schema attached.

---

### M39 — The channel capability registry ✅ BUILT

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

**As built.** `src/core/channel/registry.ts` — the table above, plus
`mayInitiate`, rendered on `/app/channels` above the alert number. Three
properties hold it together:

- **It names requirements and evaluates none of them.** `approved_template` has
  exactly one answerer (`templateReadiness.ts`); business verification and the
  privacy page are Meta's to confirm and hers to supply. And CONSENT is absent
  entirely, though this section names it for WhatsApp: consent is universal, so
  it belongs to M38's `mayContact` for every channel at once. A second place
  deciding whether a buyer opted in would agree right up until it did not.
- **`never` is not a very strict `conditional`.** No reply-only channel carries
  a requirement today, so both orderings inside the predicate refuse and the
  ordering cannot be tested against the real registry — `mayInitiateWith` exists
  as the seam. What it protects is the SENTENCE, not the boolean: `unmet`
  renders as "you can write first once these are in place", a promise no amount
  of paperwork makes true on Instagram.
- **What a channel allows is not what this product can do.** `availableHere` is
  checked against the adapters on disk in both directions, so email flips when
  its adapter lands rather than when someone remembers.

*Two things the screenshot caught. The page said "Email · you can write first"
beside a Connect button, when nothing here can send an email at all. And
"Coming soon: Instagram, Messenger" sat eight lines under "you cannot write
first, ever" — the exact dishonesty this milestone removes, on the same page as
the fix. Both chips are gone; what is genuinely coming for those two is the
inbound story, which the section now states in full.*

---

### M40 — Email as the cold channel

The real outbound engine. Owner connects her own sending domain — she provides
the credentials, as you want, and it is her domain's reputation, not ours.

**Build.** SPF/DKIM/DMARC verification before the first send (refuse if
unverified — a misconfigured domain burns her reputation permanently), sequences
with kill-conditions in code rather than judgement, one-click unsubscribe writing
straight to `suppressions`, bounce and complaint handling.

#### M40.1 — the sending domain ✅ BUILT

`src/core/outreach/domain.ts`, `src/outbound/dns.ts`, migration 0038, and the
e-mail card on `/app/channels`. `REQUIRED_SCHEMA_VERSION` 38.

- **It is a REQUIREMENT of the channel, not a fourth gate.** `verified_sending_domain`
  joined M39's `REQUIREMENTS` and sits in e-mail's `requires`, so the connections
  page renders it in the same Done/Not-yet list as WhatsApp's approved template
  and `mayInitiate` refuses without it. A separate gate would have been a second
  place deciding whether e-mail may initiate.
- **It fails closed in three directions** — never checked, checked too long ago,
  and checked and found wanting. A check that never goes stale is a claim about
  the past wearing the clothes of the present: records get removed, and a cached
  pass from six weeks ago would keep sending into the damage.
- **An SPF record that does not list our sender is `unauthorized`, not
  `malformed`.** The fix differs — a typo versus a missing line — and a
  well-formed record that omits us is worse than none: it publishes a list our
  mail is not on. With no provider configured there is no `include:` to require,
  so the shape alone proves nothing and the check refuses.
- **Naming a new domain clears the old one's pass**, and so does changing only
  the selector: the DKIM record lives at a host derived from it, so a different
  selector is a different record.
- **Every DNS failure returns nothing rather than throwing.** NXDOMAIN, a
  timeout, a resolver that is down — all mean "we did not see it", which reads
  as `missing`. A thrown error would tempt a caller into a catch that treats
  "could not check" as "fine".

*The screenshot caught the ordering: "Not set up here yet — she cannot send on
this one" sat AFTER the whole DNS form, so a page of work read as available and
the line saying it was not landed under the Save button.*

#### M40.2 — the two ways a suppression arrives from outside her hands ✅ BUILT

`src/outbound/unsubscribe.ts`, `src/core/outreach/events.ts`, the public `/u`
pages, and `/hooks/email`. No migration — both write M38's `suppressions`.

- **One-click unsubscribe is STATELESS.** A stored token needs a row written
  before the message goes out and read when it comes back; a send path that must
  write before it sends can fail between the two, leaving a message in someone's
  inbox whose unsubscribe link resolves to nothing. The token carries who it is
  for and is signed, so it cannot be edited into somebody else's address.
- **GET renders, POST acts.** Mail providers, link scanners and security proxies
  fetch every URL in a message before a human sees it; a GET that unsubscribed
  would empty her list on delivery, silently, permanently. RFC 8058's one-click
  POST lands on the same route.
- **A soft bounce is not a suppression.** "Mailbox full" is ordinary. Suppressing
  on one would permanently remove a real buyer because his inbox was full on a
  Tuesday. Only a hard bounce, an unsubscribe or a complaint suppresses, and an
  event type we do not recognise does nothing rather than being guessed into the
  nearest reason.
- **The webhook is mounted only when a secret exists**, exactly as the WhatsApp
  webhook is: an unverified endpoint that writes permanent suppressions is a way
  for anyone to remove her buyers one address at a time. The tenant comes out of
  the signed token the message carried, never out of the request.

*Three invariants caught real mistakes on the way in: `core/` may not import
`node:crypto` (the module moved to `src/outbound/`), a buyer-facing page may not
hand-roll a palette (it now emits the same tokens as the proof page), and a route
that answers a stranger must be DECLARED public — `/u` and `/hooks/email` are now
on that list, and the webhook is mounted in that probe so the declaration is not
dead documentation. A test also caught a `null` inside the events array taking
the endpoint down with a 500, which would have made the provider replay a batch
that had already written permanent rows.*

**Still to build in M40** (trimmed in G21 — three of these shipped in M40.2 and
G14, and a list that names finished work hides the work that is left):
`outreach_log` and the outreach ceiling counter (M42's `ceilingReached` is a
required field precisely so this cannot be forgotten), the sequence engine with
kill-conditions, the reply-as-opt-in, and the adapter itself — whose arrival is
what flips e-mail's `availableHere`. **Built already:** the sending domain
(M40.1), bounce and complaint handling with a signature checked over the raw
bytes (M40.2, repaired in G14 — in live mode it could never have verified one),
and one-click unsubscribe with its own derived signing key.

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

### M42 — The outreach gate ✅ BUILT

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

**As built.** `src/core/outreach/gate.ts`, migration 0037 (`outreach_settings`,
insert-only), the toggle on `/app/channels`, and the same call rendered per
person on `/app/contacts`. `REQUIRED_SCHEMA_VERSION` 37. A FIFTH refusal joined
the four above — `channel_cannot_initiate` — because without it the page said
Instagram cannot be written to first while the gate would have sent.

- **It composes; it does not decide.** M39 answers whether the channel can carry
  a first message, M38 whether this person may be written to. What is new here
  is only what neither could know: her decision, and today's quota. A test
  asserts the gate contains no local copy of either rule.
- **The order is physics, then her decision, then this person, then the day.**
  Each layer is "can this happen at all" before "should it happen now", and the
  first layer is checked first so no refusal ever advises an action that cannot
  help.
- **`ceilingReached` is required, not optional** — the `silenced` precedent.
  Nothing counts outreach attempts yet because nothing makes one; the counter
  and `outreach_log` arrive with the first sender (M40), and a required field
  makes the compiler name that sender when it is written.
- **`REFUSAL_REASONS` is now spread from `GATE_REFUSALS`** rather than
  hand-copied, and moved to `outbound/worker.ts` — the read model that renders
  it is forbidden from naming the gate at all. The test that guarded the copy
  had caught the drift twice.

*What the screenshots caught. The e-mail card read "Not set up here yet — she
cannot send on this one" directly above a switch she had just turned on, so
`canBeEnabled` now requires the decision to be able to take effect: a channel
becomes switchable when its adapter lands, not when someone edits a boolean. And
her contact list gave "you have not said she may write first" as the reason for
an e-mail contact — naming a decision she cannot make yet, about a switch e-mail
does not have. The gate now takes `availableHere` and says the honest thing.*

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

### M43.5 — Why did this month change ✅ BUILT as M51.5 (2026-08-18)

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
address collection. She meets this on day one of the pilot.
**Decided 2026-09-10: no courier details, ever.** This entry used to promise a
courier account. Nomi does not hold one, cannot book a collection, and a field
asking for her courier number would be a promise about shipping that nothing
behind it keeps. The credit reaches the proforma (G15); the parcel is hers.

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

### M51 — Nothing left in limbo ✅ BUILT (2026-08-30)

Six things had been held rather than decided, and holding is what makes a
codebase feel unfinished long after the features are done. Each is now decided —
three built, two deleted, one continuous. Written as outcomes in G21, because
this section described intentions for three weeks after the work shipped, and a
roadmap in the future tense about the past is the drift it exists to prevent.

**M51.1 — debounce-and-batch. BUILT.** Fragments persist to `message_fragments`
(the table had existed since 0009 with no writer); `decideBatch` closes a batch
on quiet or on a cap, and one turn answers the merged text. Media never merges
into text, but it flushes a pending batch first, so a photo cannot overtake the
sentence before it. The timings are per tenant and are operator-only on purpose
— see OPS-RUNBOOK (G19). ASSUMPTIONS P1 is closed.

**M51.2 — the budget gate. BUILT, AND ITS ORIGINAL DESIGN REVERSED.** The rule
now lives once, in `core/budget.ts`: the SQL in `db/channels.ts` supplies the
numbers and core makes the judgement, so the tested copy is the one that runs.
What did NOT get built is the thing this milestone was written to do — consult
the budget BEFORE the analyzer call, to save the expensive tokens. Skipping the
turn would save those tokens and cost the owner her record of it: the outbound
row is what carries `cancel_reason`, and that row is what the refusal surface
renders as what happened, why, and what to do. A saving that makes a held
message invisible to her is not a saving. `BUDGET_PAUSE_REPLY` went with it —
"we are experiencing very high volume… a member of our team will reply to you
personally" invents both halves. G19 then wired the one verdict that was still
being computed and discarded: her soft warning now reaches Today, before the
ceiling stops her rather than after.

**M51.3 — the degrade ladder. DELETED.** `degrade.ts` modelled a night-shift
hold acknowledgement and a five-minute owner alert. What runs is: the turn
throws, pg-boss retries five times with backoff, dead-letters, and alerts the
owner. A module that is better than production and not in production is a lie
about what the product does, so it is gone rather than aspirational.

**M51.4 — `editScope.ts`. DELETED.** Held to see whether it could weigh
spot-check evidence by edit size. It classifies the SCOPE of what an edit
teaches, not the SIZE of one, and every input it needs is a signal nothing
derives.

**M51.5 — why did this month change. BUILT.** The driver is named with its two
counts ("询盘从 40 变成 25"), ranked by the size of the change, ending in
something to tap. No percentages — that is why the first version was deleted
rather than wired. G19 gave it its own place beside the three things to do,
because `slice(0, 3)` was dropping it on exactly the busy months it explains.

**M51.6 — the map matches the ground. CONTINUOUS.** This file had said M37 was
NEXT after it shipped, carried no status on eight built milestones, and pointed
WeChat at M47. It is not a milestone that can be finished: G21 is the same work
again (this section, M40's list below, the audit findings, the environment
docs), and the lesson is that it needs doing at the END of a block, every time.

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

### BLOCK F · Nothing left in limbo ✅ DONE (2026-08-18)

**M51.** Debounce-and-batch WIRED (ASSUMPTIONS P1 closed), the budget rule
UNIFIED (it was enforced in SQL and tested in core — two copies, one running),
the degrade ladder and editScope DELETED, the month-change insight BUILT
without a single rate, and this file made honest. DECLARED_UNWIRED's
"decisions not yet made" section is empty.

### BLOCK G · Finish what was marked built — IN PROGRESS (started 2026-09-10)

A full audit on 2026-09-10 (commit a0c02e5) read every milestone above against
the code. Thirteen "BUILT" claims held. Nine were partly there: a named part
missing, or built and tested but never reachable from a live path. Planning
the fixes found more that the audit had missed, several of them in front of a
buyer. None of it is new scope. It is the distance between what this file said
and what the code did, closed before anything new is started.

**Order, decided 2026-09-10:** Block G first, then Block E on a new dedicated
number, then the rest of Block C. G1–G10 are the pilot's prerequisites.

| # | Milestone | Priority | Status |
|---|---|---|---|
| G1 | CI green, and a suite that runs from any folder | High | ✅ 2026-09-10 |
| G2a | M34 · the transcript correction accepts only a buyer's voice note, and saves | High | ✅ 2026-09-10 |
| G2b | M34 + M4 · she can hear and see in production | High | ✅ 2026-09-10 |
| G2c | M34 · unheard notes and other message types reach the owner | High | ✅ 2026-09-10 |
| G3 | Connect the factory's number — nothing could, so every inbound message was dropped | High | ✅ 2026-09-10 |
| G4 | M46 · "where is my order?" works after confirmation | High | ✅ 2026-09-10 |
| G5 | M44 + M35 · the proof page states only what the quote said | High | ✅ 2026-09-11 |
| G6 | M46 · payment terms and incoterm come from the owner | High | ✅ 2026-09-11 |
| G7a | Price rules · her ask-first line holds the reply — one hold rule | High | ✅ 2026-09-11 |
| G7b | M36 · a contradicting price waits for her, then becomes the baseline | High | ✅ 2026-09-11 |
| G8 | M37.5 · nothing unguarded reaches a buyer | High | ✅ 2026-09-11 |
| G9 | M47 · staff access is safe | High | ✅ 2026-09-11 |
| G10 | The reply window per buyer, approvals that tell the truth, unlisted numbers | High | ✅ 2026-09-11 |
| G11 | M35 · every quote carries a working proof link | Medium | ✅ 2026-09-11 |
| G12 | M47 · hand a conversation to a named person | Medium | ✅ 2026-09-11 |
| G13 | M34 · she can play the buyer's voice note | Medium | ✅ 2026-09-11 |
| G14 | M40.1 + M40.2 · ready for the first sender | Medium | ✅ 2026-09-11 |
| G15 | M45 · the sample credit reaches the proforma (no courier: decided 2026-09-10) | Medium | ✅ 2026-09-11 |
| G16 | M37 · re-photographing updates what changed | Medium | ✅ 2026-09-11 |
| G17 | M49 · finish the design pass, with Playwright screenshots | Medium | ✅ 2026-09-11 |
| G18 | M43a + M43b · money shows its currency everywhere | Low | ✅ 2026-09-11 |
| G19 | M51 follow-ups | Low | ✅ 2026-09-11 |
| G20 | Guard rails for the invariants | Low | ✅ 2026-09-11 (0044) |
| G21 | This file matches the ground again | Low | ✅ 2026-09-12 |
| G22 | Her discount rule can actually fire | Low | ✅ 2026-09-12 |

**G1.** `tests/parity/m40-domain.test.ts` compared a check dated 31 August
against the real clock, and the seven-day TTL turned CI red on 7 September.
Five files built paths with `URL.pathname`, which percent-encodes, so the suite
could not start from a folder with a space in its path. CI now also runs
`npm run build`, the config Railway compiles and CI never did.

**G2a.** The correction route had never succeeded. Its audit insert named a
column `channel_audit` does not have, so every correction rolled back, and the
only test read the route's source text. It also accepted any message id in the
conversation. It now takes only an inbound voice note, records the machine's
reading of an unheard note as empty rather than null, so the page says
"Corrected by you", and writes the audit row with the signed-in person.
`tests/integration/hearing.test.ts` drives it for real and fails on the old
route.

**G2b.** Neither M34 nor M4.5 had ever run in production. `startWorker` took
four optional strings that neither entrypoint passed, so the transcriber and
both media fetchers were `undefined` for the life of the process, and every
voice note and photo was refused — honestly, which is why nothing looked
broken. The fetchers are now built from the provider credential the app
already validates (`src/worker/mediaPorts.ts`), including a new
`metaAudioFetcher`: the Meta image fetcher accepts only images and would have
refused every voice note. `TRANSCRIBE_API_KEY` is the one new setting, checked
at boot when set. Whisper's language names ("arabic") now become the codes the
product reads ("ar"). The simulator gained voice notes and a media endpoint,
and `tests/integration/hear-and-see.test.ts` takes a voice note and a photo
from a signed webhook, through pg-boss and the real worker, to an answer.
Getting that test to pass twice in a row exposed two old test-isolation holes:
the simulator reused message ids across runs, which the dedup key then
swallowed, and integration files ran in parallel with several production
workers sharing one job queue. The runner now runs files one at a time.

**G2c.** Three things the owner never saw. An unheard voice note and an
unclear photo recorded their signal but left the conversation with her, so it
never reached "needs you"; both now take the existing AI → waiting-for-a-person
transition. Anything else WhatsApp sends — a document, a video, a location, a
sticker, a reaction — arrived as empty text and got a reply. Now
`core/conversation/inbound.ts` decides first: reactions and stickers are
recorded and ignored, and everything else goes to a person under a new
`media_unreadable` signal (migration 0039, `REQUIRED_SCHEMA_VERSION` 39), shown
on the conversation page with what arrived and his caption. And Today's list of
why she needed you was a hand copy that had never learned `audio_unheard`; the
problem kinds now live once, in `core/scoring/signals.ts`, and both surfaces
read them.

**G3.** The pilot could not have received a single message. An inbound message
finds its factory through `channel_credentials`, and only the demo seed ever
wrote that table; for a real factory every message was acknowledged to Meta and
dropped, and "Connect" led to a page of steps with no action. `/app/channels`
now offers **Connect this number** when the host is configured with one and
this factory has never been connected. It is owner-only, under the same
decision as activation. It writes the credential, the channel and the audit
row in one transaction, and the number comes from the validated host
configuration, never from the form. A number another factory holds becomes a
clear message instead of an error. Connecting lets messages in; activating is
still what lets her send. `tests/integration/connect.test.ts` shows a message
dropped before, received after, dropped on disconnect and received again on
reconnect.

**G4.** M46's defining scenario — "where is my order?" three weeks later —
could never be reached. Confirming closes the conversation, his next message
opens a new one, and the lookup searched only the conversation it was asked in.
An order the pipeline created also had no first entry in its history, which is
what the lookup reads, so even the same conversation got nothing. Orders are
now looked up by buyer (`latestForClient`, on the indexed `orders.client_id`),
`orders.create` writes the first `confirmed` entry through the one writer, and
a legacy `pending_confirmation` order is reported as awaiting confirmation
instead of falling through to the model. The buyer's latest order now appears,
and opens, on the new conversation and his profile. The confirmation no longer
promises "a confirmation email is on its way" — nothing here sends e-mail.
`tests/integration/order-status.test.ts` creates the order the way the turn
does and fails on the old code; the M46 test had inserted its order by hand,
first entry included, and never saw either defect.

**G5.** The date M44 refused went out by the side door. During one of her
closures the quote drops its lead time and a reply cannot state one, but the
quote row kept no lead time at all, so the buyer's proof page read the
PRODUCT's and printed it, attributed to her catalogue. Migration 0040 records
what each quote said: its lead time, or the closure that withheld it (her
label and dates, and deliberately not the date the lead time would have
promised). The proof page reads that, says "not yet — the factory is closed
for …" when a closure is the reason, and renders money in the quote's own
currency. The owner's closed-card now reads the same record instead of
re-deriving from today's closures, which had let a closure added after a date
was promised claim no date was promised. The reply writer gets a closure note
with her label, so the buyer hears why, and the prompt's worked examples no
longer model a lead time or promise an e-mail. Old quotes are not backfilled:
guessing the product's lead time would re-create the leak, so their pages
state none. `REQUIRED_SCHEMA_VERSION` 40.

**G6.** Every order the pipeline confirmed was stamped "30% deposit, 70%
before shipment", and every proforma said FOB — one a literal in the turn, the
other a message key. The owner gave neither, and a proforma is the document a
buyer pays against. The claims policy could not carry them: its payment terms
are four fixed patterns and several incoterms can be allowed at once, while a
proforma names one. Migration 0041 adds `trade_terms`, insert-only with the
newest row in force (as `sample_policy` and `owner_rates`): her payment terms
in her own words and the one delivery term she puts on a proforma, drawn from
the claims guard's own incoterm list. She states them on
`/app/settings/terms` (owner-only, under the price-rules decision), and saving
also allows that incoterm as a claim, so her document and her employee say the
same thing. Orders snapshot both at confirmation (`orders.incoterm` is new),
so changing her terms rewrites no document a buyer holds. With none stated, the
order is still recorded; its page shows no proforma and says where to state
them. Both literals are gone. `REQUIRED_SCHEMA_VERSION` 41.

**G7a.** Her answer to "above how much off should she ask you first?" was
computed as `requiresHuman`, stored on every quote, and read by nothing: with
`quote` in auto, a discount past her line went straight to the buyer. It was
also computed before the floor clamp, so a quote the floor had cut to 6.67%
still claimed to need her sign-off for the 20% nobody was being given.
`requiresHuman` is now decided on the final discount, and
`core/conversation/hold.ts` is the one rule for "this reply waits for her":
a quantity heard in a voice note (M34.5, folded in) or a discount past her
line. `computeTurn` decides the reason once; `commitTurn`, the trust harness
and the sandbox all read that field, and a hold only narrows (auto becomes
draft; a silenced capability stays silent). A new invariant,
`heldTurnNeverAutoSends`, is on the sandbox watchlist, and the golden set
gains `discount-above-ask-line-waits-for-owner` (24 scenarios). The draft
card says why it is waiting. My factory now promises the ask line, and states
the HIGHEST ceiling instead of the lowest — "never more than 8%" had been
shown while a product on a 12% ceiling was given 12%. The price-rules
questions say what the engine does: the ceiling is the most she may ever give,
even with the owner's OK; the ask line is where she stops and asks.

**G7b.** M36's guard refused a price above what the buyer already had — and a
refusal meant no quote, so the turn fell to `recommend`, the owner was never
asked, and the refusal note still put the new price on the reply's allowed
list. Approving that reply recorded nothing, so he was refused again next time;
and every drafted quote counted as history, including the ones she skipped, so
a price he never saw could become his baseline. The contradiction is now a
field on the quote and a hold reason (it outranks her discount line). The quote
exists, the draft states it as a `quote`, and it waits for her; the card shows
the price he already has, its date, and the new one, and names the worse case
(more pieces at a higher price each). "History" is now what he was actually
GIVEN: `priorQuotesForClient` counts a quote only if its reply went out on its
own or she approved it unchanged. Pending, skipped, rewritten and expired
drafts never count. So her 发送 is what makes a new price the baseline, in
`applyOwnerCommand`'s own transaction. **No migration**, where the plan
expected one. Whether a price was given is already recorded, in
`drafts.status` joined through `turns.quote_id`, and a flag beside it could
only drift from it. The golden set gains
`higher-price-than-already-given-waits-for-owner` (25 scenarios).
`tests/integration/contradiction.test.ts` runs real turns: approve, raise the
price, held, skip, still held, approve, then nothing to hold.

**G8.** Two failed attempts ended in a stand-in that went out unguarded, and
when the analyser had no question it fell back to the refusal note, which is
guidance TO the writer ("Quantity 10 is below the minimum of 1000."). The page
of words she must never use promised a reply with one "comes to you instead",
and nothing did. Now the stand-in takes only the analyser's question, passes
the numeral, claims and forbidden-word guards, and if it cannot, becomes one
fixed sentence with nothing to guard (`SAFE_REPLY`). The turn is held for her
as `guards_failed_twice`, the fourth hold reason, and the card names the words
that kept stopping it. Auto-demotion still keys off her grant, not the hold. A
forbidden word found in her OWN text (her taught answer, or the order-status
line) is its own event, `forbidden_in_her_text`, tagged by path. It is shown on
the conversation for her latest turn, with a link to fix the answer, and it is
never a `guard_violation`, so it cannot block promotion for words the employee
did not write. The forbidden term's `note` is finally written and shown to her.
And a correction to 0029, made here and not in the applied migration: its
comment says re-adding an archived term revives it. It never did. Re-adding
inserts a new row and the archived one keeps its history, which is the better
rule. `tests/pipeline/guarded.test.ts` drives a forbidden term through every
path. None reaches the buyer, and the owner gets a draft wherever the employee
could not write the reply.

**G9.** Staff access was safe on paper: every owner-only POST was gated. But
a new colleague's access code travelled in the redirect's query string, which
the production request log records. The pages behind the gates (her floor,
and the form that hands someone a way in) opened for anyone signed in. And
staff were shown buttons that could only refuse them.
- **G9a.** The code now rides a five-minute HttpOnly cookie scoped to
  `/app/settings/people`, read once and cleared. It is signed with its own
  `staffcode:` HMAC, not the session codec: that codec signs any payload and
  reads a person-less session as the owner, so a code token minted with it
  would have verified as her session. One cookie writer now takes a name. The
  people and price-rules pages refuse staff with the POST gate's own sentence.
  My factory, Your employee and Channels hide the owner-only controls and say
  "The owner decides this." A zh refusal that told staff "only YOU can do this"
  now names the owner; the zh catalogue rule exempts the `staff.*` lines, the
  one audience for whom she is 老板. The source tests that read 900 characters
  after each route name are replaced by a walk signed in as staff, over every
  owner-only route and page.
- **G9b.** Every older write site in the web app wrote the literal `'owner'`
  as its actor, so a sales assistant's actions were recorded as hers. They now
  write the signed-in person, and the conversation page and My factory show a
  NAME: "Taken over by Xiao Chen", or "you" for the reader, and never an id.
  `applyOwnerCommand` no longer writes `drafts.decided_by`. That column
  references the legacy `agents` table, and the old guard passed any UUID
  through, so the first approval by someone with a `people` row, the owner
  included, would have failed the foreign key. Who decided is recorded in the
  event and `capability_events.actor`, as it always also was.

**G10.** Three things a pilot would have met on day one, and a fourth found
while building them. Migration 0042.
- **What was said was not written down.** A voice note, a photo and a file each
  had a writer into `messages`; a typed line had none, and neither did a reply
  that went out. The demo seed wrote both directly, so every screen looked
  right. In production her conversation page would have shown drafts and
  refusals but never the buyer's words or her own — and `messages` is also
  where Buyers' latest line, the analytics counts and a contact's "he wrote
  first" consent evidence come from. A typed line is now recorded as it
  arrives (before batching), and a reply when the provider accepts it.
- **One window for every buyer.** WhatsApp allows a free-form reply for 24
  hours after THAT buyer last wrote, and the send path read
  `channels.last_inbound_at`, which any buyer's message moves. With two buyers,
  one silent for a day, his window never closed as far as the gate could tell
  and Meta rejects the reply it let through. The window now lives on
  `client_channels` — per buyer, as Meta counts it — written by the webhook
  with `greatest`, so out-of-order deliveries cannot wind it back.
- **Approving said "sent" when the gate was about to refuse.** The approve
  route now asks the same question the reply route asks, the buyer's window
  included. Live, and he cannot be reached right now: the draft stays pending
  and she is told why, so she can approve it when he writes again. Not live at
  all: unchanged — an approval before go-live is her decision recorded.
- **A number not on her list cost a model call.** During the pilot the gate
  refuses any reply to one, so the turn only ever produced a draft that could
  never leave. It is now recorded, named on her timeline, and handed to a
  person with the reason (`unlisted_number`), before any transcription, vision
  or model call. She replies herself, or adds the number and hands it back.
  The rule binds only once messaging is on: before that nothing can reach
  anyone and her drafts are rehearsal.
`tests/integration/day-one.test.ts` walks all four through the production
composition. `REQUIRED_SCHEMA_VERSION` 42.

**G11.** M35 opens with "every quote she sends carries a link", and no quote
ever did: the owner had to tap a button afterwards, and the page then showed
her `/p/<token>` — a path with no host, which is not something she can paste to
a buyer. The minting moved to one writer that takes the caller's transaction
(`db/proofs.ts`), because the quote a link proves is not visible outside the
turn's transaction until it commits; the owner's route and the turn now reach
the same writer, and the turn mints as it records the quote. The link is
appended AFTER the guards, deliberately: a token's digits are not sourced
figures and a segment like `-FOB-` is not an authorised claim, so a link inside
the guarded text would be refused by the very rules that make the text safe. A
new `PUBLIC_BASE_URL` (https only, checked at boot) is what a whole link is
built on; absent, no link is attached and the owner is told so on the
conversation rather than shown half of one. The buyer's page is now in the
language HE writes in — `clients.preferred_language`, written by the turn from
the analyser, a column that had existed since the baseline with only the demo
seed writing it. Two things the page stated that the quote did not: its tier
band ignored the band's upper bound (a buyer who ordered 20,000 was shown
"5,000–19,999"), and taught facts were scoped to the conversation rather than
to the product quoted. Both fixed. The owner's row gained the whole link and
the styles it never had.

**G12 — and the routing decision, recorded.** M47 left routing out on purpose —
"no roles, no permissions matrix, no routing" — and that was right while nobody
could be handed anything. **Decided 2026-09-10: build handing to a named
person, and nothing more.** Not roles, not a permissions matrix, not a queue —
one person hands one conversation to one other person, and the ownership model
that already existed is extended rather than replaced. With
staff it leaves the boss holding a conversation she cannot answer and no way
to put it in front of the person who can; a sales assistant has no phone
number, so a conversation only reaches them through this product. `handTo`
moves it from one person to another INSIDE `OWNER_CONTROLLED`, through the same
`canTransition` gate as every other move — the one self-transition the state
machine now allows, and the AI stays silent either way. Who may receive one is
a fact about the people table, not a role: a live person of this business, so a
removed colleague and an id from another tenant are both refused. The
conversation offers "Hand to…" (everyone but whoever holds it), says whose it
is by name, and records `handed_to` with both names; the inbox gains a "Mine"
tab, which appears only once more than one person works there. The header in
`core/conversation/people.ts` that said NO ROUTING now says what is true: one
move, not a system.

**G13.** M34 shows the owner what a voice note said and, when the machine could
not make it out, asks her to type what was said — about a recording she had no
way to hear. The provider's media id lived only inside the pg-boss job that
processed the message, so once that job finished nothing could ask WhatsApp for
the audio again. Migration 0043 keeps the id on the message (a handle, never a
URL: download links are signed and expire, and never the bytes), and a
session-gated route streams it back through the same fetcher the worker hears
with — resolved from the ROW, so a media id in a URL cannot be used to fetch
anything else. Staff can play it too: whoever holds the conversation needs to
hear it. A note received before 0043 has no handle and says so; a recording
WhatsApp no longer holds says it has expired rather than pretending. And once
she has typed what he said, "Answer this now" hands the conversation back to
the employee (`resumeAi`, which also settles the signal that flagged it) and
runs the ORDINARY turn on her words — same guards, same price rules, and
provenance `transcribed`, because the figures in them are still one human's
reading of a recording. `REQUIRED_SCHEMA_VERSION` 43.

**G14.** The e-mail pieces are idle until a sender exists, and two of them were
broken in ways that would only have surfaced on the first real callback.
- **The bounce webhook could not verify anything in live mode.** A signature is
  taken over the BYTES a provider sends; this route re-serialised the parsed
  body and hashed that. Worse, with messaging live the Command Center is mounted
  on the ingress app, whose JSON parser hands every route a STRING — so it
  hashed a quoted string and no real event could ever pass. It now lives in a
  scope of its own with its own raw-body parser (removing the inherited one
  first, which both modes have), verifies over the bytes, and parses only
  after. A byte-exact provider sample now passes in both modes.
- **A correct SPF record read as wrong.** With no provider configured there is
  no `include:` to look for, and the check called that `malformed` — telling her
  to fix DNS that was already right. It is now `no_sender`: her record is fine,
  we cannot confirm it yet, and sending stays refused either way. A record that
  DELEGATES with `redirect=` is no longer malformed (RFC 7208 forbids an `all`
  beside it), and the include must match as a WHOLE token — `includes()` matched
  our mechanism inside `include:mail.example.com.attacker.example`.
- **A suppression from the webhook is normalised and guarded**, like the
  unsubscribe page's: an address echoed in another case wrote a second row that
  no send would ever match, and one bad tenant could turn a batch into a 500 the
  provider replays.
- Unsubscribe tokens are signed with a key DERIVED from the session secret for
  that purpose, derived inside mint and read so no caller can hold the wrong
  one. `/app/contacts` now gets the domain, so it and the connections page give
  the same answer about who may be written to. `SENDING_SPF_INCLUDE` and
  `EMAIL_WEBHOOK_SECRET` are documented.
- **And a flaky integration failure got its name.** Three simulators in
  boot.test shared one tag; each restarts its wamid counter, and
  `provider_message_id` is unique across every tenant, so two of them collided
  the moment both sent — intermittently, depending on which blocks sent
  anything. Each instance now has its own tag.

**G15.** "The sample comes off the first order" was a sentence she could state
and the product never kept: the proforma charged the full total. It is now
derived when the document renders, with no new storage, from three rows that
already exist — his FIRST order (counted by `orders.client_id`, the key M46
looks orders up by, so a second order gets no second credit), that he ASKED for
a sample (`sample_requests`, reached through its conversation), and the policy
IN FORCE WHEN HE ASKED (`sample_policy` is insert-only, so the promise he was
given is the one that was current that day — and a buyer who asked before she
had stated anything was promised nothing). The proforma shows two lines, never
one adjusted total: the price he was quoted, the deduction he was promised, and
what is due. A sample priced in another currency is NOT converted — her rate is
a decision she states (M43b), and applying one silently to a document a buyer
pays against is exactly the arithmetic this product refuses to invent; the page
tells her to take it off herself. The dead branch in `samples.ts` (free-and-
credited and free-and-not returning the same sentence through two arms) is one
sentence now. **One lesson worth keeping:** the first version compared the
order's timestamp against a JavaScript `Date` handed back from the previous
query, and Postgres stores microseconds where a `Date` holds milliseconds — a
sample asked for in the same transaction as the order read as 688µs in the
future and the credit vanished. The comparison stays in the database.

**G16.** A printed price list exists to say this year's prices, and a
photograph of one could not change a single price: every line was an insert
that skipped a product she already had, and she was told they were "already
here". Each confirmed line is now compared with her catalogue by one pure rule
(`core/onboard/catalogDiff.ts`) and lands in exactly one pile — **new**,
**changed** (a different price or MOQ), **already as the page says**, or
**held**. The review and the confirm both compute that diff from the same
staged lines, so the form carries only which changes she kept ticked, never
what the changes are: a posted id can choose among changes her own catalogue
produced, and cannot invent one.
- **Which product a line is.** Her article number when the line has one (M22).
  Without one, the product's name (either of its names) — but only when exactly
  one product has it. A shared name is held rather than guessed, because
  guessing changes the price of the wrong one.
- **A line never erases.** No price on the line keeps her price; no MOQ keeps
  her MOQ. Names are not changed from a page: a misread letter would rename what
  her buyers already know.
- **Each change is its own tick, on by default,** beside the line it was read
  from, so one misread price can be left out without throwing away the sheet.
- **Changes go through the one audited edit** (`updateProduct`, now taking the
  import's transaction): the entry tier moves with the list price, her floor
  still refuses, and the audit row carries the page line that moved the price.
  A price under her floor is held at the review, naming the rule but never her
  number, since staff can open this page. A floor she raises between the review
  and the confirm still wins, and she is told it refused, not "left as it is".
- A sheet that changes nothing offers nothing to confirm and says so. Rejected
  lines past the first eight are counted ("and N more") instead of cut. The
  three upload failures are each named for what they are: `too_large` only for
  the parser's size limit, `not_a_photo` for a PDF, and `upload_failed` for a
  form with no file or a stream that broke off. Before, all of these read "too
  large", and a PDF was told to try better light.

**G17.** M49 set the rules for one measure, one rhythm and two voices, but its
spacing test read only the shell. Fifteen renderers had 93 off-scale margins and
gaps between them (a gap of 10 here, a margin of 14 there), the shell had 10
more, and `margin-inline-end` slipped past the pattern entirely.
- **G17a · the rhythm.** All 209 raw-pixel margins and gaps in `src/api/web`,
  off-scale or not, are now `var(--space-N)`. Each moved to the nearest step on
  the scale; on a tie, margins take the larger step (space between rows opens
  up) and gaps the smaller (items in a row stay together, matching the shell's
  own `.fld`). The layout test now reads every renderer, the login page
  included, and every `margin-*` and `gap`. It refuses any raw pixel value in
  the space between things, and any token the scale does not emit.
  - My factory's blocker links were jade, the colour that means "this sends",
    spent on "this opens a page". They are ink and underlined now. The rule is
    structural: any class a renderer puts on an `<a>` is checked wherever it is
    styled, and only a hover or focus may deepen to jade.
  - Buyers' "nothing waiting" was an `.ok-card` of its own, centred beside a
    left-aligned page. It uses the shared `.empty` now. Anything still centred
    is on a named list with its reason: the phone tab bar, the line under the
    sign-in card, and the rehearsal verdict.
  - The login button is as wide as its word, like every other button.
  - Each new rule was checked by reintroducing its defect and watching it fail.
- **G17b · screenshots.** Playwright, a dev dependency, drives
  `tools/screenshots.mjs` (`npm run screenshots`). It captures every owner page
  at phone, tablet and desktop widths in all three languages, plus a contact
  sheet, and flags pages that did not render, rendered in the wrong language,
  or are wider than their screen. It is not a CI gate. The first full run was
  234 captures with nothing flagged; the order page was skipped because the
  demo tenant has no order.
  - Two things it surfaced on the way. The smoke script's failure handler ran
    `kill "${APP_PID:-0}"`: before launch that is `kill 0`, which signals the
    whole process group, so any tool that called the script died with it. It
    now stops only what it started.
  - Locally, this checkout lives in an iCloud-synced folder, and part of
    `node_modules` and `dist` had been evicted to placeholders that iCloud
    would not deliver. `node dist/main.js` sat idle forever without printing a
    line, while the test suites passed because they load other modules. The
    run-nomi skill now documents the symptom and the check.

**G18.** M43a made money a pair — an amount and the currency it is in — so that
a euro price added to a dollar floor could not compile. The owner surfaces then
undid it one row at a time: each read a stored amount and rebuilt it with
`usd(...)`, so whatever the column said, the screen said "$". The type was
honest and the page was not.
- **Her month's total was one number made of every order**, summed across the
  currency column and labelled in dollars. It is now one total PER currency,
  grouped in SQL; an amount in a currency this build cannot price is dropped
  rather than counted as dollars.
- **An order in another currency showed her nothing at all** — the page
  rendered a total and a proforma only when the order was in USD, so a ￥ order
  was a blank where her own order should be. Both now render in the order's own
  currency.
- The inbox list, the conversation, the buyer profile, the product list and
  detail, her price rules and the public proof page all read the currency
  column beside the amount. Where the currency is one this build cannot price,
  the row is left out instead of priced in dollars — on the proof page that
  means the link reads as gone, which is the fail-closed answer it already
  gives for a quote that no longer exists.
- **A range is only a range inside one currency.** "She never quotes below
  $0.30" was built from every floor she has; with two currencies that sentence
  would be a number she never said, on the page where she checks what her
  employee may promise. It is stated only when her floors agree.
- The order total now shows the converted amount beside it, as the quote
  already did — her own money, at the rate she stated, with the date she
  stated it.
- **What holds it shut:** a source rule that no owner surface may call `usd()`
  on a value that came out of a row, and renderer tests written in ￥, because
  a test that only ever passes dollars cannot fail. The five tables that still
  refuse a second currency are pinned too: the day one of them widens, that
  test fails and names the screens to look at. The comment in `money.ts` that
  still said "USD is still the only currency" — eleven milestones after CNY
  joined — says what is true now.

**G19.** Three loose ends from M51, each a thing that was computed and then
thrown away.
- **The warning that arrives before the stop arrived nowhere.** `checkBudget`
  has returned `soft_warn` since M51.2 and the send gate asks only "is it
  pause?", so the owner learned about her ceiling by her employee going quiet.
  Today now carries it: her percentage, and what HER setting does at 100% —
  stops, or keeps answering — so the sentence is her rule rather than a general
  fact about limits. It is a notice, never attention: a quiet day with a
  warning on it is still a quiet day. Below her own soft-warn line nothing is
  said, because a warning shown every day is a warning nobody reads.
- **The month-change insight was dropped on exactly the month it explains.** It
  was pushed onto the same list as the three things to DO and then cut by
  `slice(0, 3)`: three drafts waiting, a quiet buyer and an unpriced product
  crowded out "inquiries went from 12 to 30". It is a different kind of thing —
  something to know, not something to do — and it now sits beside the three
  instead of competing for one of their places. The cap still applies to the
  things to do.
- **The batching timings are documented as operator-only** (docs/OPS-RUNBOOK.md)
  rather than put on a settings page. Every number she sets in this product is a
  commercial rule she can state in her own words; "how many seconds to wait
  before replying" is a tuning knob whose right value depends on provider jitter
  and nothing she knows about her buyers. The runbook says what the columns are,
  what changing them costs, and how.

**G20.** Five invariants that were true and unguarded. An invariant with no
guard rail is a convention, and the defect this repository keeps finding is a
second implementation of a rule that agreed with the first until it did not.
- **"Exactly one module decides whether a message may be sent" read four
  directories one level deep.** A second gate in a subdirectory — or anywhere
  in `src/pipeline`, which it never looked at — was invisible to it. It is
  recursive over all of `src/` now, and the old copy is deleted rather than
  left to disagree.
- **The one sender outside that gate is named.** `deliverOwnerAlert` writes to
  the owner's own phone, which is not a buyer message and is not subject to her
  allowlist or the 24-hour window. It is a deliberate exception, and it is now
  the only one that can exist without a test turning red.
- **Only `enqueueOutboundRow` inserts an outbound message.** Every refusal the
  owner reads — the cancel reason, the audit row, the what/why/what-to-do card
  — is a row that function wrote. A second INSERT would produce a message with
  no refusal story behind it.
- **The app role holds no DELETE and no TRUNCATE in `public`.** Archive-never-
  erase stops being a discipline and becomes a grant the role does not have.
  The exception is the `pgboss` schema and it is not ours: a queue deletes
  finished jobs, and those tables hold no business fact. Both halves are pinned,
  and the exception is written down in the ops runbook.
- **An applied migration that changed on disk is now an error** (0044). The
  runner chose work by version number, so editing an applied file was silent:
  it ran on every clean database and on none of the old ones, and the two
  drifted with nothing saying so. Each applied migration records the sha256 of
  what ran; a file that no longer matches stops the run, names itself, and says
  to write a new migration instead. Rows that predate the column are backfilled
  rather than judged.

**G21.** The map matches the ground again — the same work M51.6 did, which is
why it is now written down as the thing a block ENDS with rather than a
milestone anyone finishes.
- **The 2026-09-10 audit is closed, finding by finding** (table below). One of
  its findings was wrong and is recorded as wrong rather than quietly dropped.
- **M51 reads as outcomes**, with the real commit date (2026-08-30, not the
  2026-08-18 this file claimed) and the decision it reversed: the budget gate
  deliberately does NOT run before the analyzer, because skipping the turn would
  save tokens and cost her the refusal row that tells her it happened.
- **M40's "still to build" list no longer names work that shipped.** The sending
  domain, bounce and complaint handling, and one-click unsubscribe were on it
  after they were built, which hides what is actually left.
- **The courier and routing decisions are recorded where the promise was made** —
  M45 no longer offers a courier account Nomi cannot book, and M47 says what
  "routing" was scoped to mean.
- **The environment docs match the code**, and a test keeps them that way: every
  `process.env` name in `src/` must appear in `docs/env-checklist.md`. The
  `PORT` default said 8080 for four months while the code used 8787, and the
  three pool settings were in `.env.example` and no table at all.
- **The n8n-era documents moved to `docs/archive/`** with a README saying what
  each one was: a setup guide that starts "create a Supabase project" is not a
  historical curiosity when it sits beside the current one, it is a trap.
- **ASSUMPTIONS.md has the closed section it asked for since M5.** Four entries
  moved into it. Two of them (one send path, archive-never-erase) were never in
  the register at all — an invariant everyone believes is exactly the one nobody
  writes down.
- **The demo factory can be replied to.** It seeded six buyers with phone
  numbers and no `client_channels` row, so on the tenant a new factory is shown
  first, approving a draft reported "sent" while `enqueueOutboundRow` returned
  null: nothing queued, therefore nothing refused, therefore nothing on the
  blocked list either. Every seeded buyer now has the number he can be reached
  on and an open window.

**G22.** Her "ask me above this discount" line could never fire, and neither
could her ceiling. `computeQuote` derives a discount from `negotiation_rules`
and from nowhere else, and no owner surface had ever written that table: every
quote came out at `discountPct` 0, so "never more than 8% off" was a ceiling on
nothing and the hold G7a built described an event the product could not
produce. **Found by the pre-pilot walkthrough** — scenario 7 had to insert the
row by hand, and a rehearsal that reaches into the database is rehearsing
something the owner cannot do.
- She writes it in her own terms on her price-limits page: which product (or
  everything she sells), from how many pieces, how much off. Archived rather
  than deleted when she stops offering it, and audited as the price rule it is
  rather than under a second vocabulary for the same history.
- **It refuses rather than clamping.** A discount above the most she said may
  ever come off is rejected naming her own number — the engine would quietly
  narrow it, which leaves her believing she has a rule she does not. One with
  no limits stated at all is refused too: the floor is what makes a discount
  safe, and M29's argument is that absence of a rule is never a default.
- With none written, the page says plainly that she never offers one. That was
  always true and never said.
- The engine needed no change. It has always been able to discount; nothing
  could tell it to.

#### The 2026-09-10 audit, closed

| # | What the audit (or the planning that followed it) found | Closed by |
|---|---|---|
| 1 | CI red since 7 September; `npm test` could not start in a path with a space | G1 |
| 2 | The transcript correction had never once succeeded — its audit insert named a column that does not exist | G2a |
| 3 | The worker never received a transcriber or media fetchers, so every voice note and photo was refused in production | G2b |
| 4 | Stickers, documents, videos and locations arrived as empty text and ran a turn | G2c |
| 5 | Nothing in the product could connect a real factory's number; inbound was acknowledged and dropped | G3 |
| 6 | "Where is my order?" could not work: confirming closed the conversation and the lookup searched only that conversation | G4 |
| 7 | The proof page printed a lead time the quote had withheld, and "$" whatever the currency | G5 |
| 8 | Every order was stamped with payment terms and an incoterm the owner never gave | G6 |
| 9 | Her "ask me above this discount" line was computed, stored, and never enforced | G7a |
| 10 | A price contradicting one the buyer already had was refused outright, and never became the baseline | G7b |
| 11 | A reply that failed the guards twice went out unguarded, carrying an internal note | G8 |
| 12 | A new staff code travelled in a URL that production logs; owner-only pages were open to staff | G9 |
| 13 | The 24-hour window was per business, so two buyers broke it; approving skipped the send precheck; an unlisted number ran a model turn | G10 |
| 14 | The proof link the roadmap opens with was a relative path nobody could open | G11 |
| 15 | A voice note could be corrected but never played | G13 |
| 16 | The e-mail webhook could never verify a signature in live mode; a correct SPF record read as malformed | G14 |
| 17 | "The sample comes off the first order" never reached the proforma | G15 |
| 18 | Re-photographing a price sheet changed nothing — every line was an insert that skipped an existing product | G16 |
| 19 | 103 off-scale spacings across sixteen renderers; a jade link; a centred empty state | G17a |
| — | **WRONG FINDING:** the audit reported that "Turn off this link?" never appears. It does — every confirm button has an inline handler and no policy blocks it. Recorded rather than dropped: an audit that is never wrong is an audit nobody checked. | — |

### BLOCK C · The outbound engine — IN PROGRESS (C1–C3 built)

#### Block C in detail — built offline, plugged in at M52

The correction that reshaped this plan: **most of Block C needs no credential
at all.** It was deferred as "blocked", and it is not.

| # | Milestone | Credential needed to BUILD |
|---|---|---|
| C1 | **M38 contacts, consent, suppression** ✅ BUILT | None. Schema and owner surfaces. |
| C2 | **M39 channel capability registry** ✅ BUILT | None — it is the thing that TELLS the owner what each channel can do. |
| C3 | **M42 the outreach gate** ✅ BUILT | None. `gateOutbound` learns four refusals over C1 and C2. |
| C4 | **M40 email from her own address** — M40.1, M40.2 built | Only the final send. The sequence engine, the SPF/DKIM/DMARC verification, one-click unsubscribe writing to `suppressions`, bounce and complaint handling — all offline. |
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
