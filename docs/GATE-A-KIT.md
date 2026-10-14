# Gate A — the pilot kit

Rewritten 2026-10-14 for the product as it is, and updated the same day with the owner's answers at the Phase 4
gate (below). It replaces the July kit, which named a provider's sandbox, a SQL editor, a page and a module that are
all gone.

**This is a STOP-GATE.** Nothing goes to a real business before the owner names the boss. Phase 4 of
`docs/ROADMAP.md`: cold demo ×3, then the 7-day trust pilot on real WhatsApp traffic, the log written every evening,
triaged at the weekend into `docs/M5-PILOT-FINDINGS.md`.

**Gate A passes** when the boss still uses it unprompted at the end of the week, and the log holds no unfixed
blocker. **M5's exit** (it may come later): he gives one piece of work to the assistant on his own.

`tests/parity/gate-a-kit.test.ts` checks that every tool, page and document this kit and `docs/LIVE-VERIFICATION.md`
name exists.

## The owner's answers (2026-10-14)

1. **Whose number: A, with a hard constraint.** The boss's working number never moves into Nomi's account — a spare
   SIM or a new number, which the boss advertises for the pilot. B (a reseller) is rejected: a monthly fee before any
   revenue, and it would move Westlake too. C (Meta Tech Provider, M52) is the long-term answer; it stays on the
   roadmap and nothing waits for it.
2. **Billing: exempt, billing only.** Recorded on the pilot log with the day it ends (§4); the 50-a-day send ceiling
   and the model-call limits stay as they are.
3. **"We" on the pages:** the pilot proceeds, but the legal pages name the owner, personally, with the contact
   address — privacy, terms, refunds, cookies (and the deletion page). Built: `OPERATOR_PERSON`, set in Railway on
   2026-10-14. The rest of "we" waits for the LLC, as decided.
4. **The date.** The owner names the boss once the display name clears, and no date is set until all four are true:
   the display name usable · the three cold-demo runs done on Westlake · the "wants a person" model check green the
   day before · the two blockers closed.

**Blocker 1, closed:** a buyer whose language has no signed disclosure receives nothing automated at all — the
message goes to a person instead (0153). **Blocker 2, understood:** the Arabic practice turn's ✗ was the check
calling a reply HELD for the owner an escalation; nothing was sent in either language (the check is fixed). **The
pilot runs in English and Chinese only** until the owner says Arabic may join.

**Arabic, pre-approved and conditional (the owner, 2026-10-14):** Arabic joins the pilot on its own once (a) every
one of the boss's products carries an Arabic name, and (b) a fresh 60-turn Arabic run against the REAL product set comes
back with nothing gendered sent, nothing held silent, and no split against English or Chinese. Until then the pilot
workspace HOLDS Arabic (0159, row 14): an Arabic buyer goes to a person and is told so. If (b) fails, Arabic stays held
and the owner is told what failed; if it passes, it is released and the next report says so.

---

## 1 · Hard prerequisites — every one, before the first demo

Status as read from production on 2026-10-14 (read-only; names only for variables).

