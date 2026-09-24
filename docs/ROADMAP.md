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
*(C4.a, later: it never shipped at all. The first sender counts the
`outbound_messages` rows it already writes, so there is one record of the day.)*

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

### M40 — Email as the cold channel ✅ BUILT except C4.d (deferred until the pilot is live)

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

#### C4.a — one e-mail, written by her, sent to one contact ✅ BUILT

Migration 0046, `src/channels/email/`, `src/outbound/writeFirst.ts`,
`src/db/outreach.ts`, the "Write to them" page off `/app/contacts`, and her daily
cap on the writing-first card. `REQUIRED_SCHEMA_VERSION` 46.

- **The database could not hold an e-mail conversation.** `conversations.channel`
  and `client_channels.channel` both refused `'email'`; the outbound row carried
  no channel and no subject; `enqueueOutboundRow` resolved recipients from a join
  pinned to `'whatsapp'`. 0046 widens the three channel lists, adds
  `outbound_messages.channel` (defaulted `'whatsapp'`, so no existing row changes
  meaning) and `subject`, admits `origin = 'outreach'`, and gives
  `outreach_settings` her `daily_cap`.
- **No second send path.** `writeFirst` is `ownerReply` with a different origin:
  it queues through `enqueueOutboundRow`, and the ONE worker picks the adapter by
  the row's own channel at the one call site the guard rails pin. A row whose
  channel has no adapter is refused `channel_unavailable`, never dropped.
- **The window is the channel's.** `channelSendPlan` asks the registry: e-mail's
  `replyWindowHours` is null, so it has no window to be outside of — without this
  every mail was refused `window_closed`, naming a WhatsApp rule. An unknown
  channel is treated as windowed, the refusing answer.
- **The outreach gate finally has its facts.** `outreachFacts` reads her switch,
  her cap, her domain, his consent and his suppression for one buyer; `writeFirst`
  asks it when she presses send and the outbound store asks it again when the row
  leaves, so a bounce that lands in between still stops the mail. An outreach row
  whose facts could not be resolved is refused `outreach_unchecked` — `gateOutbound`
  only asks the outreach question when the field is present, so a missing field
  must not read as a yes.
- **No `outreach_log`.** The cap counts `outbound_messages` rows that actually
  left today on that channel with origin `outreach`. One record of the day rather
  than two that can disagree. The default is 50 a day — a quarter of the reply
  ceiling or less, because what is at risk is the address she has used for years.
- **Every first mail carries RFC 8058 headers**, minted at the composition root
  with the key the `/u` page reads with, in the buyer's own language when his
  client row knows it. No public address configured means no link, which means
  the mail is refused `no_unsubscribe` rather than sent without a way out.
- **Activation and the pilot allowlist are WhatsApp's, stated rather than joined.**
  `channels` has a row for WhatsApp only, and `pilot_allowlist.phone` holds digits
  only. For an e-mail conversation the store no longer reads either: what stands
  between her and a stranger's inbox is her switch, her verified domain, his
  consent, his suppression and her cap, every one absent by default. C4.d gives
  e-mail its own row and its own list.
- **An address another factory already holds writes nothing here.**
  `client_channels` is unique on (channel, identity) globally; the conversation and
  client created for him are rolled back rather than left as an empty thread.
- **A buyer on two channels has two threads.** `ensureConversation` finds the
  active conversation per channel, so a first mail can never be queued into his
  WhatsApp thread and leave as a text message with no subject.
- **When C4.a landed, nothing left production, and that was correct.** No
  domain could verify without a sending provider, deployment mode runs no
  outbound worker, and the transport was a recording fake. *Superseded by C6:*
  mail now leaves through the mailbox she connects, and the fake is tests-only.
  Deployment mode still runs no outbound worker, so the write page still says
  messaging is not switched on before she types.

*The mutation check that mattered: pinning the store's identity join back to
`'whatsapp'`, or dropping the outreach facts, fails four of the twelve
integration tests over the real composition — the send, the unsubscribe loop,
the late suppression and the cap.*

#### C4.b — a first e-mail and the follow-ups after it ✅ BUILT

Migration 0047, `src/core/outreach/sequence.ts`, `src/db/sequences.ts`,
`src/outbound/sequences.ts`, and `/app/sequences` (reached from her contact list).
`REQUIRED_SCHEMA_VERSION` 47.

- **The one feature that keeps writing to a stranger after she stops looking,**
  so its whole policy is one pure function, `decideStep`. In order: out of use →
  he replied → a suppression, by its own reason → a person holds the thread →
  the previous mail did not arrive → nothing left (finished only once the last is
  known to have gone) → not due yet → previous still pending (an hour, and only
  once due, so the hour can delay a follow-up and never bring one forward) → the
  outreach gate. Refusals true forever stop it; her cap and a lapsed domain check
  HOLD it until tomorrow in Shanghai, and after `MAX_HOLD_DAYS` (7) stop it. The
  refusal-to-meaning map is a mapped type over the gate's vocabulary, so a new
  refusal fails to compile until someone decides.
- **What goes out is what she approved, word for word — enforced by the
  database.** A trigger freezes an approved sequence's steps and name; another
  refuses any enrolment on a draft or archived one. The approve form carries a
  SHA-256 fingerprint of the words on her screen, and approval is refused if a
  colleague edited a step while she read. The step trigger locks the sequence
  row `for share`, so an edit and the approval cannot commit on one snapshot.
  Approving and taking out of use are owner-only; writing, adding someone and
  stopping are anyone's, with the name recorded.
- **The schedule is a table; the queue only wakes it.** Each enrolment holds
  `next_due_at`; a pg-boss cron runs `runDueSteps` every minute. No delayed job
  per step — a lost job would be a follow-up that silently never happens.
  Each enrolment is taken `for update skip locked` in its own transaction, so a
  throw on one retries next minute without taking the batch down.
- **No step is sent twice**, by two independent defences: the row lock, and a
  `sequence_sends` key claimed before the outbound row is queued in the same
  transaction. A deferral is `greatest(next_due_at, until)` — found by mutation:
  with the lock removed, a sweep that lost the race deferred the winner's
  "in two days" to "in an hour", and the follow-up went a day early.
- **A step is an ordinary outbound row** (origin `outreach`, her subject), so
  the gate, his suppression, her cap and the unsubscribe headers all apply at
  the moment it actually leaves.
- **The ops kill switch holds every follow-up** — found while writing the
  runbook, not by a test: C4.a had left `global_silence` binding only the
  employee's messages, so a schedule would have kept mailing strangers through
  an emergency stop. The sweep now looks at nothing while it is on, and the gate
  refuses a step queued the moment before (`GateInput.automated`, resolved by the
  store from `sequence_sends`). A first mail she typed herself is still not held,
  which keeps the refusal's sentence — "reply yourself, you are not paused" —
  true.
- **Prechecks count queued mail too.** `outreachFacts` gained `counting:
  'sent_or_queued'` (queued within the last day) for her write button and the
  scheduler; the send-time gate still counts only the sent. Before this, sixty
  first mails queued in a minute against a cap of fifty were all accepted and ten
  refused later. `writeFirst` (C4.a) now uses it as well.
- **An address another factory holds** stops the enrolment `unreachable`, with
  the thread and client made for him rolled back rather than left empty.
- **Her words follow their own direction.** Every subject and body field and
  block is `dir="auto"`: the Arabic page's first screenshot laid an English mail
  out right-to-left, comma first.

*The sequence is drafted by a person, not by her employee. "She proposes the
sequence" (below) needs a live model and its own guard rails for cold copy;
the approval that makes a proposal safe is what C4.b built, so a drafting
employee can land later behind it without changing what is enforced.*

#### C4.c — the reply is the opt-in ✅ BUILT

Migration 0048, `src/channels/email/inbound.ts`, `src/pipeline/emailReply.ts`,
and `POST /hooks/email/inbound`. `REQUIRED_SCHEMA_VERSION` 48.

- **His answer arrives at a signed webhook** in one provider-neutral shape
  (`from`, `messageId`, `inReplyTo`/`references`, `subject`, `text`); the adapter
  that comes with the provider (M52) maps its own payload onto it. Same secret,
  same raw-bytes HMAC and the same 404-on-a-bad-signature as the events route —
  one helper, `signedBody`, for both.
- **The tenant cannot be forged.** The reply names the mail it answers by
  Message-ID; `resolve_email_reply` (SECURITY DEFINER, like `resolve_tenant`)
  finds that id among mails this product actually SENT and returns the business,
  thread and address from her record. And the sender must BE that address: a
  colleague or a forward is `not_the_recipient` and records nothing in his name.
