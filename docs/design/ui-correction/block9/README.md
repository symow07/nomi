# UI correction Block 9 — screenshots

Synthetic data only (a local instance and its seed). Full-page PNGs, `<page>-<lang>-<width>x<height>.png`.

- `before/` — aa752c3c (origin/main when Block 9 began). `after/` — the head of `ui-block9-finish`.
- en and ar at 1440×900, 720×450 (200 %, device scale 2), 390×844 and 320×568, every page and state.
- 900×700, en and ar (the 721–1099 spot check): customers, invoices, invoices-nomatch, knowledge, orders, product,
  products, profile.
- es, fr and zh at 1440×900 and 390×844 where length matters: billing-unavailable, customers, invoices,
  invoices-nomatch, labels-empty, orders, product, products, profile, telegram-unavailable.
- `-staff-` and `-accountant-` shots are the same pages signed in as a team member and as an accountant (people added
  through Settings › People on each side's own instance), en at 1440×900 and 390×844. A page a role cannot open shows
  where that role lands.
- The F47 states: `*-empty` (nothing yet), `*-nomatch` (nothing matches the filters), `*-unavailable` (not on this
  installation's set-up, or billing not switched on). Each was reached on the local seed; none is drawn by hand.
- `customers-search` is the Customers list with a search typed (F07, F09). `invoices-paid` is the invoices list
  filtered to paid (F07).
