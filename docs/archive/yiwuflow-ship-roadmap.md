> **ARCHIVED — the n8n-era ship roadmap, 2026-07-17.** Written when the product was
> n8n workflows against Supabase; that system was extracted to TypeScript
> (ADR-0001) and deleted in M24/M28. The milestone numbering here does not match
> the one the repository actually used.
>
> Superseded by `docs/ROADMAP.md`.

# YiwuFlow — Ship Roadmap v3 (Execution Edition)

**Objective:** Transform YiwuFlow from an excellent engineering project into a product that factory owners love, trust, recommend, and happily pay for — without touching the finished architecture.

---

## Part 0 — The Three Permanent Product Rules

These override everything below. Every PR, every screen, every copy string gets checked against them.

**Rule 1 — The Non-Technical Owner Test.**
A 50-year-old Yiwu factory owner with no technical knowledge must be able to understand any screen immediately, complete any workflow without documentation or support, and explain it to another owner. If not → redesign. This rule overrides developer convenience, always.

**Rule 2 — Experience over preservation.**
Do not assume the current implementation is the best one. Any customer-facing workflow may be redesigned if the result is simpler, faster, or more trustworthy. But the architecture (engine, DB, RLS, audit, replay, quote engine, trust framework) is frozen unless a change has a measurable production benefit.

**Rule 3 — The AI is an employee, never a tool.**
All product language, all UI metaphors, all notifications speak in employee terms: hired, learning, promoted, on night shift, needs your review. Never expose: model, tokens, prompt, confidence, latency, API, webhook, sync error codes.

---

## Part 1 — Launch Gates

Everything in this roadmap is assigned to exactly one gate. Nothing ships out of order.

| Gate | Milestone | Bar to clear |
|---|---|---|
| **Gate A** | First pilot customer (free) | Core loop works end-to-end on real WhatsApp traffic; owner can operate it alone for one week |
| **Gate B** | First paying customer | Billing works; trust experience polished; owner would be upset if you took it away |
| **Gate C** | Public launch | Premium polish everywhere; self-serve onboarding; support & marketing ready |
| **Post** | After launch | Growth, additional channels, compounding-value features |

---

## Part 2 — Workstreams

### WS1 · Product Language & Chinese-First UI — **Gate A** ⚠️ *New, critical*

The original roadmap missed the single biggest polish item: **the owner-facing UI must be Chinese-first (简体中文), with English secondary.** Buyers are multilingual; the owner is not.

- Full zh-CN UI pass written by a native speaker, not machine-translated. Tone: respectful, plain, businesslike — like a competent HR manager talking about an employee.
- Locked product vocabulary glossary (one canonical Chinese term per concept: 审批 / 夜班 / 晋升 / 抽查 / 修复 etc.). No synonyms drifting across screens.
- Status language everywhere: 已处理 (Handled) · 等你审批 (Waiting for You) · 学习中 (Learning) · 已晋升 (Promoted) · 夜班中 (Night Shift).
- Kill all technical strings from every surface: errors, toasts, emails, logs shown to owners.
- Numbers, dates, currency formatted for Chinese business conventions (￥, 万, CN date order).

**Why it matters:** every other workstream lands flat if the owner reads awkward translated software. Effort: Medium. Dependencies: none. Do this first — it touches every screen the other workstreams will polish.

---

### WS2 · Mobile-First Reality Check — **Gate A** ⚠️ *New, critical*

Yiwu owners live on their phones, standing in showrooms and warehouses. Assume **>80% of sessions are mobile**.

- Audit every workflow on a mid-range Android phone over a spotty connection.
- The three daily actions must be thumb-perfect: **approve a draft, read a conversation, check today's summary.**
- Approval Cards: one-tap approve, one-tap edit, swipe patterns, large touch targets.
- Notifications: push/WeChat notification when a draft needs review; a single evening digest otherwise. Never notification spam — noise kills trust faster than errors.
- Decide now: responsive PWA at Gate A; evaluate WeChat mini-program wrapper Post-launch.

Effort: Medium–High. This constrains all UI polish work, so it precedes WS3.

---

### WS3 · UI Polish System — **Gate A foundation, Gate C perfection**

