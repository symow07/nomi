# Archive

Documents that described a product that no longer exists. They are kept because
they say what was true at the time and why decisions were made, and deleted
history is how a team relearns the same lesson twice. **Nothing here is a
current instruction.**

| Document | What it was |
|---|---|
| `first-run-guide.md` | The original setup guide: create a Supabase project, import n8n workflows, build the phases in order. Superseded by `docs/DEPLOYMENT.md`, `docs/GO-LIVE.md` and `docs/FIRST-FACTORY-WORKFLOW.md`. |
| `n8n-workflow.md` | Node-by-node reference for the six n8n sub-workflows. |
| `n8n-mvp-build-order.md` | The phase order for building those workflows by hand. |
| `workflow-01-build.md`, `workflow-02-image-extension.md` | Earlier build notes for the same. |
| `yiwuflow-milestones.md`, `yiwuflow-ship-roadmap.md` | The plan under the product's earlier name. |
| `RISK-REVIEW-2026-07-14.md` | A risk review of the n8n-era build. |

The product is now one TypeScript service: a Fastify process serving the owner
Command Center and the WhatsApp webhook, a pg-boss worker, and PostgreSQL with
row-level security. There is no n8n and no Supabase runtime — `supabase/` is a
directory of plain SQL whose name is historical (`tools/migrate.mjs` explains
it).
