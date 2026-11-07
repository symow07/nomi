# Block 4.3 · "What Nomi did for you" — design spec (D1)

Designer's spec for the monthly report page, its time-saved estimate, the monthly e-mail, the English copy,
and what a tester checks in a browser. It follows `docs/DESIGN-SYSTEM.md`, which is in force. Where CLAUDE.md
rules 25 and 85 disagree with it (button colour, the wash), the design system wins.

Scope rules carried from the brief:
- Every figure is a COUNT or a SUM over rows that already exist. Nothing is estimated except the owner's own
  time-saved line, which is off by default and labelled an estimate.
- Owner copy says "customer", never "buyer". The assistant is `{name}` (the chosen name, or the existing
  "your assistant" fallback) and has no pronouns. Owner copy never says "AI". No sentence promises something
  the code does not do.
- New text is English only. It goes in an English-only dictionary registered in the redesign fallback, as
  `COPILOT_EN` and `CASES_EN` are. Row labels are one sentence-case string each, with no count agreement
  (amended after cand/4.3-0, §7). Only sentences with a figure inside keep the `.one` / `.other` pattern.
- **The assistant's name inside English fallback text:** when a sentence is drawn from the English
  fallback, `{name}`'s fallback is the English "your assistant". A chosen name is used as typed, in any
  language. Resolve this once, where the fallback is resolved, never per page (amended, §7).

---

## 1 · The page: `/app/results/month?month=YYYY-MM`

### 1.1 How it is reached

- Results (`/app/results`) gets a fourth tab, **Monthly report**. It is a door (`<a>`) to
  `/app/results/month` and stays after Sales · Assistant · Getting started.
- The month page draws the same tab row with Monthly report current (`aria-current="page"`). The other three
  tabs are doors back to their views.
- Nav area: Today. On the phone that is the Today tab, as for the rest of Results.

### 1.2 The month in the address

| `month` value | What the page does |
|---|---|
| Absent | The current month in the workspace's time zone. No redirect. |
| Well-formed and in range | That month. |
| Well-formed, before the workspace's first month | 302 to `?month=<first month>` |
| Well-formed, after the current month | 302 to `?month=<current month>` |
| Malformed (`2026-13`, `abc`, `2026-1`) | 302 to `?month=<current month>` |

- The first month is the month the workspace started: `signed_up_at`, or `created_at` when that is null,
  read in the workspace's zone.
- Every month boundary is midnight on the 1st **in the workspace's zone** (rule 41). This is not the
  ledger's UTC month.

### 1.3 Who sees what

| Viewer | Sees |
|---|---|
| Owner | Every section. Also the time-saved disclosure and its minutes field (§2), and the monthly e-mail switch (§3.3). |
| Staff | Every section except **Invoices**: Books shows staff nothing. Staff get no minutes field and no e-mail switch. If the owner set minutes, staff see the estimate read-only with "Set by the owner." (§2.3). |
| Accountant | Sent to the Books, as from every sales page (rule 102). |

### 1.4 Layout and section order

This is Layout 1 · Overview: concise totals and plain rows. There is no chart, no wash and no decorative
banner. It is a single reading column on both widths.

1. **Tab row**, as on Results.
2. **Header:**
   - a back door to Today, as on the other Results views;
   - h1 `monthReport.title`;
   - the intro line `monthReport.intro`.
3. **Month bar:**
   - h2 with the month's name, written by `Intl` in the page locale ("October 2026"). This is the page's
     subject.
   - Under it, the state line or lines (§1.6), if any apply.
   - Then the picker (§1.5).
4. **Customers:** customers answered.
5. **Replies:** sent alone; drafts sent as written; drafts edited, then sent; drafts not sent.
6. **Time to first reply:** the median and how many customers it was measured on.
7. **Orders:** orders confirmed, then the value, one line per currency.
8. **Invoices:** invoices paid in full, then the value, one line per currency. Owner only.
9. **Handed to you:** the total, then one row per reason.
10. **Time saved:** owner only, at the foot (§2).
11. **Monthly e-mail:** the owner's switch, the last thing on the page (§3.3). Staff never see it.

Why this order: what Nomi did comes first (customers, replies, speed). What it led to comes next (orders,
invoices). What needed the owner comes last (hand-offs).

