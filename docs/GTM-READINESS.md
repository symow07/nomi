# GTM Readiness: Follow-ups · Onboarding · WhatsApp

## 1. Follow-up engine (Priority 4) — design

Extends ADR-0011 §1–3. Doctrine unchanged: **deterministic triggers, LLM
phrasing only, kill-conditions in code.** What's new here is the trigger
taxonomy and its schema.

### Trigger taxonomy

| Trigger | Source of truth | Fire condition | Cap |
|---|---|---|---|
| **Silence** | `conversation_state.last_message_at` | quiet > policy hours for (phase, lead_score) — hot ≥60: 4h; warm: 24h; early: 72h. Working-hours aware, both timezones | 2 unanswered / conversation |
| **Reorder reminder** | `orders.confirmed_at` + product lead time | `confirmed_at + lead_time + consumption_window` (default 90d, per-category override) — "your last batch of X should be running low" | 1 / order |
| **Price drop** | `quotes` vs current `price_tiers` | recompute the client's last quote against today's tiers; fire only if ≥5% cheaper — a *provable* "prices improved since we spoke" | 1 / quarter / client |
| **Seasonal demand** | `seasonal_signals` table (category, region, lead-window) e.g. Ramadan lighting, Christmas decor, back-to-school stationery | today ∈ [event − lead_time − 30d, event − lead_time] and client history touches the category | 1 / season / client |

```sql
create table follow_up_policies (business_id uuid, phase text, lead_band text,
  quiet_hours int, max_attempts int default 2, is_active bool default true);
create table follow_ups (id uuid pk, business_id uuid, conversation_id uuid,
  trigger text check (trigger in ('silence','reorder','price_drop','seasonal')),
  attempt int, scheduled_at timestamptz, sent_at timestamptz,
  outcome text check (outcome in ('replied','ignored','opted_out','cancelled')),
  unique (conversation_id, trigger, attempt));            -- invariant pattern again
create table seasonal_signals (business_id uuid, category text, region text,
  event text, event_date date, lead_time_days int);
create table client_optouts (business_id uuid, client_id uuid, primary key (business_id, client_id));
```

Kill-conditions (code, not judgment): any inbound reply cancels pending
follow-ups on that conversation; opt-out is permanent + raises a problem
signal; handed-off conversations are never followed up by the AI. Hourly
pg-boss cron; sends go through the normal outbound queue and both guards.

**Sequencing note:** silence + reorder ship first (their source data exists
today). Price-drop needs stable tiers; seasonal needs the signals table
populated — both fast-follow.

## 2. Onboarding: operational in one day (Priority 5)

The constraint to design against: **a factory that cannot state a floor price
cannot safely use the product** — but demanding a perfect catalog kills the
sale. Resolution: **progressive activation.** The AI's authority grows exactly
as fast as the data does; missing data degrades capability, never safety.

| Stage | Owner provides (time) | AI may do | Enforced by |
|---|---|---|---|
| **S0 Concierge** | WhatsApp connected + company name (30 min) | Greet, qualify, collect requirements, hand EVERYTHING commercial to the owner via inbox | no products ⇒ no quotes possible (structural) |
| **S1 Catalog** | Product list: name, MOQ, unit, ONE price each — CSV/Excel/paste, staged→diffed→approved (2–3 h incl. our cleanup pass) | + identify products, state list price & MOQ (single tier) | tiers exist; no policy ⇒ discount authority 0% |
| **S2 Commercial** | Floor price + max discount + human-approval threshold; standard payment terms; incoterms offered (30 min, guided) | + negotiate within authority, confirm orders end-to-end | `pricing_policy` + `claims_policy` rows |
| **S3 Rich** | Volume tiers, certifications w/ numbers, seasonal calendar, more languages (ongoing) | + volume pricing, certification claims, seasonal follow-ups | per-row policy |

Day-one target = **S2**, ~4 hours of owner time, most of it the catalog. The
interview for S2 is 6 questions, not a form ("What's the least you'd ever
accept per unit for X?" → floor. "How much can a salesperson discount without
asking you?" → authority).

**Messy catalogs are our labor, not the customer's blocker:** the ingestion
pipeline (staging → auto-clean → diff → owner approves on their phone) does the
normalization; the owner only ever answers "is this right?". Certifications:
we ask "which of these 12 do you hold?" with checkboxes + cert-number fields —
structured at the source, because C2 in ASSUMPTIONS.md says the guard will
strangle usefulness otherwise.

## 3. WhatsApp workstream (Priority 6) — external critical path

**Start the application now.** This is paperwork latency, not engineering, and
every shadow-phase gate depends on traffic that needs a channel to exist.

**Sequence:** Meta Business Manager verified (1–5 days; the long pole —
business registration docs, matching website/domain email) → 360dialog account
+ number (a NEW number not bound to any WhatsApp app; keep the factory's
existing number out of it initially) → API onboarding (hours) → display-name
review (1–3 days) → messaging-limit tier climb (starts at 1k conv/day, grows
with volume + quality).

**Operational failure modes to design for, day one:**

| Failure | Reality | Mitigation |
|---|---|---|
| **24-hour window** | Free-form replies only within 24h of the client's last message. **Follow-ups outside the window MUST be pre-approved template messages** | This is a hard constraint on the follow-up engine: silence/reorder/seasonal nudges become templates with variables, submitted for approval during onboarding. Design templates now, not after rejection |
| Quality-rating drop / flagging | Too many templates ignored or reported → tier cut or number ban | Follow-up caps (already code) are also *channel-survival* rules; monitor quality rating via API |
| Number ban | Catastrophic: the business's channel goes dark | Never onboard the factory's personal number; keep the ban-recovery runbook (appeal + standby number) written before launch |
| Template rejection cycles | Each template edit = re-review days | Batch-submit the full template pack (holding message, follow-ups × trigger × language) in week one |
| Webhook downtime | Missed messages are unrecoverable via webhook alone | 360dialog redelivery + dedup already handles replays (external_id) |

Docs to collect this week: business licence, website/domain email, the number
to dedicate. Then the application clock starts running in parallel with
everything else.
