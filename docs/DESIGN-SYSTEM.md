# Nomi design system

Nomi helps a solo owner answer customers and keep the books. Pages use a shared paper theme, plain task names and a stable navigation hierarchy. This guide replaces the earlier split-theme guidance, including the rose header wash, colored Send button and feature-flag-only styling rules.

## Delivery scope

The approved eight-area implementation covers Today, Inbox, Customers, Products, Books, Assistant, Settings and public pages. The [review index](design/redesign/README.md) links each area's desktop/phone evidence, route moves and verification. The [141-page map](design/redesign/page-map.tsv) retains the original inventory and its two explicit screenshot exclusions. Release status is recorded in `docs/PROGRESS.md`.

| Area | Owns |
|---|---|
| 1 · Today | Shared tokens and shell; Today, Calendar, Sales results and Getting started |
| 2 · Inbox | Views, conversation, draft review, saved replies and contextual Ask Nomi |
| 3 · Customers | Customer and operational order lists, records, labels, feedback and follow-ups |
| 4 · Products | Catalogue, product details, imports, photographs and price limits |
| 5 · Books | Home, owner tasks, accurate figures, spending journey, documents and exports |
| 6 · Assistant | Knowledge, Practice, checks, activity and full-page Ask Nomi/history |
| 7 · Settings | Focused settings groups and canonical destinations |
| 8 · Public pages | Authentication, customer documents/chat, legal pages and website |

## Theme

**The UI correction (the owner, 2026-11-13) supersedes the warm paper below it in history.** Block 1 moved the signed-in
app to this theme; the public pages (website, legal, customer documents, web chat) keep their previous tokens
(`PUBLIC_TOKENS`) until their own block. Evidence: [Block 1](design/ui-correction/block1/README.md).

