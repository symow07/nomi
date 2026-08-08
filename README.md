# Nomi

**A sales employee a factory can trust in front of a real buyer.**

A Yiwu-area factory hires a digital employee. She answers buyer enquiries on
WhatsApp — identifies the product, quotes within the owner's own price rules,
and never states a price, specification or certification the owner has not given
her. When she cannot answer safely, she stops and hands the conversation to a
person.

The owner runs it themselves. There is no operator between them and the product.

> The repository, database, migrations and internal identifiers are named
> `yiwuflow`; the product the owner sees is **Nomi**. That split is deliberate —
> see [PRODUCT.md](PRODUCT.md).

---

## 1. What it is

The product is not "an AI that replies to customers". It is a control system
around one, built on four commitments:

**Owner-controlled.** She proposes; the owner decides. Draft-first is the
default and order confirmation is draft-forever. Autonomy is granted per
capability, one capability at a time, and can be taken back in one tap.

**Factory knowledge before answering.** Every claim traces to something the
owner taught or confirmed. Certifications are default-deny: anything not
explicitly authorised is refused, even if the buyer insists. Prices come from
the owner's catalogue and price rules, never from the model.

**Human takeover when needed.** One ownership model — she has it, a human is
waited on, or the owner holds it. A buyer who asks for a person gets one, and
while a human holds a conversation she is silent.

**Trust before scale.** Messaging is off until the owner explicitly turns it on,
and even then only the numbers on their allowlist can be reached. Going live is
a decision made in the product, recorded, and reversible in one tap.

Three languages are first-class: **English, 中文, العربية** (RTL). The owner
picks whichever they are comfortable in; none is the source of truth.

---

## 2. Architecture

A modular TypeScript monolith. One process serves the owner's web surface and
runs the background worker.

```
Buyer on WhatsApp
      │  signed webhook
      ▼
  ingress ──► pipeline/turn ──► decide ──► retrieval (taught knowledge)
                    │                          │
                    │                          └─► commerce (quote, guards)
                    ▼
             draft  ──or──  auto-send        (per-capability autonomy)
                    │
      owner reviews │ approves / edits / skips
                    ▼
            outbound queue ──► send gate ──► WhatsApp adapter
```

| Layer | Where | What it is |
|---|---|---|
| HTTP + owner UI | `src/api/` | Fastify. Server-rendered HTML, no client framework. |
| Turn pipeline | `src/pipeline/` | One buyer message end to end. |
| Pure domain | `src/core/` | Decisions, guards, pricing, i18n. **No I/O, no clock, no randomness** — enforced by `npm run boundaries`. |
| Persistence | `src/db/` | Postgres via Kysely. Every query runs inside a tenant transaction. |
| Queues | `src/queue/`, `src/worker/` | pg-boss, in the same Postgres. |
| Channels | `src/channels/` | WhatsApp adapters, allowlist, activation. |
| Outbound | `src/outbound/` | The one path a message takes to a buyer. |
| Model calls | `src/llm/` | Anthropic. Never a source of prices or claims. |
| Trust harness | `src/trust/` | Scripted safety scenarios, run as a test. |

Runtime dependencies are deliberately few: `fastify`, `kysely`, `pg`, `pg-boss`,
`@anthropic-ai/sdk`, `zod`.

### The invariants

These are the load-bearing rules. Tests enforce each one; breaking any of them
is a defect, not a design choice.

- **One send path.** Exactly one function inserts an outbound row, and exactly
  one place calls the provider — behind one gate.
- **One approval path.** Every draft resolution goes through one service, under
  a row lock, so a double-tap cannot send twice.
- **One ownership model.** `ownershipOf(assigned_to)` is the only interpreter of
  who holds a conversation.
- **One knowledge source.** `product_knowledge` for facts, `claims_policy` for
  what may be claimed. Corrections supersede; nothing is overwritten.
- **One setup derivation.** A single live query answers "what is still missing".
- **No invented numbers.** Every figure shown to an owner is a real count. No
  scores, no ratings, no percentages-as-performance.
