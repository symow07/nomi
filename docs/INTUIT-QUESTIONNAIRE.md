# Intuit's App Assessment Questionnaire — what it asks, our draft answers, what is missing

Prepared 2026-10-22 (Phase 5, E4). **Nothing has been submitted, and nothing will be from here.** This is a file to
work from. Submitting is the owner's: it needs an Intuit developer account, signed in, and the owner's acceptance of
Intuit's terms.

Nomi's QuickBooks connector (D9, `src/books/connectors/quickbooks.ts`) is built and tested against a recorded fake.
It runs nowhere: it needs production keys, and Intuit gives those only after the questionnaire is approved.

## 0. How this was read, and what was NOT seen

- **The questionnaire itself is behind Intuit's sign-in.** `help.developer.intuit.com/s/questionnaire` redirects to
  Intuit's login, and nobody signed in. So its exact questions are **not known**. What follows is what Intuit's own
  public docs say it covers, and what the production-keys flow asks for around it.
- Every quote below is Intuit's, from its developer docs. They were read through Intuit's own text copy of those pages
  (`static.developer.intuit.com/v2/llms-full.txt`, each page marked with its source), Intuit's App Partner Program
  Guide (PDF, v1.2, 03.2026) and the Developer Terms ("As of October 14, 2025"). The key sentences were checked in
  that text a second time.
- Not readable without a login or a browser: the questionnaire; the help articles on platform service fees and on
  how API calls are classified. Intuit's blog (it redirects to Medium, which refused).
- Short form below: `/qbo/…` = `https://developer.intuit.com/quickbooks-online/docs/…`.

## 1. The gate, in Intuit's words

- "All new apps or apps that are in the development phase will be required to complete the assessment process prior
  to getting production credentials." (`/qbo/go-live/publish-app/platform-requirements`)
- "The **Show Credentials** switch appears only after the App Assessment Questionnaire is approved."
  (`/qbo/go-live/publish-app`)
- "The client ID and client secret will be accessible only after completing the Production Key questionnaire and its
  approval." (`/qbo/get-started/get-client-id-and-client-secret`)
- This is a PRIVATE app's gate too. The App Store's technical, security and marketing reviews are a separate step,
  only for a listing: "if you don't want to list your app to the QuickBooks App Store, you're free to market your app
  privately and skip the review." (`/qbo/go-live/list-on-the-app-store`)

**Our plan: a private app (no App Store listing), on the Builder tier.** So the questionnaire is the gate, and the
listing reviews are not. Their security checklist is still the bar we hold ourselves to (§5).

## 2. App Details for production — each field, and our draft

Intuit, `/qbo/go-live/publish-app`, step 1 ("This should take about 30 minutes to complete"):

