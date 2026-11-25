# UI correction — the gallery (after Block 9)

One contact sheet per area. Each cell is one inventory path (the audit's IDs above it), en at 1440×900 and ar at
390×844, first screen, motion reduced, on a local instance with its synthetic seed. Public pages are seen signed out.
The design rules these pages follow are written down in `../DESIGN-SYSTEM.md`.

Cells that do not show their page, and why:

- 117, 120, 121 (outreach): 404 — the outreach area is off by default per workspace (rule 8) and is off on the seed.
- 30 (an entry's edit form): 404 — the seed's entry is posted, and the edit form serves only a draft entry.
- 38 (the FEC export): 404 on the seed's workspace; the cause was not traced in Block 9.
- 100 (`/app/settings/components`): 404 — the component gallery is served only when the installation turns it on.
- 138 (`/u`): 404 without an unsubscribe link's own token.
- 67–70 (How you sell, one part each): the part's address lands on How you sell itself.
- 130 (`/verify`): without a code it lands on the login page.

Entries not drawn at all (no local page: they need a real provider, a real e-mail or a live channel): 9, 17, 25, 26,
35, 43, 44, 45, 66, 118, 119, 122, 128, 137, 139, 140. 141 was drawn in Block 8.
