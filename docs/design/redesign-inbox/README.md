# Inbox and contextual Ask Nomi

Inbox now has scoped views, a phone view chooser, search and focused filters. Conversations keep their existing approval and reply forms while Customer and Ask Nomi share one optional pane. On smaller screens the pane replaces the conversation view and returns to the same unsent words and position.

## Routes

| Previous or existing route | Current behavior |
|---|---|
| `/app/inbox` | Needs you, Gone quiet, With your assistant, With your team when relevant, Everyone; Did not send and Deletion requests remain reachable |
| `/app/inbox/:conversationId` | Same conversation and authorized send/approval commands; Inbox return keeps supported filters, search, cursor and row anchor |
| `/app/replies` | GET redirects to `/app/inbox/replies`, keeping the query |
| `/app/replies/:id` | GET redirects to `/app/inbox/replies/:id`; existing edit/archive POST actions remain valid |
| `/app/inbox/:conversationId/copilot` | Contextual questions, as an optional pane or a standalone page |
| `/app/inbox/:conversationId/copilot/reply` | Validation only: recompute a permitted suggestion from current records before adding it to the existing composer |

Customer records, operational orders, labels and feedback retain their existing destinations until their own area migrations.

## Review images

| Surface | Desktop | 390 px phone |
|---|---|---|
| Inbox | [View](inbox-desktop.png) | [View](inbox-phone.png) |
| Pending conversation | [View](conversation-desktop.png) | [View](conversation-phone.png) |
| Ask Nomi opened | [View](ask-desktop.png) | [View](ask-phone.png) |

[Numeric evidence in Ask Nomi](copilot-evidence-phone.png) · [Original draft source inspection](draft-source-phone.png)

## Validation scope

The local comparison covers 68 English desktop/phone renders against the prepared before states, with no browser page errors or document overflow. The final browser pass passed 43 Copilot checks and 11 supplemental checks. Browser checks cover native view selection, filter/search/row return, one shared pane, keyboard focus and Escape, typed text/caret/form identity, scroll restoration, current-record sources, stale insertion, delayed-response races, immediate retry after cancellation, permission limits and used allowance. Original approval, takeover, no-reply, deadline, deletion, refusal, uncertain-delivery and order-confirmation controls remain on their existing authorized paths.

Ask Nomi supports the customer's last recorded order, an extractive recap of the loaded chat, and a bounded percentage-discount reply computed from existing price rules. Opening the pane makes no model call. Use reply adds unsent text; it does not send or confirm an order. Unsupported or stale facts remain explicit.

Evidence uses isolated synthetic data and scripted intent recognition. No production connection, paid/live model run or real customer message was used. This verifies interface behavior and the tested boundaries, not model quality or a live channel connection. The scripted pre-pilot passed 14/14 scenarios on the frozen previous build and 14/14 on this implementation, with live mode disabled. Repository-wide gates are tracked separately in the PR.