| Intuit asks | Mandatory? | Our draft answer | Status |
|---|---|---|---|
| "fill in your email address and other details" | yes | The owner's own: the account holder's contact. | **Owner fills in** |
| "the URLs for your End User License Agreement and Privacy Policy" | yes ("required before you can get your production credentials") | `https://app.nomidoes.com/terms`, `https://app.nomidoes.com/privacy` | Pages exist. **The privacy page does not yet name Intuit** (§6) |
| "your app's host domain" | yes | `app.nomidoes.com` | Ready |
| "launch URL" | yes | `https://app.nomidoes.com/app/books#quickbooks` (sign-in first, then the books' QuickBooks block) | Ready |
| "disconnect URL" | yes | Proposed: `https://app.nomidoes.com/app/books/quickbooks/disconnected` | **Missing: no such page** (§6) |
| "connect/reconnect URL" | yes | `https://app.nomidoes.com/app/books/quickbooks/start` | Ready (sign-in first) |
| "select up to four categories for your app" | yes | Accounting; Invoicing; Bank reconciliation… — the owner chooses from Intuit's list | **Owner chooses** |
| "check any regulated industries that you built the app for" | only if any apply | None: Nomi does no lending, payments or money movement, insurance or investment | Ready |
| "Select the regions where your app is hosted." | yes | United States (Railway, `HOSTING` in `src/core/legal/processors.ts`) | Ready; see §4 on residency |
| Redirect URIs, Development and Production (`/qbo/get-started/app-settings`) | yes | `https://app.nomidoes.com/app/books/quickbooks/callback` (production); `http://127.0.0.1:8787/app/books/quickbooks/callback` (development) | Ready |
| "Geolocation … add the IP address (optional)" | **optional** | Leave empty: Railway gives no fixed outbound address | Ready |
| "Accepted Connections: Select the countries where you've launched your app and can fully support" | yes | The owner's call. The connector reads any QuickBooks Online company; the books are verified for Morocco only | **Owner chooses** |
| Basic app info: "a descriptive, branded name … Upload a logo" | yes | "Nomi"; the product's mark | **Owner checks** Intuit's naming and logo rules (step 5) |
| Scopes: "you can add additional scopes, but you can't remove existing ones" | — | ONE: `com.intuit.quickbooks.accounting` (`QBO_SCOPE`) | Ready. Ask for nothing more |
| Account Profile: "Review your contact and account info" (step 3) | yes | — | **Owner** |

## 3. What the questionnaire covers — our draft answers

From `/qbo/go-live/publish-app/platform-requirements`, which applies to "both private (i.e., unlisted) apps and apps
that want to be listed". The wording of each question is not public; these are the subjects Intuit names.

### 3.1 Your business
- **Intuit:** "You'll be asked to disclose certain information about your business, such as complaints, lawsuits, or
  requests from government agencies."
  **Draft:** the owner's to answer, truthfully. Nothing in the code base records any.
- **Sanctions:** neither the developer nor its representatives may be on a sanctions list, or "be located or do
  business in" the listed countries and regions.
  **Draft:** the owner's to confirm. Nomi operates from Morocco.
- **Intuit:** if the app passes data between another service and Intuit, "you'll be asked to describe the integration
  and share any instructions."
  **Draft:** "Nomi is a business's own books. It reads the company's chart of accounts, customers, vendors and
  journal entries from QuickBooks Online into those books. On the owner's request, it sends back the entries posted in
  Nomi as journal entries. Nothing read from QuickBooks is passed to any other service. A shop's books may also come
  from Odoo, Xero, Google Sheets or an Excel file, each the shop's own and connected separately. No data moves between
  those and QuickBooks except through the books the owner keeps in Nomi."

### 3.2 Authorization (Intuit: "we recommend")
| Intuit | Nomi does |
|---|---|
| "Make sure the redirect URIs … are active and functional." | `/app/books/quickbooks/callback`. A signed, ten-minute cookie ties it to the person who started the connection; it is used once. |
| "Always store the latest refresh_token value." | Yes. Every refresh that returns a new token is kept before anything is read with it (`rotateGrant`, `src/db/booksConnections.ts`). |
| "Access tokens are valid for 60 minutes. Use the refresh token to get a new one only when the current one expires." | **Check before submitting:** today each read refreshes first. Intuit's wording says refresh only on expiry. |
| Use the discovery document | **No:** the endpoints are fixed in `quickbooks.ts`. Intuit recommends, not requires. |
| Handle "expired access tokens / expired refresh tokens / Invalid grant errors / CSRF errors" | Expired or revoked grant: the read stops, says "connect again", and reads nothing. CSRF: the state cookie (above). |

### 3.3 Data use (Intuit: "must")
- **Intuit:** "You must clearly describe the purposes for using any customer data, and get customers' agreement."
  **Draft:** "Data read from QuickBooks is used for one purpose: to keep the business's own books in Nomi (its
  ledger, trial balance, reports and Moroccan FEC), for that business only. The owner connects QuickBooks themselves
  on Intuit's page, after the books' page says what is read."
- **Intuit:** "You must state how you use customer data within your app and if one customer's data is shared with
  another."
  **Draft:** "Each business's data is kept apart by row-level security in the database. One business's data is never
  shown to, shared with or combined with another's."
- **Intuit:** "aggregate and anonymize" any data shared across customer accounts.
  **Draft:** "None is shared across accounts."
