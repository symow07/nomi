# Provisioning a factory (M17.5)

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

```sql
-- Pick a fresh UUID: select gen_random_uuid();
insert into businesses (id, name, timezone, default_language, engine)
values ('<uuid>', '<Factory Co., Ltd>', 'Asia/Shanghai', 'en', 'service');

-- Optional: start the onboarding record (created on first attestation anyway)
insert into onboarding_state (business_id, step) values ('<uuid>', 'business_basics');
```

- `default_language` — `en`, `zh`, or `ar`. The owner can switch it in the UI at
  any time; this is only the starting point.
- `engine` — `service` (the TypeScript engine). `n8n` exists only for the
  legacy rollback path in ADR-0009.
- **Do not insert a `channels` row.** `channels.status` accepts only
  `connected | connecting | needs_attention | disconnected | degraded`; the
  "not connected yet" state is the *absence* of a connected channel and is
  derived by the read model. A row is created when the channel is connected.

Confirm the tenant starts honestly empty — every readiness item false:

```sql
with os as (select * from onboarding_state where business_id='<uuid>')
select
  coalesce((select (description is not null and location is not null
                    and (contact_email is not null or contact_phone is not null))
            from businesses where id='<uuid>'), false) as profile,
  exists(select 1 from products where business_id='<uuid>' and is_active
           and price_usd_per_unit is not null) as products,
  exists(select 1 from product_knowledge where business_id='<uuid>' and status='active'
           and source in ('owner_confirmed','owner_corrected')) as knowledge,
  (exists(select 1 from claims_policy where business_id='<uuid>' and allowed)
    or (select claims_reviewed_at from os) is not null) as claims,
  exists(select 1 from channels where business_id='<uuid>' and kind='whatsapp'
           and status='connected') as channel;
-- expected on a new factory: f | f | f | f | f
```

Then confirm isolation — a brand-new tenant must see nothing of any other:

```sql
begin;
  select set_config('app.business_id', '<uuid>', true);
  select count(*) from products;   -- 0
  select count(*) from messages;   -- 0
rollback;
```

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
