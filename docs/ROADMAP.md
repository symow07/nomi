# Roadmap & status

**Verified against the code, not assumed.** Re-verify with:

```bash
npm run check && npm run trust
DATABASE_URL='postgresql://…' npx vitest run tests/integration/
```

> This file previously described the n8n workflow system and its milestones. That
> product no longer exists — the engine was extracted to TypeScript in ADR-0001
> and the workflows were deleted in M24. The history is in `docs/adr/`.

---

## Where the product is

**Controlled-pilot ready, messaging disabled.** One factory tenant is
provisioned in production and serving; no buyer has ever been messaged.

### Complete

| Area | What it means |
|---|---|
| Deterministic commercial engine | Prices come from the owner's catalogue and rules, never from the model. Below-floor is refused, not quoted. |
| Trust harness | 23 scripted scenarios over 12 invariants, run as a test and from the owner's practice screen. |
| Factory knowledge | Taught facts, corrections that supersede, claims default-deny. Every number traces to a source. |
| Ownership model | One interpreter of who holds a conversation. A human takes over, she goes silent. |
| Autonomy | Draft-first. Capabilities are granted one at a time by the owner and revocable in one tap. |
| Channel lifecycle | Four honest states. Connected ≠ activated. |
| Activation | Live preconditions, owner-controlled start/stop, allowlist that binds everyone. |
| Refusal visibility | Every gate refusal is recorded, surfaced, explained, and given a next action. |
| Factory rehearsal | What she cannot answer yet, from the owner's own rows. Advisory only. |
| Tenant identity | The process refuses to boot on a missing tenant or the practice sandbox. |
| Tenancy | Postgres RLS, non-superuser runtime role, proven per-table. |
| i18n | English / 中文 / العربية, enforced by catalog tests. |

### Outstanding — needs Meta

Business verification · phone provisioning · credentials · **message-template
approval** · webhook registration · channel connection · activation · first real
send. None of it is code we can write; the adapter is built and simulator-tested.

### Outstanding — buildable now

- **Outbound media.** She can read a buyer's photo and match it to a product;
  she cannot send one. For a Yiwu supplier that is half a salesperson.
- **First factory setup.** The production tenant is empty. Profile, products,
  knowledge and claims are the owner's work, and the path is
  `docs/FIRST-FACTORY-WORKFLOW.md`.
- **Access-code rotation.** Required before go-live; `activate()` enforces it.

### Deliberately waiting for real buyer conversations

Analytics refinement, capability-promotion tuning, volume and rate handling, and
anything that answers *"what do buyers actually ask?"*. Building these now would
be guessing, and the product's whole claim is that it does not guess.

---

## The rules that do not change

- **One send path.** Exactly one function enqueues; exactly one place calls the
  provider, behind one gate.
- **One approval path.** Every draft resolution goes through one service.
- **One ownership model, one knowledge source, one setup derivation.**
- **No invented numbers.** Every figure an owner sees is a real count. No scores,
  no ratings, no percentages-as-performance.
- **Archive, never erase.** The application role holds no `DELETE`.
- **Fail closed.** An unresolved input is "no", never "yes".
- **Draft-first.** Turning messaging on does not grant permission to send.
