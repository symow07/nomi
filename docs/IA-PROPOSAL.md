# Where things live — a proposal

**Design only. Nothing here is built.** It is written to be argued with, and
the open questions at the end are the ones I could not answer from the code.

Grounded in `docs/AUDIT-2026-09-20.md` (click map, CC-05/06/14/18, F1–F10, A7)
and re-measured against the tree at commit `815dfe0`.

---

## What is actually wrong

Not "the navigation is cluttered". Four specific, checkable things.

### 1 · Forty-one pages behind four words

```
/app  GET routes today: 41          nav entries: 4
```

Today · Buyers · {Lily} · My business. Everything else is reached by knowing
it is there. **My business** alone hides seven hubs (Products, What she knows,
Price limits, Channels, Getting ready, Practice, Settings), and **Settings**
hides nine more pages under it. Two junk drawers, one inside the other.

### 2 · Twenty pages light nothing in the sidebar

Pages pass eleven different `active` values to the shell. The nav can light
four:

| passed by pages | can light |
|---|---|
| `products` ×4, `inbox` ×4, `settings` ×2, `knowledge` ×2, `factory` ×2, `conversations` ×2, `channels` ×2, `sandbox`, `onboarding`, `employee`, `contacts` | `home`, `inbox`, `employee`, `factory` |

So on roughly twenty pages nothing in the sidebar is highlighted and there is
no "you are here". That is audit item **A7**, and the fix is already sitting in
the file: `CONTEXTUAL_ROUTES_BY_HUB` in `layout.ts:51` maps every contextual
route to its hub, two tests read it — and `shell()` never does.

### 3 · Two pages are the same page

| | `/app/inbox` "Buyers" | `/app/conversations` "Customers" |
|---|---|---|
| what it lists | people who wrote | people who wrote |
| channel shown | no | yes |
| unread | no | yes |
| search | no | no |
| last contact | no | yes |

An owner cannot tell you which to open. **Customers** is the better page and
**Buyers** is the one in the nav (audit **F6**). Three words — Buyers,
Customers, conversations — for one idea.

Smaller duplicates of the same kind: "Practice" and "Sandbox check" are the
same feature under two names on one page (**F3**); `/app/factory` is labelled
"My business" since A2 renamed the copy but not the route.

### 4 · Two pages have no door at all

- **Results** `/app/analytics` — its only link lives *inside* "What she did",
  a section hidden entirely when she has handled nothing. A new owner, or any
  quiet week, has no way in but typing the URL (**CC-05**).
- **Write to them** `/app/contacts/write` — linked from nowhere in any
  rendered page, while the KB teaches owners to use it (**CC-06**).

And the things she does weekly are the deepest: Follow-ups is four clicks,
one sequence is five (**CC-18**).

---

## What I propose

Five entries, and Results promoted onto Today.

| # | Nav | Route | Holds |
|---|---|---|---|
| 1 | **Today** | `/app` | what needs you · **+ Results, always linked** |
| 2 | **Buyers** | `/app/inbox` | the merged list · a conversation · an order · Reaching out (tab) |
| 3 | **{Lily}** | `/app/employee` | how she behaves · what she knows · words she may not say · Practice |
| 4 | **My business** | `/app/factory` | what you sell: products · price limits · terms · samples · closures |
| 5 | **Setup** | `/app/settings` | channels · people · your sign-in · your data · getting ready |

The split between 4 and 5 is the one that matters: **"what I sell" and "how
this installation is wired" are different questions asked at different times**,
and today they are the same drawer. An owner edits a price every week and
touches a channel credential twice ever.

### Where each of the 41 pages lands

