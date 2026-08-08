> **ARCHIVED — a snapshot of 2026-07-14, not current.** Kept because the
> reasoning is still worth reading and because two of its ⛔ items record real
> history; do not act on its rankings.
>
> Resolved since: **"there is still no git repository"** — the repository exists
> and every milestone below M19 is in it. **Free-tier Supabase pauses** — the
> runtime never depended on Supabase-the-service (`SUPABASE-EXIT-AUDIT.md`);
> production is Railway Postgres 18. **`usage_ledger` designed but not built** —
> it exists (migration 0008) with `tenant_budgets` and `core/budget.ts`.
>
> Superseded by `docs/ROADMAP.md` for status and `docs/adr/` for decisions.

# Production Risk Review — 2026-07-14

What can still hurt us, ranked within category by (likelihood × damage). Items
marked ⛔ should block production; ⚠️ should block *scale*; ▫️ are accepted for
now, on the record.

The single theme: **the engine is now well-defended; the edges are not.** Almost
every remaining risk lives where Nomi touches the outside world — channels,
humans, model behaviour, and the founder's own time.

---

## 1. Technical

**⛔ Nothing has processed a real LLM turn end-to-end.** Today's live run proved
the database half of M0.5 (RLS, invariant, retrieval, close loop against real
Postgres). The service's LLM half — analyzer prompt behaviour, JSON parse rate,
guard false-positive rate, real latency — has run only against fakes. The first
100 real turns will surface prompt/parse issues no test can. *Mitigation: that
is what shadow is for; do not shorten it.*

**⛔ The shadow diff's n8n side is a reconstruction, not a recording.** n8n has
no per-turn fingerprint, so `parity-report.mjs` snapshots current state per
conversation. Bursty conversations blur attribution: a "divergence" may be two
turns compared against one state. *Mitigation: run the diff daily (not weekly);
treat burst-window divergences as triage-first, not bug-first. Accepted because
fixing it properly means instrumenting n8n — throwaway work.*

**⚠️ The numeral guard's allowlist is untested against reality.** Unit tests
pass, but real multilingual replies (Arabic-Indic numerals ٠١٢٣, "2k pcs",
"half a dollar") may bypass extraction or false-positive constantly. A guard
that fires on every reply silently degrades every message to the template.
*Mitigation: log every violation with the reply text during shadow; review
weekly; extend extraction for Arabic-Indic digits before Arabic-market cutover.*

**▫️ Model pinned to claude-sonnet-4-6.** Right for parity; after cutover it
becomes silent drift risk when the model is eventually deprecated. The `turns`
table records `model_id` per decision, so an upgrade is measurable when forced.

## 2. Operational

**⛔ Bus factor = 1, and there is still no git repository.** This remains the
single largest project risk and it is not close. One `rm -rf`, one bad sed, one
dead laptop, and 3,300 lines of engine plus eleven ADRs are gone. Every other
mitigation in this document assumes the code exists. *Mitigation: `git init` +
push to a private remote today. I can do the first; only you can add the remote.*

**⛔ No alerting destination is wired.** Dead-letter queues alert into… a
`notify.team` queue whose consumer prints to stdout. Until Telegram credentials
exist, an exhausted retry is still functionally silent. *Mitigation: the
Telegram bot token is a 10-minute setup and unblocks handoff v1 too.*

**⚠️ Free-tier Supabase pauses after ~7 days of inactivity.** Today's restore
proves the failure mode: the entire product goes down and nothing tells you.
Unacceptable once one real customer exists. *Mitigation: Pro tier (~$25/mo) at
first paying tenant; a health-check ping until then.*

**⚠️ Secrets have no story yet.** `channel_credentials.secret_ref` points at a
secret store that hasn't been chosen. The interim will be env vars on whatever
box runs the service — acceptable solo, but write the runbook: where they live,
how they rotate, who can read the box.

