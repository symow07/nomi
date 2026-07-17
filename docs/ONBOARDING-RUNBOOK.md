# First-Customer Onboarding Runbook

The operator's checklist for taking one factory from handshake to live drafts.
Owner-facing flow per TRUST-PLAYBOOK Q8; this is the backstage view.

## Before meeting the owner (30 min, us)

- [ ] Business row created; `channel_credentials` row (channel=whatsapp,
      external_ref = phone_number_id, engine=service)
- [ ] `autonomy_policy`: all 7 capabilities `draft` (migration 0008 default) —
      verify, don't assume
- [ ] Owner's own WhatsApp/WeChat added as the bridge contact
- [ ] Sandbox (or prod number) webhook pointed at our ingress

## With the owner (~1 hour of his time, conversational, in Chinese)

1. **Frame** (2 min): 「前两周它是试用期员工，每句话先给你看。你随时说『收回』。」
   Let him NAME the assistant. Rehearse the revoke once — a door he's walked
   through isn't scary.
2. **Catalog** (his: 15 min; ours: the cleanup): he forwards the price list
   (photo/Excel/anything). WE normalize → send back as a checklist → he replies
   对/不对 per line. Products + aliases + single-tier prices land in SQL.
3. **Commercial interview** (15 min, 6 questions, top-5 products only):
   floor price 「最低多少你肯接受?」→ `pricing_policy.floor_price_usd`;
   discount authority → `max_discount_pct` / `human_required_above_pct`;
   payment terms; incoterms offered → `claims_policy` rows;
   certifications held (checkbox list + cert numbers) → `claims_policy`.
   *Draft mode note: floors are only REQUIRED to promote `quote` to auto —
   don't block day one on a hesitant answer.*
4. **VIP list** (5 min): 「哪些老客户我不该碰?」 forward contacts → VIP rows.
5. **Data answer, unprompted** (1 min): 你的价格表只存在你自己的库里，不训练
   别人的模型，随时可删。
6. **Roleplay** (5 min): we message the number as a fake Dubai buyer; he
   watches the draft card arrive. 「这就是它工作的样子。」
7. **Staff** (if any): introduce the assistant as the person who takes the
   night grunt work — their junior, not their rival.

## Days 1–14

Run TRUST-PLAYBOOK's day table verbatim. Operator duties: fix every edited
draft same-day (style memory), watch approval latency for the rubber-stamp
signal, never mention promotion before day 4, log every surprise into
`docs/learnings/` for the weekly triage.

## Abort criteria (protect the market)

Drafts sitting >24h by day 4, or >50% edit rate persisting after fixes →
pause, diagnose with the owner, do NOT push through. One burned owner in one
market talks to ten others over tea.