```
Today            /app                        1
  Results        /app/analytics              2   ← was unreachable

Buyers           /app/inbox                  1   ← merged with Customers
  a conversation /app/inbox/:id              2
    an order     /app/orders/:id             3
    a voice note /app/inbox/:id/voice/:id    3
  Reaching out   /app/inbox?tab=outreach     2   ← was 3
    a contact    /app/contacts               3   ← was 3
    Follow-ups   /app/sequences              3   ← was 4
      a sequence /app/sequences/:id          4   ← was 5
    Find buyers  /app/prospects              3   ← was 4
    Write to one /app/contacts/write         3   ← was UNREACHABLE
    Not again    /app/contacts/suppress      3   ← was 4

{Lily}           /app/employee               1
  What she knows /app/knowledge              2
    one fact     /app/knowledge/:id          3
  Forbidden      /app/settings/forbidden     2   ← was 3, and under Settings
  Practice       /app/sandbox                2

My business      /app/factory                1
  Products       /app/products               2
    one product  /app/products/:id           3
    add by photo /app/products/add           3
  Price limits   /app/factory/prices         2
  Payment terms  /app/settings/terms         2   ← was 3
  Samples        /app/settings/samples       2   ← was 3
  Closed days    /app/settings/closures      2   ← was 3
  Exchange rate  /app/settings/rate          2   ← was 3

Setup            /app/settings               1   ← was 2, and not in the nav
  Channels       /app/channels               2
    connect      …/whatsapp/connect          3
  People         /app/settings/people        2
  Your sign-in   /app/settings/account       2
  Your data      /app/settings/data          2
  Your business  /app/settings/business      2
  Getting ready  /app/onboarding             2
```

**Nothing gets deeper. Nine things get shallower. Two get a door.**

### The URLs do not move

Deliberately. Renaming routes breaks bookmarks, the KB's screenshots, and
three tests that pin the route list — for no gain a reader can see, because a
reader sees the label. **The nav changes, the labels change, the URLs stay.**

The one exception worth discussing is `/app/factory`, which has said "factory"
in its path since before A2 decided this product is not only for factories.
It is internal and nobody sees it; I would leave it and spend the change
budget elsewhere. Flagged below as a question rather than decided.

---

## The four changes that do the work

### A · Merge Buyers into Customers, keep the name "Buyers"

Take `/app/conversations`' read model (channel, unread, last contact) and give
it to `/app/inbox`. Add the two things neither has and both need: **search**,
and **paging** — the query stops at `limit 50` (`inbox.ts:163`) and only then
does the page split them into Needs you / Yours / Hers, in JavaScript
(`inbox.ts:806-808`). So past fifty conversations a waiting buyer silently
drops out of "Needs you" — the row was never fetched (audit **A9**). That is a correctness bug wearing an IA costume,
and it should be fixed with this or before it.

`/app/conversations` then redirects to `/app/inbox`. One list, one word.

### B · Teach the shell the map it already has

`shell()` takes `active` and compares it to four nav ids. Give it the route
instead and let `CONTEXTUAL_ROUTES_BY_HUB` — which exists, and which two tests
already read — decide which hub lights up. Twenty pages gain "you are here"
and a `aria-current="page"` for a screen reader, from data that is already
written down and already tested.

This is the cheapest item here and it closes **A7** on its own.

### C · Results onto Today, unconditionally

Move the link out of the `didNothing ? '' : …` branch at
`operations.ts:360`. One line. A page that exists and cannot be reached is
worse than a page that does not exist, because somebody built it.

### D · Split the drawer

Settings becomes **Setup** and joins the nav; the six things that are about
*what you sell* (terms, samples, closures, rate, prices, products) move under
**My business**; the three that are about *how she behaves* (forbidden words,
what she knows, practice) move under **{Lily}**.

No page is written twice — this is where a link points, not new code.

---

## What this does not fix

Named so nobody expects it to.

- **F2 · Getting ready is seven pages in one.** It stays seven pages in one,
  two clicks away, under Setup. Splitting it is its own piece of work.