One pass, driven by a design token system so consistency is enforced, not remembered.

**Gate A (foundation):**
- Design tokens: typography scale, spacing scale, color system (semantic: success/waiting/learning/error), radii, shadows, motion durations.
- Component audit: cards, tables, forms, buttons, status chips, navigation. One canonical version of each; delete duplicates.
- The Big Four states for every view: **empty, loading, error, success.**
  - Empty states teach and motivate: "你的员工还没有处理第一个对话。上传产品目录开始培训。" Never "No Data."
  - Loading: skeletons + contextual copy ("正在生成报价…"), never bare spinners.
  - Errors: what happened, what the system is doing about it, what (if anything) the owner should do. Never stack traces, never codes.

**Gate C (perfection):**
- Micro-interactions: animated approvals, quote-generation moment, message-send animation, status transitions, success confirmations. Motion should make the employee feel *alive*, but every animation ≤300ms and skippable.
- Dark mode, hover states, keyboard shortcuts (desktop), reduced-motion support.
- Accessibility pass: contrast, focus states, font sizing for older eyes (this is not optional for a 50-year-old user base — bump base font size).

---

### WS4 · Trust Experience Polish — **Gate B** (this is what they pay for)

Polish every trust primitive until it feels like managing a human employee:

- **Draft Mode & Approval Cards** — the heart of the product. Show the draft, the back-translation, the buyer context, and *why the AI said it* (in plain language: "根据你上次的修改，我这次用了FOB价格"). One tap to approve.
- **Back Translation** — always visible, never buried. The owner must never approve text they can't read.
- **The Pause Button** ⚠️ *New:* a big, obvious "让员工休息" (pause my employee) control on the home screen. Nothing builds trust like an instant off-switch. Also: per-conversation human takeover — owner jumps in, AI steps back gracefully, and *learns* from what the owner wrote.
- **Personnel File & Job Sheet** — make it genuinely readable: what the employee can do alone, what needs approval, recent promotions/demotions, error history with repairs.
- **Capability Promotions** — turn into a ceremony: "小雅 has handled 50 quotes with zero edits. Promote her to send quotes without approval?" Owner explicitly grants autonomy; autonomy is never taken.
- **Monthly Review & Spot Checks** — a beautiful one-page report: what was handled, what was learned, what was fixed. This doubles as the retention artifact (see WS10).
- **Repair Protocol** — when the AI errs, show the mistake, the correction, and the learned rule. Owners trust systems that visibly learn from mistakes more than systems that claim to be perfect.

---

### WS5 · Onboarding = Hiring — **Gate B basics, Gate C self-serve**

Reframe entirely: the owner is not configuring software, they are **hiring and training an employee.** Target: first value in under 10 minutes.

Sequence (each step skippable, resumable, mobile-friendly):
1. Name your employee, pick an avatar → instant emotional ownership.
2. Business basics: company name, logo, hours, languages, currency (smart defaults for Yiwu: CNY/USD, GMT+8, EXW/FOB).
3. Catalog upload — **the make-or-break step.** Accept messy Excel, photos of price lists, even forwarded WhatsApp messages. The parser must be tolerant; show extracted products for confirmation, not a rigid template. ⚠️ *New: invest disproportionately here.*
4. Connect WhatsApp (see WS6).
5. **The First Conversation** — a simulated buyer message arrives immediately; the employee drafts a reply; the owner approves their first draft within minutes of signing up. This is the activation moment. Instrument it.

Gate B: guided onboarding with your help on a call. Gate C: fully self-serve.

---

### WS6 · Connected Channels — **Gate A: WhatsApp only. Gate C: architecture for the rest.**

Ruthless scoping: **WhatsApp Business is the only channel at launch.** Everything else is UI scaffolding.

