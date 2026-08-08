# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## What it is

Nomi is a trusted sales employee for factories. A Yiwu-area factory or export
business hires a digital employee who answers buyer enquiries on WhatsApp —
identifies the product, quotes within the owner's rules, and never states a
price, specification, or certification the owner has not given her.

Product name is **Nomi**, and it is now the only name. The split this document
once argued for — `yiwuflow` inside, Nomi outside — is reversed; see Constraints.

## Primary user

**The factory owner or manager, operating it themselves.** Confirmed: no operator
sits between them and the product. Design must be self-explanatory — anything that
requires someone to explain it has failed.

- Chinese factory owner/manager, sells to Arabic- and English-speaking buyers.
- Not a software user by trade. Judges the product the way they'd judge a new hire:
  *can I trust her in front of a customer yet?*
- The founder is currently also an operator during the pilot, but the owner is the
  design target; operator-only surfaces are demoted, not first-class.

## The job

1. **What needs me?** — approve or correct replies, step into a conversation.
2. **Is my employee ready?** — can she be trusted with real buyers yet.
3. **How do I improve her?** — teach a fact, correct a wrong answer.

## Operating context

**Both phone and desktop, split by task.** Confirmed:

- **Phone** — urgent, short: approving a reply, taking over a conversation, replying
  as themselves. Happens between other work, on the factory floor, one-thumb.
- **Desktop** — long, authoring: teaching knowledge, catalogue and prices, setup.

Neither is a fallback for the other. Navigation must work in both without a rewrite.

## Languages

**Chinese, English and Arabic are all first-class.** Confirmed: the owner picks
whichever they are most comfortable with, so no single locale is the layout source
of truth. Every component must be proven in Chinese density *and* Arabic RTL *and*
English before it ships. The i18n catalog is English-keyed (ADR-0008) — that is an
implementation detail, not a design hierarchy.

## Terminology (confirmed, load-bearing)

- The employee has a **name and a gender-neutral personhood** per locale:
  Lily / 小雅 / ياسمين. Owners refer to her by name, never "the AI".
- **Banned in all owner-facing copy**, enforced by test: AI, LLM, model, token, API,
  webhook, database, confidence, automation, prompt, 模型, 人工智能, 数据库, 置信度, 接口.
- Existing owner vocabulary that must not churn: draft-first approval, take over,
  hand back, teach, correct, claims/certifications, night shift.

## Durable constraints future work must preserve

- **Draft-first is the default.** The employee proposes; the owner decides. Autonomy
  is granted per capability, never assumed. Order confirmation stays draft-forever.
- **One ownership model** (AI / waiting for a human / owner-controlled), **one send
  path**, **one approval path**. No second messaging or approval system.
- **No scores, ratings, percentages-as-performance, or invented metrics.** Every
  number shown must trace to a real database count. Enforced by tests.
- **Guards are structural**: price floors, unauthorised-claim blocking, no fabricated
  numbers, handoff on a request for a human.
- **Tenant isolation** via Postgres RLS; the runtime role must never bypass it.
- **Archive, never erase.** The application role holds no DELETE anywhere.
- **Pilot safety**: an allowlist gates who can be messaged; activation is explicit and
  refuses on unmet preconditions.
- **One name.** This section previously argued the opposite: that the repository,
  database, migrations, i18n keys and role should keep the name `yiwuflow` while
  only the owner-facing brand said Nomi, on the grounds that renaming them was
  risk without user-visible benefit. That is reversed. The split cost more than
  it saved — two vocabularies for one thing, in a codebase whose whole
  discipline is that a name means what it says — and no owner-facing copy ever
  contained `yiwuflow`, so nothing she reads changed.

  What deliberately keeps the old name: migrations 0001–0022 (applied history,
  forward-only per ADR-0007), and `docs/adr/` and `docs/archive/` (the record of
  decisions taken under it). The runtime role moved in migration 0026, across
  three releases so an older build still runs against the newer schema.

  The database is not on that list, because it never carried the old name. It is
  called `railway` — the name Railway gives a Postgres it provisions — so the
  name is historical in the sense that nobody chose it, not in the sense that it
  preserves anything. There is no `yiwuflow` database, and this section and
  DEPLOYMENT.md both once described one, along with the `ALTER DATABASE` dance
  needed to rename it. See DEPLOYMENT.md for what the cluster actually holds.

## Accessibility

Trilingual including RTL Arabic; readable in factory-floor daylight on a phone;
keyboard focus visible; motion respects `prefers-reduced-motion`.

## Open decisions

- Whether the pilot readiness surface disappears once complete, or persists as a
  reachable "setup" area. (Proposed: disappears; operator details move behind a
  discreet system link.)