- **F4 · Machine-room words** ("Access key", "App secret", "Callback
  password") still sit on an owner's page. Moving them to an operator route is
  a separate decision about who operates this.
- **A3 · Nothing updates without a reload**, **A6 · oldest messages first**,
  **CC-24 · the edit box starts empty** — all on the conversation page, all
  real, none of them about where things live.
- **CC-14 · the sidebar says "Nomi · Lily's workspace" to everyone.** One
  line, worth doing, but it is copy rather than structure.

---

## Cost

Rough, assuming the verification set runs green between each:

| | |
|---|---|
| B · shell reads the hub map | half a day — it is wiring plus a test |
| C · Results onto Today | minutes |
| D · move the links, rename Settings → Setup, add it to the nav | half a day, mostly copy in three languages |
| A · merge the two lists, add search and paging | **two days**, and it carries the A9 bug fix |

A is most of it, and it is the only one with a correctness bug attached. B, C
and D are a day between them and could ship first as their own change.

---

## Decided — 2026-09-21

The five questions this document asked, answered by the owner. They change the
plan above where they say so; nothing else in it moved.

1. **"Reaching out" gets no nav entry** — and goes further than the proposal
   asked for. The whole outreach area (sequences, prospects, write-first) sits
   behind a **per-workspace flag, OFF for a new workspace**, on for the
   pilot's. *Hidden means no links, not merely no nav entry* — a page still
   reachable by URL is still shipped, and the KB still teaches it.

2. **Five entries. No conditional sixth.** While onboarding is incomplete,
   **Setup carries a progress badge** and **Today shows a "finish setup"
   card**. That is the nicer first run without a nav item that appears and
   disappears.

3. **`/app/factory` stays.**

4. **The nav label is the assistant's NAME when there is one assistant, and
   "Team" (团队 / الفريق) when there are several.** The name must come from
   the `assistants` table, never from code. Every hardcoded "Lily" / "小雅" in
   owner- or buyer-facing copy is to be found and removed as part of **C** —
   the audit is in the section below.

5. **Owner testing is arranged before A merges, and B, C and D do not wait
   for it.** The script is `docs/USABILITY-SCRIPT.md`, five tasks, Chinese
   first.

### The order changed

**A9 ships first, alone, before B+C** — and did, on 2026-09-21. A conversation
that needs a person and cannot be seen is a live correctness bug; it does not
wait for a list merge. It turned out to be sharper than this document's
description of it: see the commit, and the note under **A** above.

Then **B+C → D → A**, as proposed.

---

## The hardcoded-name audit (for change C)

Answering decision 4. Searched `src/` for `Lily`, `小雅`, `ياسمين`.

**Buyer-facing copy is already clean.** The proof page resolves the name
through `assistantNameOfConversation` / `mainAssistantName` — from the table
(`proof.ts:6,241`). Nothing buyer-facing carries a literal.

**Owner-facing, to fix in C:**

| Where | What | Why it is wrong |
|---|---|---|
| `core/channel/health.ts:49-72` | Chinese-only sentences built with `${employeeName}`, outside the catalogue entirely | **Nobody reads them.** `deriveHealth` *is* reachable (`channels.ts:137,152`), but the page maps its `status` to a problem CODE and renders `channel.problem.*` from the catalogue (`channels.ts:41-47,347`); the notification layer renders `notify.*` the same way. The `OwnerProblem` strings are computed and discarded on every path. So this is dead copy carrying a hardcoded name, not a translation bug — delete the three fields, or the module's use of `employeeName`, and leave the status codes. *(First written up here as "an English owner would read Chinese", which was wrong — the trace is above.)* |
| `pipeline/notify.ts:5,33` | the only module outside `api/web` importing `t` from the core catalogue | so `{name}` falls back to the constant. It *does* accept a resolved name and A5.2 passes one; the fallback fires only when a business has no assistant, which `ensureDefaultAssistant` should make impossible. |
| `main.ts:626` + `api/web/app.ts:171` | `employeeName: process.env['EMPLOYEE_NAME'] ?? '小雅'` | **dead**: declared on the deps type, read by nothing. An installation-wide name that no longer means anything. Delete both, and the env var. |

**Correct as they stand — leave alone:**

`db/assistants.ts:45` and `api/web/assistants.ts:27,50` pass
`EMPLOYEE_NAME[locale]` as the name for a **new** main assistant. That is code
supplying a default *at birth*, written into the table; every read afterwards
comes from the table. This is exactly where the constant belongs, and removing
it would leave a new workspace's assistant nameless.

`messages.ts:5500` — `t()` auto-filling `{name}` — is the root fallback that
`say.ts` overrides per request. It stays as the floor.

---

## Approved. Shipping order

Each its own PR against the verification set:

0. ~~**A9** — nothing that needs a person falls out of the window.~~ ✅ merged
   2026-09-21 (PR #44).
1. **B + C** — the shell reads the hub map; Results gets a door; the
   hardcoded names go; the nav label follows the assistant count.
2. **D** — the drawer splits; Setup joins the nav, with its progress badge and
   Today's "finish setup" card; outreach goes behind the per-workspace flag.
3. **A** — the two lists become one, with search and paging.

Nothing here touches `activate()`, any outbound send, the price floor, order
confirmation, or the RLS grants.
