# The later UI/UX pass — what to look at first

Written 2026-09-28, when decision 5 (the row) was settled provisionally for V1
(`docs/DESIGN-V1-BRIEF.md` §8). Symow asked for this list to exist before the
pass starts. **Nothing here is fixed or decided** — each item is a place to
look, with where to see it and why it earned its place. Ranked by how often the
owner meets it and how much it costs them each time.

The screenshots named below are in `docs/design/`; the full set is
`node tools/screenshots.mjs` on a local instance (`docs/DESIGN-V1-BRIEF.md` §10).

## Look at first

1. **The conversation page, on a phone, is three screens of controls around
   one decision.** (`v1-closeout/conversation-en-phone.png`,
   `conversation-ar-phone.png`)
   - The draft appears twice: quoted in the review card, then again in full in
     the edit box under it.
   - There are two ways to send it (`Send`, `Send my edit`), and three short
     paragraphs explain the three buttons.
   - Below that sits a second card for who holds the conversation (Take over;
     Hand to, a select, and Hand over), then the quote card.
   - The owner's one frequent act — read what the buyer said, send or change
     the reply — has to be found among eight controls.
   - Where to start: one card with the draft, editable in place; the other
     acts demoted.
2. **Buttons and doors are still mixed.** Decision 4 says buttons do things
   and doors go places. Today's "Review" and "See the buyers" are
   navigations drawn as buttons (`live-refresh/today-line-en.png`), and
   `<a class="btn">` is still common across pages. No test holds the rule yet,
   so a pass that fixes it should add the test first.
3. **Today says the same thing twice, and one line is ungrammatical.**
   (`live-refresh/today-line-en.png`)
   - "Worth your attention" and "Needs your attention" are two sections with
     near-identical headings.
   - "1 replies are written and waiting for you": `insight.draftsWaiting` has
     one form for every count. Other count sentences may share the problem.
   - The stat rows put the figure and its words far apart.
4. **The type on desktop Chrome and Android is not the type on an iPhone.**
   The family stack starts with `-apple-system`, which only Safari matches.
   Chromium falls to PingFang SC for English (hyphens render wide in every
   Chromium screenshot), and Android to whatever it has. `system-ui` after
   `-apple-system` is the likely fix. Type is Symow's (decision 1).
5. **Names that are not names.**
   - A workspace provisioned before logins existed has an owner named after
     the business, so the "Hand to" select offers "义乌宏发日用品厂 (demo)" as a
     person (`conversation-en-phone.png`).
   - The browser tab's title names the assistant, not the business.
   - On Buyers and the conversation page, the Arabic word for "buyer" standing
     alone under a message is now مشترٍ, which reads oddly as a label. It is on
     the native-review list.

## Then

6. **The live line sits over the page's last controls.** It is fixed to the
   foot of the column (`live-refresh/conversation-line-*.png` shows it over
   the reply box). How it behaves with the phone's keyboard open was never
   checked on a real phone.
7. **Setup is one long page.** The business-profile form is inline among the
   doors, and Log out sits at the very bottom under it
   (`v1-closeout/setup-en-phone.png`).
8. **People has two pill idioms** (jade "you", jade "online"), noted in the
   V1 review and never ranked (`docs/DESIGN-V1-REVIEW.md`).
9. **The calendar is long on a phone** (21 days a page) and has no way to jump
   to today except the day heading. Its kind-of-date word is new
   (2026-09-28); see how it reads in use. In Arabic its price line shows
   `$1.95` as `1.95$` (`calendar-kind/calendar-ar-phone.png`): the figure is
   not isolated there, as it now is on products and quotes.
10. **The door still offers "I have an access code" to everyone.** It is for the
    pilot's owner and staff codes. Most owners now sign in with an e-mail, and
    the toggle is a question they do not need.
11. **Dark mode** is out of V1 by decision 3: the tokens exist and are
    unreviewed. The pass should either take it in or remove the
    `prefers-color-scheme` block, not leave it half-kept.
12. **The native-review backlog** (`docs/NATIVE-REVIEW-UI.md`) grows with every
    batch: 278 zh/ar lines listed on 2026-09-28. A pass that rewrites copy
    should clear it with a native reader in the same sitting, not add to it.
