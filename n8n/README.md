# YiwuFlow — n8n Workflows

Importable workflow JSON, generated from `docs/n8n-workflow.md`.
**Do not hand-edit these files** — edit `tools/build-workflows.mjs` and re-run:

```bash
node tools/build-workflows.mjs   # regenerate
node tools/validate-workflows.mjs # structure, reachability, JS syntax
node tools/test-logic.mjs         # runs the deterministic nodes against samples/payloads.json
```

(Once you've imported and started editing inside the n8n UI, n8n is the source of
truth and regenerating will overwrite your changes. Export from n8n back to these
files if you want to keep them in sync.)

| File | Nodes | Role |
|---|---|---|
| `intake.json` | 22 | Webhook → dedup → client/conversation resolve |
| `multimodal-analysis.json` | 25 | Injection guard, fast path, text + vision analysis |
| `conversation-decision.json` | 26 | Escalation scoring, phase machine, reply generation, persistence |
| `confirmation.json` | 22 | Order validation → DB → Sheets → email → close |
| `escalation.json` | 11 | Escalation event → Telegram → handoff reply |
| `dispatch.json` | 6 | Sends the reply to the channel |

Call graph:

```
Intake → Multimodal → Conversation ─┬→ Escalation ───→ Dispatch
                                    ├→ Confirmation ─→ Dispatch
                                    └→ Dispatch
```

---

## Import order

Import **leaves first**, so each Execute Workflow node has something to point at.

1. `dispatch.json`
2. `escalation.json`
3. `confirmation.json`
4. `conversation-decision.json`
5. `multimodal-analysis.json`
6. `intake.json`

In n8n: **Workflows → Import from File**.

## Wire up the Execute Workflow nodes

n8n cannot resolve workflow references across an import, so **every Execute
Workflow node ships with an empty `workflowId` and you must set it by hand.**
This is the one manual step, and nothing runs until it's done.

After importing, open each node below and pick the target from the dropdown:

| In workflow | Node | Point it at |
|---|---|---|
| Multimodal Analysis | `→ Conversation + Decision` | YiwuFlow - Conversation + Decision |
| Conversation + Decision | `→ Escalation` | YiwuFlow - Escalation |
| Conversation + Decision | `→ Confirmation` | YiwuFlow - Confirmation |
| Conversation + Decision | `→ Dispatch` | YiwuFlow - Dispatch |
| Confirmation | `→ Dispatch (Blocked)` | YiwuFlow - Dispatch |
| Confirmation | `→ Dispatch (Confirmed)` | YiwuFlow - Dispatch |
| Escalation | `→ Dispatch` | YiwuFlow - Dispatch |
| Intake | `→ Multimodal Analysis` | YiwuFlow - Multimodal Analysis |

## Credentials

Two nodes need credentials configured in the n8n UI (env vars aren't enough):

- **`Webhook - Simulated Intake`** (Intake) — Header Auth credential:
  header name `x-webhook-secret`, value `test_secret_xyz`.
- **`Sheets - Append Confirmed Order`** (Confirmation) — Google Sheets OAuth2 or
  Service Account. The service account email needs **Editor** on the sheet.

## Environment variables

```
BUSINESS_ID                 = a0000000-0000-0000-0000-000000000001
SUPABASE_URL                = https://<project-ref>.supabase.co
SUPABASE_SERVICE_KEY        = eyJhbGc...     # used for ALL Supabase calls, reads included
ANTHROPIC_API_KEY           = sk-ant-api03-...
MOCK_CALLBACK_URL           = https://webhook.site/<your-uuid>
GOOGLE_SHEET_ID             = 1BxiMVs0XRA5...   # Confirmation only
TELEGRAM_BOT_TOKEN          = 123456789:AAF...  # Escalation only
TELEGRAM_ESCALATION_CHAT_ID = -1001234567890    # Escalation only
SENDGRID_API_KEY            = SG....            # Confirmation only
SENDGRID_FROM_EMAIL         = sales@yourdomain.com
DIALOG360_API_KEY           = ...               # real WhatsApp only (deferred)
```

**`SUPABASE_ANON_KEY` is intentionally absent.** `supabase/rls_policies.sql`
enables RLS with no policies for `anon`, so that key now returns zero rows for
every table — which is the point: n8n is a trusted server, and a leaked anon key
should do nothing. All Supabase nodes use the service key, reads included. If a
read suddenly returns `[]` after applying RLS, that node is still on the anon key.

---

## Design notes

These differ from `docs/n8n-workflow.md`, deliberately. Each one is a bug in the
spec that would have broken a fresh install.

**Every Supabase call sets `fullResponse: true`.** PostgREST returns a JSON array,
and n8n splits arrays into one item per element — so an empty result (`[]`) yields
**zero items** and execution halts silently. That would kill the dedup check's
"not a duplicate" branch, i.e. the happy path for every new message. With
`fullResponse`, the array arrives intact as `$json.body`.

**There is no "Respond to Webhook" node.** Spec Node 6.4 put one inside the
Dispatch sub-workflow, but n8n requires it to live in the same workflow as the
Webhook. The webhook responds `200` immediately and all simulated channels echo
the reply to `MOCK_CALLBACK_URL`, which is what the README describes anyway.

**The injection filter was rewritten.** The spec's
`/ignore (all |previous |your |the )?instructions/` matches only *one* qualifier
word, so `"ignore all previous instructions"` — the single most common injection
string, and the literal text of TC-012 — passed straight through to the model.
The qualifier group now repeats. `tools/test-logic.mjs` covers this.

**`Build Image Analysis` reads `image_analysis` from `$json`.** Spec Node 2.13
referenced a `visionResult` variable that only exists in Node 2.11's scope,
throwing a `ReferenceError` at runtime.

**Image + text runs sequentially, not in parallel.** The spec calls for parallel
branches merged by position. Sequential (vision → then text analysis → merge) is
a couple of seconds slower on `image_text` only, and is far easier to reason
about and debug. Revisit if the latency target bites.

**DB writes are sequential, not parallel.** The spec suggests fanning the four
writes out from one node so dispatch isn't blocked. Sequential writes are ordered
and debuggable; parallel branches in n8n make failures much harder to trace. If
you need the latency back, split them after the flow is stable.
