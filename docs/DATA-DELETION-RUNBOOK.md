# Deleting someone's data

Written for whoever operates this installation. Everything below is done by a
person, on purpose, and none of it can be undone.

## Why a person does this at all

The application role (`nomi_app`) holds no `DELETE` grant on any product table.
That is deliberate and `tests/integration/grants.test.ts` keeps it true, so a
bug, a stolen session or a mistaken tap cannot erase anybody's records. The
price of that guarantee is this document: erasure happens outside the app, as
the migration role, run by hand.

The product's job is to make the request **visible and countable**. Before
`deletion_requests` existed, a request lived in somebody's inbox and nobody
could say how many were open or how old the oldest was.

## The two kinds of request

| | Who asks | Where it lands | Carried out with |
|---|---|---|---|
| **Workspace** | the owner, for their whole account | `/app/settings/data` → a `deletion_requests` row, `scope = 'workspace'` | `tools/erase-workspace.mjs` |
| **Buyer** | one person who wrote to a business; the **owner** records it for them | a `deletion_requests` row, `scope = 'buyer'`, naming that buyer's `client_id` | `tools/erase-buyer.mjs` |

A buyer's request is the business's decision, because the business is the
controller of that buyer's data and we are its processor: the buyer asks the
business they wrote to (the public `/data-deletion` page tells them to), the
owner records it in the product, and we carry it out. If a buyer writes to us
directly, forward it to the business and tell the buyer you have.

## Before you erase anything

1. **There must be an open request.** Both tools refuse without one, and that
   refusal is load-bearing: no open request means somebody decided on a
   business's behalf. If the request arrived by e-mail or letter, have the
   owner make it in the product first, from their own account.
2. **Check it is not withdrawn.** An owner may take a request back until it is
   carried out. `state` must be `open`.
3. **Offer the export first, once.** `/app/settings/data` gives them every
   buyer, message, product, order, quote and contact as CSV. Someone closing a
   business usually wants their order history; after this they cannot have it.
   For one buyer, the owner may want that buyer's messages first — once erased
   they are gone for the business too.
4. **Take a backup you can actually restore**, and know how long it is kept.
   This is the last moment a mistake is recoverable.

## Carrying out a workspace deletion

```sh
# 1 · see what it would remove. Changes nothing.
MIGRATE_DATABASE_URL=… node tools/erase-workspace.mjs --business <uuid>

# 2 · do it. Both flags are required.
MIGRATE_DATABASE_URL=… node tools/erase-workspace.mjs \
  --business <uuid> --confirm "Their Business Name" --yes
```

The tool:

- refuses unless there is an **open workspace request** for that business;
- refuses unless `--confirm` matches the business's own name;
- is a **dry run** unless `--yes` is passed;
- reads the live schema to order the deletes, so it stays correct as tables are
  added — a hand-written list of seventy statements would not;
- runs in **one transaction**, so it cannot leave half a workspace behind;
- keeps `signup_invites` and unlinks it instead: that row is the operator's
  record of who was let in, not the business's data;
- keeps global `ops_flags` rows (`business_id is null`).

**On Railway**, `MIGRATE_DATABASE_URL` is the Postgres service's own URL, not
the app's. Run it through `railway run --service Postgres` so the value never
passes through a shell history.

## After a workspace deletion

The `deletion_requests` row is itself the business's data, so it goes with
everything else. That means **the only surviving record is the one you keep**:

1. Copy the tool's final line — it names the business, the row count and the
   request id.
2. Put it wherever your team keeps such records, with the date.
3. Reply to whoever asked, on the channel they used.

## A buyer, inside a business that is staying

The buyer asks the business; the owner records the request in the product, on
that buyer's page — one open request per buyer. **The 30-day clock starts at
`asked_at`** — when the owner recorded it — and the dry run prints the date it
is due. What is waiting:

```sql
select id, business_id, client_id, asked_at, asked_at + interval '30 days' as due, subject_note
  from deletion_requests
 where scope = 'buyer' and state = 'open'
 order by asked_at;
```

```sh
# 1 · see what it would erase and keep. Changes nothing.
MIGRATE_DATABASE_URL=… node tools/erase-buyer.mjs --request <uuid>

# 2 · read the counts, then do it. All three flags are required.
MIGRATE_DATABASE_URL=… node tools/erase-buyer.mjs --request <uuid> \
  --yes --confirm <first 8 characters of the request id> --by "<your name>"
```