- **What his answer changes, in one transaction:** his words on the thread
  (deduped on his Message-ID), `replied_to_email` consent for e-mail to his
  address, the `email_reply` signal and the SAME handoff an unread document takes
  (`handToPerson`, moved out of the worker closure so there is one copy). No
  model runs on a stranger's first answer. His follow-ups stop by C4.b's own
  rule — he has written since he was enrolled.
- **She answers him through the one send path.** The owner precheck is
  channel-aware (an e-mail thread has no WhatsApp lifecycle); her reply takes
  "Re:" and the subject of the mail he answered — how every mail client names a
  reply, not an invented subject — and threads under his with In-Reply-To and
  References. The unsubscribe refusal now asks for `List-Unsubscribe` BY NAME:
  it had been "no headers at all", which a threading header would have satisfied.
- **E-mail has no delivery receipt to wait for.** The outbound sequencer held
  each message until the one before it had a WhatsApp 'delivered' receipt or 90
  seconds passed; for e-mail that was always the full 90 seconds on her answer.
  The registry now says `deliveryReceipts: false` for e-mail (absent means yes,
  the waiting behaviour), and a mail still in flight still blocks the next.
- **Found while building it — M40.2 could never have matched a real provider's
  bounce.** Its webhook reads the tenant from a signed `tag` on each event, and
  nothing ever handed a transport that tag: it existed only inside the
  List-Unsubscribe URL. `MailMessage.tag` now carries it, the transport contract
  says to attach it as provider metadata, and an integration test posts a bounce
  echoing the tag of a real sent mail and sees the right address suppressed.
- **The transport contract, written down for M52:** on success,
  `providerMessageId` is the RFC 5322 Message-ID the recipient's client sees —
  a provider's internal job id there would make every reply unmatchable.

*The roadmap said a reply "opens WhatsApp for them later". It does not, and
cannot: consent belongs to the channel it was given on (M38), and answering a
mail hands nobody his phone number. It opens e-mail; WhatsApp opens when he
messages her there.*

**Still to build in M40:** per-channel activation (C4.d). **Built already:** the
sending domain (M40.1), bounce and complaint handling (M40.2, repaired in G14,
matchable since C4.c), one-click unsubscribe, the first mail (C4.a), follow-ups
(C4.b), and replies (C4.c).

**Draft-first applies here too.** She proposes the sequence; the owner approves
it. Autonomy is granted per capability and revocable in one tap, exactly as it
works for replies today.

**The reply is the opt-in.** When a contact answers an email, that writes a
`contact_consent` row with evidence — and *that* is what legitimately opens
WhatsApp for them later. This is the mechanism that makes the whole thing safe,
and it costs nothing because the reply had to happen anyway.

---

### M41 — Apollo, and the connector shape ✅ BUILT as C5 (live call unverified until M52)

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

#### C5 — Apollo behind a connector ✅ BUILT

Migration 0049, `src/connectors/` (the contract and Apollo), `src/prospects/service.ts`,
`src/db/prospects.ts`, `/app/prospects`, and a company line on her contact list.
`REQUIRED_SCHEMA_VERSION` 49.

- **One contract, Apollo behind it.** `ProspectSource` speaks the product's words
  (a company, a person, a search); the next source is a file beside `apollo.ts`.
  The Apollo client puts her key in the `X-Api-Key` header only, turns every
  status into a closed reason (`unauthorized`, `no_credits`, `rate_limited`,
  `unavailable`, `unreadable`) and carries nothing a vendor said past the
  boundary. It refuses an address Apollo will not stand behind — a placeholder
  or an unverified one. **Not yet exercised against the live API**: there is no
  key here and none belongs in a test; the first real call is M52's.
- **Her key, locked.** `connector_credentials` holds AES-256-GCM ciphertext and a
  fingerprint — the first production use of the M3 helpers. Owner-only (on the
  `outreach` action); replacing archives, removing archives, nothing is erased; a
  key written under another CREDENTIAL_KEY reads as unreadable, never guessed.
- **Every credit is a click.** Search spends nothing. Adding a person (their
  business address) and looking up a company each spend one, only on a button
  that says so. A company is bought once per domain per 90 days; a personal
  mailbox (gmail, qq, 163…) is never looked up — it would buy "works at Google".
  No network call holds a database transaction.
- **Enrichment is for people, never for her employee** — asserted at source level
  as the roadmap asked, and as an IMPORT GRAPH rather than a word search: no
  module under `src/pipeline`, `src/llm`, `src/core/conversation`, `src/trust`,
  `src/worker` or `src/retrieval` can reach the prospects store, service or a
  connector through any chain of imports; the table is queried in exactly one
  module; no prompt names it. A planted import fails the test.
- **Target lists she decides about, never a queue.** A result is a person with one
  button. Adding them creates a contact with `source: 'apollo'` and a job title —
  and **no consent**. Her list says so in the gate's own words, and enrolment
  refuses them by the existing path. *Enrolment into C4's sequences therefore
  works for an Apollo contact exactly when a lawful basis is recorded, and not
  before.*
- Vendor facts on the Arabic page are isolated fact by fact, not as one span — the
  first screenshot read ": 60 عدد الموظفين".

**Waiting on the owner, not on code:** whether a cold e-mail to a business address
found in a search may rest on "legitimate interest" (and so on a new consent
evidence) is a legal decision. M38's rule — no row means no consent — holds for
purchased leads until she makes it.

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
  Nothing counted outreach attempts because nothing made one; a required field
  made the compiler name the first sender when it was written — which C4.a did,
  counting `outbound_messages` rather than adding an `outreach_log`.
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

### M50 — The connect surface ✅ BUILT as C6 (WhatsApp paste path deferred with C4.d)