**How a row is drawn.** Reuse the existing `dl.result-rows` / `.result-row` pattern from `analytics.ts`:
- the label goes in `<dt>`, the figure in `<dd>`;
- figures use tabular numerals and sit at the inline end, so they mirror on an Arabic page;
- under each figure's row is one quiet definition line (`.caption.muted`), from the table in §1.7.

Each section is a `<section aria-labelledby>` with an h2, so the page has one h1.

**Desktop (1440).** The rail, then the content column at the shell's reading measure. Don't use a
two-column grid: a month is read top to bottom.

**Phone (390).**
- The same single column, no horizontal scroll.
- Each row is the label and figure on one line, with the definition under them.
- The tab row wraps to a second line instead of clipping "Monthly report".
- Doors, the select and buttons are at least 44 px tall.

**Buttons.**
- **Save** (the minutes form) is the form's primary action: a black fill with a white label.
- **Show** (the picker) is secondary: black text with a neutral border.
- Doors are magenta words with their arrow (`deeper` / `back`), never `class="btn"`.

### 1.5 Month picker

- **‹ previous month:** a door (`<a>`) to the month before.
  - Its visible text is the month name ("‹ September 2026"), from `monthReport.picker.previous`.
  - It is absent on the workspace's first month.
- **Month select:** a GET form to `/app/results/month`:
  - `<label for>` `monthReport.picker.label`;
  - `<select name="month">` with every month from the current one back to the first, newest first, each
    option named by `Intl`;
  - a `<button>` `monthReport.picker.show`.
  - It works without script. Nothing auto-submits on change.
- **next month ›:** a door, `monthReport.picker.next`. It is absent on the current month.

### 1.6 States

These state lines sit under the month's h2, in this order when more than one applies.

| State | When | What shows |
|---|---|---|
| Month still running | The month shown is the current month. | `monthReport.state.running`: "{month} so far, up to today. These figures change until the month ends." |
| First month begun mid-month | The month shown is the first month and the start date is not the 1st. | `monthReport.state.firstMonth`: "Counted from {date}, the day your workspace was made." |
| No activity | No customer wrote, {name} sent nothing, no draft was decided, nothing was handed over, no order was confirmed and no invoice was paid in full. | The sections are replaced by Layout 12's empty block. Title `monthReport.empty.title`; body `monthReport.empty.past` for a finished month, `monthReport.empty.running` for the current one. In the current month, while Getting started is unfinished, add one door `monthReport.empty.setup` → `/app/get-started`. The picker stays. |
| A section with nothing in it | For example, no order this month. | The section keeps its heading and says its own empty line (`…none`). It never shows a blank, a dash or an invented 0 currency amount. Plain counts of 0 do show as 0. |
| Books never started | No issued invoice has ever existed (owner). | The Invoices section says `monthReport.invoices.noBooks` with one door `monthReport.invoices.openBooks` → `/app/books`. |

There is no loading state: the page is server-drawn. A failed read is the app's ordinary error page.

### 1.7 Each figure: label, definition, source

Test conversations (`owner_testing`) are excluded from every figure (`notOwnerTesting`), and practice copies
never count. The month means the workspace's zone, from the 1st at 00:00 to the next 1st, or to now for the
running month.