- **Intuit:** comply with "GDPR, CCPA, LGPD and PIPEDA".
  **Draft:** the owner's to confirm with counsel. What the code gives: a buyer's data deleted on request (CC-02); a
  workspace closed, its books kept only for the legal period, then erased by the operator's tool
  (`tools/books-retention.mjs`); the owner's copy of everything before closure (E1).

### 3.4 Accounting API (Intuit: "must")
- Handle QuickBooks edition changes and multi-currency.
  **Draft:** "Multi-currency is read from the company's settings. An entry whose lines are in two currencies is sent
  in the books' converted amounts, since a QuickBooks journal entry has one currency." (`quickbooks.ts`)
- Test sales tax.
  **Draft:** "QuickBooks' tax rates are not read: they name no account the books could post to, and a United States
  company's sales tax is QuickBooks' own automation. Nomi's tax codes stay Nomi's; a line's tax code travels in
  Nomi's mark." **This is a deliberate gap to state plainly, not hide.**
- Webhooks: "If you rely on webhooks … your production endpoint URL must be active and functional."
  **Draft:** "No webhooks: Nomi reads once a day and when the owner asks, with a cursor." Intuit recommends webhooks
  over CDC alone; Nomi uses neither. It reads "changed since" by query.

### 3.5 Support (Intuit: "must")
- "operational and available on a twenty-four-hour, seven days a week … 99.95% of the time."
  **Draft:** the owner's to commit to. What exists: Railway's health check; the app's own error e-mails and five-minute
  heartbeat (CC-10). **The outside heartbeat (`HEALTH_PING_URL`) is unset**, and no uptime has been measured against
  99.95%.
- "a way for your customers to reach out to you for support."
  **Draft:** the legal contact address on `/privacy` and `/terms`. The owner may want a support address of its own.
- "ensure that all API errors, including syntax and validation errors, are appropriately handled."
  **Draft:** "Every QuickBooks answer other than success stops the read with a named reason. Nothing is half-read: a
  read goes in whole or not at all."
- intuit_tid (advice): "Capture the value of the intuit_tid field … Store all error information in logs."
  **Not done:** Nomi does not keep `intuit_tid`. A small change, worth making before the first live connection.

### 3.6 Security
- "You'll be asked to disclose information about any security breaches in the past." "Any breach that has occurred
  in the past must be resolved before you go live." Any future breach "must be reported immediately."
  **Draft:** the owner's to answer.
- "Any Intuit credentials including customer IDs, app client ID and client secret must be stored securely."
  **Draft:**
  - The app's client ID and secret are Railway variables, pasted by the owner, never in the code or the repository.
  - Each company's refresh token is sealed with AES-256-GCM under the installation's credential key before it is
    stored (`connector_credentials`).
  - The realm ID is kept as the connection's setting.
- "apps also need to undergo an annual security assessment."
  **Draft:** the owner's to commit to; none has been done.

### 3.7 Regulated industries
Extra questions apply to Lending, Payments/Money Movement, Insurance and Investment. **None applies to Nomi.**

## 4. The Developer Terms the questionnaire confirms (§8.1: the "self-assessment questionnaire … confirms your Application's compliance")

| Term | What it asks | Nomi today |
|---|---|---|
| §12.2 | disclosures that "describe the data that is collected … how it may be disclosed, processed, shared, stored, transferred or exchanged" and "clarify that you do not process User Data or Personal Information on Intuit's behalf" | **Missing from /privacy** (§6) |
| §12.2 | "Not sell" User Data | Already true and said: "not used to advertise to you and are not sold" |
| §12.2 | sub-processors under a "written agreement … at least as restrictive" | **The owner's:** Railway (hosting) holds the books. No model provider receives QuickBooks data, unless the owner asks Nomi to read a paper (D6), which is not QuickBooks data |
| §12.2 | "Securely Delete User Data … at the request of User" | Disconnect revokes the token at Intuit. Closure and the retention tool erase the books. **A request to delete only what came from QuickBooks, while the workspace stays open, has no tool:** read-in entries become the owner's books (a system of record) |
| §11.7, §12.2 | NIST standards and "Intuit's Responsible AI Principles" for AI and LLMs | QuickBooks data is never sent to a model: the assistant does not read the books, nor does the advisor (its catalogue lists payments and invoices as not available to it). **State it on /privacy and in the questionnaire** |
| §13.1 | a written security and incident policy | **Missing as a document** (the practice exists in pieces: CC-10, backups, `docs/BACKUP-RESTORE.md`) |
| §13.4 | tell Intuit "no later than twenty-four (24) hours, after discovery of a Security Incident" | **The owner's commitment**; add it to the incident policy |

