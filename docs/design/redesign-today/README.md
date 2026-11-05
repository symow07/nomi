# Today and shared navigation

Area 1 of the approved redesign. The shared paper theme and primary navigation apply to signed-in pages; Today, Calendar, Sales results and Getting started have their new layouts. Other areas retain their existing contents until their area PR.

## What moved

| Old address | New home |
|---|---|
| `/app` | Today, with the priority approval before sales and books summaries |
| `/app/analytics` | `/app/results` |
| `/app/guide`, `/app/onboarding` | `/app/get-started` |
| `/app/onboarding/activity` | `/app/results?view=setup` |
| `/app/settings/assistant/month` | `/app/results?view=assistant` |
| `/app/calendar` | Today → Calendar; agenda comes first on phones |

Redirects preserve query parameters. Existing POST handlers, signed links, callbacks and exports keep their contracts. Customers and Assistant are working entrances to their current tools while their fuller layouts are pending. Daily reply checks and activity select Assistant; configuration remains under Settings.

The owner rail is Today, Inbox, Customers, Products, Books and Assistant, with Settings at the foot. Phone navigation is Today, Inbox, Customers, Books and More. Team and accountant permissions still determine available destinations; unavailable Books pages retain the shared shell and their refusal status.

## Behavior retained and clarified

Approval retains the actual draft, saved edits, source disclosure, channel deadline, Send, Edit, Hand to me and No reply needed. A changed draft or conversation produces an update notice without replacing typed words. The scripted approval checks cover the same send path before and after this change.

Sales counts include all eligible records. Amounts use the workspace currency, disclose records in other currencies, and omit the amount when no records use that currency. The existing Books summary is labelled income and expenses; cash Received/Paid out definitions belong to the later Books area.

Getting started combines the saved setup checklist and real readiness checks. Existing name confirmation, attestations, practice and installation-only details remain available. No guide-video promotion remains on these pages.

## Screenshots

English interface, synthetic local data, disabled provider. Customer words retain their own language.

| Page | Desktop | Phone |
|---|---|---|
| Today | [View](today-desktop.png) | [View](today-phone.png) |
| Calendar | [View](calendar-desktop.png) | [View](calendar-phone.png) |
| Sales results | [View](results-desktop.png) | [View](results-phone.png) |
| Getting started | [View](getting-started-desktop.png) | [View](getting-started-phone.png) |
| Changed draft, typed edit retained | [View](today-update-desktop.png) | [View](today-update-phone.png) |
| Other-currency records | [View](today-currency-desktop.png) | [View](today-currency-phone.png) |

The browser matrix also covers empty Today, Books disabled, team/accountant restrictions, readiness, practice checks, technical details, all result views and the shared shell on Inbox/Books. Local menu checks exercise keyboard open, Escape, focus return, outside click and every destination. Approval inspection checks the exact form/draft/source controls; automated browser checks send no customer messages.
