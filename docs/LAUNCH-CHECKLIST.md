# Launch checklist

Things that must be true before a capability, a channel or a workspace is
switched on in production. Each item says **where it is enforced**, because a
rule that lives only in this file is a rule somebody will miss at 2 a.m.

## Autonomy — anything sent without the owner reading it first

### 1. The zh and ar AI disclosure have had native review

**Hard rule.** No workspace turns on any autonomy capability in production until
a native speaker has read the Chinese and Arabic disclosure text and signed it
off.

- **Enforced in code.** `DISCLOSURE_NATIVE_REVIEW` in
  `src/core/conversation/disclosure.ts` is `{ en: true, zh: false, ar: false }`.
  While any value is `false`, `autonomyReleased()` is false, and:
  - the route that saves her choice (`POST /app/employee/autonomy`) refuses every
    level except `waits`, with a flash saying why;
  - her autonomy page says it above the three levels.
- **Proved** by `tests/integration/autonomy-level.test.ts` ("no autonomy until
  the disclosure has had native review"), which drives the real route against
  the real flag. It asserts the flag is down today — so flipping it without
  meaning to fails CI.
- **To lift it:** a native speaker reads the `zh` and `ar` strings in
  `disclosure.ts` and says what to change; apply their changes, set both flags
  to `true`, and update that test's first assertion — all in one commit, with
  the reviewer named in the commit message.

Why a gate and not a note: this is the one sentence in the product whose job is
to tell a buyer the truth about what is answering him. A translation that is
merely close is not good enough for it, and a workspace that writes only English
today can receive an Arabic message tomorrow.

### 2. The assistant's name is confirmed

- **Enforced in code.** Activation refuses with `assistant_not_named`
  (`src/channels/activation.ts`), and a capability in auto falls back to draft
  while the name is unconfirmed or there is no name to say (`commitTurn`,
  `autonomy_withheld` on the timeline).
- **Where the owner does it:** Getting ready (`/app/onboarding`), pre-filled
  with the signup-locale default.

As of 2026-09-22, production has **zero** `assistants` rows. Every workspace,
including the one live one (Westlake Canvas Co.), must confirm its name after
0065 deploys before anything is sent alone.

## Before any deploy that migrates

- **Backup first**, per `docs/BACKUP-RESTORE.md` (`tools/backup.sh`, roles +
  dump, encrypted, uploaded). The schedule is manual: before every migration.
- **After the deploy**, confirm `/health` answers and `schema_version` equals
  `REQUIRED_SCHEMA_VERSION` in `src/db/schemaVersion.ts`.
