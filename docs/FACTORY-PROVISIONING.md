# Provisioning a factory (M17.5)

> **Since A1 (2026-09-18) a factory can sign ITSELF up** — see
> "A factory signs itself up" at the end. What follows is still how the FIRST
> factory of an installation is made (the one `PILOT_BUSINESS_ID` names and
> the environment's access code opens), and it is unchanged.

How a new factory tenant is created. **This is deliberately an operator
procedure, not a self-service signup** — there is no public registration, and
creating a tenant requires database admin access. That is a security property,
not a gap: the app role is blocked by RLS from creating a business at all
(verified — the attempt fails with *"new row violates row-level security policy
for table businesses"*).

Everything below has been executed against a real database.

## What provisioning does and does not do

| Operator does (once, with admin access) | Owner does (in the Command Center) |
|---|---|
| Create the `businesses` row | Fill in the business profile |
| Set the owner access code | Add products and prices |
| Later: attach the WhatsApp credential | Teach knowledge, review claims |
| | Run the sandbox rehearsal |

The split matters: the operator creates an **empty, honest** tenant, and M15
Pilot readiness then tracks the owner's progress from real data. Nothing is
pre-ticked.

## Step 1 — create the tenant (admin connection)

```bash
MIGRATE_DATABASE_URL=<admin url> node tools/provision-factory.mjs "Factory Co., Ltd" zh
```

It generates the id itself, creates one `businesses` row, and prints the value
to configure plus the factory's readiness — every item `○`:

```
  Factory provisioned: 义乌启明日用品厂

  Set this in the deployment environment, exactly:

      PILOT_BUSINESS_ID=0c8fca99-6637-4310-9161-fa4150f96d7c

      ○ business profile
      ○ products with prices
      ○ taught knowledge
      ○ claims reviewed
      ○ pilot allowlist
      ○ WhatsApp connected   (needs Meta — see GO-LIVE.md)
```

**The id is generated, never supplied.** An operator who can pass an id is an
operator who can pass the sandbox's, which is the mistake this tool exists to
make impossible. The language argument is `en | zh | ar` and is only a starting
point — the owner can change it in the UI.

`MIGRATE_DATABASE_URL` is required: the application role is refused by RLS
(`businesses` carries `with check (id = current_business_id())`). This tool does
not weaken that, and an integration test asserts the app role still cannot
create a tenant.

**The factory starts empty.** No products, no knowledge, no claims, no
conversations, and no `channels` row — "not connected" is the *absence* of a
connected channel, derived by the read model (M20.3.1), not a stored status. M15
readiness derives from real rows, so a seeded head start would be a lie the
product then reports as progress. The tool exits non-zero if a brand-new factory
somehow reports anything as done.

## Step 1b — tenant identity (M23)

`PILOT_BUSINESS_ID` decides which business every owner surface reads. Set it to
the id printed above.

```bash
# host environment
PILOT_BUSINESS_ID=<the id the tool printed>
```

**This is enforced at boot.** `assertPilotTenant` refuses to start when the id
is unset, names a business that does not exist, or names the practice sandbox —
joining `assertSafeRuntimeRole` (tenant isolation) and `assertSchemaCurrent`
(schema currency). In production it throws; elsewhere it warns, so a developer
without a provisioned factory is not locked out.

### The sandbox separation rule

**A factory must never be the practice sandbox.** `SANDBOX_BUSINESS_ID`
(`5a4d0000-…-b1`) is where the owner rehearses: `/app/sandbox` resets it, which
archives conversations, and it is seeded with a product nobody sold. Pointing
`PILOT_BUSINESS_ID` at it is the dangerous failure precisely because **nothing
breaks** — the owner teaches her real catalogue into practice space and no
surface tells her.

This was not hypothetical. Live production held exactly one business, the
practice sandbox, while `PILOT_BUSINESS_ID` defaulted to a demo id that did not
exist there. Both reachable states were wrong; neither showed on `/health`.

### Verifying tenant identity

```bash
# 1. the row exists and is not the sandbox
psql "$MIGRATE_DATABASE_URL" -c "select id, name from businesses;"

# 2. the deployment agrees — it will refuse to boot if it does not
#    (watch the deploy logs; a refusal names the exact operator action)
curl -s https://<host>/health
```

`/health` deliberately does **not** report the tenant id, for the same reason it
does not report the commit (M17.1).

## Step 2 — give the owner access

One pilot factory per deployment today: the Command Center authenticates with a
single `OWNER_ACCESS_CODE`, and the session is bound to `WebDeps.businessId`.

```bash
# host environment
OWNER_ACCESS_CODE=<a long random phrase>
```

If unset, one is generated and logged once at boot — set it explicitly instead.
Send it to the owner over a channel they already trust; it is the only credential
they have.

> **Limitation, stated plainly:** a second factory needs a second deployment.
> Multi-tenant owner login (one deployment, many factories, per-owner accounts)
> is not built — see "Not built yet" below.

## Step 3 — the owner sets the factory up

Point them at `/app/onboarding` (**Pilot readiness**) and let the page drive:

1. **Business profile** → `/app/settings` — description, location, contact.
2. **Products and prices** → `/app/products` — at least one active product with a price.
3. **Knowledge** → `/app/knowledge` — teach the facts buyers actually ask about.
4. **Claims** → `/app/knowledge` — authorise certifications you can prove, or
   confirm you have none.
5. **Sandbox validation** → the **Run** button replays the golden scenarios
   through the real engine.
6. **Practice** → `/app/sandbox` — a buyer question, a draft, an approval, a
   take-over, a reply, a hand-back. The runbook shows what has been practised.
7. **Owner confirmations** — backup tested (`BACKUP-RESTORE.md`), secrets
   rotated (`SECRET-ROTATION.md`), owner ready.

Every ✓ is either system-detected from real data or an explicit owner
confirmation, and the page keeps the two apart. Nothing can be ticked on the
owner's behalf.

## Step 4 — connect WhatsApp

Only once the checklist is green: `GO-LIVE.md`. Until then the factory is fully
usable in the sandbox and no buyer can reach it.

## Decommissioning

There is no delete. The app role has **no DELETE privilege anywhere** —
archive-not-erase is a system-wide invariant. To stop a factory:

```sql
-- stop messaging (the send gate suppresses outbound immediately)
update channels set status='disconnected', disconnected_at=now() where business_id='<uuid>';
-- deactivate the credential so no inbound webhook resolves to this tenant
update channel_credentials set is_active=false where business_id='<uuid>';
```

Take a final backup (`BACKUP-RESTORE.md`) before any decommissioning, and keep
it for as long as the factory's data-retention agreement requires.

## Not built yet (deliberately)

- **Self-service signup** — no public registration; provisioning is admin-only.
- **Multi-factory in one deployment** — one `OWNER_ACCESS_CODE`, one
  `businessId` per deployment. The *data layer* is already multi-tenant (RLS is
  enforced and tested per tenant); it is the **owner login** that is single-tenant.
- **Per-user accounts / RBAC** — documented as a future need since M15; no
  authentication changes have been made.

## A factory signs itself up (A1)

`/signup` asks four things — the factory's name, her name, an e-mail and a
password — and makes a business, its owner and her login **together or not at
all**. She is signed in to an empty, honest workspace; readiness starts at
every item `○`, exactly as above. From then on she signs in at `/login` with
that e-mail and password. Nobody copies an id, and nothing is redeployed.

**Who may do it is the operator's decision, `SIGNUP_MODE`:**

| Mode | What a stranger meets |
|---|---|
| `invite` (default) | The form, which also asks for an invitation. No valid one, no workspace. |
| `open` | The form. Anyone who reaches it gets a workspace. |
| `closed` | One sentence and no form. |

Make an invitation (admin access, like everything else in this document):

```bash
MIGRATE_DATABASE_URL=<admin url> PUBLIC_BASE_URL=https://app.example.com \
  node tools/invite-factory.mjs "Atlas Canvas — met at Canton Fair" 14
```

It prints a link, `/signup?invite=<id>`, good for one workspace and for the
number of days given (14 if omitted).

**The security property above still stands.** The application role still cannot
insert into `businesses`. A tenant is made by one definer function,
`provision_account` (migration 0055), which takes nothing that could name an
existing tenant and spends the invitation in the same transaction. To the
application role `signup_invites` does not exist: it can ask whether a ticket
is good and nothing else, so nothing that faces the internet can mint one.

**What every workspace shares, and what it does not.** Its data never (row-level
security, as before). The installation's WhatsApp number can belong to one
workspace only — a second one is told it is taken. Instagram, Messenger and
Gmail are connected per workspace. **The reply-writing key is shared**: every
workspace's drafts and live practice are paid for by this installation, which is
why `open` is a decision and `invite` is the default. The `SMTP_*` sender is
also installation-wide; leave it unset on an installation with more than one
factory, because a domain's DNS records are public and would let one factory
"verify" another's domain.

**Not built yet:** a forgotten password is reset by the operator (there is no
installation-wide mail sender to send a reset link with), and staff still sign
in with the access codes their owner hands them.
