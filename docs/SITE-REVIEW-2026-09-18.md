# Site review — 2026-09-18

A walk through the live owner site (`app.nomidoes.com`) as a brand-new factory
owner would meet it, done while setting up a demo factory ("Westlake Canvas
Co.", five canvas-bag products) in the pilot workspace. Every finding below was
seen on the running site; where a source line is named it was checked in the
code. A second pass over the renderers' source is in the section at the end.

Nothing here is a judgement on the product's rules — the gates (draft-first,
price floors, the activation checklist) behaved exactly as designed. These are
the places where an owner gets lost, misled, or has to be told what to do.

## Defects — the page says something untrue or drops something

| # | What she sees | Where | Fix | Effort |
|---|---|---|---|---|
| D1 ✅ | **Imported products are silently switched off, and the badge lies about why.** *(fixed 2026-09-18)* After *Confirm & add* the list shows every product as "Needs a price" although each has one; the checklist keeps saying "Add at least one product with a price". The real cause: *Offer this to buyers* is unticked on each product, one page deep, one product at a time. Five products took five visits. | `src/api/web/products.ts` (import + badge), product detail form | Activate priced products on confirm (she already confirmed them), or add "Offer all 5 to buyers" on the list; make the badge say what is actually missing. | M |
| D2 ✅ | **The import's result message never appears.** *(fixed 2026-09-18)* The confirm step redirects to `/app/products?flash=…` and the list page does not read it, so "Added 5 products…" is lost. | `src/api/web/app.ts:1240` — the list route ignores `flash`; the detail route takes one | Pass the query flash to `renderProductList`. | S |
| D3 | **Raw keys on the Customers page**: `conv.channel.email` and `conv.channel.messenger` are printed as text. | `src/core/owner/i18n/messages.ts` ~477 — labels exist for wechat/rednote/webhook_test, not for `email` or `messenger` | Add both keys in en/zh/ar; add a test that every `CHANNEL_REGISTRY` kind has a label. | S | ✅ **Fixed 2026-09-20.** All four registry kinds have a label; the renderer reads the catalogue instead of spelling two out.
| D4 | **Her own typed replies are signed "Lily".** In a conversation she took over, "hello sir — Today 14:28 · Lily" is a message the owner typed. | conversation transcript in `src/api/web/inbox.ts` | Label by `origin`: owner → "You" (or the person's name), employee → Lily. | S | ✅ **Fixed 2026-09-20.** The transcript joins the sent row and labels by its `origin`: his line says "You".
| D5 | **A refusal is painted as a success.** "Not sent — messaging is switched off…" arrives in the green success banner. Same for "Not sent — you can't message this buyer right now". | one `.flash` style for every outcome | A second style for refusals, chosen by the route that refuses. | S–M |
| D6 | **My factory contradicts itself about WhatsApp.** The card reads "Connected — Ready", and two lines lower "Until this is connected, Lily cannot receive or answer a buyer." The readiness list under it showed "Add at least one number" as open while a number was on the list. | `src/api/web/factory.ts` | Show the "until connected" line only when it is not; derive the three readiness lines from the same precheck the activation uses. | S | ✅ **Fixed 2026-09-20.** The line follows the lifecycle: connected-but-not-started says so.
| D7 | **Getting ready says "Live — Lily is talking to real buyers"** under *WhatsApp setup* while messaging has never been started. | `src/api/web/pilot.ts` readiness section | "Live" must mean activated, not "provider configured". | S | ✅ **Fixed 2026-09-20.** `live` now requires `activated_at`; a connected channel nobody started says "not started".
| D8 ✅ | **Price limits: the per-product forms vanish once the general answer is saved** *(fixed 2026-09-18)*, while the page still promises "You can set a different answer for any single product below." | `/app/factory/prices` | Keep the product list, collapsed, after the general rule exists. | S |
| D9 | Chinese full-width colon in English: "Last contact：", "Hired：". | i18n strings or a shared label helper | Locale-aware separator. | S |
| D10 | The holder of a conversation is named "Pilot Factory" — the owner *person* still carries the workspace's first name after the company was renamed. | people / profile | Let her name herself on the profile; default the badge to "You". | S |

Two found earlier the same day, already recorded in `docs/EMAIL-SETUP.md`:
saving the sending-domain form resets a passing DNS check, and the SPF check
does not follow a registrar's wrapped `include:`.

## Friction — true, but harder than it needs to be

1. **Four items in the menu, fifteen pages behind them.** Channels, Contacts,
   Follow-ups, Find buyers, Results, Practice, Settings and People are reached
   only through links inside other pages (Channels only from "Manage the
   connection" at the bottom of My factory; Results only from "How the month
   went" on Today). Owners will not find them twice. A fifth menu entry
   ("Reach buyers": channels, contacts, follow-ups) and a Settings entry would
   cover it.
2. **Getting ready is seven pages in one.** Setup checklist, go-live
   confirmations, pilot counters, a practice tracker, "after conversations",
   history, WhatsApp technical status and the installation's version. Keep the
   checklist and the confirmations; move the rest to where it belongs.
3. **Three names for one thing**: "Sandbox check", "Practice", "Trust
   validation" (and "rehearsal" in the docs). "Sandbox check" also appears twice
   on the same page. Pick "Practice".
4. **Words from the machine room on her page**: "Access key", "App secret",
   "Callback password", "Connection version", "Secrets rotated", "Backup
   tested". The last two ask her to vouch for things only the operator can do.
   They belong to whoever runs the installation, not to the factory owner.
5. **One dollar floor for everything she sells.** "What is the least you would
   ever accept for one of these? (US$)" is asked once for products from $0.48
   to $1.65. A floor as a share of each product's price is the only general
   answer that means something; the dollar floor fits per product.
6. **Buyers list tells her less than Customers.** No channel on the row (it is
   on Customers), no unread mark, no search; all three rows read the same
   "Held by …". With four channels live, the channel is the first thing she
   needs.
7. **The conversation page hides the conversation.** The reply box and buttons
   come first, the transcript below, oldest first — the newest message is under
   the fold, there is no delivery state on her own replies, and nothing
   refreshes; she reloads to see an answer.
8. **Teaching gives no receipt.** After *Teach* the page reloads at the top of
   a long page with no message; the form is at the very bottom. "Most-asked"
   lists test chatter glued together ("Hello Sent test ×1").
9. **Machine SKUs up front**: "NEW-mu7040xb-0" beside every product name.
   Hide it unless she typed one.
10. **Page titles**: "Lily · Lily", and "My factory · Lily" for the price page.

## What worked well

- Paste-a-price-list → review → confirm read five messy lines perfectly, showed
  each line beside what it read, and added nothing before she agreed.
- The safety practice (25/25) explains in her words what it proves and what it
  does not.
- Refusals always name a reason and a next step ("Start Lily in My factory and
  send it again") — the wording is right even where the colour is wrong.
- Contacts states why each person may or may not be written to, per channel.
- Three languages switch in place and return to the same page.

## The demo factory left in the pilot workspace

Profile "Westlake Canvas Co.", Hangzhou; five products, all offered to buyers;
a general price limit (floor US$0.40, at most 10% off, ask above 5%); one
taught fact (lead time); certifications "we have none"; practice 25/25; the
owner's WhatsApp number added to "Who Lily may message". Left for the owner:
the three go-live confirmations and starting Lily.

## Source pass — read from the renderers, not run

A second pass read every renderer in `src/api/web/`, the shell, the tokens and
the three-language copy. It confirmed D4, D5 and the domain-form reset at their
source lines, and found the following that the walk could not see. Items marked
**verified** were re-checked by hand afterwards; the rest are as read.

### One security defect

**S1 · Removing a staff member does not sign them out — verified. ✅ FIXED 2026-09-18** (every workspace request now asks whether the person still works there, at most once a minute and at once after a removal or a password change; the Remove button asks first and says so). The session
is a stateless signed cookie that lives seven days
(`src/api/web/session.ts:25`), and no request path looks at
`people.archived_at` (`src/api/web/app.ts` never names the column). *Remove*
only archives the row (`src/api/web/people.ts:182-195`), with no confirmation.
Someone who left can read and answer buyers for up to a week. Fix: for a
non-owner session, check the person row is unarchived (one cached query a
minute is enough), and make the confirm sentence say they are signed out now.
Effort S–M. **Do this before a second person is ever given a code.**

### Ranked

| # | Finding | Where | Fix sketch | Effort |
|---|---|---|---|---|
| A1 | **The flash is text in the URL.** Beyond the colour (D5): it survives reload and bookmarking, keeps the old language after a language switch, can be spoofed by anyone who crafts a link, and puts phone numbers and addresses into URLs and logs. About 60 redirects carry a refusal this way. | `layout.ts:230-232`, `app.ts:905-909`, `app.ts:1212` | `flash(kind, text)` in the shell with a `.flash.bad` / `role="alert"` variant; carry a key and tone, or the one-shot signed cookie already used at `app.ts:1749`. | M (tone alone: S) |
| A2 | **Outbound bubbles: no author, no delivery state, no channel.** Every outbound bubble is captioned with the employee's name (`inbox.ts:1029`); the timeline query selects no origin, status or channel (`inbox.ts:535-544`); a queued reply is visible nowhere until it is `sent`, and `failed` appears on no page. | as cited | Left-join `outbound_messages` for origin/status/delivered/read; caption "You" / staff name / Lily; a state line; pending bubbles for queued rows; a channel badge on rows and header. | M |
| A3 | **Nothing updates without a reload.** No script, refresh or event stream anywhere in `src/api/web`. | `layout.ts:353-374` | A small poll of "latest message id" showing "New message — tap to refresh"; never reload while a textarea holds text. | M |
| A4 | **My factory and setup still think WhatsApp is the only channel.** The setup step requires a WhatsApp credential (`onboarding.ts:50-53`); the channels page's H1 is "WhatsApp" (`messages.ts:19`, `channels.ts:674`); a refusal on an Instagram or e-mail thread says "WhatsApp is not connected" (`app.ts:422-424`, `messages.ts:587`). | as cited | Any connected inbound channel completes the step; one row per channel in the reach section; rename the page "Channels". | M |
| A5 | **Editing Lily's draft starts from an empty box, and a refusal throws away what she typed.** | `inbox.ts:1055-1060`, `app.ts:905-909`, `app.ts:2220-2235` | Prefill with the draft, `required`, `rows=4`; on refusal re-render with her text kept, as the profile form already does. | S |
| A6 | **Long threads show the OLDEST messages.** `order by sent_at asc limit 200` (`inbox.ts:543`); the buyer file does `asc limit 60` then `slice(-40)` (`conversations.ts:224,252`). With F7, she approves a draft without the buyer's question beside it. | as cited | Newest N `desc`, reversed, with "Show earlier"; the last buyer message inside the review card. | S query, M layout |
| A7 | **No active menu item and no way back on about 20 pages.** Active state matches four ids (`layout.ts:350-352`) while routes pass `'settings'`, `'channels'`, `'contacts'`…; Results is linked only from a block that hides on a quiet day (`operations.ts:359-367`); Practice vanishes from My factory once live (`factory.ts:609-621`); there is no orders list. | as cited | `CONTEXTUAL_ROUTES_BY_HUB` (`layout.ts:49-61`) already has the map: use it to light the hub and print a back link; an always-present "More" block on My factory. | S–M |
| A8 | **One-tap destructive actions**: disconnect WhatsApp / Meta / mail, turn write-first ON, grant or revoke a capability, archive a fact, archive a sequence, remove the Apollo key, archive a contact. | `channels.ts:625,512-513,540-545`, `connect.ts:102-103`, `employee.ts:300-303`, `knowledge.ts:200-204`, `sequences.ts:223-224` | Reuse the existing `confirm(this.dataset.confirm)` pattern (`factory.ts:565`); move `.btn.stop` into the shell. | S |
| A9 | **Hard caps, no search, no pages.** Buyers `limit 50` applied BEFORE the pending/mine/blocked filters (`inbox.ts:152,187-196`) — past 50 conversations a buyer disappears and "Did not send" can show fewer than Today counts; Customers `limit 100`; Products `limit 200`; Contacts scans every inbound message and loads the whole list to find one contact. | as cited, `src/db/contacts.ts:139-188`, `app.ts:2176,2201` | Filters in SQL with cursor pages; reuse the Customers `ilike` search; a single-contact lookup. | M |
| A10 | **Getting ready is reachable by staff, who can tick "backup tested" and "secrets rotated".** | `app.ts:1566-1614` | Owner-only for the confirmations; operator sections behind their own route (see F2, F4). Also delete the developer HTML comment shipped in every channel card (`channels.ts:556-558`). | M |
| A11 | **Accessibility basics.** No skip link, no `aria-label` on the nav, no `aria-current`; no `<h1>` on the conversation, buyer file, product and order pages; errors announced as `role="status"`; "waiting" and "highlight" text on their washes compute to about 4.2:1 and 4.1:1 at 12px (`tokens.ts:86-88,116-118`); dark cards lose their edge (`css.ts:66-70`). | as cited | In `shell()`: skip link, `aria-current`, per-page `<h1>`; darken the two foregrounds a step; a dark border token. | M |
| A12 | **Forms outside `.pform` get browser-default inputs**, and many controls have no label or type (contacts add, sequences, domain and cap, forbidden words, prospects). iPhones zoom the page on focus when an input is under 16px. `capture="environment"` on the photo upload may stop an Android owner choosing a photo from her gallery. | `layout.ts:218-221`, `products.ts:423`, `settings.ts:184-186` | Scope the input rule to `.fld`; `for`/`id` or `aria-label`; `type=email|tel` with `autocomplete`; drop `capture`. | S |
| A13 | **No friendly not-found or error page** (no `setNotFoundHandler` / `setErrorHandler` in `src`), and **Practice's Scripted/Live switch does nothing** — the radios sit outside every form while each form posts the current mode as a hidden field (`sandbox.ts:425-435,444`). | as cited | Register both handlers through `page()`; turn the radios into two `.tab` links to `?mode=`. | S |

Smaller, as read: the header's "Probation · you're mentoring her" is a static
string that can contradict the computed stage on the Lily page
(`layout.ts:368`); the header never says who is signed in; log out is a GET
link; the login footer still says "Owner only · … works in WhatsApp"; the legal
pages have no language switcher and are linked from nowhere in the app; times
are hard-coded to Asia/Shanghai (`core/owner/i18n/format.ts:10`); the
conversation page runs about fifteen queries one after another.

Copy check: en, zh and ar each hold 1,544 keys with none missing among
single-line entries — the two raw keys in D3 are missing in all three.

## Suggested order

1. **S1** (removed staff stay signed in) — the only security item.
2. **D1 + D2** (imported products switched off, message lost) — the first thing
   every new factory hits.
3. **D3, D4, D5/A1-tone, D6, D7, D9** — an afternoon of small truths.
4. **A2 + A6 + F7** as one piece: a conversation page that shows the newest
   messages, who wrote each, and whether it arrived.
5. **A4 + F1 + A7**: channels as a first-class place, and a menu that reaches
   every page.
6. The rest as they come up: A3, A5, A8, A9, A10–A13, F2–F5.
