# ADR-0005 — Multi-tenancy enforced at the database

**Status:** Proposed · **Depends on:** [0003](0003-domain-model-and-typed-state.md)

## Context

Two live problems, both of which become breaches the moment there is a second tenant.

**1. The tenant is taken from the customer's request body.**

```js
// n8n/intake.json — Normalize Payload
if (!b.business_id) b.business_id = $env.BUSINESS_ID;
```

`business_id` is read **from the payload**, with the env var only as fallback. Anyone
who can post to the webhook can therefore *declare which tenant they are*. Today there
is one tenant, so the blast radius is nil. At multi-tenancy, this exact line lets an
attacker request another business's catalog and pricing.

**2. Isolation lives in hand-typed URL strings.**

Every Supabase call filters with `?business_id=eq....` written by hand in a GUI. The
service key **bypasses RLS entirely**. One forgotten filter — in one node, once — is a
cross-tenant data leak, and nothing will tell you.

Tenant isolation cannot depend on remembering to type a filter.

## Decision

**The database refuses cross-tenant reads. Application code is not trusted to filter.**

### 1. The app does not connect as a superuser

Today everything uses the Supabase `service_role` key, which has `BYPASSRLS`. That is
the root of the problem: RLS is present but structurally inert.

| Role | Used by | RLS |
|---|---|---|
| `yiwuflow_app` | the service, at runtime | **enforced** (no BYPASSRLS) |
| `yiwuflow_migrate` | migrations only, in CI | bypasses |
| `service_role` | **retired** from application use | — |

### 2. Every request runs inside a tenant-bound transaction

```ts
export async function withTenant<T>(
  businessId: BusinessId, fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async tx => {
    await tx.raw(`select set_config('app.business_id', ?, true)`, [businessId]);
    return fn(tx);   // ← every query inside is tenant-scoped by the DATABASE
  });
}
```

`true` makes it `SET LOCAL` — scoped to the transaction, so a pooled connection cannot
leak one tenant's context into another's request. **This is the single most important
line in the file**; getting it wrong with a connection pooler is the classic way this
design fails.

### 3. Policies

```sql
alter table conversations enable row level security;

create policy tenant_isolation on conversations
  for all to yiwuflow_app
  using      (business_id = current_setting('app.business_id')::uuid)
  with check (business_id = current_setting('app.business_id')::uuid);
```

`using` blocks reads; `with check` blocks writes that would *create* a row in another
tenant. Both are required — a policy with only `using` lets you write rows you can't
read, which is worse than useless.

Applied to every tenant-scoped table. Tables reachable only by FK (`messages`,
`conversation_state`, `product_aliases`) get a policy that joins to the parent, so a
missing `business_id` column is not an escape hatch.

**Now a query that forgets `where business_id = ...` returns zero rows instead of
another customer's order book.** The failure mode becomes a bug, not a breach.

### 4. Tenant resolution moves to the credential

`business_id` is **derived from the channel credential the message arrived on** and is
never read from the payload:

```ts
interface ChannelAdapter {
  resolveTenant(req: Request): Promise<BusinessId>;   // by webhook token / phone number ID
}
```

```sql
create table channel_credentials (
  id              uuid primary key,
  business_id     uuid not null references businesses(id),
  channel         text not null,
  external_ref    text not null,        -- WABA phone_number_id, IG page id, webhook token
  secret_ref      text not null,        -- pointer into the vault — NOT the secret
  unique (channel, external_ref)
);
```

The inbound `business_id` field is **dropped from the message schema entirely**. It
cannot be spoofed if it does not exist.

### 5. Secrets leave the database

`channel_sources.webhook_secret` and `.api_token` currently hold **plaintext
credentials**. They are replaced by `secret_ref` — a pointer resolved at runtime from
an external secret store (Doppler / AWS Secrets Manager / Fly secrets). A database
backup should never be a credential dump.

## Consequences

**Good.** Cross-tenant leakage requires defeating Postgres, not just fooling a
developer. Spoofing a tenant becomes impossible because the field is gone. A dropped
`where` clause degrades to "no results" instead of "someone else's data". Secrets
survive a database compromise.

**Bad.** RLS costs a few percent on query plans. Every DB access must go through
`withTenant` — a real discipline, enforced by making the raw pool private to `db/` and
lint-banning direct imports elsewhere. Migrations and admin/analytics jobs need a
deliberate, audited bypass path.

**Sequencing.** Do this **during** the migration, not after. Retrofitting RLS to a
live multi-tenant system with customer data in it is the kind of project that eats a
quarter. Right now there is one tenant and no production data — it is nearly free.
