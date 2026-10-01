# The launch acceptance test (G8)

Cohort 1b — real customers — opens on the day both of these hold:
**App Review has approved Nomi's Meta app (M4)**, and **this test has passed
on production**. There is no completion gate from 1a.

> **Never run yet.** It needs Meta's approval: before it, a customer's message
> reaches a stranger's Page only from people added to the app on Meta's side.

## Who does it

Three people, none with any role on Nomi's Meta app or Nomi's Business
Manager, each on their own device:

1. **The owner** — a fresh e-mail address, a Facebook account that admins a
   Facebook Page with an Instagram professional account linked to it.
2. **The customer** — a second Instagram account, not following the Page.
3. **The operator** — reads what the product wrote, with the tool below.

Claude never creates these accounts or types their passwords.

## The steps

The owner, with a stopwatch running only while they act (not while Meta's
own screens load, and not while waiting for the customer):

1. Asks for an invitation on the site, opens the link, signs up: the terms
   box, the six-digit code from the e-mail.
2. Imports a real catalogue: a price list photo, a pasted spreadsheet, or a
   store link — and confirms the review.
3. Names the assistant on Getting ready.
4. Practises until "Ready for customers" says every item is seen.
5. Connects their own Page and its Instagram on Channels.

Then the customer writes to the Page's Instagram ("Hi, do you have …?"), and
the owner:

6. Sees the draft on Buyers (and by e-mail, and on the phone if alerts are on),
   reads it, and presses Send.
7. The customer sees the reply arrive in Instagram.

**Pass:** every step done, the reply arrives, and the owner's own time is
under **30 minutes**.

## Checking it

```bash
railway run --service nomi -- node tools/acceptance-check.mjs --business <the new workspace's id>
```

It reads the rows the product wrote — the sign-up, the confirmed import, the
name, the complete checklist, the live Page with Instagram, the customer's
message, the approved draft, the reply sent and delivered on Instagram — and
prints each step `✓` or `○`; exit 0 only when all are there. It also prints
the time from sign-up to the reply sent, which includes Meta's screens and the
customer's wait: the 30 minutes are the stopwatch's, not this number.

Find the workspace's id with `node tools/workspaces.mjs --self-serve`.

Record the result in `docs/PROGRESS.md` ("Never run against live Meta"), with
the date and the stopwatch time.