Read the dry run before step 2. It prints the business, who asked and when,
the owner's note on who the buyer is, their identities (masked — check it is
the right person), how many conversations they have and how many stay as empty
shells, then three lists: **ERASED**, **KEPT** and **CHANGED IN PLACE**, with a
count per table. A line starting `!` is something to settle first — a sample
credit their order page will stop showing, another buyer row holding one of
their identities (the same person recorded twice needs a request of its own),
or a worker busy with them right now. `--by` goes on the request as who carried
it out. On Railway, run both steps through `railway run --service Postgres`, as
for a workspace, so the URL never passes through a shell history.

### What goes, and what stays

This is the contract the public `/data-deletion` page states. The tool carries
out exactly this — no more, no less.

**Erased** — their data:
- their identity on every channel (`client_channels`), and every message to or
  from them: `messages`, `message_fragments`, `turns`, `outbound_messages` and
  `outbound_transitions`, `deliveries`;
- drafts, quotes, sample requests, proof links (`quote_proofs`), conversation
  signals, events, escalations and notes, handoffs, `repairs`, conversation
  state, and the service's shadow of each turn (`shadow.turn_decisions`);
- outreach rows for their identities: `contacts`, `contact_consent`,
  `sequence_enrollments` and `sequence_sends`, and their number on the
  `pilot_allowlist`;
- their conversations — **except** one an order points at;
- their raw webhook receipts (`channel_events`) and any queued or finished job
  about them (`pgboss.job` — inbound jobs carry their words).

**Kept**:
- the orders they placed, with items, prices and status history
  (`order_updates`, `email_confirmations`). The order's e-mail, shipping
  address and notes are cleared; a confirmation mail keeps when it went and
  whether it arrived, not the address or the text;
- a quote an order was made from (a price snapshot, nothing personal);
- the conversation an order points at, as an **empty shell**: nothing in it,
  closed, inactive, held by nobody — it shows as done, never as a live buyer;
- their `clients` row, with every personal field cleared (name, e-mail, phone,
  country, language, notes), so the order and the request still point at
  someone who is nobody;
- `suppressions` for their identities, so they are never written to again;
- the request itself, closed as `done`: when, by whom, and the counts in
  `closed_note`. The audit trail has no verb for a carried-out deletion, so the
  closed request is the record.

**Changed in place** — rows that are not theirs but quoted them:
- `spot_checks`: the owner's verdict on the assistant's work stays (promotion
  and demotion count it); the link to their conversation and the owner's
  correction go;
- `channel_audit`: the entry stays; its detail is replaced when it named them
  or one of their rows (a refused send to their number, their words corrected);
- `channel_events`: another buyer's receipt that Meta batched with theirs keeps
  that buyer's part; theirs is taken out.

The same person in **another** business is that business's buyer, and nothing
there is touched.

### How it decides, and when it refuses

It reads the live schema rather than a list: it starts at the buyer's
`clients` row, walks every foreign key down, keeps whatever a kept row points
at, and deletes deepest first. Links that are not foreign keys — an identity
typed as text, a webhook's JSON, the audit trail's detail, a queued job — are
written out in the tool with the reason. It is one transaction: it locks the
buyer's rows, checks every statement's row count against the plan, then plans
again inside the transaction and commits only if nothing is left to erase and
every kept row is still there.

It refuses, and changes nothing, when:
- it is run as a role that row-level security filters — the app's own
  `DATABASE_URL` pasted by mistake would see a buyer with nothing to erase;
- the request is not an open buyer request — none, withdrawn, already done
  (a second run refuses), refused, or a workspace request;
- `--confirm` is not the request id's first 8 characters, or `--by` is missing;
- it meets a table it cannot classify — a new table with a key to `clients` or
  `conversations`, or with a buyer-like column (`client_id`, `conversation_id`,
  `identity`, `phone`, `email`…). Add it to `RULES` in the tool, with a
  decision, before running again;
- a row that stays would need a row the contract erases;
- a row reached from the buyer belongs to another business or another buyer
  (inconsistent data is a person's decision);
- a worker is handling one of their jobs right now — run it again in a minute.

### Afterwards

1. The owner sees the request as done in the product; tell them anyway.
2. Confirming to the buyer is the business's. Once their identities are
   erased, Nomi cannot write to them — a confirmation the owner wants to send
   through Nomi goes out **before** you run the tool.
3. Backups keep the old rows until they age out; say so.

The tool does not read free text people typed about the buyer elsewhere — the
owner's own description in `subject_note`, the notes on their order's status
updates (`order_updates.note`), the pilot log. If the owner knows of one, it is
theirs to edit.

## What we do not delete

- **Backups.** They age out on their own schedule; say so when you reply.
- **Meta's own copies.** A buyer manages those in their own Instagram or
  Facebook settings, and `/data-deletion` says so.
- **Another business's records.** Two businesses can hold the same buyer, and
  each one's copy is its own.