- Dedicated "对话渠道" section. Per channel: Connect / Disconnect / Reconnect / Health status / Last sync / Test connection / Permissions / plain-language diagnostics ("WhatsApp 需要重新登录，点这里").
- OAuth-style guided flows only. Never show an API key, webhook URL, or token to an owner.
- ⚠️ *New — WhatsApp compliance workstream (Gate A, non-negotiable):* BSP relationship, template message approval flow, 24-hour customer-service-window handling, opt-in records, quality rating monitoring. An account ban at a pilot customer is a company-ending event; the product must handle the 24h window and template rules invisibly.
- Visible-but-locked cards for Instagram, Messenger, WeChat, RedNote, Telegram, LINE, Email, Website Chat ("即将推出 — 想要这个渠道？告诉我们"). This is free roadmap-demand research.
- Future: TikTok, LinkedIn, Discord, SMS.

---

### WS7 · Business Profile + AI Employee Profile — **Gate B**

Two clean settings surfaces, both fully editable, both mobile-friendly:

- **Business Profile:** name, logo, country, timezone, languages, currencies, business hours, Incoterms, payment methods, shipping methods, description. Smart Yiwu defaults everywhere.
- **AI Employee Profile:** name, avatar, languages, personality, communication style, working hours, night shift, capabilities, approval levels, escalation rules, VIP handling. Frame as an employee's HR file, not a settings page.

Effort: Low–Medium (mostly exists; this is presentation polish).

---

### WS8 · Wow Moments — **one at Gate A, three by Gate C**

Do not build nine wow moments. Build the top three to perfection; each must make an owner grab another owner's arm.

Priority order:
1. **Image → Product match** (Gate A): buyer sends a product photo, YiwuFlow instantly identifies the catalog item, price, and MOQ, and drafts a quote. This is the demo. Perfect it.
2. **The Returning Buyer** (Gate B): buyer comes back after months; the employee greets them with full memory — last quote, negotiated price, shipping preference. Surface this to the *owner* visibly ("这是Ahmed，上次3月询过ZX-200，谈到$2.10/pc").
3. **Instant Invoice** (Gate B): from negotiation to formatted invoice card in one tap.

Later: voice-note understanding, smart follow-up suggestions, live operations view, instant multilingual replies (these exist as capabilities — stage their *presentation* post-launch).

---

### WS9 · Smart Insights, not Dashboards — **Gate C**

The home screen answers questions; it does not display charts.

- Daily brief: "今天：12个对话已处理，3个等你审批，1个客户需要跟进。"
- Answerable questions: Why did sales change? Which country converts best? Which products trigger objections? Which replies do I keep editing? Who should I follow up with today?
- Every insight ends with a suggested one-tap action, or it doesn't ship.
- Explicit anti-goal: no chart library, no analytics page, in v1.

---

### WS10 · Factory Brain, Buyer Memory, Retention & Referrals — **Gate B seed, Post-launch growth**

These are one strategy: **compounding value**, not lock-in.

- **Buyer Memory (Gate B):** perfect recall of quotes, products, negotiations, payment/shipping preferences, language, buying habits, full history, owner corrections. Surfaced in-context during conversations, not in a separate CRM screen.
- **Factory Brain (Post):** expand ingestion — documents, emails, invoices, voice notes, photos, operational knowledge. The longer YiwuFlow runs, the smarter the employee.
- **Make accumulation visible** ⚠️ *New:* a "knowledge counter" in the monthly review — "小雅 now knows 340 products, 85 buyers, and 210 of your corrections." Owners retain what they can see growing.
- **Referral moments, not referral campaigns:** the shareable weekly "员工周报" (employee weekly report) — a beautiful card summarizing what the AI handled, designed to be screenshotted into WeChat groups. Plus the wow moments in WS8. That's the entire referral strategy for v1.

---

### WS11 · Commercial Readiness — **Gate B** ⚠️ *New — missing from both drafts*

You cannot have a first paying customer without:

- Pricing tiers defined and a pricing page (Chinese + English).
- Billing: given the market, support WeChat Pay/Alipay/bank transfer with manual invoicing at Gate B; automate at Gate C. Don't block launch on Stripe.
- Fapiao/invoicing answer for Chinese businesses.
- Terms of service, privacy policy, and a **PIPL-compliant data story**: where buyer conversation data lives, cross-border transfer implications, deletion and export rights. This is also a *trust* feature — "你的数据永远是你的，随时可以导出" belongs in the product, not just legal pages.
- LLM cost guardrails per account ⚠️: per-tenant usage caps, graceful degradation, cost-per-conversation dashboard for *you*. One runaway account must not burn a month of margin.

