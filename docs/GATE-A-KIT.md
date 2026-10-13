# Gate A — the pilot kit

Rewritten 2026-10-14 for the product as it is: schema 152, Phase 3 shipped. It replaces the July kit, which named a
provider's sandbox, a SQL editor, a page and a module that are all gone.

**This is a STOP-GATE.** Nothing goes to a real business until the owner has read this page and said go. Phase 4
of `docs/ROADMAP.md`: cold demo ×3, then the 7-day trust pilot on real WhatsApp traffic, the log written every
evening, triaged at the weekend into `docs/M5-PILOT-FINDINGS.md`.

**Gate A passes** when the boss still uses it unprompted at the end of the week, and the log holds no unfixed
blocker. **M5's exit** (it may come later): he gives one piece of work to the assistant on his own.

`tests/parity/gate-a-kit.test.ts` checks that every tool, page and document this kit names exists.

---

## 1 · Hard prerequisites — every one, before the first demo

Status as read from production on 2026-10-14 (read-only; names only for variables).

| # | Prerequisite | How to confirm | 2026-10-14 |
|---|---|---|---|
| 1 | The app is healthy and current | `curl -4 https://app.nomidoes.com/health` → `"ok":true,"worker":true,"provider":"active"`; schema = `REQUIRED_SCHEMA_VERSION` | ✓ schema 152, no operator flag set, no error in 7 days |
| 2 | Backups run and restore | `backup_runs` (nightly 03:00 UTC, with a restore drill); PITR on | ✓ last 2026-10-13 03:04 UTC, drill passed |
| 3 | Someone outside Railway notices an outage | `HEALTH_PING_URL` set on `nomi`; the Healthchecks.io check shows pings | ✓ set — **owner: look once that the check is green** |
| 4 | The model answers "wants a person" | `npm run build && railway run --service nomi -- node tools/check-person-model.mjs` the day before (never while integration runs) | □ run it on the pilot's eve |
| 5 | **WhatsApp sends** | The last WhatsApp send (2026-09-19) was refused by Meta, `#131037`: the number's display name was not approved. Nothing has been sent on WhatsApp since. WhatsApp Manager → Phone numbers → display name → Approved; then a round trip from the owner's phone | □ **owner** |
| 6 | **The boss's own WhatsApp number** | See the decision below | □ **owner decides** |
| 7 | The disclosure is signed in the buyers' languages | `DISCLOSURE_NATIVE_REVIEW` (`src/core/conversation/disclosure.ts`) | ✓ en, zh, ar. es/fr/pt buyers get drafts only — fine for a Chinese- or Arabic-speaking boss |
| 8 | The pilot workspace exists and has a login | Invitation sign-up (sign-up stays `invite`: the HARD ORDER), or the operator makes it and `tools/add-login.mjs` gives the owner a one-time link | □ when the boss is chosen |
| 9 | It cannot be frozen for money | No card exists before the LLC. `railway run --service nomi -- node tools/billing.mjs exempt <business-id> --by "<you>" --yes` for the pilot week | □ **owner** (money is the owner's) |
| 10 | Going live in that workspace | Getting ready: assistant named, the confirmations, the allowlist (pilot mode is ON by default: only listed numbers are answered); `secrets_rotated` stamped by `tools/installation-checks.mjs` | □ with the boss, day 1 |
| 11 | The week's limits will not bite | 50 of the assistant's messages a day for a new workspace (`tools/send-ceiling.mjs` raises it); 1,000 model calls and 20 photo reads a day | ✓ ample for a pilot; raise the send ceiling only once he trusts it |

**Decision 6 — whose WhatsApp number.** Nomi can only drive numbers that sit in its own WhatsApp Business account
("nomi", the one Westlake's +1 555 number is in). The boss's buyers write to the boss's number, so the pilot needs one
of these:

- **A · The boss's number joins Nomi's account** (WhatsApp Manager → add phone number). The number must leave the
  WhatsApp app (a spare SIM is simplest), and its display name — the boss's business — waits for Meta's approval
  (decision 5 shows that wait is real). Meta caps business-started conversations for an unverified portfolio; buyers
  who write first are answered without that cap. **Recommended**: no new code, no monthly fee.
- **B · 360dialog**, the provider already built in. A monthly fee, and `WHATSAPP_PROVIDER` is one switch for the whole
  deployment: Westlake would move with it.
- **C · Wait for Meta Tech Provider (M52)** so the boss connects his own number himself. Last on the roadmap, always.

**Also the owner's, before a real business sees the pages:** the owner decided the pages keep "we / us / our" until
the LLC (PROGRESS, 2026-10-13: "Nothing public may say 'we' before a real customer can sign up"). A pilot boss is
invited, not signed up in public — say whether that is close enough, or the pilot waits for the one-pass rewrite.

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

**At the weekend:** `railway run --service nomi -- node tools/pilot-log.mjs triage --business <id>` — blockers first,
then the worst, then the most trust lost, then the oldest. Each open line becomes a finding in
`docs/M5-PILOT-FINDINGS.md`; each fix links back with `tools/pilot-log.mjs set --id <n> --status fixed --task "#PR"`.

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
