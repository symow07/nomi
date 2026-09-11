# Go-Live: switching WhatsApp on (M17.2)

Everything up to this point is **preparation** — Nomi currently runs with
`WHATSAPP_PROVIDER=disabled`, so no webhook is mounted and no message can be
sent or received. This document is the one deliberate step that changes that,
and how to undo it.

> **Nothing in the product performs this switch.** The readiness page reports
> what is missing; flipping the provider is a human decision made in the host's
> environment settings.

## Before you start

Confirm on `/app/onboarding` (owner login required):

- **Pilot readiness** — the before-launch checklist is ✓ (system-verified items
  and your own confirmations).
- **Practice before launch** — the rehearsal has been done at least once, so you
  have taken over a conversation, replied as yourself, and handed it back.
- **WhatsApp setup** — every credential shows ✓ *Set*.

The page shows only whether each credential is **set and correctly shaped** — it
never displays a value, and reading it contacts nobody.

## Credentials

Set these in the host environment (Railway → Variables). They are read at boot;
the app never stores them in the database.

The left column is what the **owner page** calls each item; the middle is the
env var to set. (The UI uses owner language — implementation vocabulary is
banned there by an ADR-0008 test — so the mapping is written down here instead.)

| Shown as | Env var | Shape |
|---|---|---|
| Access key | `META_WHATSAPP_ACCESS_TOKEN` | ≥ 20 chars |
| WhatsApp number id | `META_WHATSAPP_PHONE_NUMBER_ID` | digits, ≥ 5 |
| Business account id | `META_WHATSAPP_BUSINESS_ACCOUNT_ID` | digits, ≥ 5 |
| App secret | `META_APP_SECRET` | ≥ 16 chars |
| Callback password | `WEBHOOK_VERIFY_TOKEN` | ≥ 16 chars (you choose it) |
| Connection version | `META_GRAPH_API_VERSION` | e.g. `v23.0` |

These shapes are defined once, in `src/core/channel/metaReadiness.ts`, and are
used by **both** the readiness page and the fail-closed boot check — so the page
cannot say "ready" for a value the app would refuse to start with.

Setup of the Meta app itself (numbers, permissions, test recipients) is covered
in `META-CLOUD-API-SETUP.md`.

## The switch

> **M18 changed the order.** Two things now happen before the provider flip:
> the **security gate** (`M18-ACTIVATION-GATE.md` — rotate the compromised
> setup credentials; `activate()` refuses without the confirmation) and the
> **pilot allowlist** (`FIRST-FACTORY-WORKFLOW.md` §5 — add your own phone
> first). While the channel is in pilot mode, outbound reaches only listed
> numbers; everything else is refused at send time, canceled, and audited.
> `pilot_mode` defaults to **true**, so this holds whether or not you set it.

0. **Pass the security gate and add the allowlist** — your own number alone, to
   begin with.
1. **Set the credentials** (above) and redeploy. The provider is still
   `disabled`, so nothing changes yet — this only makes the readiness page ✓.
2. **Verify the deployment is healthy** before turning messaging on:
   ```bash
   bash .claude/skills/run-nomi/verify-remote.sh https://<host> "$OWNER_ACCESS_CODE"
   ```
   While messaging is disabled this asserts `/webhook/whatsapp` is **404**.
3. **Flip the provider**: set `WHATSAPP_PROVIDER=meta` and redeploy. The webhook
   routes now mount. `/health` reports `"provider":"active"`.
4. **Register the webhook with Meta** — callback URL
   `https://<host>/webhook/whatsapp`, verify token = `WEBHOOK_VERIFY_TOKEN`.
   Meta issues a `GET` handshake; the app echoes the challenge only when the
   token matches.
5. **Connect the number** in the Command Center: `/app/channels` →
   **Connect this number** (the owner does this). It records the number set in
   `META_WHATSAPP_PHONE_NUMBER_ID` as this factory's, which is how an incoming
   message finds its factory. **Until this step, every message a buyer sends is
   acknowledged to Meta and dropped** — the webhook answers 200 and nothing is
   processed, so a test message from your phone will simply never appear. (G3,
   2026-09-10: before then nothing in the product could do this at all.)
   Connecting lets messages in; she still sends nothing. Then **activate** the
   pilot. Activation refuses unless readiness is complete, the allowlist is
   non-empty, and secrets are confirmed rotated — and it leaves pilot mode ON,
   because activation starts a controlled pilot rather than ending one.
6. **First contact — with your own number, not a customer's.** Send a WhatsApp
   message *to* the business number from your own phone and confirm:
   - it appears in `/app/inbox`
   - the employee's reply is held as a **draft** (draft-first is the default;
     nothing auto-sends until you grant a capability)
   - approving it delivers the message
7. **Watch the first real conversations.** `/app` (Operations Home) shows what
   needs you; `/app/onboarding` shows what the employee did.

## Reachability is verified here, not in code

The readiness check is deliberately offline: it validates shape only. Whether
the token is *accepted by Meta* is proven by step 4 (the handshake succeeds) and
step 6 (a real message round-trips). There is no automated probe against Meta —
adding one would mean live traffic, which is exactly what preparation must not do.

## Rollback

**The channel is the switch — reach for it before rolling back the app.**

| Situation | Action | Effect |
|---|---|---|
| Replies are wrong / buyer is upset | `/app/inbox` → **Take over** on that conversation | The employee goes silent there immediately; you reply as yourself |
| Something is broadly wrong | `/app/channels` → **Disconnect**, or `deactivate()` | `channels.status='disconnected'`; queued employee messages are **canceled at send time**, not delivered. The allowlist and all history survive — reconnecting resumes |
| A specific buyer must stop being reached | archive them from the allowlist | that number is refused at send time from the next message on |
| Full stop | Set `WHATSAPP_PROVIDER=disabled`, redeploy | Webhook unmounts; inbound stops being accepted |
| Bad build | Redeploy the previous commit (see `DEPLOYMENT.md`) | Schema is additive, so an older build runs against the newer schema |

Disconnecting is **not** destructive: no conversation, message, or draft is
deleted, and `/app/channels` → **Reconnect** resumes. The suppression happens in
the outbound worker's send gate, so a message already queued but not yet sent is
canceled rather than delivered late.

After any rollback, note what happened in `INCIDENT-PLAYBOOK.md`.

## What does not change at go-live

- **Draft-first stays the default.** Turning messaging on does not grant the
  employee permission to send on its own; capabilities are promoted deliberately
  in `/app/employee`.
- **The guards stay on.** Price floors, unauthorised-claim blocking, and handoff
  on a request for a human behave exactly as they did in the sandbox — the
  sandbox runs the same engine.
- **The sandbox stays isolated.** It has no channel credential and cannot send.
