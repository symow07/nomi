# UI correction Block 8 — screenshots

Synthetic data only (a local instance and its seed). Full-page PNGs, `<page>-<lang>-<width>x<height>.png`.

- `before/` — cfc71dca. `after/` — the head of `ui-block8-public`.
- en and ar at 1440×900, 720×450 (200 %, device scale 2), 390×844 and 320×568, every page and state.
- 900×700, en and ar: chat, cookies, login, privacy, proof, signup (the 721–1099 spot check).
- es, fr and zh at 1440×900 and 390×844 where length matters: chat, cookies, data-deletion, login, privacy,
  refunds, setpw-gone, signup, terms, unsub.
- `r-*` pages are states drawn by a local renderer from the page functions (the same HTML the app serves), for states
  a visit cannot reach without a real e-mail or a fault.
- `signup-refused`: the after shots are the "check what is marked" state in both languages; the before ar shot is the
  "too many tries" state (that hour's local sign-up count was used up when it was taken).
