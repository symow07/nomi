# What already exists: accounting connectors and sales agents (2026-10-21)

Written for the owner, before Phase 5's scope.

**How it was checked:**
- Every repo was read live through GitHub's API: licence, stars, last push, the file tree, and the key files themselves, not the README alone.
- Nothing was cloned, installed or run, and no code was copied.
- The licence, stars and last push of the 15 repos on the shortlist were re-checked a second time, and Odoo's API claims were checked word for word against Odoo's own documentation.

**Licence key:**
- **reuse:** MIT, Apache-2.0, BSD or ISC. Code may be reused.
- **LGPL:** usable unmodified as a dependency, never copied into Nomi.
- **ideas only:** GPL, AGPL, ELv2, a proprietary licence or no licence. No code.

## Odoo's API: facts that shape the connector (Odoo 19 docs)

- **The plan matters:** "Access to the external API is not available on One App Free or Standard plans." Many small Odoo Online customers can't connect at all. Onboarding has to check this first.
- **XML-RPC and JSON-RPC are going:** "/xmlrpc, /xmlrpc/2 and /jsonrpc are scheduled for removal in Odoo 22 (fall 2028) / Odoo Online 21." Build on **JSON-2** (`POST /json/2/<model>/<method>`, `Authorization: bearer <api key>`), with JSON-RPC as a fallback for Odoo 17–18 only.
- **Keys expire:** "it is not possible to create keys that last for more than three months." The connector needs a rotation reminder for the owner.
- **No multi-call transactions:** "it is not possible to chain multiple calls inside a single transaction." Each business operation must be one server method or an idempotent retry.
- **No custom server code on Odoo Online:** it can't install third-party Python modules (Odoo's Apps FAQ). A server-side addon works on Odoo.sh or self-hosted only.

## Job 1 · Accounting

