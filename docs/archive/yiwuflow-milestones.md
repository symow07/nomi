> **ARCHIVED — the n8n-era Ship Plan as Milestones, 2026-07-17.** Written when the product was
> n8n workflows against Supabase; that system was extracted to TypeScript
> (ADR-0001) and deleted in M24/M28. The milestone numbering here does not match
> the one the repository actually used.
>
> Superseded by `docs/ROADMAP.md`.

# YiwuFlow — Ship Plan as Milestones

Eight milestones. Each one has a **goal**, a **deliverables checklist**, and an **exit criterion** — a real-world test that must pass before the next milestone starts. No milestone is "done" because the code is merged; it's done when the exit criterion passes.

**Permanent rules applied to every milestone:**
1. Every screen passes the Non-Technical Owner Test (50-year-old Yiwu owner, no docs, no support call).
2. Architecture is frozen; customer-facing workflows may be redesigned freely.
3. Employee language everywhere. Never: model, tokens, prompt, API, webhook.

---

## M1 · Speak the Owner's Language
**Goal:** The product reads like it was made in China for Chinese factory owners — on a phone.

- [ ] Full 简体中文 UI pass, written by a native speaker (not machine-translated)
- [ ] Locked product vocabulary glossary (审批 / 夜班 / 晋升 / 抽查 / 修复 — one canonical term each)
- [ ] Status language everywhere: 已处理 · 等你审批 · 学习中 · 已晋升 · 夜班中
- [ ] Zero technical strings on any owner-facing surface (errors, toasts, emails included)
- [ ] Currency, dates, numbers in Chinese business format (￥, 万, GMT+8)
- [ ] Mobile audit: the three daily actions (approve draft / read conversation / today's summary) are thumb-perfect on a mid-range Android
- [ ] Notification strategy: push for "needs review," one evening digest for everything else — no spam

**Exit criterion:** Hand your phone to a non-technical Chinese speaker over 45. They approve a draft and read today's summary without asking a single question.

---

## M2 · One Premium Product
**Goal:** Every screen looks and behaves like it came from the same world-class team.

- [ ] Design token system: typography scale, spacing, semantic colors, radii, shadows, motion durations
- [ ] Component consolidation: one canonical card, table, form, button, status chip, nav — duplicates deleted
- [ ] The Big Four states for every view:
  - [ ] Empty states that teach and motivate ("上传产品目录开始培训你的员工") — never "No Data"
  - [ ] Loading: skeletons + contextual copy — never bare spinners
  - [ ] Errors: what happened, what the system is doing, what the owner should do — never codes
  - [ ] Success states that feel rewarding
- [ ] Base font size bumped for older eyes; contrast checked

**Exit criterion:** Screenshot any 5 random screens side by side. A designer can't tell they were built in different months.

---

## M3 · WhatsApp, Bulletproof
**Goal:** The one launch channel works flawlessly and can never get an owner banned.

- [ ] "对话渠道" section: Connect / Disconnect / Reconnect / Health / Last sync / Test connection / Permissions
- [ ] Plain-language diagnostics ("WhatsApp 需要重新登录，点这里") — no error codes, no API keys ever shown
- [ ] Guided OAuth-style connection flow an owner completes alone
- [ ] Compliance: BSP setup, template message approval flow, 24-hour window handled invisibly, opt-in records, quality rating monitoring
- [ ] Delivery retry queue — a buyer message is never lost, even during outages
- [ ] Locked "coming soon" cards for Instagram, Messenger, WeChat, RedNote, Telegram, LINE, Email, Web Chat (with "want this? tell us" — free demand research)

**Exit criterion:** An owner connects WhatsApp start-to-finish with zero help, and you can explain in one page why a template rejection or 24h-window edge case cannot cause a lost message or a ban.

---

## M4 · The Demo That Sells Itself
**Goal:** One perfected wow moment plus a demo environment that makes every future demo, screenshot, and test trivial.

- [ ] **Wow #1 — Image → Product Match:** buyer sends a photo → catalog item, price, MOQ identified → quote drafted, in seconds
- [ ] Demo factory: fully populated fake company (products, buyers, live-feeling conversations) — doubles as test fixture and marketing asset
- [ ] The moment is polished end-to-end: animation, timing, back-translation visible, one-tap approve

**Exit criterion:** You demo it cold to a factory owner and they take out their phone to film it, or ask "how much?"

### 🚩 GATE A — First pilot customer goes live (free)
Run one real owner on real WhatsApp traffic for one week. Log every confusion and every support ping. **That log is M5's top of backlog.**

---

## M5 · Earn the Owner's Trust
**Goal:** Managing the AI feels like managing a trusted human employee. This is what they will pay for.

- [ ] Approval Cards perfected: draft + back-translation + buyer context + plain-language "why I wrote this" + one-tap approve/edit
- [ ] Back translation always visible — the owner never approves text they can't read
- [ ] **The Pause Button:** big, obvious "让员工休息" on the home screen
- [ ] Human takeover: owner jumps into any conversation, AI steps back gracefully and learns from what the owner wrote
- [ ] Personnel File & Job Sheet readable at a glance: capabilities, approval levels, promotions, error history with repairs
- [ ] Capability Promotion as a ceremony: "小雅 handled 50 quotes with zero edits — promote her?" Autonomy is granted, never taken
- [ ] Repair Protocol visible: mistake → correction → learned rule
- [ ] Monthly Review as a beautiful one-page report (this becomes the retention artifact in M7)
- [ ] Fix everything from the Gate A pilot log

**Exit criterion:** The pilot owner enables at least one capability promotion voluntarily — they choose to give the AI more autonomy.

---

## M6 · Hire in Ten Minutes, Pay in One Tap
**Goal:** Onboarding feels like hiring an employee; taking money actually works.

**Onboarding-as-hiring:**
- [ ] Step 1: name the employee, pick avatar (instant emotional ownership)
- [ ] Step 2: business basics with smart Yiwu defaults (CNY/USD, GMT+8, EXW/FOB)
- [ ] Step 3: tolerant catalog import — messy Excel, price-list photos, forwarded messages; confirm extracted products, no rigid template
- [ ] Step 4: connect WhatsApp (M3 flow)
- [ ] Step 5: **The First Conversation** — simulated buyer message, employee drafts, owner approves their first draft within 10 minutes of signup. Instrument this as the activation metric.
- [ ] Business Profile + AI Employee Profile pages: everything editable, framed as HR file, mobile-friendly

**Wow moments #2 and #3:**
- [ ] **Returning Buyer:** buyer comes back after months, employee greets with full memory; owner sees the recall ("这是Ahmed，3月询过ZX-200，谈到$2.10/pc")
- [ ] **Instant Invoice:** negotiation → formatted invoice card in one tap
- [ ] Buyer Memory surfaced in-context during conversations (not a separate CRM screen)

**Commercial readiness:**
- [ ] Pricing tiers + pricing page (中/EN)
- [ ] Billing: WeChat Pay / Alipay / bank transfer with manual invoicing (automate later — don't block on Stripe)
- [ ] Fapiao answer for Chinese businesses
- [ ] ToS, privacy policy, PIPL-compliant data story — surfaced in-product as trust: "你的数据永远是你的，随时可以导出"
- [ ] Per-tenant LLM cost caps + cost-per-conversation dashboard for you

**Exit criterion:** The pilot owner pays real money without a discount fight. If they hesitate, the stated reason becomes M7's top item.

### 🚩 GATE B — First paying customer

---

## M7 · Premium Feel + Compounding Value
**Goal:** The product delights daily and visibly gets smarter the longer it runs.

- [ ] Micro-interactions: animated approvals, quote-generation moment, send animations, status transitions (all ≤300ms, skippable)
- [ ] Dark mode, hover states, desktop keyboard shortcuts, reduced-motion support
- [ ] **Smart Insights, not dashboards:** daily brief ("今天：12个已处理，3个等你审批，1个客户需要跟进"); every insight ends in a one-tap action; explicitly no chart pages in v1
- [ ] Answerable questions: why sales changed, best-converting countries, products triggering objections, replies the owner keeps editing, who to follow up today
- [ ] **Knowledge counter** in the monthly review: "小雅 now knows 340 products, 85 buyers, 210 of your corrections" — accumulation made visible
- [ ] **Shareable weekly 员工周报:** a beautiful card summarizing the AI's week, designed to be screenshotted into WeChat groups — this IS the referral strategy for v1

**Exit criterion:** A paying owner shares the weekly report or shows the product to another owner unprompted.

---

## M8 · Ready for the Public
**Goal:** Anyone can sign up, succeed alone, and you can sleep at night.

- [ ] Self-serve onboarding (M6 flow, zero human help required)
- [ ] Reliability sweep: retries on every network call, offline/poor-connection queueing, graceful LLM-outage degradation (worst case: owner is notified to reply manually — a buyer message is never dropped)
- [ ] Performance: approval card opens <1s on mobile; "instant" quote is honestly instant
- [ ] Ops: monitoring, alerting, status page, one actually-performed backup/restore drill, incident playbook, per-capability kill switches
- [ ] Support: WeChat support group + in-product 联系我们; 10-article knowledge base written from real pilot questions
- [ ] Marketing site (Chinese-first) — hero is a 60-second video of the Image→Quote moment
- [ ] 30-day onboarding email/WeChat sequence
- [ ] **30-day emotional arc instrumented:**
  - Minute 10 → first draft approved ("it works")
  - Day 1 → first real buyer handled (excitement)
  - Week 1 → first spot check passed, first learned correction (trust)
  - Week 2 → first promotion offered (letting go)
  - Month 1 → monthly review shows hours saved + knowledge grown (renewal is obvious)

**Exit criterion:** A stranger signs up, onboards, connects WhatsApp, and approves their first real draft — with zero contact with you.

### 🚩 GATE C — Public launch

---

## Post-Launch Milestones (sequenced, not scheduled)

- **M9 — WeChat channel** (the owner's native habitat comes first, not Instagram)
- **M10 — Factory Brain expansion:** documents, emails, invoices, voice notes, photos, operational knowledge
- **M11 — Voice-note understanding** as a first-class wow moment
- **M12 — WeChat mini-program evaluation** (vs. keeping the PWA)
- **M13 — Referral report iteration** based on what actually gets shared

---

## How to Read Progress

| Milestone | Theme | Gate |
|---|---|---|
| M1 | Owner's language, owner's phone | |
| M2 | One premium product | |
| M3 | WhatsApp bulletproof | |
| M4 | The demo that sells | 🚩 A — pilot live |
| M5 | Trust experience | |
| M6 | Hiring + money | 🚩 B — first payment |
| M7 | Delight + compounding value | |
| M8 | Public readiness | 🚩 C — launch |

**One rule when prioritizing inside any milestone:** if a task doesn't improve owner trust, ease of use, delight, perceived intelligence, retention, referrals, or first impressions — defer it. Shipping is the feature.