| Figure | Label (key) | Definition shown (key) | Counted from |
|---|---|---|---|
| Customers answered | `monthReport.n.answered` | `monthReport.def.answered` | Distinct customers (client) with at least one message that reached them in the month, written by {name}: sent alone (`auto_sent`), or a draft approved or edited and sent. The owner's own typed replies don't count. **Never** billing's figure (decided, §6.1): the billing table `customers_answered` counts a draft even when it never went out, by UTC month. The PR notes the difference. |
| Replies sent alone | `monthReport.n.alone` | `monthReport.def.alone` | `auto_sent` events created in the month. |
| Drafts sent as written | `monthReport.n.asWritten` | `monthReport.def.asWritten` | Drafts with status `approved` and `decided_at` in the month. Since R1, "Edit & send" with the words unchanged is recorded as `approved`. |
| Drafts edited, then sent | `monthReport.n.edited` | `monthReport.def.edited` | Drafts with status `edited` and `decided_at` in the month. |
| Drafts not sent | `monthReport.replies.notSent` | `monthReport.def.notSent` | Drafts that became `rejected`, `expired` or `superseded` in the month. Accepted (§6.4), so "drafted" is never shown as only the drafts that went out. |
| Median time to first reply | `monthReport.median.label` | `monthReport.def.median` + `monthReport.median.from` | For each customer whose first inbound message of the month has a later message that reached them (any writer: sent alone, a draft, or the owner), take the clock time between the two. Show the median of those times. Nights and weekends count, because business hours are free text (as in G9). Display: under a minute → `monthReport.duration.underMinute`; otherwise hours and minutes (days and hours past 48 h), through `Intl.NumberFormat` units joined by `Intl.ListFormat`, as `formatTimeLeft` does (no `Intl.DurationFormat`). |
| Customers still waiting | `monthReport.median.waiting` | — | Customers who wrote in the month and have had no reply since. They are left out of the median, and this line says so. It shows only when the count is above 0. |
| Orders confirmed | `monthReport.n.orders` | `monthReport.def.orders` | Orders in `SPEND_STATUSES` with `coalesce(confirmed_at, created_at)` in the month: the same rule as the Sales tab and Today. |
| Value of orders | `monthReport.orders.value` | (in `def.orders`) | `sum(total_value_usd)` grouped by `currency`. Show one line per currency, never added together (G18). A currency the build doesn't know is dropped, not called dollars. |
| Invoices paid in full | `monthReport.n.invoicesPaid` | `monthReport.def.invoices` | Issued invoices whose last payment, refunds aside, is dated in the month and left nothing owed. Each invoice counts once. An invoice settled by a credit note is not "paid". |
| Value of invoices paid | `monthReport.invoices.value` | (in `def.invoices`) | Those invoices' totals, one per currency. This is not the cash received this month: the definition says so, and nothing relabels it as cash. |
| Hand-offs to you | `monthReport.n.handed` | `monthReport.def.handed` | `conversation_events` of type `handoff` created in the month. A customer handed over twice counts twice. Times the owner took a conversation over themselves are not included. |
| One row per reason | The existing words `takeover.reason.<reason>` (no new copy), with the first letter capitalised for a row label. | — | Those events grouped by their recorded reason, ordered by count (highest first), then by key; **"Another reason" (`monthReport.handed.other`) is always last**, whatever its count (amended, §7). A reason with no catalogue words shows `monthReport.handed.other`. |

---

## 2 · Time saved: an estimate, hidden by default

### 2.1 Storage and rules

- A workspace setting holds **minutes a reply would take you**: a whole number from 1 to 60. Empty means
  not set. It starts empty for every workspace.
- Suggested storage: `businesses.minutes_per_reply smallint null check (between 1 and 60)`. That's the
  backend's call.
- Owner only. The route is `POST /app/results/month/minutes`, with `month` carried through so the owner
  lands back on the same month. A staff POST is refused and changes nothing. Staff never see the form
  (rule 11: never a form that refuses them).
- What the field takes:
  - Allowed: `1`–`60`, and empty (empty clears the setting).
  - Refused (the value is left unchanged):
    - `0`, `61` (out of range);
    - `5.5` (not whole);
    - `-3` (negative);
    - `five` (not a number);
    - a value with spaces inside;
    - more than two digits.

### 2.2 What the owner sees

- **Not set (the default):** no estimate anywhere on the page.
  - The foot has one closed disclosure (`<details>`).
  - Its summary is `monthReport.estimate.open`, "Estimate the time this saved you".
  - Opened, it holds the field (label `monthReport.estimate.minutes`, hint `monthReport.estimate.hint`,
    `inputmode="numeric"`) and **Save**.
  - **The field is `type="text"` with `inputmode="numeric"`**, and has no `min`, `max`, `step`, `pattern`
    or `required` (amended, §7). The server alone decides what is refused, so the owner always sees our
    refusal words (§2.4), never a browser's own bubble. The mouse wheel and arrow keys never change the
    value, and no spinner is drawn.
- **Set:** a **Time saved** section (h2 `monthReport.section.estimate`) shows:
  - the formula `monthReport.estimate.formula`, "{replies} replies × {minutes} min = {hours} h", with all
    three figures isolated;
  - under it, the label `monthReport.estimate.label`, "An estimate, from the minutes you gave. Replies
    {name} sent alone, plus drafts you sent as written. Edited drafts are not counted.";
  - the same disclosure, now titled `monthReport.estimate.change`, with the field filled in.
- **The figures in the formula:**
  - N = replies sent alone + drafts sent as written for the month shown.
  - Hours = N × M ÷ 60, rounded to one decimal place.
  - When N is 0, the formula is replaced by `monthReport.estimate.nothing`.

