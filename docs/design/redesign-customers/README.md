# Customers

Customers now has a directory of real customer records, including people without a conversation and people whose conversations are closed. Each record combines the overview with a selected conversation’s history and channel controls. Other conversations remain individually selectable; private tests stay outside these customer facts.

| Destination | Route and behavior |
|---|---|
| All customers | `/app/customers`; search, active labels and bounded paging |
| Customer record | `/app/customers/:clientId`; validated `conversation` selection, overview, recorded orders, history and existing privacy controls |
| Operational orders | `/app/customers/orders`; recorded states, search, customer filter and paging; existing `/app/orders/:id` detail and commands |
| Labels | `/app/customers/labels`; shared labels still filter Inbox |
| Feedback | `/app/customers/feedback`; existing 90-day records and owner activation rules |
| Follow-ups | `/app/customers/outreach`; existing contacts, suppression, first-message, find and sequence tools, when the workspace feature is available |

The old GET destinations redirect to their corresponding Customers pages while preserving supported context. Existing POST endpoints remain authoritative. Operational orders remain separate from the Books invoicing workflow. Order value uses standing orders in the newest order’s currency, with omitted-currency and unknown-amount explanations; it is not money received.

## Review images

| Surface | Desktop | 390 px phone |
|---|---|---|
| Directory | [View](customers-desktop.png) | [View](customers-phone.png) |
| Unified record | [View](customer-desktop.png) | [View](customer-phone.png) |
| Operational orders | [View](orders-desktop.png) | [View](orders-phone.png) |

[No-conversation record](no-conversation-phone.png) · [Compact card](compact-phone.png) · [Follow-ups](followups-phone.png) · [Privacy controls](privacy-phone.png)

## Local verification

The comparison covers 102 English desktop/phone page visits for each build. First-message refusal screenshots remain excluded as specified in the approved inventory; the routes and current refusals were inspected. No document overflow or browser page error was observed. A separate GET-only pass left all 12 tracked table snapshots unchanged.

Browser checks cover directory and order paging, filters and return anchors, closed/no-conversation records, historical selection, missing and foreign records, literal search and labels, overview agreement, phone section chooser, keyboard/Escape/focus, compact cards, exact unsent text/caret/form identity, no-script navigation, roles and outreach feature gates. Safe synthetic rename, Stop/lift and order-stage forms retain their return context through success and refusal. Existing deletion controls and owner restrictions remain visible on their existing paths; no erasure was performed.

Evidence uses separate local synthetic clones with external fetch blocked and intent recognition scripted. No real customer message, production access or paid/live model call was used. This verifies the exercised interface and command boundaries. Full repository checks and release gates are reported separately.
