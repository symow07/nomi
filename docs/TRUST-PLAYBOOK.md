# The Trust Playbook — winning one Yiwu factory owner in 30 days

The objective: **3 of 7 capabilities autonomous within 30 days, granted willingly.**
Everything below is evaluated against that and nothing else.

## The organizing insight: he has hired salespeople before

A 45-year-old 老板 has no mental model for "AI agent". He has a deeply-worn
mental model for **the new 业务员 on probation**: watch everything they write,
give them small responsibilities, take responsibilities back when they mess up,
stop checking when they've earned it. Draft mode + the autonomy ladder *is*
this model. Every word of UI, onboarding, and promotion should use employment
language — 试用期 (probation), 值夜班 (night shift), 收回 (take back) — never
"AI", "model", "automation". We are not asking him to trust technology. We are
asking him to manage an employee, which he already knows how to do.

The second insight: **his #1 unverifiable fear is language.** He sells to
buyers in Arabic and English he cannot fully read. A draft in Arabic is not a
trust-builder — it is an anxiety generator. Every owner-facing surface must be
Chinese-first, and **every draft must carry a Chinese back-translation**. He
cannot approve what he cannot read. This is the single most important missing
feature in the system.

## Q1 — What builds trust fastest

1. **Chinese back-translation + a one-line 为什么 ("why") on every draft**:
   「买家问5000个的价格。按你的价格表：$0.45/个，共$2,250。」The why-line is the
   `turns` replay data, surfaced. He sees the AI *reasoning from his numbers*.
2. **The AI visibly refusing what it shouldn't say**: 「买家问有没有CE认证。你
   没告诉我有，所以我没承诺。要我怎么回?」 Knowing boundaries (有分寸) is the
   quality he hires for. A guard firing is a *selling moment* — show it.
