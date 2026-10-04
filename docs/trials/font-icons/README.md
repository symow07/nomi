# The font-and-icons trial (branch `trial/font-and-icons`, not merged)

This is a throwaway preview for judging Switzer and three icon families on a real screen. It changes no page of the app:
- every address is under `/dev/trial`;
- nothing links to it;
- it exists only when a local instance starts with `TRIAL_ROUTES=on` (never in production).

## Run it on your machine
1. `node tools/fetch-switzer.mjs`. This fetches your own copy of Switzer from Fontshare into `assets/trial/`, which git ignores.
2. `TRIAL_ROUTES=on bash .claude/skills/run-nomi/smoke.sh`. Then, optionally, `MIGRATE_DATABASE_URL=postgresql://postgres@127.0.0.1:55440/nomi node tools/seed-usability.mjs` for a fuller Today.
3. Sign in at `http://127.0.0.1:8787/login` with "I have an access code" → `smoke-code`.
4. Open these pages:
   - `/dev/trial`: the nav three ways;
   - `/dev/trial/today`: Today in Switzer;
   - `/dev/trial/today?icons=a|b|c`: Today in Switzer with that nav;
   - `/app`: the current app, for comparison.

## The screenshots (1280 and 390 px wide, at 2×)

| What | Desktop | Phone |
|---|---|---|
| Today in Switzer | `today-switzer-desktop.png` | `today-switzer-phone.png` |
| The nav: A Iconoir, B Lucide, C Phosphor bold | `nav-variants-desktop.png` | `nav-variants-phone.png` |
| Today as it is now, in Noto, for comparison | `today-noto-desktop.png` | `today-noto-phone.png` |

## What was measured (on the served pages)

**Switzer draws every Latin glyph of the nav and of Today:** 35 and 271 glyphs at 1280 px. It draws none outside them.

**Other scripts are untouched.** The same trial page uses no Switzer in Arabic or Chinese:
- Arabic is 100 % Noto Sans Arabic;
- Chinese is 100 % Noto Sans SC;
- the Chinese characters inside an English Today still fall through to Noto.

**Stems at 15 px:**

| Weight | Switzer | Noto |
|---|---|---|
| 500 | 1.6 px | 1.59 px |
| 600 | 1.9 px | 1.9 px |
| 700 | 2.3 px | 2.27 px |

**The icon lines:**
- **A and B** are drawn at 24 px with a 1.6 px line (1.9 px on the entry you are on, 1.4 / 1.7 px on a phone), so they match their words. Iconoir ships 1.5 px and Lucide 2 px.
- **C** is Phosphor bold at 28 px (+15 per cent): a 2.6 px line, heavier than the words, as specified. It is drawn in ink, the wordmark's near-black.

**Level:** at 1280 px, every icon's centre sits 0.1 px from the centre of its word's capitals, in all three variants.

**The "you are here" state** is the line in deep magenta in all three. Neither Iconoir nor Lucide has a filled drawing of these six, so the app's "filled where you are" cannot carry over to A or B.

## Licences

**Switzer:** ITF Free Font License v2.0.
- Commercial use and self-hosting are allowed.
- Passing the files on through a repository or a public server is not, and neither is changing them.
- So it is not in git. A real rollout would have to fetch it at build or deploy time, never commit it.

**The icon families:**
- Iconoir 7.12.1 is MIT (`assets/icons/ICONOIR-LICENSE.txt`);
- Lucide 1.52.0 is ISC (`assets/icons/LUCIDE-LICENSE.txt`);
- Phosphor 2.1.1 is MIT (already in the app).
