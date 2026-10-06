# The advisor batch's fixes — Results and the privacy page

Taken 2026-10-06 on a local instance (the demo workspace; Chromium, device scale 2), at 1280 px and 390 px, in en, zh, ar, es and fr.

- `results-*`: Results for the month. "Handled" now has Home's meaning: the conversations in which a reply the assistant wrote went out. It no longer counts replies sent from drafts. The owner's own test conversations count in no figure.
- `privacy-*`: the privacy page's new line, right after the provider that drafts replies. It says the same provider writes the advisor's answers, and that the question and the records that answer it (customers' names, amounts and dates) are sent there. Locally the provider is the default one (Anthropic). In production it is DeepSeek, because the page names whichever provider is configured.

Every shot was checked by script: nothing wider than its screen, Arabic right to left, the new label on Results, and the provider named twice on the privacy page.