| # | Prerequisite | How to confirm | 2026-10-14 |
|---|---|---|---|
| 1 | The app is healthy and current | `curl -4 https://app.nomidoes.com/health` → `"ok":true,"worker":true,"provider":"active"`; schema = `REQUIRED_SCHEMA_VERSION` | ✓ no operator flag set, no error in 7 days |
| 2 | Backups run and restore | `backup_runs` (nightly 03:00 UTC, with a restore drill); PITR on | ✓ nightly, drills passing |
| 3 | Someone outside Railway notices an outage | `HEALTH_PING_URL` set on `nomi`; the Healthchecks.io check shows pings | ✓ set — **owner: look once that the check is green** |
| 4 | The model answers "wants a person" | `npm run build && railway run --service nomi -- node tools/check-person-model.mjs` the day before (never while integration runs) | □ the day before the pilot |
| 5 | **WhatsApp sends** | `railway run --service nomi -- node tools/wa-number-status.mjs`, then the round trip in `docs/LIVE-VERIFICATION.md` §3. The last send (2026-09-19) was refused, `#131037` (display name) | ○ Meta now reads the name "nomi" **usable** (`AVAILABLE_WITHOUT_REVIEW`, GREEN); **owner: one round trip proves it** |
| 6 | **The boss's number** | Decision 1: a spare SIM, added to Nomi's account (`docs/LIVE-VERIFICATION.md` §5); its display name is reviewed by Meta once it exists. Attached to the boss's workspace with `tools/attach-number.mjs` (§5 step 3 there); a number belongs to exactly one workspace | □ when the boss is named |
| 7 | Nothing automated in an unsigned language | Blocker 1 (0153): a buyer whose language has no signed disclosure goes to a person, and the send gate refuses anything the assistant would still send them alone. Signed: en, zh, ar | ✓ built; **pilot languages: en and zh** (blocker 2) |
| 8 | The pilot workspace exists and has a login | Invitation sign-up (sign-up stays `invite`: the HARD ORDER), or the operator makes it and `tools/add-login.mjs` gives the owner a one-time link. **The same day, the operator holds Arabic in it:** `node tools/language-hold.mjs --business <id> --hold ar` (row 14), **and the owner ticks the languages their buyers write in on the profile** (Chinese for the pilot) — setting up then asks for those names (row 13) | □ when the boss is named |
| 9 | It cannot be frozen for money — and nothing else is loosened | `railway run --service nomi -- node tools/billing.mjs exempt <business-id> --by "<you>" --yes`, then the decision on the log with its end date (§4). Exemption touches billing only: the send ceiling and the model allowance never read it (a test holds it) | □ day 1 |
| 10 | Going live in that workspace | Getting ready: assistant named, the confirmations, the allowlist (pilot mode is ON by default: only listed numbers are answered); `secrets_rotated` stamped by `tools/installation-checks.mjs` | □ with the boss, day 1 |
| 11 | The week's limits will not bite | 50 of the assistant's messages a day for a new workspace (`tools/send-ceiling.mjs` raises it); 1,000 model calls and 20 photo reads a day | ✓ ample for a pilot; raise the send ceiling only once he trusts it |
| 12 | The legal pages name who runs Nomi | Each legal page opens with the owner's name and "we" means them (`OPERATOR_PERSON`); the contact section carries the address | ✓ set in Railway; on the pages from the deploy that carries it |
| 13 | **Each product is found from the words its buyers use** — the owner's setup | A product is found only through its names (`docs/CAPABILITY-SWEEP.md`): a buyer's words never reach one with no name in their language. On each product: **More names customers use** — the Chinese name and the short names Chinese buyers say (for the pilot), and **an Arabic name before Arabic joins** (a buyer writing in Arabic is otherwise always asked what they want). **Setting up asks for it too (#344, corrected by #349):** the products step waits until every product has a name in each language with its own script (Chinese, Arabic, Russian) that the owner ticked on the profile or a buyer has written in; the profile's other languages are only suggested. Getting started, Home, the list and each product say which are missing. `node tools/capability-sweep.mjs` (layer 2) shows what is found | □ with the boss, before day 1; Arabic names before Arabic joins |
| 14 | **Arabic joins only on the run** — the operator's, pre-approved | Held from row 8. When Setup shows no product without an Arabic name: `railway run --service Postgres -- sh -c 'CATALOGUE_DATABASE_URL="$DATABASE_PUBLIC_URL" node tools/check-language-release.mjs --export --business <id> --out <file>'`, then `npm run build && RELEASE_CHECK_DB=<a local throwaway database> railway run --service nomi -- node tools/check-language-release.mjs --catalogue <file> --language ar`. PASS → `tools/language-hold.mjs --release ar`, said in the next report; FAIL → stays held, the report says what failed | □ after row 13's Arabic names |

---

## 2 · The cold demo — three times, before meeting the boss

**Where.** The owner's own live workspace, Westlake Canvas Co., on WhatsApp — the owner's phone is the buyer (Westlake
has one number on its allowlist: check it is that phone). If prerequisite 5 is not met yet, Practice (`/app/sandbox`) shows the same turn with no channel.

**The 20 seconds that matter.** A buyer writes at night → the reply goes out at once, opening with the disclosure word
for word → the buyer asks for a better price for a quantity → the reply waits for the owner's tap, never below the
lowest price set → the buyer says yes → the owner confirms the order in one tap → the proforma link is ready to send.
It is the site's reel (`/site/next`), done for real.

**Backups, if there is time:** the Buyers list (one list, searched); the morning summary (`2a`, counts only); the
advisor's lost deals (`2b`); a product photo on Instagram (`2d`); the owner's Stop on My business.

**Never demo — they do not exist** (removed in `b24f052c`, never built since): a memory of each buyer, progress updates
to buyers, a weekly report. The morning summary is a daily count; do not call it a report.

**The morning of each demo**
- [ ] Two phones charged: the buyer's (allowlisted) and the owner's (signed in, alerts on)
- [ ] One round trip on WhatsApp that morning
- [ ] A hotspot, not the room's Wi-Fi
- [ ] Do Not Disturb off on both phones
- [ ] If the channel fails: Practice, then the Buyers list and a real conversation's history

**Write each run down** — the date, what landed, the second someone frowned. The third run is one of the four things
the date waits on.

**It worked** when they take out their phone, or ask what it costs. Neither → write down the second they frowned:
that is the next thing to fix.

---

## 3 · The pilot week — seven days, what is real each day

| Day | What the boss meets | Where |
|---|---|---|
| 1 | Sign-up lands on Getting started; the five steps; the first reply to approve | `/app/guide`, Buyers |
| 2 | An edit is kept; a taught answer is used the next time | the buyer's page, Knowledge |
| 3 | The first morning summary at 08:00 in his zone; the night's replies to look over | his phone, Buyers |
| 4 | The first spot checks of work done alone | the assistant's page (`/app/settings/assistant`) |
| 5–7 | Hand-overs (a buyer who wants a person, or a deletion request — nothing is sent); an order confirmed; a proforma | alerts, Buyers |

What the observer does each day, and only this:
1. In the morning, a look at his morning summary (a screenshot he agreed to forward).
2. Every time he is stuck, confused or pleased: the template below, his own words.
3. In the evening, ten minutes: each note into the log (§4).

---

## 4 · Observing and the log

**The shadow template** — on the phone's notes. It records; it never explains, defends or teaches.

```
【试用观察记录】每条 30 秒内记完：
几点几分 ｜ 在哪个界面
老板做了什么 / 说了什么（原话）
他以为会怎样 ｜ 实际怎样
卡住了吗（几秒）｜ 找人帮忙了吗
情绪：困惑 / 犹豫 / 惊喜 / 信任 / 烦
——不解释、不辩护、不教他，只记录。
```

(In English: the time and the screen · what he did or said, verbatim · what he expected, what happened · stuck? how
long? did he ask someone? · confused / hesitant / surprised / trusting / annoyed.)

**Every evening**, one line per note — `tools/pilot-log.mjs` is the one writer of `pilot_log`:

```bash
railway run --service nomi -- node tools/pilot-log.mjs add --business <id> --owner 王老板 \
  --surface "approval card" --kind hesitated_before_approval \
  --event "Looked at the card for twelve seconds before sending" \
  --quote "这个英文我又看不懂发的对不对" --severity 2 --trust -1
```

`node tools/pilot-log.mjs kinds` lists the nineteen kinds. Severity 3 is the worst; trust runs from −2 (broke it) to
+2 (built it); `--blocker` marks what must be fixed before Gate A can pass.

**A decision made for the pilot** — the billing exemption on day 1 — goes on the same log, with the day it ends:

```bash
railway run --service nomi -- node tools/pilot-log.mjs decision --business <id> \
  --what "Billing exempt for the pilot week; the send ceiling and the model limits unchanged" --until <YYYY-MM-DD> --by "<you>"
```

**At the weekend:** `railway run --service nomi -- node tools/pilot-log.mjs triage --business <id>` — blockers first,
then the worst, then the most trust lost, then the oldest. Each open line becomes a finding in
`docs/M5-PILOT-FINDINGS.md`; each fix links back with `tools/pilot-log.mjs set --id <n> --status fixed --task "#PR"`.
Triage also lists the pilot's decisions: those in force, and any whose day has passed — undo it (for the exemption,
`tools/billing.mjs unexempt`).

---

## 5 · At the end of the week

- **Gate A passes:** he still uses it without being asked, and `triage` shows no open `[BLOCKER]`.
- **Either way:** the triage list is the whole input of the next build cycle.
- **First-customer marketing** — the owner has ideas; we work them together after the pilot's first days, with the
  three hooks (`docs/marketing/hooks/`) as raw material.

## 6 · On call during the week

A note from the observer → transcribed, triaged, fixed the same day where it is copy. A channel stuck → the
channel's health on My business, then `channels.last_error`. Any line he reads as odd → his words, and it changes that
day (zh/ar lines through `docs/NATIVE-REVIEW-UI.md`).