| Role | Value or rule |
|---|---|
| Page | Neutral off-white `#FAFAF9` |
| Surface | White `#FFFFFF`; flat, separated by thin neutral lines `#E4E4E1` |
| Text and primary actions | Ink `#171717`; the one filled button on a task, with a white label |
| Secondary text | `#5E5E5A` |
| Secondary actions | Ink text, white ground, a 1 px control edge `#8A8A86` (also every field's edge) |
| Consequential actions | White ground, a heavy ink edge and weight; set apart by wording and place; never red |
| Magenta | `#9A0F5E`, sparse: the seal, the dot before what waits, the rail's count. Not links, tabs, selections, fields or panels |
| Where you are, links, focus | Ink: a quiet tile and weight for the rail, an underline for a link, a 2 px ink ring for focus |
| AI output | A neutral surface, the seal as its cue, clear attribution |
| Green | `#3F6B5C`: quiet confirmation of paid or done, with its tick and word |
| Type | One sans (vendored Noto, a per-language order) for everything, titles and names included; page title 26 px semibold (24 on a phone); body 17; tabular figures |
| Corners | Control 8, card 12, panel 16 |

No decorative header wash, gradients, shadow cards, ornamental banners or large glowing identity graphics. A necessary operational notice stays beside the affected task and states what happened and what the owner can do. Charts present data; they are not decoration.

Preserve the supplied Nomi seal artwork. Use the existing mark helpers rather than redrawing it. Thin line icons aid recognition; every navigation item and meaningful action still has a label. Customer photographs are round, with an initial when no photograph exists. Product thumbnails use actual catalogue photographs; an absent photograph must not look like a failed download.

Use locally served fonts. The working app is set in one sans throughout; a serif remains only on the public pages and paper documents until their block decides. Aim for 16–17 px body text, clear heading hierarchy, stable numeric alignment and at least 44 px touch targets. Reuse spacing, radius and typography tokens. Keyboard focus must remain visible on paper and surface backgrounds. Respect reduced motion.

The token source is `src/core/owner/tokens.ts`. The shared shell and base rules live in `src/api/web/layout.ts`; the Today/Inbox rules also use `src/api/web/splitStyle.ts`. Existing internal names and flags are implementation details, not a separate visual contract.

## Navigation

Every signed-in page, Books included, keeps the same labelled primary rail. Settings is pinned at its foot. A selected area owns its secondary navigation and remains selected on its records and subpages. Permission-limited viewers see only their permitted destinations; hiding a link never replaces server authorization.

| Primary area | Secondary destinations |
|---|---|
| Today | Today · Calendar · Sales results · Getting started |
| Inbox | Needs you · Gone quiet · With your assistant · With your team when relevant · Everyone |
| Customers | All customers · Orders · Follow-ups · Labels · Feedback; Sample requests for relevant businesses |
| Products | All products · Add products · Price limits |
| Books | Overview · Get paid · Spending · Bank · Reports and tax · Year end; Advanced below |
| Assistant | Overview · Knowledge · Practice · Check replies · Activity · Ask Nomi |
| Settings | Business · Channels · Assistant · Books · Team · Billing · Personal |

On a phone, use Today · Inbox · Customers · Books · More. More contains labelled links to Products, Assistant, Calendar and Settings. Omit Books when unavailable or forbidden and preserve the existing role-specific shell. A labelled section chooser replaces the secondary sidebar. Menus must open by keyboard, close predictably and leave focus usable.

Getting started remains reachable after completion, even when its home checklist disappears. Keep Did not send and Deletion requests reachable in Inbox, showing their views when relevant. Records need a clear route back to their list; preserve applicable filters and scroll position. Public authentication, legal and customer-document pages keep the minimal public shell.

Area-owned route changes land with that area. Old GET addresses redirect to the canonical page while preserving record IDs, supported query parameters and return anchors. Existing POST actions continue to invoke the same authorized commands. Callback, export, webhook and signed public-link contracts remain stable.

## Fifteen layouts

| Layout | Structure | Phone behavior |
|---|---|---|
| 1 · Overview | Today has one priority decision followed by Sales and Books summaries. Other overviews use concise totals and actionable rows. | Priority first, then stacked summaries. |
| 2 · List | Search and scoped views above aligned, selectable rows. | Two-line rows with essential facts and a large tap target. |
| 3 · Conversation | Inbox views/list, transcript and one optional panel. Customer details and Ask Nomi share that panel. | List, chat, details and Ask Nomi are separate views with a clear return; preserve the unsent draft. |
| 4 · Detail | Record identity, fact sections, history and actions beside the facts they change. | Readable sections in a useful order. |
| 5 · Document | Invoice/credit note with issuer, recipient, dates, line items and totals; actions outside the paper. | Reflow for reading; retain a proper print document. |
| 6 · Table | Compact toolbar, aligned columns, useful headings and totals. | Essential columns first; label a horizontal region only where comparison needs one. |
| 7 · Settings form | Group navigation and one subject with related fields and its own Save. | One column, group back link and visible field labels. |
| 8 · Data entry | Task heading, grouped fields, repeating line editor, persistent total and final action. | Legible line groups with visible quantity, price and tax controls. |
| 9 · Status rows | Each setup or connection check states its real condition and next action. | Stack the same rows with a short explanation and one next step. |
| 10 · Step flow | One question, progress, Back/Continue and a final review before learning or importing. | Full-width step with the same confirmation boundary. |
| 11 · Sign-in | Supplied large seal and centered, narrow form. | Spacious single column; retain code, recovery and verification states. |
| 12 · Empty state | Explain the purpose and give one useful next step. Distinguish empty, disabled and no search results. | Same meaning and action, without ornamental illustration. |
| 13 · Reading | Quiet prose column, useful anchors and comfortable line length. | Readable type and measure; preserve legal wording. |
| 14 · Website | Honest product story, real app examples and invitation/sign-in routes. | Vertical sequence, without a signed-in rail. |
| 15 · Calendar | Month grid, selected-day agenda and overdue commitments. | Agenda first with a date picker/month control; never compress the desktop grid into unreadable cells. |

A working state is part of its layout: waiting, loading, refusal, error, unavailable, permission-limited and empty views must retain the relevant explanation and next action. A whole-page overflow check does not prove that nested fields and controls are reachable.

## Content and action boundaries

Today preserves the exact draft words, reply editing, source-reading disclosure, channel deadline and existing Send, Hand to me and No reply needed controls. The approval command decides what may send. A layout change must not create another send path or hide the evidence needed to approve.

Ask Nomi uses the owner's chosen assistant name. Opening a contextual panel makes no paid call. Keep factual answers, source links and suggested reply text distinct; inserting a suggestion into the composer does not send it. Later integration must reuse allowance, privacy, tenant and history boundaries, with authorized customer context resolved on the server.

A figure needs a truthful definition, period, currency and destination. Do not relabel posted income as cash received or posted expense as cash paid. The later Books home must derive cash movements without transfer or matched-payment duplication, invoice balances after credits/payments, recorded supplier liabilities and fiscal-year profit. Unavailable data needs an honest unavailable state. Owner tests do not inflate sales figures; unsupported or absent values never become invented zeroes.

Settings have one canonical owner. Related pages may link to that owner with a useful return path. Personal history choices and workspace history policy remain separate permissions. Preserve real channel availability, import/export safeguards, tax and locking checks, deletion controls and confirmation boundaries.

New redesign copy is authored in English through the existing translation catalogue. Until a reviewed translation exists, use its English fallback; do not invent translations or insert new English strings directly into renderers. Preserve existing locale switching, language-specific fonts, bidirectional isolation and translated functionality. Review screenshots for this redesign in English only. Customer messages and record names remain their actual content.

## Verification

For each area, retain desktop and 390 px phone captures, a short route/move list and evidence of its empty, error and permission states. Inspect the actual images and nested form controls. Check active navigation, keyboard/focus behavior, menu closing, working links, readable type, black action buttons, palette, source controls and absence of decorative banners or overflow.

Run `npm run check`, `npm run trust`, `npm run build` and the isolated integration runner on Node 22. Changes involving sending or approval also require the scripted pre-pilot against an isolated local database, with a before/after comparison when approval UI changes. Keep synthetic fixtures and credentials outside deliverable captures. Verification uses no production connection, paid model run or live message. Completion claims must name the checks actually run and any remaining limitation.
