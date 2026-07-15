# 30-Day Learning Plan — no new features, maximum evidence

Rule: every experiment is scored by learning-per-day. Talking beats building.
Eight of ten experiments need zero code. Priority = (P(wrong) × cost-if-wrong) / experiment-cost, scored 1–10.

## Assumption zero (test before everything)

**A0. We can reach Yiwu factory owners at all.** Every experiment below needs
owner conversations. If 10 conversations can't be booked within 2 weeks —
via existing contacts, 1688/WeChat seller groups, sourcing-agent introductions,
or physically walking Futian Market — then *distribution* is the existential
problem and the product questions are moot until it's solved.
**Experiment:** book them. **Success:** ≥10 booked in 14 days. **Failure:**
<5 → stop everything; solve access first. **Time:** starts today. **Priority: 10 — existential.**

## The ten assumptions

| # | Assumption (belief as built) | Experiment (cheapest that can kill it) | Success | Failure → direction change | Time | Priority |
|---|---|---|---|---|---|---|
| 1 | **Overnight/foreign-language inquiries are a burning pain** (the night-shift wedge) | 10 owner interviews. Never pitch. Ask: how do foreign inquiries reach you? Who answers at night? Tell me about a deal you lost to a slow reply | ≥5/10 describe lost deals or night burden **unprompted, with emotion** | Shrugs; "翻译软件够用" → the wedge is wrong; find the pain they *do* name | Wk 1–2 | **10 — existential** |
| 2 | **WhatsApp inbound volume per factory is meaningful** (≥10 inquiries/wk) | In the same interviews: 「能给我看看你的WhatsApp吗?」 Count last week's inquiries, languages, arrival hours | Median ≥10/wk, ≥30% outside 08–22 CST | Median <5/wk → per-factory value too thin; pivot channel (WeChat-first? Alibaba TM?) or upmarket to trading companies | Wk 1–2 | **9 — existential** |
| 3 | **The OWNER answers the phone** (our persona/trust design targets him) | Same interviews: who physically replies today — owner, son, clerk? | Owner or family ≥60% | Clerk majority → the *user* is the clerk (who fears replacement); persona, trust ladder, and buyer-of-record all change | Wk 1–2 | 8 — existential-adjacent |
| 4 | **A stable price table exists** (the quote engine's input) | Interviews: 「你怎么报价?」 Ask to see the Excel/price list. Probe: does the number move with material costs / FX / relationship? | ≥6/10 quote from a written table that changes ≤ monthly | Mostly ad-hoc pricing → deterministic quoting has no input; product leans harder on draft-mode-with-owner-supplied-numbers; S2 onboarding redesigned | Wk 1–2 | 8 — changes the core loop |
| 5 | **Someone will pay** (price point unknown; we've never named one) | End of each good interview: concierge pre-sell — 「¥699/月，我帮你搭个夜班助理，一个月内随时退」. Collect deposits, not compliments | ≥3 deposits from 10 asks | 0 deposits despite pain confirmed → value story or price wrong; iterate offer before building anything | Wk 2 | **9 — existential** |
| 6 | **Arabic/GCC is the right first market** | Free data from #2: language mix of real inbound + which market owners *want* help with | One language ≥40% of foreign inbound across interviews | Fragmented mix → pick per-pilot language; kill the single-market thesis | Wk 1–2 | 6 — inconvenient |
| 7 | **Draft quality is good enough that owners would send them** (sonnet-4-6, our prompts, zh/ar/en) | Offline replay: ask 2–3 interviewees for 10 anonymized real threads; run through the pipeline (M0.5 creds needed); show drafts to the SAME owners: 「这条你会直接发吗?」 | ≥70% "would send" or minor edit | <50% → generation quality is the blocker; fix prompts/model BEFORE any pilot; a bad pilot burns the market | Wk 2 | **9 — gates the pilot** |
| 8 | **WABA is viable for a Chinese supplier entity** (verification, templates, bans, gray-zone ops) | Two emails + one form: ask 360dialog directly how they onboard Chinese exporters (they do it routinely); submit Meta Business verification with the pilot factory's docs | Verified path confirmed in ≤2 wks | Blocked/slow → pilot on WhatsApp Business *App* with manual relay (WoZ) while API path resolves; longer-term channel risk noted | Starts today | 8 — external clock |
| 9 | **Draft-approval fits the owner's day** (days 1–3 net-negative survives) | **Wizard-of-Oz pilot** with 1 deposit-paying factory: engine runs locally, founder manually relays drafts/approvals over WeChat. No new features — a human is the bridge | Owner still approving on day 7; approval latency trending down; asks for more | Drafts sit >24h by day 4; 「我还是自己回吧」 → the surface is wrong, not the engine; rethink delivery before building the bridge | Wk 3–4 | **10 — the real test** |
| 10 | **Trust ladder pacing (~promote by day 14)** and the night-shift wedge sequence | Inside the WoZ pilot: offer night-greeting autonomy when the rubber-stamp signal appears; observe, don't push | Owner grants ≥1 capability by day 14 of pilot | Never grants (fear) → ladder too steep; grants day 2 without reading (complacency) → guards matter more than ladder; either way redesign pacing | Wk 3–4 | 7 — shapes product |

## Existential vs inconvenient

**Existential (any one failing kills or pivots the company):** A0 access, #1
pain, #2 volume, #5 willingness-to-pay, #9 workflow fit. **Gates:** #7 draft
quality, #8 WABA. **Inconvenient (change design, not direction):** #3 persona,
#4 price tables, #6 market, #10 pacing.

## Minimum engineering before the first customer conversation

**Zero.** Interviews need a notebook, not a repo.

Before the first *pilot* (weeks 3–4): **M0.5 only** — credentials in, service
runs, offline replay works. The approval bridge is NOT required: in the WoZ
pilot the founder *is* the bridge (manual relay). Build the real bridge only
after a deposit exists — a paying pilot justifies the 3–5 build days; zero
deposits means the bridge would have been built for nobody.

## The 30-day calendar

- **Wk 1:** A0 (book interviews) · #8 (WABA submission + 360dialog email) ·
  M0.5 the day credentials arrive · interviews begin (#1–#4, #6 data).
- **Wk 2:** finish 10 interviews · #7 offline replay with real threads ·
  #5 pre-sell, collect deposits.
- **Wk 3–4:** #9/#10 WoZ pilot with one deposit customer. Daily notes into
  `docs/learnings/`.
- **Day 30 decision:** ≥3 deposits + pilot owner still engaged → build the
  bridge, onboard pilots 2–3. Pain unconfirmed or 0 deposits → the docs say
  what to change; the engine keeps.

Failure on day 30 costs one month. The same discovery after building the
bridge, dashboard, and follow-up engine costs a quarter. That asymmetry is the
entire argument.