- **Archive, never erase.** The application role holds no `DELETE` anywhere.

### The send gate

Nothing reaches a buyer without passing all of it, and every check fails closed —
an unresolved input is treated as "no", never "yes":

| Refusal | Meaning |
|---|---|
| `not_activated` | The owner has not turned messaging on for this channel. |
| `not_allowlisted` | This buyer is not on the pilot allowlist. Binds the owner too. |
| `handed_off` | A human holds this conversation; she stays silent. |
| `paused` | The capability was pulled back, or the tenant is paused. |
| `daily_ceiling` | The tenant hit its daily maximum (employee messages only). |
| `window_closed` | Outside the 24-hour window; it goes back to the owner. |

**Connected ≠ activated.** Working credentials mean a message *could* leave.
Activation means the owner *decided* it should. A channel is in exactly one of
four states — not connected, ready, active, paused — and every surface renders
that one answer.

### Tenancy

Multi-tenant by Postgres RLS. The app connects as `nomi_app`, a role that is
neither superuser nor `BYPASSRLS`, and every query runs inside
`withTenantTx(db, businessId, …)`. Two boot guards refuse to serve rather than
serve unsafely:

- the runtime role is not subject to row security → **refuse**
- the database schema is behind this build → **refuse**, with the migrate command

Migrations are additive and forward-only; an older build runs correctly against
a newer schema, which is what makes rollback safe.

### The owner's product

Four destinations, each answering one question:

| Surface | Question |
|---|---|
| **Today** (`/app`) | What needs me today? |
| **Buyers** (`/app/inbox`) | Who needs care? |
| **小雅** (`/app/employee`) | Who is she today? |
| **My factory** (`/app/factory`) | What does she need to know about my factory? |

Everything else — products, knowledge, connections, settings, practice, the
go-live runbook — is reached from one of those four, never from a permanent
menu slot.

---

## 3. Running it locally

Requires Node and a local Postgres.

```bash
npm install
bash .claude/skills/run-yiwuflow/smoke.sh
```

That script is the fastest honest path: it starts an ephemeral Postgres,
migrates, seeds a demo factory and the practice sandbox, builds, launches, and
drives the whole owner walkthrough. It prints the URL and login code, and leaves
the server running.

Manually, if you prefer:

```bash
export MIGRATE_DATABASE_URL='postgresql://…'   # admin role
npm run migrate
npm run seed:demo
npm run seed:sandbox
npm run build && npm start
```

Messaging is **off** unless `WHATSAPP_PROVIDER` is set. With it unset there is no
adapter, no webhook route, and no outbound worker — the owner surface runs fully.

Environment variables are listed in [`docs/env-checklist.md`](docs/env-checklist.md).
The app validates them at boot and exits with the names of anything missing or
malformed; it never prints a value.

---

## 4. Testing

```bash
npm run check     # typecheck + core purity + the full unit suite
npm run trust     # the scripted safety scenarios
```

Integration tests need a real Postgres:

```bash
DATABASE_URL='postgresql://…' npx vitest run tests/integration/
```

| Suite | What it protects |
|---|---|
| `tests/parity/` | Pure logic and every rendered surface, in all three locales |
| `tests/pipeline/` | One buyer turn, with fakes for I/O |
| `tests/integration/` | Real Postgres: RLS, the send path, boot, owner routes |
| `tests/harness/` | The trust harness — scripted safety scenarios |

The suite treats certain things as facts about the product rather than
implementation details: the send gate's fail-closed behaviour, tenant isolation,
the banned owner-facing vocabulary, and the absence of invented metrics.

---

## 5. Deploying

Railway builds on push to `main`. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

Apply migrations **before** the new build boots — it refuses to start on a stale
schema:

```bash
MIGRATE_DATABASE_URL='<admin url>' node tools/migrate.mjs
git push
bash .claude/skills/run-yiwuflow/verify-remote.sh https://<host> "$OWNER_ACCESS_CODE"
```