| Repo | Licence | Real? | Better than Nomi today | We'd take |
|---|---|---|---|---|
| **apexive/odoo-llm** | **No root licence; per module:** `llm_tool_account` is **LGPL-3**, 3 of 34 modules (e.g. `account_invoice_import_llm`) are **AGPL-3** | 219★, last push 2026-05-26. The 18 accounting tools exist as code with tests. They're Odoo addons running **inside** Odoo, not an external client | A well-chosen set of accounting operations for an AI: trial balance, aging, ledger, journal entries, payments, reconciliation, tax balance, lock dates and a pre-close check | **The design:** the tool list and parameter shapes as the verbs of our connector interface, and read-only / lock-date discipline per tool. No code |
| **panaversity/accounts_ai** | none (ideas only) | **Not real:** 2 commits (2025-09-07), the whole repo is one README. The multi-connector architecture is a plan | nothing | nothing |
| **vas3k/TaxHacker** | **MIT** (reuse) | 6,755★, last push 2026-09-28, vitest tests. **Single-entry, not a ledger.** Bank-statement parsing is UNVERIFIED: no OFX/CAMT/MT940 parser in the tree | Receipt and invoice extraction in any language and currency, with each field's prompt driving the JSON schema, conversion at the document date, and e-mail inbox ingestion | **Design:** the field-driven extraction schema (code allowed under MIT, with attribution) |
| **fernandoslim/odoo-jsonrpc** | **ISC declared in package.json only, no LICENSE file** | 24★, last push 2026-10-08, zero dependencies, tests against a fake Odoo. **Supports JSON-2 with bearer keys** and JSON-RPC | A ready TypeScript client for JSON-2 (Nomi has none) | A dependency, **once a LICENSE file exists**. Or the idea for our own thin client |
| vvhybe/odoo-client | MIT | 4★, created 2026-10-16. No JSON-2 | — | Too new; the auth/ORM split as an idea |
| iraycd/odoo-xmlrpc-ts · faisalsami/odoo-xmlrpc | MIT / Apache (package.json) | XML-RPC only, which Odoo is removing; one is abandoned (2022) | — | skip |
| **erp-mafia/unified-accounting-api** | **MIT** | 13★, 26 commits, last 2026-08-03, tests. A real TypeScript connector layer, but for Nordic systems (Fortnox, Visma, Bokio…) | The best concrete **provider interface** found: per provider a config + mapper + OAuth helpers (exchange, refresh, revoke) + "modified since" sync, behind a registry | **The interface design** for Odoo → Xero → QuickBooks. MIT code if wanted |
| panoratech/Panora | **AGPL-3.0, archived** | Unified accounting models, but **no Xero/QBO data mappers**, only OAuth | — | ideas only: its list of unified objects as a checklist |
| NangoHQ templates (Odoo, QBO) | **ELv2** | real templates | which Odoo/QBO models and fields are worth syncing | ideas only |
| **XeroAPI/xero-node** | **MIT** | 264★, v20 (2026-09), official | the official Xero SDK | a dependency for connector 2 |
| **intuit/oauth-jsclient** | **Apache-2.0** | 146★, last push 2026-07-15, official | Intuit's OAuth client | a dependency for connector 3 (QBO's API is plain REST) |
| mcohen01/node-quickbooks | ISC in package.json only, no LICENSE file | 368★, community, last commit 2026-03 | — | optional; calling REST plus intuit-oauth may be cleaner |
| **pgr0ss/pgledger** | **MIT** | 495★, last push 2026-10-20. **One SQL file** of double-entry tables and functions, with property tests | a Postgres-native ledger core that would drop into a Nomi migration | code allowed **if** Nomi ever keeps its own ledger. Limit: two-leg transfers, not multi-line entries |
| medici · TigerBeetle · Blnk · Formance | MIT · Apache · Apache · **no licence file** | medici needs MongoDB; the other three are separate services | — | ideas only (idempotent ids, immutable entries) |
| **Odoo `l10n_ma`** (Moroccan PCM) | **LGPL-3** | about 634 PCM accounts, taxes and fiscal positions as an Odoo chart template | the PCM, maintained by Odoo | **Comes free with the Odoo connector.** Reference only, don't copy. No other maintained PCM project exists |
| **Odoo's FEC wizard** (`l10n_fr_account`) | **LGPL-3** | the 18 columns, the opening-balance block | a correct FEC | **When the books are in Odoo, ask Odoo for the FEC; don't build one** |
| DGFiP/Test-Compta-Demat | CeCILL v2.1 (copyleft) | the tax administration's own FEC checker (2022) | — | **run it as an external validator**, never copy it |
| adh-studio/fec-validator | MIT | 2 commits (2026-09), "26 rules" | — | its rule list as test cases |
| Dolibarr FEC export · kledg | GPL-3 · AGPL-3 | real | — | ideas only |
| Merge · Codat · Rutter · Apideck (commercial) | — | — | design references only: one common model with raw "remote data" passthrough (Merge); separate read and write, with async writes (Codat) | ideas |

## Job 2 · The salesperson

