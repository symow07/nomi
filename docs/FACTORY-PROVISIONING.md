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
MIGRATE_DATABASE_URL=<admin url> node tools/provision-factory.mjs "Factory Co., Ltd" zh --zone=Asia/Shanghai --currency=CNY
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

Take a final backup (`BACKUP-RESTORE.md`) before any decommissioning. Backups
are pruned — manual pairs after 180 days, dailies after 60 — so if the
factory's data-retention agreement requires that pair for longer, move it out
of the prune's reach first (`BACKUP-RESTORE.md`, "How long copies are kept")
and write down where it is and until when.

## Not built yet (deliberately)

- **Self-service signup** — no public registration; provisioning is admin-only.
- **Multi-factory in one deployment** — one `OWNER_ACCESS_CODE`, one
  `businessId` per deployment. The *data layer* is already multi-tenant (RLS is
  enforced and tested per tenant); it is the **owner login** that is single-tenant.
- **Per-user accounts / RBAC** — documented as a future need since M15; no
  authentication changes have been made.

## A factory signs itself up (A1)

`/signup` asks about the business (its name, what kind it is, what it sells,
country, website, team size, where buyers write today) and about her (name,
e-mail, password), and makes a business, its owner and her login **together or not at
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

**A forgotten password** is answered by the product, by the person who forgot
it: "Forgot your password?" on the sign-in page e-mails a one-time link (PWR,
#133; held to the standard by PWR2, 0129 — see "An owner who forgets the
password" below). The operator's `tools/add-login.mjs --reset` remains for an
owner who cannot reach that mailbox. A staff member with an e-mail login does
the same; one who signs in with an access code asks the owner for a new code.

## The first cohort: strangers who sign themselves up (G1–G10)

What changes when the people signing up are strangers, and what the operator
does about it. `docs/GO-LIVE.md` has the opening sequence; CLAUDE.md rules
54–61 the detail.

- **Sign-up (G1).** `SIGNUP_MODE=invite` and `SIGNUP_CAP=20` for cohort 1;
  `open` needs the installation's sender (it reads as closed without one).
  Every sign-up agrees to the terms in so many words (their version recorded)
  and confirms the e-mail code. The operator gets an e-mail for each sign-up
  (name, kind, country, what it sells, website) and a daily list at 07:15 UTC
  (sign-up forms and codes, and every operator switch still on).
- **What a new workspace starts with (G2).** Its zone and currency, the seven
  capabilities in draft, and a daily allowance: 1,000,000 tokens and 1,000
  model calls, a hard cap.
- **The allowance (G3).** Used up, the customer is handed to the owner in
  silence and no model is asked until midnight UTC; the owner is e-mailed at
  80% and 100%; 20 photos of a list a day.
- **Drafts until earned (G4).** Every reply waits for the owner until the ramp
  (or the operator, for a pilot: `tools/workspaces.mjs --earn`) opens sending
  alone.
- **Ready for customers (G6).** The owner's own Practice checklist stands where
  the installation's facts did; the machine room is the installation's only.
- **The operator's controls (G7).** `tools/suspend-workspace.mjs`,
  `tools/ops-flags.mjs` (silence, force drafts, stop new connections),
  `tools/workspaces.mjs` — each a dry run until `--yes`.
- **The funnel (G9).** `tools/workspaces.mjs --funnel`: each workspace's steps
  and decision 33's exit criteria.
- **A reply the owner may not read (G10).** Said so on the card, its figures
  listed, a translation on request (never sent).

## A workspace that exists gets a login (0078)

Sign-up makes a login only for a NEW workspace. A workspace made any other way
(the pilot's, provisioned before logins existed, or one made by
`tools/provision-factory.mjs`) has none, and an owner whose only login is lost has
no way back in through the product. For both, with admin access:

```bash
MIGRATE_DATABASE_URL=<admin url> PUBLIC_BASE_URL=https://app.example.com \
  node tools/add-login.mjs <business-id> <e-mail>
```

It gives the workspace's **owner** a login with that e-mail and prints a one-time
link, `/login/set-password?t=…`, good for 72 hours (`--hours N`, up to 168). The
owner opens it, chooses a password, and signs in on the ordinary door (a browser
never seen before still answers the e-mailed code). No password is typed on a
command line, and nobody but the owner ever knows it. Opening the link spends
nothing — a messenger's preview fetches it too; saving the password does, once.
Only the link's SHA-256 is stored, so if the printed link is lost, run the tool
again: a newer link closes the older one.

The rows are the ones sign-up writes: the owner on record (`people.is_owner`,
one per business), the e-mail trimmed and lower-cased and held to sign-up's
shape check, and a scrypt hash with sign-up's parameters — of random bytes
thrown away when hashed, so nothing signs in until the owner chooses a password.

| Situation | What to run |
|---|---|
| The workspace has no login | `add-login.mjs <id> <e-mail>` |
| No owner on record (e.g. made by `provision-factory.mjs`) | add `--name "<owner's name>"` |
| The owner forgot the password; the e-mail still works | nothing — "Forgot your password?" on the door. Only if no link arrives: `add-login.mjs <id> <their login e-mail> --reset` |
| The owner lost the e-mail itself | `add-login.mjs <id> <new e-mail> --replace` — archives the old login |

It refuses, and changes nothing, when the business does not exist or is switched
off, when it is the practice sandbox, when the e-mail is another workspace's
login, when the workspace already has a login (it says which, and wants
`--replace`), and when run with a role that row security filters.

**An owner who forgets the password asks the door** (PWR, 0084, since
2026-09-30; PWR2, 0129, 2026-10-04). "Forgot your password?" on the sign-in
page, in all five languages, asks for the address and mails a one-time link to
this same page (`/login/set-password?t=…&l=<language>`):

- **Only to the login's own, proven address.** The link goes to the address the
  login signs in with (as stored, never as typed), and only once that address
  has answered: a code mailed to it was typed back (sign-up, a new browser), a
  link sent to it was spent, or the operator wrote it in with this tool
  (`logins.email_verified_at`, 0129). An address that never answered gets
  nothing — and the door says the same words.
- **Good for 60 minutes, once.** Only the token's SHA-256 is stored. Opening the
  link spends nothing; saving a password spends it, closes every other open
  link of that login, and ends every other session of that login at once. The
  address is then mailed "your password was changed", with the way to ask for
  another link.
- **No enumeration.** The same page, status, headers and words whether or not
  the address signs in here; the answer is sent before anything is looked up,
  and the timing is measured equal (tests/integration/password-reset.test.ts).
- **Throttled.** Five asks an hour per caller at the door; three links an hour
  per login in the database; the daily mail caps (0112) on top.
- **Nothing logs the token.** The link's routes write no request line and send
  `Referrer-Policy: no-referrer`; switching language on that page keeps the link
  in a cookie for that one address (HttpOnly, an hour), never in a link.
- **How it leaves.** The same sender as sign-in codes (`codeMail`): the
  dedicated HTTPS sender when `MAIL_PROVIDER`/`MAIL_API_KEY`/`MAIL_FROM` are
  set, else the operator's connected Gmail mailbox over the Gmail API (HTTPS),
  from `SYSTEM_SMTP_FROM`, and SMTP only last — Railway blocks SMTP, so on
  Railway a reset mail leaves over HTTPS or not at all. A mail that cannot
  leave is written to `app_errors` as `DoorMailFailed` (the reason, never the
  address), and the operator is e-mailed like any error (`tools/errors.mjs`).
- **Where the installation sends no system mail** (or has no
  `PUBLIC_BASE_URL`, which the link needs — it is never built from the
  request's host), the page says to write to Nomi's team at the legal contact
  address, and `--reset` is the way.

The pilot's workspace also opens with the deployment's `OWNER_ACCESS_CODE` ("I
have an access code"). An access code is never mailed: the forgot page says to
ask whoever gave it — the business (a staff code) or Nomi's team.
