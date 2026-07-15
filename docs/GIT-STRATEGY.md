# Git & Backup Strategy

Solo-dev rules. Anything more ceremonial than this is theater.

## Branching

- **`main` is always shippable.** `npm run check` and `npm run workflows:check`
  must be green before every commit to it — that gate is the code review.
- **Short-lived branches only for risky work** (engine changes during the shadow
  phase, migration authoring). Merge or delete within days; no long-lived
  branches, no develop branch, no gitflow.
- **Tags mark irreversible moments:** `pre-shadow`, `cutover-<channel>`,
  `pre-contract-migration`. The contract migration (drops `escalation_score`)
  is the point of no return — tag before running it.

## Commit discipline

- Migrations are immutable once pushed: fix forward with a new file (ADR-0007).
- `n8n/*.json` is committed generated output — regenerate via
  `npm run workflows:build`, never hand-edit, until cutover freezes the generator.
- `.env*` is gitignored. Secrets never enter history — a leaked history is a
  leaked key, and history cannot be unshipped.

## Backup (the actual point)

| Layer | Mechanism | Owner action needed |
|---|---|---|
| Code | **Push to a private remote after every session.** `git remote add origin <url> && git push -u origin main` | ⛔ **You: create the private GitHub repo.** Until this exists, the repo is one laptop failure from gone. |
| Database schema | `migrations/` in git + Supabase's own migration history | done |
| Database data | Supabase daily backups (free tier: 1 day; Pro: 7 days + PITR) | Pro tier at first paying tenant |
| n8n workflows | `n8n/*.json` in git (importable) | done |
| Prompts | `prompts/` in git, hash-versioned per turn in `turns.prompt_version` | done |

The one action this document exists to force: **create the private remote and
push.** Everything else is already true.