### 2.3 What staff see

- Not set: nothing about the estimate.
- Set: the Time saved section read-only, the same formula and label, plus `monthReport.estimate.byOwner`
  ("Set by the owner.").
- Staff get no disclosure and no field.

### 2.4 Flash messages after Save

Each flash on this page is English-fallback text. On a page in another language it is wrapped as
`<bdi lang="en" dir="ltr">…</bdi>`, the same marking the page's English labels carry. Do not put
`dir="auto"` on the shared flash banner (ruling F03, §7).

These are drawn by `flashBanner` on the month page, never painted by the page itself.

| Result | Key |
|---|---|
| A value saved | `monthMail.flash.minutesSaved` |
| Cleared | `monthMail.flash.minutesCleared` |
| Refused | `monthMail.flash.minutesInvalid` |
| A non-owner tried | `monthMail.flash.ownerOnly` |

---

## 3 · The monthly e-mail

### 3.1 When and to whom

- It goes once a month, on the 1st at 08:00 in the workspace's zone, for the month that just ended.
- Inside the owner's quiet hours it waits until they end, as the morning summary does (0150).
- It goes to the workspace's **owner** at their sign-in address only, never to staff, because it carries
  the invoices.
- It is not sent when:
  - the month had no activity (§1.6, "No activity");
  - the workspace is a practice copy;
  - the installation has no system mail;
  - the owner turned it off with the switch on the month page (§3.3).
- It goes through MAIL's sender under the `alerts` daily cap (rule 70). Each send is claimed once per owner
  per month, so a retry never sends it twice.
- It is English for every owner, with English dates and money (`en`). New owner text is English only.

### 3.2 What it says

It is plain text, like the alerts. **It names no customer**, following the morning summary's rule: it gives
counts only, and the names are one tap away in Nomi. It has one door, to the page.

```
Subject: {business} · What Nomi did for you in {month}

Here is {month} at {business}.

Customers answered: 42
Replies {name} sent alone: 30
Drafts you sent as written: 12
Drafts you edited, then sent: 4
Drafts not sent: 2
Median time to first reply: 6 min, from 38 customers
Orders confirmed: 7 ($1,240.00 · AED 300.00)
Invoices paid in full: 3 ($900.00)
Hand-offs to you: 5
  The customer asked for a person: 3
  A stock question — only you know what is on the shelf: 2
Time saved, an estimate: 42 replies × 5 min = 3.5 h

See the month in Nomi: {url}

This e-mail comes on the 1st of each month. You can stop it at the foot of that page.
```

- The lines are the same figures as the page, by the same definitions.
- When a count is 0, its line still shows with 0. The exceptions:
  - The value in brackets goes away when there is no amount.
  - The reason lines show only for reasons that occurred.
  - With no reply to measure, the median line says `monthMail.medianNone`.
  - The "Invoices" line is left out when no issued invoice has ever existed.
- The estimate line shows **only if** minutes are set.
- `{url}` = `PUBLIC_BASE_URL` + `/app/results/month?month=YYYY-MM`, the month just ended. It is the only
  link in the e-mail.

### 3.3 The switch, on the month page (decided, §6.2)

The e-mail's last line points at this switch; there is no Settings or Notifications switch.

- **Storage:** one workspace setting, on by default. Suggested: `businesses.month_report_mail boolean not
  null default true`. That's the backend's call.
- **Route:** `POST /app/results/month/mail` with `mail=on|off`, and `month` carried through so the owner
  lands back on the same month.
  - Owner only. A staff POST is refused and changes nothing.
  - Any other `mail` value is refused and changes nothing.
- **On the page:** the last section, owner only, h2 `monthReport.section.mail`.
  - **While on:**
    - the line `monthReport.mail.on`;
    - one secondary button (black text, neutral border), `monthReport.mail.stop`, posting `mail=off`.
  - **While off:**
    - the line `monthReport.mail.off`;
    - one secondary button, `monthReport.mail.start`, posting `mail=on`.
  - It is one form with one button. The button names the action, never the state.
- **Staff:** the section is not drawn at all.
- **Flash after the POST:**
  - stopped: `monthMail.flash.mailOff`;
  - started: `monthMail.flash.mailOn`;
  - a non-owner: `monthMail.flash.ownerOnly`.
  - A `mail` value other than `on` or `off` can only come from a hand-made request: it is a 400 with
    nothing changed and no flash.

