# WABA Operational Runbook

Operational, not architectural. What to do, in order, and what to do when it breaks.

## Setup sequence (fastest path — ADR-0012 B)

1. **Today, no accounts needed:** 360dialog **sandbox** — free, immediate.
   Point `WHATSAPP_BASE_URL=https://waba-sandbox.360dialog.io`, get the sandbox
   API key per their docs, set our webhook. The adapter + WoZ pilot run here.
2. **This week:** create the 360dialog account and request **partner-led Meta
   verification** (no website needed; 5 min–48 h after validation). Prepare:
   business licence, legal name exactly as registered, contact email.
3. **Number:** a NEW number, never the factory's personal WhatsApp (ban risk =
   channel death). SIM stays in a drawer; the API owns the number.
4. **Display-name review** (1–3 days) → then production base URL + key.
5. **Template pack, submitted in week one, one batch** (each edit = re-review):
   holding message, follow-up nudges × trigger × language, digest opener.
   Wording frames YiwuFlow as the *merchant's own sales assistant* — never a
   general-purpose AI (policy constraint, ADR-0012 A).

## Hard platform rules the code already honours

| Rule | Where enforced |
|---|---|
| Ack webhooks < 5s, process async | ingress does verify→persist→enqueue only |
| Retries up to 7 days → dedup mandatory | `channel_events.id` = provider event id (PK) |
| Outbound order not guaranteed | `outbound_messages.seq` + sequencer (await `delivered`, 90s cap) |
| 24h customer-service window | outside-window sends must be approved templates; a 4xx here is **non-retryable** (client marks it so) |
| Quality rating | follow-up caps are channel-survival rules, not politeness |

## Failure drills

- **Number ban:** appeal via 360dialog; activate standby number; buyers reached
  via last-known alternate contact. Write the appeal BEFORE launch.
- **Webhook outage (ours):** provider retries 7 days; on recovery the pending
  `channel_events` drain in order; dedup absorbs replays. No action beyond fix.
- **Template rejected:** revise wording (no promotional language in utility
  templates), resubmit; never work around via free-form outside the window.
- **Quality rating drops:** halt follow-ups (`follow_up` → draft), review the
  digest for ignored messages, resume gradually.
