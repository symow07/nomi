# Plan — from one factory's pilot to a product any business signs up for

Decided with the owner on 2026-09-18, after the first self-serve sign-up (A1)
went live. Nomi is for **any business that talks to buyers on social channels**
— a manufacturer, a trading company, a brand, an agency — not only a factory,
and each account needs its own people and more than one assistant.

Order of work. Each item ships and deploys on its own.

| # | Milestone | State |
|---|---|---|
| A1 | A business signs itself up; e-mail + password | ✅ live 2026-09-18 |
| S1 | Removing someone signs them out | ✅ live 2026-09-18 |
| D1 | Her answer for everything switches her catalogue on | ✅ built 2026-09-18 |
| A2 | Sign-up asks about the business; nothing says "factory" | next |
| A4 | Team page: everyone, who is online, last seen | after A2 |
| A3 | E-mail codes at sign-up and on a new device | built behind a switch; needs a system mailbox |
| A5 | Several assistants: name, role, channels | plan below — owner confirms before it is built |

## A2 · Sign-up asks about the business, and the product stops saying "factory"

**Decisions taken:** the type is chosen from a list of categories at sign-up;
sign-up also asks what they sell, country, website, team size and the channels
they use.

- **Categories** (`businesses.kind`): manufacturer · trading company / exporter ·
  wholesaler / distributor · brand / online shop · retail shop · agency ·
  services · other. Stored, shown on the profile, editable.
- **Also stored:** what they sell or do (becomes the profile description, so the
  first setup step is half done), country, website (optional), team size
  (1 · 2–5 · 6–20 · 21–100 · 100+), channels used today.
- **Wording:** with eight categories a word per category is not workable, so the
  copy goes neutral — "business" / 公司 / شركة — in all three languages
  (about 150 strings). Internal addresses such as `/app/factory` do not change.
- Team size and channels are for whoever sells Nomi, not for the product: they
  are stored and shown nowhere else in v1.

## A4 · Team page

One page for the account's admin: every person (owner, staff), how each signs
in (e-mail or access code), **online now** (seen in the last five minutes) and
**last seen**. The liveness check S1 added already runs once a minute per
person; it records the time it ran. Adding and removing people stays here. The
assistants of A5 get their section on the same page.

## A3 · E-mail codes (OTP)

**Decision taken:** a six-digit code by e-mail when the account is created, and
again when signing in from a browser not seen before.

- Needs an installation-wide sender, which does not exist yet: `SYSTEM_SMTP_*`
  (host, port, user, password, from). With Google Workspace: a mailbox such as
  `no-reply@…`, 2-step verification on, and an app password.
- **Unset, codes are off and sign-in works as today** — so this can ship before
  the mailbox exists and switch on the moment the five values are set.
- Codes: six digits, ten minutes, five tries, stored as a keyed hash, single
  use. A pending sign-up holds the password HASH, never the password.
- "A browser we have seen" is a signed, HttpOnly, 180-day cookie bound to the
  login; clearing cookies or a new device asks for a code again.
- The same sender makes **"forgot my password"** possible; it follows A3.

## A5 · Several assistants — for the owner to confirm

**Decision taken:** v1 assistants differ by **name, role and channels**.
Products, taught facts, price limits and what-she-may-do-alone stay shared by
the whole business.

What changes:

1. **`assistants`** — per business: name, role (sales · support · after-sales ·
   other), a short note in the owner's words about how this one should sound,
   the channels it answers on, and one default. Today's single employee becomes
   each business's default assistant, keeping her name — nothing changes for an
   account that never adds a second.
2. **Who answers a conversation** — the assistant whose channels include the
   one the buyer wrote on; otherwise the default. Recorded on the conversation
   when it starts, shown on the conversation and in Buyers, and changeable by
   the owner ("hand to Yasmin").
3. **Her name in the product** — today one constant per language, used by 23
   files and by every sentence that says `{name}`. Pages about one conversation
   use that conversation's assistant; pages about the whole business say "your
   assistants" or name the default. This is the largest part of the work.
4. **What she is told** — the reply writer receives the assistant's name, role
   and the owner's note. The guards do not change: numbers, claims, floors and
   forbidden words are the business's, whoever is speaking.
5. **Team page** — add, rename, change role and channels, archive. Archive,
   never erase: a conversation she held last March still names her.

Not in v1: per-assistant knowledge or product lists, per-assistant autonomy and
promotion, assistants that hand work to each other.

Estimate: about a week, in four steps that each ship — table and default
assistant · routing and the conversation badge · names in the copy · the reply
writer and the Team page.
