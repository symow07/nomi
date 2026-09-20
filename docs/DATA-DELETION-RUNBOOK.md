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

| | Who asks | Where it lands |
|---|---|---|
| **Workspace** | the owner, for their whole account | `/app/settings/data` → a `deletion_requests` row, `scope = 'workspace'` |
| **Buyer** | one person who wrote to a business | reaches the **business**, not us — the public `/data-deletion` page tells them to ask the business they wrote to |

A buyer's request is the business's to carry out, because the business is the
controller of that buyer's data and we are its processor. If a buyer writes to
us directly, forward it to the business and tell the buyer you have.

## Before you erase anything

1. **There must be an open request.** The tool refuses without one, and that
   refusal is load-bearing: no open request means somebody decided on a
   business's behalf. If the request arrived by e-mail or letter, have the
   owner make it in the product first, from their own account.
2. **Check it is not withdrawn.** An owner may take a request back until it is
   carried out. `state` must be `open`.
3. **Offer the export first, once.** `/app/settings/data` gives them every
   buyer, message, product, order, quote and contact as CSV. Someone closing a
   business usually wants their order history; after this they cannot have it.
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

## Afterwards

The `deletion_requests` row is itself the business's data, so it goes with
everything else. That means **the only surviving record is the one you keep**:

1. Copy the tool's final line — it names the business, the row count and the
   request id.
2. Put it wherever your team keeps such records, with the date.
3. Reply to whoever asked, on the channel they used.

## A buyer, inside a business that is staying

There is no tool for this yet, and that is honest rather than accidental: it
needs the business's own decision about what it must keep by law (an invoice
for an order is usually one of those), and that is a conversation, not a
script. Today:

1. Find them: `select id, display_name from clients where business_id = $1 …`
2. Decide with the business what stays — orders and their `order_updates`
   normally do; messages, `client_channels`, `contacts` and `contact_consent`
   normally go.
3. Delete inside one transaction, deepest first. `messages` hang off
   `conversations`, `client_channels` off `clients`.
4. Record it, and tell the buyer.

When this happens more than once or twice, build it into the tool with a
`--client` flag rather than repeating it from memory.

## What we do not delete

- **Backups.** They age out on their own schedule; say so when you reply.
- **Meta's own copies.** A buyer manages those in their own Instagram or
  Facebook settings, and `/data-deletion` says so.
- **Another business's records.** Two businesses can hold the same buyer, and
  each one's copy is its own.