Data residency (A5): QuickBooks data is kept where the workspace's books are. Today that is the database, hosted
in the United States (Railway). The papers store is a parameter; the books' rows are not.

## 5. If ever listed on the App Store — the stricter checks, held already or not

Not needed for a private app. Listed here so nothing is a surprise (`…/security-requirements`, `…/technical-requirements`):

- TLS everywhere: Railway serves the app over HTTPS. **Check** that plain HTTP redirects, and which TLS versions Railway accepts (Intuit: 1.2 with AES-256 recommended).
- Cache-Control no-store on pages with data: yes on exports and files; not on every page.
- Cookies Secure and HttpOnly: yes in production (`secureCookie`).
- "You must not log any user's credentials or QuickBooks data": the logs are redacted (CC-10). **Check** the books
  routes log no record contents at `info`.
- "Encrypt and store the refresh token and realmID": the token yes (AES-256-GCM); **the realm ID is stored in the
  clear** as a connection setting.
- "Store your AES key … in a separate configuration file": the key is a Railway variable, apart from the database.
- Disconnect calls Intuit's revoke endpoint: yes (`revokeToken`).
- A "Connect to QuickBooks" button in Intuit's style: **no**, a plain link.
- Vulnerability scans and a security affidavit within two weeks of Intuit's request, and an annual review for listed
  apps or "any app with over 500 connections".

## 6. What is missing before submitting — the owner's list

1. **The privacy page names Intuit.** `src/core/legal/recipients.ts` holds `intuit` as `named: false`. The boot
   refuses `QBO_CLIENT_ID` until it is named (D18). That needs a line in every language: what is read from
   QuickBooks; that it is kept with the books for the legal period and erased after; that it is not sold, not shared
   with another business, and not sent to any model; and that Nomi does not process it on Intuit's behalf (§12.2).
   *The books' public-pages blocker (LAUNCH-CHECKLIST, "ANY workspace") already lists this.*
2. **A disconnect page** at the "disconnect URL": where Intuit sends someone who disconnected Nomi from inside
   QuickBooks. Today Nomi only disconnects from its own button. Small: a signed-in page that marks the connection
   disconnected and says the books keep what was read.
3. **A written security and incident policy** (Developer Terms §13.1), including the 24-hour notice to Intuit (§13.4).
4. **`intuit_tid` kept** with each QuickBooks error (support advice, §3.5).
5. **The owner's answers:** the contact; the business disclosures (complaints, lawsuits, government requests,
   breaches); sanctions; categories; accepted countries; the 24/7 99.95% support commitment; the annual assessment.
6. **Decide, then say:** refresh only on expiry rather than before each read (§3.2); and whether to seal the realm ID
   too (§5).
7. **Costs, before anything is live** (App Partner Program; Intuit's partner FAQ, "Last updated: 2026-10-02"):
   - "Only the Builder tier is not charged." Apps are enrolled at Builder automatically.
   - On Builder, reads are capped: "the Builder tier will be limited to 500,000 CorePlus API credits per month", and
     calls above that are "blocked entirely" (the cap "resets on the 1st of each new month"). Reads are CorePlus;
     writes ("Core") are "unmetered and uncharged".
   - Fees "apply to all partners with production apps, whether or not your app is published". Silver is US$300 a month.
   - So Nomi on Builder costs nothing and is blocked, never billed, above the cap. Moving off Builder is spending,
     and is the owner's to decide.

None of the above is done by this file. Nothing was sent to Intuit.
