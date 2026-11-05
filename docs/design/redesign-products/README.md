# Products

Products now uses All products, Add products and Price limits in the shared shell. The catalogue supports complete bounded paging and search, includes inactive records and displays only stored served thumbnails. Product records keep their existing identity, pricing, photo, names, optional quantity details and teaching controls.

| Surface | Route and behavior |
|---|---|
| All products | `/app/products`; search and paging retain the row return context |
| Product record | `/app/products/:id`; existing edits, names and photo actions keep their filtered-list return |
| Add products | `/app/products/add`; paste, printed-photo, store-address and file methods, with current availability and refusal rules |
| Review | `/app/products/import/:id`; saved row edits, flags, challenge checks and original-source access |
| Column mapping | `/app/products/import/:id/columns`; source preview scrolls within its labelled region; mapping fields stay outside it |
| Lowest prices | `/app/products/import/:id/floors`; explicit floor choices retain existing pricing authority rules |
| Price limits | `/app/products/price-limits`; old GET redirects preserve product context; existing POST endpoints remain authoritative |

Existing knowledge and export destinations remain working. Product records, import review and pricing authority retain their existing services. No new price policy or automatic teaching was introduced. An unticked floor can leave a product recorded but inactive; it does not invent a pricing rule. Correctly typed photo challenge answers retain their explicit confirmations.

## Review images

| Surface | Desktop | 390 px phone |
|---|---|---|
| Catalogue | [View](products-desktop.png) | [View](products-phone.png) |
| Product with a stored photo | [View](product-desktop.png) | [View](product-phone.png) |
| Add methods | [View](add-desktop.png) | [View](add-phone.png) |
| Flagged review | [View](review-desktop.png) | [View](review-phone.png) |
| Column mapping | [View](columns-desktop.png) | [View](columns-phone.png) |
| Floor choices | [View](floors-desktop.png) | [View](floors-phone.png) |
| Price limits | [View](price-limits-desktop.png) | [View](price-limits-phone.png) |

[Refused price field focused without script](price-error-phone.png)

## Local verification

The comparison covers 76 English visits per build across the seven mapped surfaces and their empty, search, inactive, role and refusal states. No document overflow or browser page error was observed. Both viewports traversed all 207 fixture products once across five pages, and search reached the final inactive record. A dedicated read-only pass left all 10 tracked tables unchanged.

Browser checks cover exact typed fields, caret and tick preservation across source jumps with script on/off, protected challenge values, mapping and floor controls, current-record command safety and 44 px phone targets. A browser-discovered focus issue was fixed by removing fragments from price POST actions; the existing success redirects retain their section anchors. All six general/product/volume error cases focus the correct field with script on/off.

Local synthetic commands verify edit/refusal/no-minimum/offering behavior, retained errors, stored photo replacement/removal, source permissions, explicit change choices, extraction containment, currency re-review, challenge mismatch and floor authority. Scripted reading ports and a blocked external fetch guard were used, with no workers, paid/live model call, live store request, production connection or customer send. These checks verify the exercised interface and safeguards; full repository and release gates are reported separately.