| Repo | Licence | Real? | Better than Nomi today | We'd take |
|---|---|---|---|---|
| **filip-michalsky/SalesGPT** | MIT | 2,786★, **abandoned** (last commit 2024-09-17), tests | **Nothing.** Its stage detector is one prompt whose raw output becomes the stage id, with no validation and no transition limits, and the stage gates nothing. Its prompt also scripts an untruth ("public records"), and the model picks the e-mail recipient | nothing |
| **chatwoot/chatwoot** | **MIT core; `enterprise/` is proprietary** ("may only be used in production" under Chatwoot's subscription terms; copying forbidden) | 38,007★, last push 2026-10-20, very much alive | **Channels:** Telegram, LINE, SMS, TikTok, web widget, X. **Inbox tools in MIT core:** canned responses, macros, labels, round-robin assignment, CSAT. **Captain (enterprise):** suggests FAQs learned from human replies, remembers dismissed ones so they never return, and a person approves each | Design ideas from core (canned replies, labels, CSAT outside WhatsApp's 24-hour window). The FAQ loop as an **idea only**. No code: it's Ruby, and Captain is proprietary |
| **Jasononggg22/whatapp-sales-agent** | **none** (ideas only) | 0★, one hackathon commit (2026-09-26). **The escalation code isn't in the repo:** `app.py` imports four modules that don't exist. Its rules are README claims (UNVERIFIED) | **Stricter** in one place: all bulk or custom pricing goes to a human. **Looser** everywhere else: no AI disclosure, no per-capability autonomy, no hand-off detection in the text, no order gate, a string-match price check | nothing; at most a promised response time on the hand-off message |
| **emcie-co/parlant** | **Apache-2.0** | 18,305★, last push 2026-10-20, 171 test files | **Composition modes:** the model drafts, then picks from **pre-approved templates** filled by the engine's tool results. "Strict" sends only templates. Templates can be tied to a journey stage | **Named idea: "strict mode per language".** In a language without a native reviewer (zh and ar today), sending alone would use only approved templates with fields filled by Nomi's deterministic code; free text stays a draft |
| **sierra-research/tau2-bench** | **MIT** | 2,270★, last push 2026-10-20 | A model-simulated customer with personas, six language packs (incl. Chinese), **scoring on the final database state**, and pass^k over repeated trials | **The method:** a periodic buyer-simulator sweep with k trials per language, judged on the database (an order row only when the gate holds, no quote below the floor). Note: it spends model balance |
| **TianXiaSJTU/AmazonPriceHistory** (OG-Narrator, ACL 2024) | **Apache-2.0** | 10★, research code, 2024 | **Concession pacing.** A deterministic offer generator sets each round's price on a curve, and the model only narrates it. **Nomi has no concession ladder:** a quote's discount comes from the owner's rules for product, quantity and value, capped at the maximum, and doesn't move as a buyer pushes back (checked in `src/core/commerce/quote.ts`) | **Named idea:** a seller-side concession ladder within the owner's maximum, narrated by the model and checked by the existing numeral guard. New capability, an owner's decision |
| **botpress/botpress** | MIT | 14,960★, last push 2026-10-19 | TypeScript channel integrations with tests: Telegram, LINE, Viber, **WeChat Official Account**, plus Zendesk/Freshchat hand-off | **Reference code** for webhook verification and message mapping (WeChat for the parked M48, Telegram, LINE). It's written for Botpress's own SDK |
| RasaHQ/rasa | Apache-2.0, **in maintenance mode**; CALM is proprietary Rasa Pro | — | its repair patterns (a correction like "actually 500, not 300", cancel, clarify) | the idea |
| stanfordnlp/cocoa · AgenticPay | MIT | abandoned (2022) · research | strategy kept separate from wording in negotiation | the same idea as OG-Narrator |
| "WhatsApp AI sales agent" repos · lead scoring | mostly n8n (fair-code) · Mautic GPL-3 | demos, 0–47★ | nothing better than Nomi's lead and problem scores | nothing |

## The shortlist

**Accounting, top 5:**
1. **Odoo JSON-2 + `fernandoslim/odoo-jsonrpc`:** a ready Node client for the API Odoo is moving to, if its author adds a LICENSE file. Otherwise a thin client of our own, built to the same design.
2. **odoo-llm's 18-tool catalogue** (ideas): the verb list for our connector interface, so we don't have to invent which operations an accounting AI needs.
3. **erp-mafia/unified-accounting-api** (MIT): a proven provider interface (config, mapper, OAuth, sync, registry) that keeps Xero and QuickBooks to adding a provider, not a rewrite.
4. **xero-node (MIT) + intuit-oauth (Apache-2.0):** official SDKs, so connectors 2 and 3 start from maintained code.
5. **Odoo's own `l10n_ma` and FEC export, plus DGFiP's validator as an external check:** Moroccan PCM and FEC come from Odoo, so we don't build them. pgledger (MIT) is the fallback only if Nomi ever keeps its own books.

