# Grouped Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. The approved user instruction authorizes inline execution through the gated merge.

**Goal:** Put every existing setting in one of seven focused groups, preserving its real command, permission, confirmation and refusal behavior.

**Architecture:** Add a presentation-only route registry and Settings wrapper. Existing loaders, command handlers, callback paths, privacy services and accounting services remain authoritative. Register canonical GETs and authenticated bookmark redirects; retain original POST URLs and download endpoints.

**Tech Stack:** TypeScript, server-rendered Fastify, Kysely/Postgres, Vitest, local Playwright, Node 22.23.4.

## Global Constraints

- Warm paper #F7F3EE, surface #FFFDFA, ink buttons, magenta #9A0F5E only for highlights, quiet green only for paid/done; unchanged seal.
- New copy is English in the existing redesign fallback catalogue. Keep existing translated functionality; take only English screenshots.
- No migration, production connection, paid calls, live messages or changed sending decisions.
- Old GET routes authenticate before redirecting. Existing POST, callback and download routes keep their current authorization.
- Own worktree, ports and temp directories only. Never stop a process not recorded as started by this run.
- One Settings PR; check, trust, build and isolated integration all green before PR; exact-head CI and tools/gated-merge.sh before merge.

## Files and interfaces

- Create `src/api/web/settingsNavigation.ts`: `settingsDestination(path: string): string | null`, `settingsGroup(path: string): SettingsGroup | null`, `settingsHref(path: string): string`. Pure local path mapping, no DB and no commands.
- Create `src/api/web/settingsArea.ts`: `settingsArea(body: string, locale: Locale, path: string, viewer: Viewer): string` and `renderSettingsIndex(locale: Locale, flash: Flash | null, viewer: Viewer): string`. Own group navigation and menus, not settings authority.
- Create `src/api/web/settingsAreaStyle.ts`: scoped layout and form styles.
- Create `src/core/owner/i18n/settingsArea.ts`; register in `redesign.ts`.
- Modify `app.ts`, `layout.ts`, `settings.ts`, `factory.ts`, `channels.ts`, `howYouSell.ts`, `employee.ts`, `people.ts`, `assistants.ts`, `advisorHistory.ts`, `phoneAlerts.ts`, `businessKind.ts`, `books.ts`, `account.ts` for route registration, focused rendering and permitted links.
- Add `tests/parity/redesign-settings-navigation.test.ts`, `tests/integration/redesign-settings-routes.test.ts`, and update existing assertions affected by deliberate GET moves without weakening command tests.
- Add `docs/design/redesign-settings/README.md`, `VALIDATION.md` and representative desktop/phone screenshots; update `docs/PROGRESS.md`.

### Task 1: Group navigation and authenticated route moves

- [x] Add pure navigation tests, including command-prefix exclusion, `/app/settings/business` staying the new group root and personal/accountant routes:

```ts
expect(settingsDestination('/app/settings/profile')).toBe('/app/settings/business/profile');
expect(settingsDestination('/app/settings/closures')).toBe('/app/settings/business/hours');
expect(settingsDestination('/app/settings/people')).toBe('/app/settings/team');
expect(settingsDestination('/app/settings/account/password')).toBeNull();
expect(settingsDestination('/app/settings/business')).toBeNull();
expect(settingsGroup('/app/settings/books/accounts')).toBe('books');
```

- [x] Run `npx vitest run tests/parity/redesign-settings-navigation.test.ts` on Node 22 and record the missing-module failure.
- [x] Implement the registry with exact legacy GET entries and explicit dynamic selling-question mapping. Canonical selling question names use hyphens; command names continue using underscores. Return targets and anchors use `URL`/`URLSearchParams`, never arbitrary external URLs.
- [x] Add the seven-group wrapper and index. Desktop uses one narrow group rail; phones use a native labelled group chooser and back link. Books settings use this wrapper rather than nesting the old Books sidebar.
- [x] Register canonical GETs using the same auth wrappers/loaders. Add legacy redirect handlers using existing `movedPage`. Add canonical account/language paths to the accountant GET allowlist only.
- [x] Verify owner, staff, accountant and anonymous outcomes; verify GETs never invoke model or sender ports. Commit registry and focused tests.