One settings page where every account links: WhatsApp, Google/Microsoft,
Instagram, Facebook, Apollo. Each shows connected / not connected / needs
attention, **and what that channel can actually do** (M39's registry, rendered).

This is the page the whole niche rests on, so it gets designed, not assembled.
The owner is not technical and may have no IT support: she connects everything
with a few clicks. Built against dev-mode platform apps with test accounts;
paste-credentials stays as the fallback path for factory #1.

#### C6 — the connect surface, and the transport that finally sends ✅ BUILT

Migration 0050, `src/connectors/oauth.ts`, `src/channels/email/{senders,accountTransport,connectMailbox}.ts`,
`src/db/mailAccounts.ts`, and "Your accounts" on `/app/channels`. `REQUIRED_SCHEMA_VERSION` 50.

- **Google proven live, 2026-09-18.** The pilot's domain moved to Google
  Workspace; an Internal app in the domain's own Cloud organisation, the
  mailbox connected as the owner, the three records done, and the first e-mail
  written on a contact reached an outside inbox. Two warts logged in
  `docs/EMAIL-SETUP.md`: a registrar's wrapped SPF include, which the domain
  check does not follow, and Save resetting a passing check. Outlook remains
  untried live.

- **A read model that holds more than one account.** Gmail, Outlook, Apollo,
  Instagram and Messenger, each answering the same questions: connected, as what,
  and what it lets her do. "Not connected" and "not set up here yet" are
  different rows — no Connect button for an app this installation has no client
  for. Instagram and Messenger say what the registry says (they can never write
  first) and offer nothing to press. WhatsApp keeps its own card: its lifecycle
  is the pilot's.
- **Connect Gmail / Outlook with a few clicks** — OAuth 2.0 authorization code
  with PKCE (S256), owner-only. The callback is tied to the person who pressed
  Connect by a signed, ten-minute, HttpOnly cookie scoped to `/app/connect`
  holding the verifier, a nonce and her person id; a missing, stale, forged,
  other-provider or other-person callback connects nothing (login-CSRF closed).
  The ID token's audience, issuer, expiry and — for Google — `email_verified`
  are checked. Scopes: send only. **Nothing that reads her mailbox**; a test
  holds both providers to it.
- **The refresh token is stored locked** (AES-256-GCM, fingerprint), one live
  mailbox per business, replacing archives, nothing erased. No access token is
  ever stored: it lives in the sending process's memory until a minute before it
  expires.
- **Production no longer sends into the recording fake.** The outbound worker
  binds an account-backed transport to each job's own business. It reads the
  live mailbox on every send and REFUSES, saying why, when none is connected,
  when the installation has no app for its provider, when the mailbox is not on
  her verified domain, or when the token is dead. A dead token (`invalid_grant`,
  or a second 401) is recorded on the row and the page asks her to connect again.
  Microsoft's rotated refresh tokens replace the stored one.
- **One MIME message for both providers**, because Graph's JSON message only
  allows `x-` headers and so could never carry List-Unsubscribe. Header injection
  is closed (no CR/LF in any value, reserved headers not overridable), non-ASCII
  subjects are RFC 2047-encoded. The Message-ID is minted on her domain and read
  back from Gmail / taken from Graph's `internetMessageId`, keeping C4.c's reply
  contract.
- **Her SPF is checked against the mailbox she connected** (`_spf.google.com`,
  `spf.protection.outlook.com`) when the host names no include — the first time
  the domain requirement can actually pass without an operator setting.
- **Not exercised against Google or Microsoft from here.** Dev-mode OAuth needs
  her own Google Cloud project and Entra app (M52 #3, #4). Everything on this
  side of the wire is tested with a recording fake.

**Deferred, on purpose — the WhatsApp paste-credentials path.** The running app
builds its WhatsApp sender once from the host's settings; a pasted token would
only mean something if the pilot-critical send path read credentials from the
database per tenant. That is the same class of pre-go-live reshaping the owner
chose to defer for C4.d, so it waits for the pilot too. Apollo's paste path
exists (C5).

**Known limits, for the owner to decide:** a buyer's reply to a mail sent through
Gmail/Outlook lands in her own inbox, not in the product — reading it would need
`gmail.readonly` / `Mail.Read`, which Google classes as restricted (paid security
assessment). The inbound webhook (C4.c) serves an e-mail service provider
instead. Because of that, follow-ups wait for a person (0051, below). And an
Outlook send that fails between creating and sending leaves a draft in her
Drafts folder.

#### C9 — Instagram and Messenger: the channels a buyer starts (0053) ✅ BUILT 2026-09-16

`src/channels/meta/messaging.ts`, `src/channels/{instagram,messenger}/adapter.ts`,
`src/api/web/metaChannels.ts`, and two webhook paths. `REQUIRED_SCHEMA_VERSION` 53.

- **The half that was always possible.** M39 recorded that neither channel can
  ever be written to first — Meta answers only inside 24 hours, there is no
  template and no one-time notification — and stopped there, so the product
  carried neither at all. What it could always do is the half this product is
  built around: a buyer comments, taps an ad or sends a DM, and 小雅 answers
  inside the window. That is now wired end to end.
- **One wire, two channels.** Meta carries both over the same Graph messaging
  API, so the parser and the sender live once in `meta/messaging.ts` and the
  adapters are thin. Each reads only its own webhook `object` (`instagram`,
  `page`), which is what keeps a Page message out of an Instagram conversation
  when one app serves all three products.
- **Reply-only is enforced three times over**: the registry says `never`,
  `mayInitiate` refuses whatever requirements are satisfied, and `gateOutbound`
  refuses an `outreach` row on either channel. An integration test drives a cold
  message through the real worker and watches it be canceled.
- **A defect found while building it.** `channelSendPlan` fell back to
  `send_template` for ANY windowed channel once the window closed. Instagram and
  Messenger have no templates, so that plan produced a send Meta refuses and
  this product recorded as sent. Templates now reopen a window only where the
  registry says the channel has them (`reopenWithTemplate`, WhatsApp alone).
- **Connecting is hers, the account is the host's.** `connectMetaChannel`
  mirrors G3: the id comes from the environment, never the form, the token is
  NAMED in `secret_ref` and never stored, and the credential is what
  `resolve_tenant` uses. Until she presses Connect, a buyer's message is
  acknowledged to Meta and dropped — which the test asserts, because silently
  dropping is exactly what a missing credential row caused before G3.
- **No activation switch and no allowlist** on these two, for the reason e-mail
  has none: there is no cold message to hold back. C4.d gives every channel its
  own activation when the pilot is live.
- **Found going live, 2026-09-17: deployment mode swallowed them.** Production
  runs with `WHATSAPP_PROVIDER=disabled` because Meta has not offered the
  number, and that one flag chose "no messaging surface at all" — the Page
  token was set, neither webhook was mounted, Meta's verification met a 404,
  and Today would have said messaging was off while buyers wrote to the Page.
  Deployment mode is now the case where NO channel is configured. With a Page
  and no number the messaging path runs with WhatsApp honestly absent: no
  `/webhook/whatsapp`, a `channel_unavailable` refusal for a WhatsApp row,
  owner alerts dropped as permanent failures rather than queued for a number
  connected weeks later. The owner surfaces ask two questions where they asked
  one — is the number configured, and does anything queued here leave — and
  `Production.channels` names what is mounted. A defect fixed on the way: every
  channel's event was recorded under the WhatsApp adapter's provider.
- **The legal pages (2026-09-17).** Instagram delivers messages only to a
  *published* app, and Meta will not publish one without a privacy policy and
  data-deletion instructions it can fetch. `/privacy` and `/data-deletion` are
  the first pages a stranger may read that name nothing and nobody: what is
  kept about the people who write in, who sees it, how long, and how they have
  it removed — in plain words, three locales, bound by the same catalogue scan
  as everything the owner reads. `docs/LEGAL.md` is the operator's side of the
  promise: the thirty days the page names, and the deletion an operator does
  with the migrate role, because the app role can delete nothing (G20).

- **Live on Meta (2026-09-18), and what the platform actually gates.** The
  first Facebook message and the first Instagram DM reached `/app/inbox` on
  production. Two of the gates are invisible from the dashboard and are written
  down in `docs/META-SOCIAL-SETUP.md`: the Page token Messenger's *Generate*
  button mints carries no Instagram scope (Meta then forwards no Instagram
  webhook at all), and a published app with standard access receives messages
  only from people who hold a role on it — the admin's own Facebook, an
  Instagram account added as a tester. **Next Meta milestone: App Review** for
  `instagram_manage_messages` and `pages_messaging`, which is what lets a
  stranger — a buyer — write in. It needs a screencast of the flow, which the
  live setup can now record.
- **Found on the first Instagram reply (2026-09-18).** The owner typed an
  answer to an Instagram buyer minutes after he wrote and was told "you can't
  message this buyer right now". The owner-reply precheck (`ownerSendFacts`)
  read his last message from his WhatsApp identity, so an Instagram or Page
  buyer had none and his window read as shut. It now reads the channel he
  wrote on — the store's own rule, which the worker had followed all along.
- **Found on the second Instagram reply (2026-09-18).** With the window open
  the reply reached Meta and came back `meta 400`. Instagram replies were
  posted to the Instagram account's own id, `/{ig-account}/messages`, which
  graph.facebook.com does not serve: under Facebook Login one Page token sends
  for both channels from the Page, `/{page}/messages`, and Meta routes to
  Instagram by the buyer's scoped id. The Instagram adapter now takes the Page
  id, and a refused send records Meta's numeric code beside the status —
  `meta 400 (#100)` — so the next one names its rule without a repro.
- **A1 · A factory signs itself up (2026-09-18, migration 0055).** One access
  code in the environment opened one business; a second factory could not exist
  without the operator making its row by hand and redeploying — which locked the
  first one out. Now `/signup` makes a business, its owner and her login
  together, she signs in with her own e-mail and password, and staff codes name
  their own business. Invite-only unless `SIGNUP_MODE` says otherwise, because
  every workspace spends this installation's reply-writing key. The tenant is
  still made in exactly one place — a definer function; the application role
  still cannot insert a business. Passwords are scrypt with their parameters in
  the stored string; five wrong tries lock a login for a quarter of an hour; the
  door never says which addresses exist. Found on the way: Today read the
  ENVIRONMENT's business instead of the session's, and the minute's sweep
  (follow-ups, the domain check) ran for that one business only — both would
  have been invisible until the second factory. Not built: password reset by
  mail (no installation-wide sender exists), e-mail logins for staff.
- **PR 2 · Stop promising what nothing does (2026-09-20).** From the audit's P0s.
  `docs/kb/08` quoted ￥399 and ￥899 a month, a 14-day trial, WeChat Pay, Alipay
  and 增值税专票 against **three orphan tables and no code at all**: nothing in
  `src/` reads or writes `subscriptions` or `payments` (the only grep hit is a
  sentence in the terms), both are empty in production, and the `core/billing`
  that migration 0013 refers to was never written. The tables are **left in
  place on purpose** — dropping one is a decision about a feature nobody has
  designed, and 0013 is applied everywhere, so editing that file would fail the
  checksum guard G20 added. The customer-facing article now says the price is
  not announced; `docs/kb/09` says self-serve export is not built and deletion
  is a person's work; `landing-zh.md` keeps its thinking under a NOT YET BUILT
  banner with its three untrue claims corrected (the ￥ figures, "export
  anytime", and a headline describing auto-send while the default is
  draft-first). `/data-deletion` no longer says the product removes anything:
  a person does, by hand, and the page says so in three languages — the old
  test pinned the SENTENCE "30 days", which read as assurance the promise was
  covered when the app role holds no `DELETE` on any table. And the boot now
  refuses without `LEGAL_CONTACT_EMAIL`: both public pages tell a buyer to write
  in, and with it unset the contact block rendered nothing at all.
- **D3–D7 · Four small truths (2026-09-20).** Each is something the owner met in
  his first days, from `docs/SITE-REVIEW-2026-09-18.md`. **D3:** the Customers
  page printed `conv.channel.email` and `conv.channel.messenger` at him as
  though they were words — two labels were missing and two others were spelled
  out in the renderer; all four now live in the catalogue, and a test walks the
  registry. **D4:** a reply HE typed was signed with his employee's name; the
  transcript now joins the sent row and labels by its `origin`, so his line says
  "You". **D5** (a refusal painted in the success colour) was
  deliberately left here and is closed by PR 3 below, which made the notice a
  key rather than text and gave it a tone. **D6:** My business said "Connected" and, two lines below, "until
  this is connected she cannot answer" — the line knew only active-or-not and
  now follows the lifecycle. **D7:** Getting ready said "Live — she is talking to
  real buyers" while she had never been started, on the very day every send was
  refused with "messaging is switched off"; `live` now requires `activated_at`,
  and a connected channel nobody started says exactly that.
- **Phase 2 · Her data, out and gone (2026-09-21, migration 0064).** The two
  audit findings that were promises rather than features. **CC-12:** there was
  no export at all — no route, no CSV writer, no `Content-Disposition` anywhere
  in `src/`. An owner who wanted to leave, or to answer their own customer, had
  to ask somebody with database access. Six subjects now download as CSV from
  `/app/settings/data`: buyers, messages, products, orders, quotes, contacts.
  Two things that writer gets right because every cell is text a BUYER typed —
  a cell starting `=`, `+`, `-`, `@` or a tab is marked as text, so
  `=HYPERLINK(…)` in a WhatsApp message is not a clickable link in her Excel,
  and a real number is still a number; and the file carries a byte-order mark,
  without which Excel on Windows renders 你好 as mojibake and the export is
  useless to exactly the customer it was built for. Every query runs inside
  `withTenantTx`, so RLS answers "whose data" rather than a `where` clause
  somebody can forget, and a test holds that no query names a password hash, a
  ciphertext column or the seven tables those live in. **CC-02:**
  `/data-deletion` told every buyer their records were "removed from Nomi"
  within 30 days. Nothing deleted anything. There is now a `deletion_requests`
  row, an owner-only page that makes one, and a withdrawal until somebody acts.
  It is a REQUEST, and the page says so: the app role holds no DELETE grant on
  any product table (`tests/integration/grants.test.ts`) and this did not move
  it. `tools/erase-workspace.mjs` does the erasing, as the migration role,
  refusing three ways — no open request, no matching business name typed, and
  dry-run unless `--yes`. It reads the live schema to order the deletes rather
  than carrying a list of seventy tables that would be wrong the week somebody
  adds the seventy-first, and runs in one transaction so it cannot leave half a
  workspace behind. `docs/DATA-DELETION-RUNBOOK.md` is the procedure.
  Found on the way: `suppressions` dates its rows `at`, not `created_at`; and
  the `channel_audit` action CHECK had twelve verbs a guessed list would have
  dropped — it was copied from the live constraint, not from memory.
- **PR 3 · Two pages nobody wrote, a list that named six countries twice, and
  a notice that lied about its own tone (2026-09-21).** Phase 1's third group,
  against `docs/AUDIT-2026-09-20.md`. **CC-19 / A13:** a mistyped address
  answered `{"message":"Route GET:/app/nope not found"}` in Fastify's English
  to an owner reading Arabic, and a thrown route answered the same way with a
  500 that could carry an internal message. Both are pages now, in three
  languages; the 500 says nothing but a reference that ties a report to one log
  line. They sit on the root instance, which also carries `/hooks/*` and
  `/health`, so both negotiate on `Accept` — Meta's retries and the uptime probe
  see exactly the JSON they saw before, and a 4xx a route threw on purpose is
  still the framework's to answer. **The country list:** `Intl.DisplayNames`
  names six superseded codes identically to codes in force (DY/BJ, HV/BF,
  NH/VU, RH/ZW, UK/GB, VD/VN), so the sign-up dropdown listed "Benin" above
  "Benin" with nothing to tell them apart and stored the same country two ways.
  The superseded six are dropped from the list and KEPT AS A READING:
  `canonicalCountry` maps each to its successor, `isCountryCode` still accepts
  them, and both write sites store the code in force — nobody who already
  answered is made to answer again. **A1 + D5:** the notice after a POST
  travelled as rendered text in ~70 `?flash=` redirects. It was spoofable (a
  link anyone can write, spoken in the product's voice), stale (translated by
  the request that POSTed, so switching language left it behind), and written
  into every access log, browser history and proxy — including sentences naming
  a buyer. It now rides a signed, HttpOnly, one-minute cookie carrying the KEY,
  and the page that draws it translates it. The tone came with it: one `.flash`
  class painted "Only the owner can do that" in the jade of a success. Which
  sentences are refusals is decided once, in `src/core/owner/flashTone.ts`, and
  a test holds every flash key in exactly one of the two lists — so a new
  sentence cannot ship without someone deciding how it looks. An unclassified
  key draws as a refusal, which is the right way to be wrong. Found on the way:
  one redirect hid its `flash=` behind a template expression and slipped a
  narrower version of that test; and `tests/integration/accounts.test.ts` picked
  its session cookie as "the first one that is not empty", which sign-up's new
  welcome notice quietly stole.
- **E1 · She reads the inbox (2026-09-20, migration 0062).** E-mail was
  send-only: the Google connection asked for `gmail.send` alone, and a buyer's
  mail landed in the owner's Gmail unread by this product — which its page
  promised, and which the owner found out by e-mailing her and getting nothing.
  Reading is now a grant she makes on purpose: a box beside Connect asks for
  `gmail.readonly`, and whether it was granted is read off what Google returned.
  With it, the minute sweep asks for mail newer than the last look, records each
  buyer's mail on his e-mail conversation with its subject, and queues the same
  turn a WhatsApp message gets; her answer leaves as "Re:" what he wrote, from
  the same mailbox. Never answered: her own mail and its aliases, and anything a
  machine wrote. A mailbox connected before this sends but does not read until
  connected again, and the page says so. **A minute's work still fits in a
  minute:** reading is network work sharing the sweep's budget with her sends,
  so reading happens in its own pass AFTER every send in the minute, every call
  is bounded (8 s), the whole read is bounded (10 s), at most three mailboxes
  are read a minute, and a read that stops halfway leaves its watermark alone — Gmail answers newest first, and moving the mark past mail it
  never saw would lose it. Caught by the suite: unbounded, one mailbox took the
  whole forty seconds and the follow-ups of every other business went nowhere.
  Google only; the reader is one module and Microsoft's would be its twin.
  **E1.1, the same morning:** within an hour of reading going live she answered
  Google's own "Welcome to Google Workspace" mail. `workspace-noreply@google.com`
  has the word in the MIDDLE of the name, which the first filter (anchored at
  the start) missed, and the mail carries no `Auto-Submitted` and no
  `Precedence` — only the unsubscribe header every bulk sender puts on. Machine
  mail is now recognised by the word anywhere in the name and by the headers
  that mean "sent to a list" (`List-Unsubscribe`, `Feedback-ID`,
  `X-Auto-Response-Suppress`), with a buyer writing from `replies@` or
  `sales.reply@` pinned as a person: a false positive costs a buyer his answer.
- **F1 · The pilot list is WhatsApp's list — at the door in, too (2026-09-19).**
  The day the owner started her, WhatsApp answered and Instagram did not. The
  worker's gate (`pilotFactsFor`) read the buyer's WHATSAPP identity for every
  conversation; an Instagram account, a Page visitor or an e-mail address has
  none, read as "not on the list", and was tagged `unlisted_number`, handed to a
  person and never answered — silently, on three of four channels. The send
  path had known since C4.a that the list is digits only and WhatsApp's alone;
  the door in did not. A conversation on another channel is no longer subject
  to it: a buyer there wrote first, a reply is only possible inside the
  platform's own window, and e-mail is limited by consent. WhatsApp keeps its
  list unchanged. Found from the turn record N1 added — no turn at all for the
  message, and two `unlisted_number` signals beside it.
- **T1 · How much she does on her own is the owner's choice (2026-09-19).** The
  evidence ladder was the only door: fifteen handled, twelve approved untouched,
  two spot checks and five days before "Hi there!" could go out without a tap.
  On his first real day the owner said an assistant that waits for approval on
  every message is not one — and it is his risk to weigh. The ladder stays as
  advice about what she has EARNED; her page now opens with what he has DECIDED:
  everything waits · she talks on her own and prices wait · she also quotes and
  negotiates inside his price rules. One press moves every capability the level
  means, writes only what changed, and records that he chose it. No level lets
  her confirm an order; a turn her rules hold still waits (the hold overrides
  the mode where the mode is read); numbers still come only from her engine; a
  violation still takes a capability back by itself. Owner-only. A waiting draft
  now points to the choice. New workspaces still start with everything waiting.
- **N6a.1 · A provider that thinks out loud (2026-09-19).** The day the owner
  switched to DeepSeek, one real call showed its answer arrives as a `thinking`
  block FIRST and the text second — and all four model adapters read
  `content[0]`. Every analysis would have been unparseable and every reply
  replaced by the stand-in sentence, silently. They now read the first TEXT
  block wherever it sits, and a provider selected by `LLM_*` is told not to
  think (`thinking: disabled`): the same one-sentence reply took 26 output
  tokens and 1.7 s instead of 115. Anthropic's pinned model is sent nothing
  extra, as before. Proven with the real analyser and reply writer against
  DeepSeek: a French question read correctly (language, 500 pcs, a price
  request) and answered in French with no invented price.
- **N6a · Another model provider, by configuration (2026-09-19).** A model is her
  fallback, and it may be whichever provider the installation pays for; the
  owner chose DeepSeek. Several providers speak Anthropic's message format at
  their own address, so this is not a second implementation: `LLM_BASE_URL`,
  `LLM_API_KEY` and `LLM_MODEL` — all three or none — point the one client
  somewhere else, for the analyser, the reply writer, the photo reader and the
  price-sheet reader alike. A half-set trio is no switch: a warning names the
  missing variable, never a value, and Anthropic stays. Everything that makes a
  reply safe sits after the model and does not care who it is. What does change
  is where buyers' messages are sent, which the privacy notice must say.
- **N2b.1 · She knows a product by its name (2026-09-19).** The shadow's
  disagreeing rows showed why she found no product where the model did: a search
  score is diluted by the rest of the buyer's sentence, while every word of the
  product's name is right there. Her own reading now goes by the name — whole
  name of exactly one product: that product, and sure; most of a name, or one
  word of the only candidate: a guess the buyer is asked to confirm; a score
  alone is still never "sure". Still a shadow. Rehearsal agreement on the
  product went from 46% to 11 of 12 turns, and on everything from 3 of 13 to
  7 of 12; the stage of a message that names no product is what remains, and
  the two labelled sets contradict each other there, so real traffic decides.
- **N2a · Her own understanding of a message, by rules, in shadow (2026-09-19,
  migration 0061).** The rules that decide a turn use only four things from a
  model's analysis — product, quantity, stage, complaint — and the language to
  answer in, so her own understanding is rules rather than a model
  (`core/conversation/understand.ts`; `null` means "I cannot tell", never a
  guess). It is computed beside the model's analysis on every analysed turn,
  compared field by field, stored on the turn, and read by nothing that decides
  one; a test counts the places that touch it. Two scoreboards: all but the
  three memory-dependent quantities agree on the 20 hand-labelled scenarios the
  rules were tuned on, and on the rehearsal through the real product search
  language, quantity and complaint agree fully while product (46%) and stage
  (23%) do not. Nothing stops asking a model on that evidence; N2b starts from
  the disagreeing rows.
- **N1 · Who answered each turn, and what it cost (2026-09-19, migration 0060).**
  The owner's direction: she answers on her own power and a model is the
  fallback (`docs/PLAN-OWN-POWER.md`). Nothing can be moved off a model honestly
  until each turn says what happened, so `turns` now records who WORDED the
  reply (nine paths; only `model` means a model wrote it), the turn's model
  calls and tokens, and whether the analyser's call bought anything. The label
  is set beside every branch that decides the words, so it cannot drift from
  the branch. `tools/answer-paths.mjs` reports it for the operator with an
  estimated cost — money with its currency, unknown rather than partial when a
  model has no listed price — and Results tells the owner how many replies came
  straight from her rules and teaching. One tested sum feeds both. Turns from
  before 0060 are counted apart, never as free.
- **A3.1 · The code is sent over HTTPS where the host blocks SMTP (2026-09-19).**
  The first real sign-up with codes on answered "we could not send the e-mail".
  The mailbox, alias and app password were right; Railway's Hobby plan blocks
  every outgoing SMTP port, which A3 never checked. The installation's mail now
  goes first through the operator's connected mailbox over the provider's HTTPS
  API — only the mailbox named as `SYSTEM_SMTP_USER`, only in the operator's own
  workspace, sent from the `SYSTEM_SMTP_FROM` alias — with SMTP as the fallback.
  A business's own mail keeps its verified-domain check; only system mail, which
  can carry a subject and a text to one address, skips it. A send that fails now
  says why in the log for each way tried, never the address or the code: the
  failure that prompted this was silent, and had to be inferred from a response
  time.
- **A5.4 · She hands one buyer to another assistant (2026-09-19).** Who answers
  is decided when a conversation starts; this is the only other writer of it.
  On the conversation page, once there is more than one assistant, the owner
  sees who answers and can change it — only someone still on the team can be
  chosen, a finished conversation offers nothing, and saying it twice writes no
  second line. It changes who SPEAKS and nothing about what may be said, and it
  is recorded in the conversation's own history with who did it. Owner-only,
  through the same gate as the team page. **Known limit:** messages already
  sent are labelled with whoever answers now; a message does not yet remember
  which assistant wrote it.
- **A5.3 · The reply writer knows who is speaking, and for whom (2026-09-19).**
  Every reply was written by "a business representative for a Yiwu, China export
  trading company" — for an agency in Casablanca too. The three instruction
  files now assume nothing about the business; what it is comes from what the
  owner said (name, kind, country, what it sells), and who the writer is comes
  from the conversation's assistant: name, job, and her own note on how this one
  should sound, which the team page now asks for. A key is present only when she
  said something. It shapes tone and focus and is never a source of facts: the
  guards run on the output as before, a number in her note stays unsayable, and
  only a digit inside the assistant's or the business's NAME is sourced — hers
  the way a closure's label is — so signing off cannot fail the guard. Who
  answers is now also set on the repository's own create path, not only where a
  channel message arrives.
- **A5.2 · Her name is the business's, on every page (2026-09-19).** The name
  was one constant per language, filled into every sentence that says `{name}`
  — about 150 of them — so a renamed assistant was still "Lily" everywhere. The
  name is now a fact about the request: the main assistant's on a page about
  the whole business, the conversation's own on a page about one conversation
  (even one since removed — a conversation she held still names her), and the
  same on the alert to the owner's phone and the buyer's proof page. The
  catalogue stays pure, so the web layer wraps it (`src/api/web/say.ts`); the
  scope opens on `preHandler`, because one opened before the body is read is
  gone by the time a form's handler runs. Remembered a minute per business and
  forgotten on a rename. An account that never renamed anyone reads exactly as
  before; the main assistant is named in the language she was browsing in when
  it was made. Fixed on the way: five save messages were handed the
  installation's one configured name, so English pages said "小雅".
- **A5.1 · More than one assistant: name, job, channels (2026-09-18, migration
  0059).** A business asked for several assistants for different reasons. v1, as
  decided: they differ by name, job (sales, support, after-sales, other) and the
  channels they answer on; what is sold, what was taught, price limits and what
  may be done alone stay the business's, so nothing here can widen what a buyer
  may be told. The assistant she always had becomes the main one, made the first
  time the team page is opened and carrying the same name, and it answers every
  channel nobody else was given. A channel has one answerer. Who answers is
  decided once, where a conversation is created, and written on it; a
  conversation from before keeps a blank, read as the main one. Removing one
  archives it and hands its open conversations back; the app role cannot erase
  one. Owner-only, by the same rule as adding a person.
- **A3 · A code by e-mail, at sign-up and on a new browser (2026-09-18,
  migration 0058).** A password does not prove the address is hers, and does not
  stop someone who learned it elsewhere. With a sender configured
  (`SYSTEM_SMTP_*`), sign-up sends six digits and WAITS: the whole sign-up —
  her answers and the password hash, never the password — sits in
  `login_codes`, and nothing becomes a tenant, and no invitation is spent, until
  the code comes back. Signing in with the right password from a browser we
  have not seen for that login asks for a code too; a signed 180-day cookie is
  what "seen" means. Five tries and ten minutes per code, six codes an hour per
  address — counted in the database, where a restart cannot reset them; the
  application role cannot read the table. **Without a sender nothing asks for a
  code**, so this shipped before the mailbox exists; and a sender that is DOWN
  lets an owner with the right password in rather than locking every business
  out. The installation's sender is its own small thing, never a business's
  outreach path: no consent gate, no unsubscribe header and no domain check
  apply to it, so it can carry only a subject and a text to one address.
- **A4 · The team page says who is here now (2026-09-18, migration 0057).** The
  account's admin asked who works there and who is signed in. There is no
  session store to ask, so it is read off what people do: the once-a-minute
  check S1 added records when it ran. "Online now" is "seen in the last five
  minutes", said in words; the page also says how each person gets in.
- **A2 · Sign-up asks about the business, and nothing says "factory" (2026-09-18,
  migration 0056).** Nomi was built for one factory and said so everywhere. It is
  for any business that talks to buyers on social channels, so sign-up now asks
  which KIND — manufacturer, trading company, wholesaler, brand, retail, agency,
  services, other — what it sells, its country, website, team size and where
  buyers write today. What it sells becomes the profile description, so the
  first setup step arrives half done. The answers live on the business row and
  are checked twice (the form's validation and the column checks); kind, country
  and website are hers to change under Settings. With eight kinds a word per
  kind is not workable, so the copy went neutral in all three languages —
  "business" / 公司 / شركة for her, "the company" for a buyer on the proof page —
  and a test now fails if any sentence says "factory" outside the one category
  that is one. A tenant is still made in one place: a NEW definer function,
  `provision_workspace`, because the app and the schema deploy seconds apart
  and the old name must keep answering the old code. Found on the way: this
  app's form reader keeps only the LAST of a repeated field name, so ticked
  boxes must each carry their own name.
- **D1 · Her answer for everything covers everything it can (2026-09-18).**
  The first thing every new business hit: she pasted a price list, answered
  "what is the least you would accept?" once for everything — as the page
  invites — and her catalogue stayed switched off, every product reading "Needs
  a price" beside its price, with the per-product forms gone. Only a SINGLE
  product's answer ever switched a product on. Now her general answer switches
  on exactly what she has not decided about: priced, same currency, not below
  her floor, no answer of its own, untouched since import. A later import
  arrives ready where that answer already covers it (M29 stands: a human stated
  the floor; the import still writes no rule). The badge has four states instead
  of one lie, the list says once where to go, the import's message is finally
  shown, and the products her answer covers stay on the price page with a way
  to give one its own.
- **S1 · Removing someone signs them out (2026-09-18).** The session is a
  stateless signed cookie that lives seven days, and nothing looked at
  `people.archived_at`: someone she removed could read and answer buyers for a
  week. Every `/app` request now asks whether the person behind the cookie
  still works there — once a minute at most, and at once in this process after
  a removal (the remembered answer is dropped in the same request). A password
  change ends every other session she has open: a session carries WHICH password
  opened it (the row's own timestamp, compared for equality — the process and
  the database do not share a clock), and the page she is on is re-issued one.
  If the question cannot be asked the owner still gets in and nobody else does,
  the same two directions of failure as at the door. The Remove button now asks
  first, in a sentence that says they are signed out now. Found by the source
  audit in `docs/SITE-REVIEW-2026-09-18.md`.
- **WhatsApp receives in production (2026-09-18).** The missing number was
  never a number problem: this developer account is simply not offered the
  WhatsApp product. What worked instead is written down as §8 of
  `docs/META-CLOUD-API-SETUP.md` — an account created from Business settings
  with a Meta-issued number, a fresh app that does list the WhatsApp
  permissions, everything in one portfolio, the generic Webhooks product, and
  a published app. `WHATSAPP_PROVIDER=meta`; the boot log names all three
  channels. Replying on WhatsApp still waits on the pilot workspace's own
  activation checklist, which is empty — by design, not a defect.
- **Model moved to Haiku 4.5 (2026-09-18).** The owner's call, on cost: about
  a third of Sonnet's price per buyer message. The pin in `src/llm/anthropic.ts`
  says what the trade is — no figure or claim can be invented, because those
  are gated downstream; a sentence can be worse — and the LEARNING-PLAN's
  "would you send this?" row is the test that decides whether it holds.
- **Buyers by name (2026-09-18).** The first Instagram and Page buyers were
  "Buyer": those webhooks carry only a scoped id, and nothing asked for a name.
  The adapters now offer `nameOf` — the profile lookup the Page token is
  allowed once it holds the messaging scopes (Messenger: first and last name;
  Instagram: the profile name, else `@handle`) — asked only when it would fill
  a blank, outside the tenant transaction, and never able to stop a message.
  The buyer's page gained a **Name** field: hers wins over the channel's, empty
  is an honest "Buyer" again, and the change is on the conversation's record
  with who made it (`buyer_renamed`).

**X (Twitter), researched and not built.** Its DM API is real but a poor fit
today: X closed its flat tiers to new customers in February 2026 and charges
per call, DMs may only be sent to people who have consented to receive them
(so it is reply-only in practice, like these two), and the webhook side needs
access this project does not have. It also needs an X developer account, which
is the owner's to create. Revisit when a factory actually asks for it.

#### C10 — Connect your own Page and Instagram (0054) ✅ BUILT 2026-09-18

Built the day it was planned, on the owner's go. What landed, against the plan
below: `meta_accounts` (0054) holds the Page's own token encrypted, one live
row per business and one business per Page; `src/channels/meta/connect.ts` is
the login — dialog, signed state (the user token rides in it encrypted for the
one round trip a choice of Page takes), code → long-lived user token → the
Page's token and its Instagram account, `subscribed_apps`, then the credential
rows that route; the outbound worker reads the business's row inside the same
transaction as the send, so a disconnect takes effect on the next reply; a
token Meta refuses (401) is recorded once and the page asks for a reconnect;
the name lookup uses the business's own token. The two webhook routes now
mount for the app secret alone, because a Page connected through the dialog
must be able to deliver before any account is in the environment. Operator
setup (redirect URI, login configuration, two variables) is in
`docs/META-SOCIAL-SETUP.md`; the gate for strangers' Pages is still App Review.

*The plan as written that morning:*

**Why.** Today the Instagram account and the Page nomi answers from are the
host's, set in the environment (`META_PAGE_ID`, `META_IG_ACCOUNT_ID`,
`META_PAGE_ACCESS_TOKEN`): every reply on this installation goes out as
*Nomi does*. A business that signs up must be able to press **Connect**,
choose *its* Page and Instagram, and have every reply leave as itself —
without pasting a token, and without anyone at Nomi touching its accounts.

**What is already in place.** Inbound routing needs nothing new:
`resolve_tenant(channel, external_ref)` already finds the business by the
Page or Instagram id the credential row names, and `connectMetaChannel`
already writes those rows. Sending is already per business
(`adaptersFor(businessId)` — e-mail leaves through the mailbox each business
connected, C6). The encryption helpers and the `mail_accounts` shape (a
long-lived token per business, encrypted with `CREDENTIAL_KEY`, key version
recorded, `needs_attention` when it dies) are the pattern; Meta gets the same.

**The build, ~2 days.**
1. Migration 0054 `meta_accounts`: business, Page id, Instagram id, the Page
   token encrypted, key version, who connected it and when, `needs_attention`.
   `channel_credentials.secret_ref` points at the row (`meta_accounts:<id>`)
   instead of `env:META_PAGE_ACCESS_TOKEN`.
2. Facebook Login for Business, mirroring C6's mail connect:
   `/app/connect/meta/start` opens Meta's dialog (a login *configuration* on
   the app carrying the seven scopes from `docs/META-SOCIAL-SETUP.md` § 6);
   `/app/connect/meta/callback` exchanges the code for a long-lived user
   token, reads `/me/accounts`, lets her pick the Page when she has more than
   one, takes the Page's own token and its `instagram_business_account`,
   subscribes the Page to the app (`subscribed_apps`, `messages`), stores the
   row and writes both credential rows. One press, no token seen by anyone.
3. `adaptersFor(businessId)` builds the Instagram and Messenger adapters from
   the business's row (decrypted per job, never held), with the environment
   as the fallback for an installation that has no row — this one, today.
   The name lookup (`nameOf`) uses the same token.
4. The accounts page shows the connected Page and handle by name, with
   Disconnect (revokes the subscription, keeps history) and Reconnect when
   the token dies — `needs_attention`, as for a mailbox.
5. Tests as C6 has them: the OAuth round trip against a fake Meta, a business
   whose reply leaves with *its* token, two businesses whose Pages route to
   their own inboxes, a dead token that says so.

**The gate that is not ours.** Until Meta grants **advanced access** to the
seven scopes (App Review) and verifies the *Nomi does* business, Connect
works only for accounts that hold a role on the app — which is enough to
build it and to record the screencast the review requires. Start the review
the day the flow exists; it is measured in weeks, and nothing else on the
roadmap waits on it.

#### C8 — a message is never sent twice by a machine (0052) ✅ BUILT 2026-09-16

`migrations/0052_uncertain_sends.sql`, `src/outbound/uncertain.ts`, the
'uncertain' status, and the card she answers on the conversation.
`REQUIRED_SCHEMA_VERSION` 52.

- **The defect, stated by the code that caused it.** `SENDING_RECLAIM_MS` said
  a row stuck in 'sending' should be re-queued after two minutes, because "a
  rare duplicate send is the accepted cost of never losing a message". The
  worker marks 'sending', calls the provider, records the answer; a crash or a
  deploy between the second and third step leaves a message that may already be
  on a buyer's phone. It was then sent again.
- **The trade was the wrong way round.** A buyer who receives the same price, or
  the same first e-mail, twice learns something false about the factory — and a
  machine chose it for her in the one case where nobody could say what had
  happened. Losing the message is not the alternative: the row stops as
  'uncertain', she sees her own words with two answers ("he did not get it —
  send it" / "leave it"), and nothing happens until a person chooses.
- **No provider can settle it in general.** WhatsApp will not answer about a
  message whose id we never received; SMTP has nothing to ask. Where a receipt
  does arrive later it is still believed — 'uncertain' is ranked with 'sending'
  and is not terminal — so she is spared the question when the answer turns up.
- **It does not block the conversation.** An uncertain row is out of the
  pipeline until she decides, so the sequencer steps over it: one unanswerable
  question must not leave a buyer with silence behind it.
- **Her decision is a claim, not a toggle.** The update moves the row only from
  'uncertain', so a double click, or a colleague on another screen, decides
  nothing twice. "Send it" produces an ordinary queued row that meets the gate
  again — the hours it waited may have closed the window or brought a
  suppression. The write lives in `src/outbound/uncertain.ts`, not in the
  refusals read model, which a parity test holds to reading only.

#### C7 — her own mail provider, over SMTP ✅ BUILT 2026-09-16

`src/channels/email/smtp.ts`, `src/channels/email/smtpTransport.ts`, and the
`SMTP_*` settings. No migration: this is a third transport behind the same port,
not a new path.

- **Why.** C6 sends as her through Gmail or Outlook, at roughly $6–7 per factory
  per month. Every other mail host on earth speaks SMTP submission, so a factory
  on Zoho, Fastmail or its own server can now send without registering anything
  with Google or Microsoft — and the first factory's own bill drops to about a
  dollar a month.
- **A provider, not a second send path.** It is a `MailTransport` like the
  others: the same gate, the same unsubscribe headers, the same one worker, the
  same MIME builder as C6. `SMTP_*` set OUTRANKS a connected mailbox, because an
  operator who names a server means that server, and the accounts page says so
  rather than showing a Gmail row that no longer sends.
- **It will not send her password in the clear.** Port 465 connects wrapped;
  anything else must offer STARTTLS or the send is refused rather than
  downgraded. The one exception is a relay on the same machine, which is also
  what makes the whole conversation testable against a real server.
- **SMTP's codes mean the opposite of HTTP's** — 4xx temporary, 5xx permanent —
  so the retry decision is inverted from every other transport in the product. A
  wrong password is permanent on purpose: retrying one locks the account.
- **The domain rule belongs to the domain, not to Gmail.** `SMTP_FROM` off the
  verified sending domain is refused on every send, exactly as a connected
  mailbox off the domain is.
- **What SMTP cannot do, said plainly:** no provider metadata channel, so
  `MailMessage.tag` cannot ride along and bounces arrive as ordinary mail in her
  mailbox rather than as signed events. Her buyers' way out is unaffected: the
  List-Unsubscribe headers are part of the message.
- **Hand-rolled on node's own primitives,** like the DNS check, the MIME
  message, OAuth and every webhook signature here — no dependency added to the
  process that holds her buyers' data.

#### After C6 — what the last check found (0051) ✅ BUILT 2026-09-15

A final read of Block C against the code, before calling it done, found five
things that would have failed a real factory. Migration 0051,
`src/outbound/domainCheck.ts`, and `docs/EMAIL-SETUP.md`.
`REQUIRED_SCHEMA_VERSION` 51.

- **A sequence would have kept writing to a man who had answered.** C4.b stops
  on a reply the product *records*. Since C6 her mail leaves through her own
  mailbox and his answer lands there, unread, so `repliedSinceEnrolment` could
  never become true: the one thing a sequence must never do, made certain.
  Now `decideStep` takes `repliesObservable` — required, the composition root
  says `false` — and where replies cannot be seen every follow-up (never the
  first mail) waits for a person: "Waiting for you" on the sequence page, a line
  saying his answer would be in her own inbox, and **No answer yet — send it**,
  recorded with the person's name. Nobody pressing it for `MAX_HOLD_DAYS` stops
  the enrolment `unconfirmed`. It is asked after the refusals that end a
  sequence (nobody releases a mail that could never go) and before her cap and
  domain holds; releasing resets the hold clock. A stale page releases nothing:
  the button carries the step it was shown for. Today counts the waiting ones.
- **The domain check lapsed on its own after a week.** Only her "Look again"
  button renewed it, so a week after setup every follow-up was held and a week
  after that stopped, for a reason she had done nothing to cause. The sequence
  cron now looks first — daily after a pass, hourly after a failure — through the
  same function as her button, and it can only record what DNS says.
- **An Outlook app registered for "this organization only" could not
  connect.** Microsoft refuses such an app at `/common`, which is what a factory
  registering inside its own Microsoft 365 naturally creates.
  `MICROSOFT_OAUTH_TENANT` sends the requests to her own tenant.
- **An expired app secret would have asked her to reconnect, forever.** A
  provider's `invalid_client` (Entra secrets always expire) was read as her
  token being dead: her mailbox was marked "Needs you", and connecting again
  failed the same way. It is now `app_refused`: her row is untouched, the mail
  is refused naming the secret, and connecting tells her it is the
  installation's to fix.
- **Nobody could have set e-mail up from the docs.** `docs/EMAIL-SETUP.md` is
  the operator's and owner's path, from the Google Cloud project or Entra app to
  the DNS records to the first follow-up.

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

### BLOCK G · Finish what was marked built ✅ DONE (2026-09-10 → 2026-09-12)

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

#### Found while planning C4 — fixed 2026-09-12 (0045)

**Her "check my domain" button raised a 500, in production's own
configuration.** G14 gave the SPF answer a fourth state, `no_sender` — her
record is fine and we cannot confirm it until a sending provider exists — so
the page would stop telling her to fix DNS that was already correct. The type
gained the value and the CHECK on `sending_domains.spf_state` did not.
`SENDING_SPF_INCLUDE` is unset in every production today, so `checkSpf` returns
`no_sender` for every well-formed record and `recordDomainCheck` writes it
unconditionally: a constraint violation on an owner action, in the one
configuration nothing tested. The existing suite always passed an include, and
so never produced the state the column refused.

0045 widens all three state columns to the code's own vocabulary — they share
one `RecordState`, so a column accepting a subset is the same defect waiting on
a different record — and `RECORD_STATES` is now an exported array that an
integration test compares against the constraints, so the type and the column
cannot drift again. The regression test runs the configuration production runs
in: no include, a correct record, and the check recorded rather than thrown.

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

### BLOCK C · The outbound engine ✅ DONE except C4.d (2026-09-15)

#### Block C in detail — built offline, plugged in at M52

The correction that reshaped this plan: **most of Block C needs no credential
at all.** It was deferred as "blocked", and it is not.

| # | Milestone | Credential needed to BUILD |
|---|---|---|
| C1 | **M38 contacts, consent, suppression** ✅ BUILT | None. Schema and owner surfaces. |
| C2 | **M39 channel capability registry** ✅ BUILT | None — it is the thing that TELLS the owner what each channel can do. |
| C3 | **M42 the outreach gate** ✅ BUILT | None. `gateOutbound` learns four refusals over C1 and C2. |
| C4 | **M40 email from her own address** ✅ BUILT — M40.1, M40.2, C4.a, C4.b, C4.c; C4.d (per-channel activation) deferred until the pilot is live | Only the final send. The sequence engine, the SPF/DKIM/DMARC verification, one-click unsubscribe writing to `suppressions`, bounce and complaint handling — all offline. |
| C5 | **M41 Apollo behind a connector** ✅ BUILT (live call unverified until M52) | Only the live call. The connector, the enrichment surface and the rule that 小雅 may never SPEAK enrichment are testable against a fake. |
| C6 | **M50 the connect surface** ✅ BUILT (WhatsApp paste path deferred with C4.d; providers unverified until M52) | Only the OAuth handshake. The page, and M39's registry rendered on it, are what the owner reads BEFORE she connects anything. |

Built in that order, each one ships with "not configured" as an honest state —
the same shape M34 and M37 already use. When M52's credentials arrive they are
pasted into a product that already knows what to do with them.

### BLOCK E · Go-live

`FIRST-FACTORY-WORKFLOW.md` §4 onward: rotate secrets, prove the backup
restores, allowlist, activation. Everything here is procedure, not code.

---

## 2b. The queue after the audit — written 2026-09-24

The audit of 2026-09-20 (`docs/AUDIT-2026-09-20.md`) set six phases. Three
are done. What remains stands in this order, with two milestones added on
2026-09-24 (**V1**, **V2**). **The order is the decision.** Nothing here is
started early because it looks small, and nothing is started before the row
above it has shipped.

| # | What | Stands |
|---|---|---|
| Phase 1 | Stop saying untrue things | ✅ 2026-09-21 |
| Phase 2 | Her data, out and gone (0064) | ✅ 2026-09-21 |
| Phase 3 | The IA restructure (`docs/IA-PROPOSAL.md`): A9, B + C, D | ✅ PRs #44, #46, #54 (2026-09-21 → 23). **A** remains, below |
| — | The usability script (`docs/USABILITY-SCRIPT.md`) | The owner runs it before A. What stalls feeds V1 and A |
| **V1** | **The visual design pass** — a design system for the app | Before A, so the merged list is styled once |
| Phase 3 · A | Merge Buyers into Customers, keep the name "Buyers"; search and paging | After V1, in its language |
| **V2** | **The calendar view** — a timeline over dates the data already holds | After V1 (its language) and after A (its rows link into the merged buyer surface) |
| Phase 4 | Permissions and first-run | |
| Phase 5 | nomidoes.com, the marketing site | |
| Phase 6 | Billing, then Meta Tech Provider review | M52 stays last, always |

V2 sits after A rather than straight after V1 because its entries are per
buyer and open the buyer's conversation; building it against a list that A is
about to replace would style and link it twice. Moving it later costs
nothing; moving it earlier does.

### V1 — The visual design pass · QUEUED, before A

Everything so far has been structure. M49 fixed the measure, the rhythm and
the two voices; Phase 3 fixed where things live. Nothing has yet been
*designed*. V1 is a real design system for the app: a typography scale, a
spacing scale, colour, density, and the component styles — buttons, inputs,
cards, list rows, chips, the notice, the empty state, the nav — drawn once and
used everywhere.

**Who does what.** Symow is the UI/UX lead. He directs the look — references,
the type, colour, how dense each screen is, what a row looks like — and
decides. Claude Code implements: tokens, components, the tests that hold them,
and screenshots for his review at every step. The plan assumes that split; no
visual decision is made by the implementer and then defended.

**The target.** Genuinely minimal and purposeful. No decorative density; and
no page so bare that its purpose is unclear — a page must say what it is for
without a sentence explaining it. The inbox specifically reads as **one list
of messages, each row tagged with its category**, not a set of panels.

**What is already there and stays.** Tokens are defined once
(`src/core/owner/tokens.ts` → `cssVariables` in `src/core/owner/css.ts`, named
by value) and every page draws from them through `src/api/web/layout.ts`; a
state colour needs a state-named class (`tests/parity/shell.test.ts`); the
two-voice rule — serif only for what a person said — and the one-measure
layout test are M49's; Playwright screenshots at three widths and three
locales are G17's. V1 changes the values and grows the set. It does not add a
second way to style a page.

**What V1 has to answer** — Symow's decisions, written down before code:
1. The type scale — and, separately, how Arabic and Chinese sit on it: the
   three scripts do not share an x-height or a comfortable line-height, and
   the scale is tested in all three, not in English and then translated.
2. The spacing scale and the density per surface: lists dense, forms open,
   reading pages narrow.
3. Colour: ink and paper, one accent, and the state colours (waiting, refused,
   done) — spent on state only, as M49 decided, in light and dark.
4. The component set, each with its states: rest, hover, focus, disabled, and
   mirrored for RTL.
5. The row: what a message row shows — who, when, the category tag, one line
   of preview — and what a buyer row shows.

**Decided 2026-09-24** (`docs/DESIGN-V1-BRIEF.md` §8): 1 type, 2 spacing and
density, 3 colour (dark mode out of V1), 4 components — by Symow. **5, the
row, is deferred until after the usability session**; the inbox step waits
behind it.

**Order within V1:** decisions → tokens → the components on one owner-only
page under Setup, so every state is reviewed and screenshotted in one place →
the shell → the inbox → the rest, page by page. Each step is a PR against the
verification set, with screenshots for Symow before it merges.

**Why before A.** A merges two lists into one, with search and paging. Styling
that list twice — once as it is, again after V1 — is the waste V1 is placed
here to avoid.

**Rules it inherits:** three locales, RTL, every surface; owner language only;
tests assert structure — tokens, classes, provenance — never literal CSS
values; no colour that is not a token; inline CSS comments ship to the
browser and are scanned like copy.

### V2 — The calendar view · QUEUED, after V1 and A

A filtered timeline over dates the data already holds, per buyer: sample
requests, follow-ups, shipping, negotiation milestones, the factory's
closures. **A view, not a new data model.** Filterable by category. Built in
V1's language, after A, because each entry opens a buyer.

**Dates that exist today**, by category — every one already a column (read on
2026-09-24):
- Samples: `sample_requests.requested_at`, `handled_at`.
- Orders: `orders.confirmed_at`; each state change in `order_updates.at`
  (confirmed, in production, shipped, cancelled), with its tracking reference.
- Negotiation: `quotes.created_at` (a price was given);
  `handoffs.sla_deadline_at` (a person owes a reply by then); the reply window
  per conversation (`src/core/channel/window.ts`).
- Follow-ups: `sequence_enrollments.next_due_at` — the outreach area only, so
  only where that area is on.
- Closures: `factory_closures.starts_on` → `ends_on`.
- Conversations: `conversation_state.last_message_at`, `conversations.closed_at`.

**What does not exist, and V2 does not add:** a promised ship date, a sample
deadline, a next follow-up on a buyer outside a sequence. Each would be a new
column — a data-model change and a separate decision, taken before V2 or not
at all. V2 shows what happened and what is due from what the product already
knows, and never invents a date (§3: no invented numbers).

**Shape.** One route in the Buyers hub; one list of days; each entry a date, a
category tag (the same tags V1 gives the inbox rows), the buyer, one line, and
a link to the conversation. Filters: category, buyer. Default range: the past
week and the coming two. Every read inside `withTenantTx`. No writes, no job,
no table.

**Tests:** every entry names the row it came from (provenance, not a
summary); a category filter excludes exactly the other categories; another
tenant's buyer never appears; three locales, RTL, the empty state.

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