`verify-remote` is read-only and safe against production: health, that `/health`
leaks no build information, that every owner surface redirects when signed out,
that owner actions reject anonymous callers, the session cookie flags, that the
webhook is absent while messaging is disabled, and that each owner surface
renders.

Back up with **both** parts before a migration — a database dump without its
roles file restores with RLS enabled and zero policies. See
[`docs/BACKUP-RESTORE.md`](docs/BACKUP-RESTORE.md).

---

## 6. Where things are written down

| Document | |
|---|---|
| [PRODUCT.md](PRODUCT.md) | Who the owner is, their devices, the language rules |
| [docs/adr/](docs/adr/) | The decisions and why, including the ones since regretted |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Where it runs, which build is live, how to verify |
| [docs/BACKUP-RESTORE.md](docs/BACKUP-RESTORE.md) | Backup that actually restores |
| [docs/GO-LIVE.md](docs/GO-LIVE.md) | Turning messaging on, and off again |
| [docs/OPS-RUNBOOK.md](docs/OPS-RUNBOOK.md) · [docs/INCIDENT-PLAYBOOK.md](docs/INCIDENT-PLAYBOOK.md) | Running it, and when it breaks |
| [docs/SECRET-ROTATION.md](docs/SECRET-ROTATION.md) | Rotating credentials |
| [docs/ROADMAP.md](docs/ROADMAP.md) | What is next |

---

## 7. Status

**Controlled-pilot ready, messaging deliberately disabled.** Deployed and
verified in production: schema current, tenant isolation enforced and proven,
three boot guards active, and the owner surfaces serving a real, intentional
factory tenant.

Built and verified:

- **Activation** — connect ≠ activate. Preconditions are a live derivation, the
  owner starts and stops messaging from My factory, and the send gate refuses
  anything the owner has not turned on.
- **Allowlist** — add and remove numbers from My factory, audited. During a
  pilot the list binds everyone, the owner included.
- **Refusal visibility** — every way a message can fail to reach a buyer is
  recorded, surfaced on the conversation it belongs to and in Today, and says
  what happened and what to do about it. A silent refusal is a product defect.
- **Factory rehearsal** — what she cannot answer yet, derived from the owner's
  own catalogue, prices, taught knowledge and authorised claims. Never blocks
  activation.
- **Tenant identity** — the process refuses to boot on a missing tenant, or on
  the practice sandbox.
- **Pictures** — she reads a buyer's photo and matches it to a product, and she
  can send one back. A picture goes out through the same single send path and
  the same gate as any reply, and an image whose photo cannot be carried is
  refused rather than quietly sent as its caption alone.

Not done, and the only external dependency: **Meta / WhatsApp Cloud**. Business
verification, phone provisioning, credentials, message-template approval, webhook
registration and channel connection are all outstanding, and activation is
blocked until they exist. The adapter itself is written and exercised against a
simulator; no Meta traffic has ever been sent.

Also outstanding: message templates — until Meta approves one, a conversation
that falls outside the 24-hour window goes back to the owner rather than being
re-opened. The state is derived from what is actually approved, so the path
lights up the moment one is.

---

## 8. What is left from the first version

The product began as n8n workflows against Supabase. The workflows are gone
(`ADR-0001` records the extraction, `docs/SUPABASE-EXIT-AUDIT.md` the database
exit). Three directories survive, and — contrary to what this section used to
claim — **two of them are load-bearing**:

| Path | Status |
|---|---|
| `prompts/` | **Live.** `src/llm/anthropic.ts` reads `analysis.txt`, `response.txt` and `image_analysis.txt` on every model call. |
| `supabase/` | **Live.** `tools/migrate.mjs` applies `schema.sql` as the migration baseline; `rls_policies.sql` is applied only when Supabase's own roles exist. The filename is historical; the content is portable SQL. |
| `samples/` | **Live in tests.** `payloads.json` is the corpus the parity suite replays. |

Only `prompts/order_validation.txt` is inert — it is quoted in a comment in
`core/types/commerce.ts` as the origin of the confirmation rules, and kept for
that provenance.

The runtime has never depended on Supabase-the-service.
