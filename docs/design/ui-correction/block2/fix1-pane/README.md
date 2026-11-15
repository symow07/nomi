# Ask Nomi conversation pane — Block 2 fix round 1

Captured from `22bd0cb9` with synthetic local data. Each of the 32 images was opened
whole during builder review. English and Arabic; 1440×900, 1280×900, 390×844, 320×568.

`ask-pane-{language}-{width}-{state}.png`: `closed` is before opening with an unsent
edit; `loading` holds the local GET response; `open` is the real ready pane;
`error` returns a local 503 for that GET. No question or message was sent.

At 1440 the pane sits beside the conversation. At 1280 it replaces the conversation
and preserves the list. At phone sizes it replaces the conversation; its contents
scroll above the tab bar. English catalogue text is still English in Arabic;
paragraph direction now keeps its punctuation in place. The loopback address shown
in the footer is the test installation's deliberately disabled provider.

Eight browser cases passed: loading/error text present, no stale loading text in
the ready state, no horizontal overflow, the unsent edit preserved, Escape focus
returned to the opener, and the page scroll restored after close. These are builder
checks in desktop Chromium emulation; independent and real-device checks remain
with the tester. No product change in this evidence commit.