**▫️ No staging environment.** Solo + shadow-run + flag rollback is a defensible
substitute for now. Revisit at first paying tenant.

## 3. Commercial

**⛔ The AI can still over-commit in prose.** The numeral guard stops invented
*numbers*, but "we can definitely deliver before Ramadan", "yes, food-grade
certified", "we ship DDP" are numeral-free commitments a B2B buyer will hold
you to. This is the same class of exposure as invented prices and currently
unguarded. *Mitigation (schema, not prompts — per your rule): a per-business
`claims_policy` table (certifications held, incoterms offered, guarantees
allowed) + a post-generation claim check against it. Design in M1; this is the
numeral guard's sibling and the next deterministic-code-over-LLM move.*

**⚠️ Floor prices don't exist for real tenants.** The whole commercial engine
assumes `pricing_policy` rows a factory owner must supply. If onboarding doesn't
force floor + discount authority, the engine runs guardrail-free — legally
quoting whatever tier price exists, with no negotiation margin defined.
*Mitigation: make floor price a required onboarding field. No floor, no AI
quoting — refuse loudly, not silently.*

**⚠️ One quote in writing is an offer.** In most B2B contexts a written quote
can be treated as binding. The quote audit trail helps you *honour* mistakes
cheaply, but a tier-table typo (0.038 vs 0.38) becomes 10,000 units at a tenth
of the price. *Mitigation: ingestion staging + diff + approve (already designed)
plus a sanity check — quote price deviating >50% from the scalar reference price
requires human approval.*

## 4. Scaling

**⚠️ Every turn is 1–2 LLM calls with no per-tenant budget.** One viral RedNote
post = one tenant consuming the platform's whole Anthropic quota and budget.
~~The `usage_ledger` is designed but not built.~~ **Closed.** The ledger exists
(migration 0008: `usage_ledger`, `tenant_budgets`), `core/budget.ts` decides, and
`channelStore.load` resolves the pause from real usage against the tenant's own
budget — a tenant over its cap is paused, not the platform. A separate daily
outbound ceiling (M18.5) blocks a runaway loop from spending the day messaging a
real buyer, and never blocks the owner.

**▫️ pg-boss on the primary; catalog re-fetched per turn; single region
(ap-southeast-1 — good for China/GCC clients).** All fine for years at
realistic volume; all have known escape hatches (ADR-0004, retrieval caching,
read replica). On the record, not on the roadmap.

## 5. Customer experience

**⛔ Handoff still has no human on the other end.** The AI now correctly goes
silent (`unclaimed`) — which means until the Telegram claim-bridge exists, an
escalated customer gets *nothing*: no bot, no human. Silence is worse than the
old bug for that customer. **This is why the inbox is item 3 in your plan and
must ship before any real-customer cutover** — the SLA holding message is the
minimum viable version.

**⚠️ Deterministic commitment templates are English-only.** An Arabic-speaking
buyer converses in Arabic, then receives the order confirmation in English.
Safe but jarring at the exact moment of maximum trust. *Mitigation: translate
the ~8 commitment templates per supported language (static strings, one-time
human-verified translation — not generation) before cutover of ar/zh traffic.*

**⚠️ No typing/latency masking.** A 4–8s silent gap between message and reply
reads as "nobody is there" on chat channels. *Mitigation: send the channel's
typing indicator from the worker on job start — small, but disproportionate CX
value.*

**▫️ Image pipeline still has placeholder URLs** (bucket exists in name only).
Known since the first audit; blocks TC-006/007 only.

---

## The five that matter most, in order

1. **`git init` + remote** (operational ⛔ — everything else assumes the code survives)
2. **Human inbox v1 / Telegram bridge** (CX ⛔ — silence after handoff)
3. **First real LLM turn + shadow** (technical ⛔ — the remaining unknown)
4. **Claims policy check** (commercial ⛔ — the numeral guard's missing sibling)
5. **Per-tenant budget ledger** (scaling ⚠️ — cheap now, an outage later)