---

## 4 · Copy: key → English

`{name}` is the assistant's chosen name, as typed. With no chosen name it is "your assistant" in the
sentence's own language; every key below is English, so it is the English "your assistant" on every page,
Arabic included (§7). `{month}` is "October 2026", from `Intl`.
`{date}` comes from `show.date`. Every figure parameter is isolated by `t` / `tn`.

### 4.1 PAGE keys (`monthReport.`)

| Key | English |
|---|---|
| `monthReport.title` | What Nomi did for you |
| `monthReport.intro` | One month at a time: who {name} answered, what sold and what was handed to you. |
| `monthReport.picker.label` | Month |
| `monthReport.picker.show` | Show |
| `monthReport.picker.previous` | ‹ {month} |
| `monthReport.picker.previousName` | Previous month: {month} |
| `monthReport.picker.next` | {month} › |
| `monthReport.picker.nextName` | Next month: {month} |
| `monthReport.state.running` | {month} so far, up to today. These figures change until the month ends. |
| `monthReport.state.firstMonth` | Counted from {date}, the day your workspace was made. |
| `monthReport.empty.title` | Nothing happened in {month} |
| `monthReport.empty.past` | No customer wrote, {name} sent no reply, and no order or invoice was settled this month. |
| `monthReport.empty.running` | Nothing yet this month. As customers write in and {name} answers, this fills in. |
| `monthReport.empty.setup` | Finish getting started |
| `monthReport.section.customers` | Customers |
| `monthReport.n.answered` | Customers answered |
| `monthReport.def.answered` | Different customers who got at least one reply {name} wrote, sent alone or sent by you. Replies you typed yourself are not counted. |
| `monthReport.section.replies` | Replies |
| `monthReport.n.alone` | Replies {name} sent alone |
| `monthReport.def.alone` | Sent without waiting for you, within the rules you set. |
| `monthReport.n.asWritten` | Drafts you sent as written |
| `monthReport.def.asWritten` | {name} drafted them and you sent them without changing a word. |
| `monthReport.n.edited` | Drafts you edited, then sent |
| `monthReport.def.edited` | {name} drafted them and you changed the words before they went. |
| `monthReport.replies.notSent` | Drafts not sent |
| `monthReport.def.notSent` | You chose no reply, answered in the channel's own app, or the time to reply ran out. |
| `monthReport.section.speed` | Time to first reply |
| `monthReport.median.label` | Median time to first reply |
| `monthReport.def.median` | Half of the customers got their first reply faster than this, half slower. Clock time, nights and weekends included, from their first message this month to the first reply that reached them, whoever wrote it. |
| `monthReport.median.from.one` | Measured on {n} customer. |
| `monthReport.median.from.other` | Measured on {n} customers. |
| `monthReport.median.waiting.one` | {n} customer who wrote this month is still waiting and is not in this figure. |
| `monthReport.median.waiting.other` | {n} customers who wrote this month are still waiting and are not in this figure. |
| `monthReport.median.none` | No customer who wrote this month has had a reply yet. |
| `monthReport.duration.underMinute` | under a minute |
| `monthReport.section.orders` | Orders |
| `monthReport.n.orders` | Orders confirmed |
| `monthReport.orders.value` | Value of confirmed orders |
| `monthReport.def.orders` | Orders you confirmed this month that still stand. Each currency has its own total; they are never added together. |
| `monthReport.orders.none` | No order was confirmed this month. |
| `monthReport.section.invoices` | Invoices |
| `monthReport.n.invoicesPaid` | Invoices paid in full |
| `monthReport.invoices.value` | Value of invoices paid |
| `monthReport.def.invoices` | Invoices whose last payment, dated this month, left nothing owed. The value is what the invoices were for, one total per currency — not the money that arrived this month. |
| `monthReport.invoices.none` | No invoice was paid in full this month. |
| `monthReport.invoices.noBooks` | You have not issued an invoice yet, so there is nothing to count here. |
| `monthReport.invoices.openBooks` | Open Books |
| `monthReport.section.handed` | Handed to you |
| `monthReport.n.handed` | Hand-offs to you |
| `monthReport.def.handed` | Each time {name} stopped and passed a customer to you, with the reason recorded then. A customer handed over twice counts twice. Times you stepped in yourself are not here. |
| `monthReport.handed.none` | {name} handed nobody to you this month. |
| `monthReport.handed.other` | Another reason |
| `monthReport.section.estimate` | Time saved |
| `monthReport.estimate.formula` | {replies} replies × {minutes} min = {hours} h |
| `monthReport.estimate.label` | An estimate, from the minutes you gave. Replies {name} sent alone, plus drafts you sent as written. Edited drafts are not counted. |
| `monthReport.estimate.nothing` | No replies to count this month. |
| `monthReport.estimate.byOwner` | Set by the owner. |
| `monthReport.estimate.open` | Estimate the time this saved you |
| `monthReport.estimate.change` | Change the minutes |
| `monthReport.estimate.minutes` | Minutes a reply would take you |
| `monthReport.estimate.hint` | A whole number from 1 to 60. Leave it empty to remove the estimate. |
| `monthReport.estimate.save` | Save |
| `monthReport.section.mail` | Monthly e-mail |
| `monthReport.mail.on` | On the 1st of each month, Nomi e-mails you last month's figures, with no customer named. |
| `monthReport.mail.off` | The monthly e-mail is stopped. This page still has every month. |
| `monthReport.mail.stop` | Stop the monthly e-mail |
| `monthReport.mail.start` | E-mail me each month |