### Task 2: Business and Channels

- [x] Extend integration cases for `/app/settings/business`, `/profile`, `/selling`, `/hours`, `/terms`, `/currency`, `/samples`, `/data` and every channel page. Expected anonymous result is `/login`; foreign/forbidden roles retain the original refusal.
- [x] Compose Profile from existing profile and business-kind forms, with separate existing save commands. Do not remove fields from the profile POST: omitted profile fields would clear values. Hours and Currency read current values and link to their authoritative profile section, alongside existing closures/rate forms.
- [x] Map Business promises and readiness into Assistant; map test numbers into Channels/WhatsApp. All existing connection buttons, tests, callback routes and disclosures remain. Technical setup retains installation-owner gating.
- [x] Preserve selling's one-question/confirmation flow. Canonical GET question parameter converts hyphens to the original wire name before `questionOf`; forms keep `HS_BASE` command paths. Existing safeguards decide whether a confirmation is necessary.
- [x] Verify an invalid profile and selling answer retains exact typed fields, a closure removal/Undo uses its existing signed command, and GET pages leave source/authority tables unchanged. Commit.

### Task 3: Assistant, Team and Personal ownership

- [x] Cover split ownership in integration tests: personal history shows only the viewer's preference/download; workspace history policy is owner-only and never exposes anyone's conversations.
- [x] Compose Assistant authority, progress and reply-type sections using existing employee renderers. Keep Stop, release holds, earned capability and explicit permission forms unchanged. Move assistant identity/job/tone controls out of Team into a focused Assistant identity page; Team keeps people, permissions, codes and rotation.
- [x] Scope newly issued team-code cookies to the canonical Team page. Preserve single-use display, expiry, same signing purpose and no secret URL. Verify add-person and rotate-code commands reach that page and show the code only once.
- [x] Separate advisor-history UI into Personal and workspace policy views using existing `AdvisorMemory` methods. Keep POST and CSV paths. Explicitly preserve consent wording, confirmation and deletion-without-reading behavior.
- [x] Compose Personal notifications from existing browser/email preference and owner WhatsApp controls, retaining each viewer's permissions and return context. Account/password and language stay focused pages. Billing keeps the real configured/disabled state and original checkout command.
- [x] Run affected focused suites; inspect denied controls and refusal data; commit.

### Task 4: Browser coverage and release

- [x] Freeze the final Assistant build as before; clone its synthetic database twice under owned names; use ports 18894/18895, disabled provider, blocked external fetch and no workers.
- [x] Capture every Settings manifest row before and after at 1440×900 and 390×844. Capture supplementary new groups and empty/error/permission states. Inspect long forms and all actual phone controls, not only document overflow.
- [x] Run GET-only source/authority snapshots and compare row counts/hashes. Exercise only local synthetic forms for profile refusal/save, selling confirmation, closure Undo, notification preference, team code lifecycle and history permission separation.
- [x] Run the required Node 22 commands in this worktree:

```sh
npm run check
npm run trust
npm run build
node tools/run-integration-isolated.mjs
```

Use `env -u DATABASE_URL -u MIGRATE_DATABASE_URL` for check and integration; include the owned Postgres binary path for the isolated runner. Expected: all four commands exit 0; integration reports every test ran and none skipped.

- [x] Review the diff for changed commands/permissions, cross-tenant reads, secrets and dropped fields. Document evidence and limits. Update the page map and progress; commit/push with Codex attribution.
- [x] Create one Settings PR based on current main. Run `tools/gated-merge.sh <PR> <full-head-sha>`. When it returns 0, fast-forward shared main and report desktop/phone screenshots plus the moves, then continue Public pages.

## Self-review

The seven groups cover the approved map. Profile retains the complete save payload; currency/hours link to its actual source rather than introducing partial writes. Team code-cookie scope, accountant account/language access, technical-owner access and personal/workspace history permissions have explicit checks. No connector or authority action is a GET. The old business-kind URL collides with the new Business hub: its POST stays and its editor is linked from the canonical Profile page; the GET now correctly opens the group hub.
