# Books

Books now opens with work waiting for the owner and five figures whose account scope and time basis are visible. Received and Paid out describe saved cash movements, transfers are excluded, currencies owed stay separate, refunds and supplier advances remain visible, and profit follows the current fiscal year.

The main menu is Overview, Invoices, Spending, Bank, Reports and Year-end, with Advanced for entries and trial balance. Connections, sales/payment accounts, starting balances, tax details and extra fields now live in Settings → Books. Known bookmarks and old GET routes lead to their canonical destination; existing POST commands keep their validation and authority.

Spending separates keeping an original, requesting a reading, checking its figures, creating a draft and explicitly saving the checked draft to the books. A draft still counts as work waiting. Opening an original or reviewing a reading does not post an entry. Phone forms retain refused values and work without JavaScript.

| Surface | Desktop | 390 px phone |
|---|---|---|
| Scoped overview | [View](overview-desktop.png) | [View](overview-phone.png) |
| Invoices | [View](invoices-desktop.png) | [View](invoices-phone.png) |
| Spending | [View](spending-desktop.png) | [View](spending-phone.png) |
| Guided spending draft | [View](draft-desktop.png) | [View](draft-phone.png) |
| Bank review | [View](bank-desktop.png) | [View](bank-phone.png) |
| Supporting profit report | [View](report-desktop.png) | [View](report-phone.png) |
| Year-end | [View](year-end-desktop.png) | [View](year-end-phone.png) |
| Books settings | [View](settings-desktop.png) | [View](settings-phone.png) |

Issued paper: [invoice](invoice-print.png), [credit note](credit-note-print.png). Their print output omits application controls and labels current issuer details honestly.

The local comparison covers 136 visits per build, plus 20 additional after visits. Final visits have no document overflow or browser page errors. Twenty navigation/read-only checks, seven actual synthetic receipt command checks and four final phone controls checks pass. Paging reaches all 113 invoices, 205 bank lines and 209 pending receipts. The five money figures match independently seeded posted records, and 19 financial/source tables remain unchanged after read-only review. A browser-found workspace date boundary was corrected and checked with a current-day invoice.

[Detailed verification, moves and limits](VALIDATION.md). Evidence uses local synthetic data and scripted reading with external and outbound work blocked. Full repository and release gates are reported separately.