### 4.2 MAIL keys (`monthMail.`): the e-mail, the Results tab, the minutes flashes, the switch

| Key | English |
|---|---|
| `monthMail.tab` | Monthly report |
| `monthMail.subject` | {business} · What Nomi did for you in {month} |
| `monthMail.opening` | Here is {month} at {business}. |
| `monthMail.answered` | Customers answered: {n} |
| `monthMail.alone` | Replies {name} sent alone: {n} |
| `monthMail.asWritten` | Drafts you sent as written: {n} |
| `monthMail.edited` | Drafts you edited, then sent: {n} |
| `monthMail.notSent` | Drafts not sent: {n} |
| `monthMail.median` | Median time to first reply: {time}, from {n} customers |
| `monthMail.medianOne` | Median time to first reply: {time}, from 1 customer |
| `monthMail.medianNone` | Median time to first reply: no first replies to measure |
| `monthMail.orders` | Orders confirmed: {n} ({totals}) |
| `monthMail.ordersBare` | Orders confirmed: {n} |
| `monthMail.invoices` | Invoices paid in full: {n} ({totals}) |
| `monthMail.invoicesBare` | Invoices paid in full: {n} |
| `monthMail.handed` | Hand-offs to you: {n} |
| `monthMail.handedReason` | {reason}: {n} |
| `monthMail.estimate` | Time saved, an estimate: {replies} replies × {minutes} min = {hours} h |
| `monthMail.open` | See the month in Nomi: {url} |
| `monthMail.off` | This e-mail comes on the 1st of each month. You can stop it at the foot of that page. |
| `monthMail.flash.mailOff` | The monthly e-mail is stopped. Nothing more will be sent. |
| `monthMail.flash.mailOn` | The monthly e-mail is on. The next one comes on the 1st. |
| `monthMail.flash.minutesSaved` | Saved. The estimate now uses {minutes} minutes a reply. |
| `monthMail.flash.minutesCleared` | Removed. The page no longer shows an estimate. |
| `monthMail.flash.minutesInvalid` | Type a whole number from 1 to 60, or leave it empty. Nothing was changed. |
| `monthMail.flash.ownerOnly` | Only the owner can change this. Nothing was changed. |

Copy checks the writer runs before committing any key:
- no "buyer";
- no "AI";
- no she, her, it or they for the assistant;
- no "free";
- no promise the code doesn't keep (`monthMail.off` and `monthMail.flash.mailOn` need §3.3's switch and the
  1st-of-month job);
- no CSS-scanned words in class names ("token", "stack", "%").

---

## 5 · Acceptance criteria (a tester, in a real browser)

Run against a local instance with a fixture month that holds:
- replies sent alone;
- an approved draft, an edited draft, a rejected one and an expired one;
- a first reply after 6 min, one after 3 h, and a customer still waiting;
- orders in USD and AED;
- one invoice paid in full and one paid in part;
- hand-offs for two reasons;
- an `owner_testing` conversation holding each of the above, which must count for nothing.

Check at **1440 × 900** and **390 × 844**, in **en** and in **ar**, as the owner and as staff.