3. **The morning digest** (7am, his phone): "while you slept: 3 inquiries
   answered, 1 hot Dubai lead, 1 quote awaiting your tap." The nightly gap is
   his sharpest pain (GCC buyers write at Yiwu's 3am); the digest is proof of
   value delivered *during his sleep* before autonomy is even on.
4. **Perfect probation discipline**: during draft mode, NOTHING ever sends
   without his tap, and he can verify that. One violation of this = dead.
5. **Small wins in 24h**: first qualified lead with name/product/quantity
   collected before he woke up.

## Q2 — What kills trust instantly

1. A wrong number or wrong promise reaching a real buyer (guards exist for this).
2. **Touching an old customer** (老客户) without permission. His decade-long
   relationships are sacred. → VIP exclusion list is mandatory (Q6).
3. **Contradicting him in the same chat**: he replies manually at lunch, the AI
   drafts something inconsistent at dinner. → The AI must *see his messages*
   and *yield when the boss is talking* (Q6).
4. Approve-but-didn't-send, or double-send. Delivery reliability = employee
   reliability.
5. Robotic template voice to a buyer who knows the factory. (Guard-fallback
   templates must be rare and natural-sounding.)
6. Unanswered data fear: "does my price list leak?" Needs a 3-sentence Chinese
   answer during onboarding, unprompted.

## Q3 — First-week delight moments

Day 1: the bot interviews HIM in Chinese and builds his catalog from a
forwarded price list photo. Day 2: first overnight draft waiting at breakfast,
in Arabic he couldn't have written, with a back-translation he can check.
Day 3–4: one-tap approvals become rhythm; a buyer remarks on the response
speed. Day 7: the weekly digest — "12 inquiries · 5 qualified · 2 quotes · avg
response 30 seconds (was: 4 hours)". Delight = *evidence he is winning deals
he used to lose to slow replies.*

## Q4 — Anxiety moments (and their designed answers)

- **The first autonomous message** (promotion ceremony): answer = start with
  night-shift-only autonomy + the visible 收回 button ("take it back anytime,
  one tap").
- **Arabic he can't read**: back-translation.
- **Silence from the tool** ("is it on?"): the digest is the heartbeat.
- **Notification fatigue**: low-stakes drafts batch into the digest; only
  quote/order drafts ping immediately. An annoying employee gets fired too.

## Q5 — Built, but worthless to customer #1 → park (don't delete; git keeps them)

Bundle/substitution rules (empty), price-drop & seasonal follow-ups (no data
yet), pgvector/embeddings, per-tenant batching knobs UI, the inbox
claim/release machinery (he is the only human — no claim contention exists),
hot-lead alerts (every draft already reaches him), tenant budget enforcement
(one tenant; keep the soft usage alert), the shadow endpoint & parity report
(archived), escalation_events taxonomy, the API server as a whole (launch =
worker + approval bridge only).

## Q6 — Missing features that are actually critical

1. **Chinese back-translation of every draft** — cannot approve the unreadable.
2. **VIP / do-not-touch list** — protects the relationships that feed his family.
3. **Owner-presence awareness** — ingest his manual replies as conversation
   context; suppress drafting for N hours in any conversation where he has
   spoken last. The employee stays quiet while the boss is talking.
4. **The morning digest** — the trust heartbeat and the retention surface.
5. **One-tap revoke (收回)** per capability, always visible.
6. **The why-line** on every draft (surfacing `turns`, already recorded).
7. Chinese data-privacy one-pager, delivered before he asks.

Note what these have in common: none is AI. All are product.

## Q7 — Cutting another 50%: the kernel

WhatsApp in → **batch** → analyze → **quote from SQL** → **guarded draft with
back-translation + why-line** → owner taps → send → **record turn**. Plus the
phase machine, `ConfirmableOrder`, and the database invariants. Postgres,
pg-boss (retries are trust), trigram retrieval (one SQL function).

Round-2 cuts: the follow-up engine (even silence drafts — week-3 feature, not
launch), lead-score plumbing (he sees every conversation himself; keep only
`human_requested`/problem detection), auto-promotion suggestion logic (show
streak counts; he promotes manually), budgets, retrieval sophistication.

That kernel is ~30% of what exists — and it is the product.

## Q8 — Onboarding entirely from his phone (~1 owner-hour, spread over a day)

A Chinese-language chat with the bot itself — dogfooding from minute one:
company name → forward the price list (photo/Excel/paste; **we** clean it,
send back a formatted list, he answers 对/不对) → floor prices for the TOP 5
products only (「XX最低多少你肯接受?」 — not a form, not all 15) → cert
checkboxes → payment terms → forward VIP contacts → data-privacy 3-liner →
WABA documents (we run the Meta process concierge-style; he only forwards a
business licence photo). Finale: the bot roleplays a Dubai buyer while he
watches it draft. "This is how I'll work. Everything shows to you first."

## Q9 — Shortest path to "quotes while I sleep": the night-shift wedge

Promote autonomy **by time-of-day before by capability**. 值夜班 (night duty)
is the product's signature move: the stakes are lowest when he's asleep, the
pain is sharpest at night, and the review loop is built in (every night action
appears in the morning digest). Path: days 1–3 full draft → day 4 greetings
auto at night → day 6 qualify auto (questions commit nothing — guards make
this structurally safe) → day 9 recommend → **day 11–14 quote auto, NIGHT ONLY,
after ≥10 unedited quote approvals + floor prices entered + his explicit tap**.
Morning digest reviews every night quote; one bad one → auto-revoke. Daytime
quote autonomy follows a week later. ~12 days for a cooperative owner.

## Q10–Q13 — The autonomy ladder rules

**Promote first:** greet → qualify → recommend — the *asking* capabilities;
they gather information and can commit nothing. Then follow_up (drafted),
then quote (night-first), then negotiate (within `pricing_policy` only).

**Never fully autonomous:** `confirm_order` keeps a human tap forever — one tap
per order is negligible cost and enormous trust (and a clean legal position);
anything touching a VIP contact; complaint/problem conversations (handoff
exists); custom-artwork/spec approval; any discount beyond configured authority
(already `requiresHuman`).

**Auto-revoke (self-demotion, announced):** owner manually overrides an
autonomous conversation; any guard fires in auto mode (the model tried to
invent → that capability drops to draft); buyer requests a human; an order
traced to an AI turn is cancelled/disputed; parse-failure spike. The
announcement matters: 「我退回草稿模式了，因为X。你来决定什么时候恢复。」An
employee who demotes themselves *before* the boss notices earns more trust
than one who never errs.

**Authority increases on:** unedited-approval streaks per capability (counted
in `drafts`), clean night-shift periods, owner-initiated widening after digest
review. Suggestions only — **the owner always flips the switch.**

## Q14 — Metrics that predict retention

1. **Autonomy breadth over time** (capabilities in auto) — the ladder is the
   engagement curve.
2. **Draft-response latency, interpreted jointly with mode**: fast approvals =
   engaged; slowing approvals *while promoting to auto* = trust (good);
   slowing approvals with drafts piling up = churn (bad).
3. **Unedited-approval rate trend** — the drafts are learning him.
4. **Owner investment actions**: adds floor prices unprompted, adds product
   lines, adds a second staff member — he's building on it.
5. Digest engagement ≥5/7 mornings.

## Q15 — Metrics founders love that would mislead here

Messages sent, drafts generated, token/latency stats (activity ≠ value);
conversation volume (buyers window-shop); early GMV (one big order he'd have
won anyway swamps the signal); self-scored "AI accuracy"; politeness-biased
surveys — a Chinese factory owner will not tell you your product is bad, he
will just stop opening the digest. **Watch behaviour, never ask opinion.**

## The first 14 days, exactly

| Day | What happens | Collected | Promotion / revoke triggers |
|---|---|---|---|
| 0 | Phone onboarding (Q8); roleplay demo; probation framing: 「前几天每条都给你看」 | catalog rows, floor×5, certs, VIPs | — |
| 1–3 | Full draft mode. Every reply = draft + 中文 back-translation + why-line. Owner taps/edits. 7am digest starts day 2 | per-capability approve/edit/latency; guard fires; parse errors | Fix every edited draft same-day (learning loop). NO promotion talk yet |
| 4 | Digest shows greeting streak: 「问候语你已经连续N条没改过。夜里(23:00–07:00)让我自动发问候，早上你检查?」 | — | **greet → auto (night)** on his tap |
| 5–6 | Qualify streak surfaces the same way | night-action review rate in digest | **qualify → auto** (24h) — questions commit nothing |
| 7 | **Weekly digest**: inquiries, qualified, response-time vs his old baseline, edited% trend | week-1 report | any manual override in auto convs → that capability back to draft, announced |
| 8–10 | Recommend promotes. Quote drafts keep pinging immediately (never digest-batched). Track unedited-quote streak toward 10 | quote streak; floor-price coverage | **recommend → auto**. If quote edits persist: fix drafts, do NOT push promotion |
| 11–13 | **The night-shift quote offer** — only if streak ≥10 AND floors entered: 「夜里按你的价格表自动报价，早上你看每一单?」 First night: digest lists every quote with 收回 one tap away | night quotes sent, buyer replies, morning review outcome | **quote → auto (night)** — the target moment. One bad night quote → auto-revoke + announce |
| 14 | Review call (in chat): show the ladder, the streaks, the response-time delta. Ask ONE question: 「下周想让它多做什么?」 | day-14 snapshot | his answer IS the roadmap |

**Success (day 14):** ≥2 capabilities fully auto + night-quote trial begun or
running; week-2 unedited rate ≥70%; digest opened ≥5/7; zero guard breaches
sent; ≥1 quote answered by a buyer. **The metric-of-metrics: he asks for more.**

**Failure (day 14):** week-2 edit rate >40% (drafts aren't good enough — fix
generation before any promotion talk); drafts sit >24h unactioned (the tool is
extra work, not less — the delivery surface is wrong); any trust-breaking
incident sent; or he says 「我还是自己回吧」 ("I'll just reply myself") — the
politest possible way to say the product failed. Failure here is cheap and
early. That is the point of doing it this way.
