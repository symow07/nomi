# The first real factory, end to end (M18.6)

One ordered path from an empty tenant to real buyers, with the point of no
return marked. **The first real message cannot be un-sent** — everything before
step 5 is reversible, and step 5 onward is deliberately narrow.

Each stage has an exit condition. Do not move on until it is true.

    provision → verify tenant → owner setup → knowledge → rehearsal
      → security → allowlist → Meta connection → first buyer

## 0. Tenant identity — operator. **Blocking, and easy to get wrong.**

Before anything else, the deployment must know *whose factory it is*.

```bash
MIGRATE_DATABASE_URL=<admin url> node tools/provision-factory.mjs "Factory Co., Ltd" zh
# → prints PILOT_BUSINESS_ID=<id>;  set it in the host environment
```

`assertPilotTenant` refuses to boot when that id is unset, absent, or is the
**practice sandbox**. The sandbox case is the one to fear: everything works, and
the owner teaches her real catalogue into the space `/app/sandbox` resets.

Live production reached exactly this state — one business, the practice sandbox,
with `PILOT_BUSINESS_ID` defaulting to a demo id that did not exist there.

**Exit:** the deployment boots, and `select id, name from businesses` shows the
factory you meant, distinct from `5a4d0000-…-b1`.

> **Rollout order matters.** The guard refuses a wrong tenant, so provision and
> set `PILOT_BUSINESS_ID` **before** deploying a build that contains it.
> Otherwise the deployment will correctly refuse to start.

## 1. Provision — operator, ~10 minutes

`FACTORY-PROVISIONING.md`. Stage 0 created the `businesses` row; now set
`OWNER_ACCESS_CODE` and send it to the owner. No `channels` row — "not
connected" is the absence of one.

**Exit:** the owner can log in and `/app/onboarding` shows every item ○.

## 2. Owner setup — owner, a few hours over a few days

Driven entirely by `/app/onboarding`: business profile → products and prices →
teach the knowledge buyers actually ask for → authorise (or disclaim) claims.

**Exit:** Profile, Products, Knowledge and Claims are ✓ *Verified by system*.
These come from real data — nothing can be ticked on the owner's behalf.

## 3. Rehearse — owner, ~30 minutes

`/app/sandbox`. Run the practice flow at least once: buyer question → drafted
reply → approve or edit → **take over** → reply as yourself → **hand back** →
correct a fact you taught. The runbook counts what has actually been practised.

**Exit:** *Practice before launch* shows **5/5**, including *Trust validation
passed*. The owner has now done, on a simulated buyer, every action they will
need to do on a real one.

## 4. Security gate — operator. **Blocking.**

`M18-ACTIVATION-GATE.md`. Rotate the Anthropic key and both database passwords,
then confirm **Secrets rotated** on `/app/onboarding`.

This is enforced: `activate()` refuses with `secrets_not_rotated` until the
confirmation exists. Activating with credentials that were pasted into a chat
transcript would expose real buyer conversations.

**Exit:** rotation done at source, old credentials proven rejected, backup
tested (`BACKUP-RESTORE.md`), and the deployment reachable
(`verify-remote.sh https://<host> <code>` passes).

## 5. Activate — narrow by construction

**Add the allowlist BEFORE activating.** While the channel is in pilot mode,
outbound goes only to numbers on it — everything else is refused at send time,
canceled, and audited. `pilot_mode` defaults to **true**, so this is the
behaviour you get whether or not you think about it.

Order the allowlist deliberately:

| Stage | Who is on the list | What you are testing |
|---|---|---|
| 5a | **Your own phone, alone** | that a real message arrives, reads correctly, and the draft-approve loop works with a live buyer |
| 5b | **+ 2–3 friendly buyers** who know they are in a pilot | real questions, real ambiguity, with someone who will forgive a mistake |
| 5c | wider, one number at a time | volume, and the questions you did not anticipate |

Then: set the Meta credentials, flip `WHATSAPP_PROVIDER=meta`, redeploy,
register the webhook, connect the channel, and activate in the product
(`GO-LIVE.md` has the exact steps). Activation refuses unless readiness is
complete, the allowlist is non-empty, and secrets are confirmed rotated.

**Exit for 5a:** you sent yourself a message from your own phone, the reply was
held as a draft, you approved it, and it arrived.

## 6. Watch — the first real conversations

- `/app` — what needs you today.
- `/app/inbox` — take over the moment a reply looks wrong. The employee goes
  silent in that conversation immediately; you reply as yourself.
- `/app/onboarding` — *Delivery health* (anything accepted but not delivered)
  and *What happened so far* (why you were needed, what you did).

**Draft-first stays on.** Turning messaging on does not grant the employee
permission to send by itself; capabilities are promoted deliberately in
`/app/employee`, and only after you have seen enough real conversations to want
it. A daily outbound ceiling blocks a runaway loop; it never blocks you.

**Exit:** a week in which you were not surprised.

## 7. Widen

Add numbers one at a time. Turning the allowlist **off** — opening to every
buyer — is a separate, deliberate decision, and the honest end of the pilot.
Do it only when `What happened so far` has stopped teaching you new things.

## When it goes wrong in front of a real buyer

1. **Take over that conversation** — the narrowest containment, instant.
2. Fix the cause: correct the fact in `/app/knowledge`, or authorise/withdraw a
   claim. The correction is what stops it recurring.
3. If it is broader: **Disconnect** on `/app/channels`, or deactivate. Queued
   employee messages are canceled at send time, not delivered late. Nothing is
   deleted; reconnecting resumes.
4. Record it (`INCIDENT-PLAYBOOK.md`). A repair the owner can see is worth more
   to trust than a mistake that never happened.

## What is deliberately NOT automated

- **Going live** — an env change plus a human decision. No runtime toggle.
- **Opening past the allowlist** — a separate explicit step.
- **Promoting a capability** — the owner does this, never the system.
- **Reachability against Meta** — proven by the webhook handshake and a real
  round-trip at go-live, not by a probe. Probing would be the live traffic this
  whole sequence exists to control.