### 5.1 Navigation and address

1. Results shows four tabs. "Monthly report" is an `<a>` to `/app/results/month`. On that page it carries
   `aria-current="page"` and the other three are doors.
2. `/app/results/month` with no `month` shows the current month and doesn't redirect.
3. Out-of-range and malformed `month` values redirect with 302, as in the table in §1.2.
4. "‹ previous" is absent on the first month and "next ›" on the current month. Both are `<a>`, with
   accessible names "Previous month: …" / "Next month: …".
5. The month select and Show work with script switched off. Show is a `<button>` inside the GET form.
   Choosing an option alone does not navigate.

### 5.2 Figures

6. Each figure equals the fixture's expected count or sum. The `owner_testing` conversation moves no figure.
7. USD and AED order values are two lines. No line adds them.
8. The part-paid invoice is not counted. The paid one's value is its total.
9. The median is shown with "Measured on N customers" and the still-waiting line. With one reply only,
   "Measured on 1 customer".
10. Hand-off reasons use the existing reason words. The rows are ordered by count.
11. Staff: no Invoices section, no minutes field, no disclosure, no Monthly e-mail section. Accountant:
    redirected to the Books.

### 5.3 States

12. The current month shows the "so far" line. A past month does not.
13. A workspace started on the 14th shows "Counted from 14 …" on its first month only.
14. An empty past month shows the empty title and body, with no sections. The picker still works.
15. An empty current month in an unfinished setup shows one door to Getting started.

### 5.4 The estimate

16. **No estimate by default:** a fresh workspace shows no "h" figure, no formula and no Time saved section,
    as owner or staff. The owner sees only the closed disclosure at the foot.
17. Owner sets 5 → the flash "Saved…", the Time saved section with the formula and the estimate label.
    18 replies → "18 replies × 5 min = 1.5 h".
18. Each of `0`, `61`, `5.5`, `-3`, `five` → the refusal flash, and the stored value is unchanged. **Typed
    into the field in the browser and saved**, not only posted. No browser validation bubble appears: the
    field is `type="text"` `inputmode="numeric"` with no `min` / `max` / `step` / `pattern`. Arrow keys and
    the mouse wheel over it leave the value unchanged.
19. An empty field → the "Removed" flash, and no estimate shows.
20. Staff see the set estimate read-only with "Set by the owner.". A staff POST to the minutes route changes
    nothing.

### 5.5 Right to left (ar)

21. `<html dir="rtl">`. Rows mirror: label at the start (right), figure at the end (left).
22. Every figure, amount, month name, date and duration sits inside an isolate. The surface walk's isolate
    check passes on this page. Money reads in the locale's form ("1,240.00 US$").
23. English fallback labels read left to right inside their own element. No punctuation jumps to the wrong
    end.
    - The save flash on the ar page is wrapped `<bdi lang="en" dir="ltr">`, and its full stop stays at the
      end at 390 (F03).
    - With no chosen name, every English sentence on the ar page says "your assistant". No Arabic fallback
      name (مساعدك) appears inside English text. With a chosen name, the name appears as typed.
    - Row labels are sentence case and don't change with the count: "Drafts you sent as written … 1".
    - In Handed to you, "Another reason" is the last reason row even when its count is higher.
24. The formula keeps its order: "18 replies × 5 min = 1.5 h" is not reversed.

### 5.6 Interaction and access

25. **Buttons do things, doors go places:** the only `<button>`s are Show, Save and the e-mail switch's one
    button, each inside its own form. No `<a class="btn">`. `buttons-and-doors.ts` passes on the page.
26. **Keyboard order:** skip link → rail → tabs → back door → previous month → Month select → Show → next
    month → (owner) the disclosure summary → minutes field → Save → the e-mail switch's button.
    - Focus is visible on paper and surface.
    - The disclosure opens with Enter and Space.
    - After Save, focus lands on the flash or the page top, not lost.
    - **Known, shared, pre-launch (N01):** pressing Tab at once after opening the disclosure can skip the
      minutes field while the opening animation runs. It passes once the content is shown, and under
      reduced motion. Not a 4.3 blocker. The fix is in the shared `<details>` animation: animate opacity /
      transform only, so the content can take focus from the moment `open` is set. Re-run the immediate-Tab
      replay on every page with a `<details>` when it lands, before launch.