**Sales, top 5:**
1. **Parlant's strict mode per language** (idea): sending alone in zh/ar from approved templates, without trusting unreviewed free text.
2. **Chatwoot Captain's FAQ loop** (idea only): taught answers drafted from the owner's own replies, never re-suggesting a dismissed one.
3. **tau2's simulated buyer, pass^k on the final state** (MIT method): real-model reliability measured per language, which the scripted golden scenarios can't show.
4. **OG-Narrator's concession ladder** (idea): paced discounts within the owner's maximum, a capability Nomi doesn't have today.
5. **Chatwoot core inbox tools + Botpress channel adapters** (MIT): canned replies, labels, CSAT, and reference code for Telegram, LINE and WeChat.

## Where Nomi is already clearly ahead (don't chase)

- **Stage control:** SalesGPT writes the model's raw text into the stage, unvalidated and gating nothing. Nomi's phases are advanced by code, and orders pass a deterministic gate.
- **Hand-off detection:** Captain's hand-off is a model tool only, and whatapp-sales-agent's rules aren't in its repo. Nomi has a multilingual deterministic layer, then the model, then a silent `not_answered`.
- **Price safety:** the projects read use a string match or let the model pick the product. Nomi has a quote engine (floor, maximum discount, tiers, never a higher re-quote) plus the unsourced-numeral guard.
- **Honesty and data rights:** no project read has an AI disclosure, a never-claims-human guard, deletion handling or a Stop switch.
- **Lead scoring and "negotiation agents":** what's out there is benchmarks or demos, not products.

## Traps

- **Licences that look clear but aren't:**
  - odoo-llm has no root licence, and 3 modules are AGPL.
  - Chatwoot's `enterprise/` is proprietary.
  - fernandoslim, node-quickbooks and iraycd declare a licence only in package.json.
  - Formance has no licence file.
  - Nango is ELv2; n8n is fair-code; Typebot is FSL; Panora is AGPL and archived; DGFiP's checker is CeCILL.
  - Odoo's own `l10n_ma` and FEC code are LGPL: depend on Odoo for them, never copy.
- **Not what they claim:**
  - panaversity/accounts_ai is a README.
  - whatapp-sales-agent's escalation code is missing.
  - Panora has no Xero/QBO data mappers.
  - TaxHacker is single-entry, and its bank-statement claim is UNVERIFIED.
  - medici needs MongoDB; TigerBeetle, Blnk and Formance are services, not libraries.
- **Odoo is plan-gated:** One App Free and Standard have no API; Online has no custom Python; keys last at most 3 months; there are no multi-call transactions.
- **Still UNVERIFIED:** Intuit having no official Node data SDK; Formance's earlier licence; TaxHacker's bank statements.

## Sources

Repos (read via the GitHub API): apexive/odoo-llm, panaversity/accounts_ai, vas3k/TaxHacker, fernandoslim/odoo-jsonrpc, vvhybe/odoo-client, iraycd/odoo-xmlrpc-ts, faisalsami/odoo-xmlrpc, erp-mafia/unified-accounting-api, panoratech/Panora, NangoHQ/integration-templates, XeroAPI/xero-node, intuit/oauth-jsclient, mcohen01/node-quickbooks, pgr0ss/pgledger, flash-oss/medici, tigerbeetle/tigerbeetle, blnkfinance/blnk, formancehq/ledger, odoo/odoo (`addons/l10n_ma`, `addons/l10n_fr_account/wizard/account_fr_fec_export_wizard.py`), DGFiP/Test-Compta-Demat, adh-studio/fec-validator, Dolibarr/dolibarr, kledghq/kledg; filip-michalsky/SalesGPT, chatwoot/chatwoot, Jasononggg22/whatapp-sales-agent, emcie-co/parlant, sierra-research/tau2-bench, sierra-research/tau-bench, TianXiaSJTU/AmazonPriceHistory (paper arXiv:2402.15813), botpress/botpress, RasaHQ/rasa, stanfordnlp/cocoa, SAIL-Research-Lab/AgenticPay.

Docs: https://www.odoo.com/documentation/19.0/developer/reference/external_api.html, https://www.odoo.com/documentation/18.0/developer/reference/external_api.html, https://apps.odoo.com/apps/faq