---

### WS12 · Ship Readiness — **Gate C checklist**

- **Reliability:** error handling on every network call; retry queues for WhatsApp delivery; offline/poor-connection behavior (queue actions, sync later); graceful degradation when the LLM is slow or down (never lose a buyer message — worst case, notify the owner to reply manually).
- **Performance:** approval-card open <1s on mobile; drafts generated fast enough that "instant" is honest.
- **Ops for you** ⚠️: monitoring, alerting, status page, backup/restore drill actually performed once, incident playbook, kill switches per capability.
- **Demo environment:** a fully populated fake factory (products, buyers, live-feeling conversations) for sales demos and screenshots. Build this early — it also becomes your test fixture and marketing asset.
- **Support:** for this market, a WeChat support group + in-product "联系我们" beats a ticket system. Knowledge base of 10 articles covering the questions the pilot actually asked — write it from real pilot support logs, not imagination.
- **Marketing site:** Chinese-first landing page; the hero is a 60-second video of the image→quote wow moment. Onboarding email/WeChat sequence for the first 30 days.

---

### WS13 · First 30 Days Emotional Arc — **Gate C**

Design the milestones deliberately:

| When | Emotional target | Product moment |
|---|---|---|
| Minute 10 | "It works" | First draft approved (WS5 activation) |
| Day 1 | Excitement | First real buyer handled; owner shows someone |
| Week 1 | Trust forming | First spot check passed; first learned correction |
| Week 2 | Letting go | First capability promotion offered |
| Month 1 | Dependence (the good kind) | Monthly review: hours saved, revenue touched, knowledge accumulated → renewal is obvious |

Instrument each milestone. If pilots don't hit them, that's your bug list.

---

## Part 3 — Execution Sequence

Assumes one small team; adjust durations to reality. Order matters more than dates.

**Sprint 1–2 · Foundation (→ Gate A)**
1. WS1 Chinese-first language pass + product vocabulary lock
2. WS2 mobile audit of the three daily actions
3. WS3 design tokens + component consolidation + Big Four states
4. WS6 WhatsApp: connection UX + compliance (templates, 24h window)
5. WS8 Wow #1: image → product match, demo-perfect
6. WS12 demo factory environment (early — reused everywhere)

**→ Gate A: put a real pilot owner on it for a week. Log every confusion and support ping — that log is Sprint 3's backlog.**

**Sprint 3–4 · Trust & Money (→ Gate B)**
7. WS4 trust experience polish (approval cards, pause button, back translation, personnel file)
8. WS5 onboarding-as-hiring (guided)
9. WS7 both profile surfaces
10. WS8 Wow #2 & #3 (returning buyer, instant invoice) + Buyer Memory surfacing (WS10)
11. WS11 pricing, billing, PIPL/data story, cost guardrails

**→ Gate B: convert the pilot to paid. If they hesitate, the hesitation reason is the next sprint's top item.**

**Sprint 5–6 · Premium & Public (→ Gate C)**
12. WS3 micro-interactions, motion, dark mode, accessibility
13. WS9 Smart Insights daily brief
14. WS5 self-serve onboarding
15. WS10 weekly shareable report + knowledge counter
16. WS12 full ship-readiness checklist + marketing site + support setup
17. WS13 instrument the 30-day arc

**→ Gate C: public launch.**

**Post-launch:** additional channels (WeChat first — it's the owner's native habitat), Factory Brain expansion, voice notes, WeChat mini-program evaluation, referral report iteration.

---

## Part 4 — Per-Item Discipline

Every task created from this roadmap must carry:

- **Why it matters** (one sentence)
- **Impact:** user / trust / business (H·M·L each)
- **Effort:** S / M / L
- **Dependencies**
- **Gate:** A / B / C / Post
- **Definition of done includes:** passes the Non-Technical Owner Test, works on a mid-range Android phone, all four states designed, zero technical language, zh-CN copy reviewed.

**And one final filter, applied to every single item:** if it does not improve owner trust, ease of use, delight, perceived intelligence, retention, referrals, or first impressions — defer it. Shipping is the feature.