27. 390 wide:
    - no horizontal scroll;
    - the tab row wraps, unclipped;
    - every door, the select and the button are at least 44 px tall;
    - body text is 16–17 px.
28. One `h1`. Each section has an h2 and `aria-labelledby`.
29. Palette: black Save with a white label; magenta doors and the active tab. There is no wash, gradient,
    shadow card or chart.
    - Read the computed colour: the active "Monthly report" tab and both month doors are `#9A0F5E`
      (`rgb(154, 15, 94)`). The month doors use the shell's door class and arrow, not a class of the page's
      own (F02). All four Results tabs mark the active one the same way.
30. Banned words: none of "AI", "buyer", or an assistant pronoun in any new string. The owner-term scan
    passes.

### 5.7 The e-mail (test transport, clock advanced)

31. On the 1st at 08:00 in the workspace's zone, exactly one mail goes to the owner for the month before.
    None goes to staff.
32. The subject is as in §4.2. The body:
    - names no customer;
    - holds exactly one URL, the month page;
    - shows the estimate line only when minutes are set;
    - shows the same figures as the page for that month.
33. An empty month sends nothing. A practice copy sends nothing. With the switch off, nothing is sent. A
    retry of the job does not send twice.

### 5.8 The e-mail switch, on the month page

34. **Owner sees it:** the last section is "Monthly e-mail", with the "on" line and the button "Stop the
    monthly e-mail" (on by default, for every workspace).
35. **Staff do not:** the section isn't drawn for staff at either width or in either language. A staff POST
    to `/app/results/month/mail` changes nothing.
36. Owner presses Stop:
    - the flash "The monthly e-mail is stopped…";
    - the same month is shown again;
    - the line now says it is stopped, and the button reads "E-mail me each month".
    - Pressing that button turns it back on, with its flash.
37. A hand-made POST with `mail=maybe` is refused (400) and the setting is unchanged.
38. The mail's last line says it can be stopped at the foot of the month page. It names no Settings or
    Notifications page, and the e-mail still has exactly one URL.

---

## 6 · Decisions (the supervisor, t1r, 2026-11-07)

These were open questions in the first commit. The spec above now follows each one.

1. **"Customers answered"** counts the customers who were actually SENT a reply {name} wrote, by the
   workspace's month. It is never billing's figure. Billing's `customers_answered` (0117) counts a draft
   that never went out, by UTC month. Pricing is the owner's; the PR notes the difference.
2. **The e-mail is stopped by an owner-only switch on the month page itself** (§3.3,
   `POST /app/results/month/mail`, `mail=on|off`). The Settings › Notifications line is dropped. The
   e-mail's last line says it can be stopped on that page. Its browser checks are §5.8: the owner sees it,
   staff do not.
3. **First month** = `signed_up_at`, else `created_at`. Accepted. The 59 operator-made workspaces have no
   `signed_up_at`, so their first month is the month they were made.
4. **"Drafts not sent"** is accepted, keyed `monthReport.replies.notSent` (one string since §7.1), with
   `monthReport.def.notSent`.

---

## 7 · Amendments after the design review of cand/4.3-0 (accepted by t1r, 2026-11-08)

1. **Row labels are sentence case, one string each**, with no `.one` / `.other`: "Customers answered",
   "Drafts you sent as written" and so on (§4.1). The figure follows the label, so a count-agreeing phrase
   read wrong ("draft you sent as written … 1"). Sentences with a figure inside keep their plural forms.
2. **"Another reason" is always the last reason row** in Handed to you (§1.7).
3. **The minutes field is `type="text"` `inputmode="numeric"`**, with no `min` / `max` / `step` / `pattern` /
   `required`, so our refusal words are what the owner sees (§2.2, check 18).
4. **The name inside English fallback text is English:** "your assistant" when no name is chosen; a chosen
   name as typed. Resolved once, where the fallback is resolved (scope rules, §4, check 23).
5. **An English flash on a page in another language** is wrapped `<bdi lang="en" dir="ltr">`, never
   `dir="auto"` on the shared banner (F03; §2.4, check 23).
6. **The month doors and the active tab are magenta**, as already specified (§1.4). In the review, the doors
   used a class of their own and the shared active-tab rule computed black (F02). Fix the shared rule, not
   the page. No spec change; restated so the tester checks it (check 29).
7. **N01 is a known shared defect, to fix before launch.** It is not a 4.3 blocker (check 26).

