# Intuit's App Assessment Questionnaire — what it asks, our draft answers, what is missing

Prepared 2026-10-22 (Phase 5, E4). **Nothing has been submitted, and nothing will be from here.** This is a file to
work from. Submitting is the owner's: it needs an Intuit developer account, signed in, and the owner's acceptance of
Intuit's terms.

Nomi's QuickBooks connector (D9, `src/books/connectors/quickbooks.ts`) is built and tested against a recorded fake.
It runs nowhere: it needs production keys, and Intuit gives those only after the questionnaire is approved.

## R · Before the owner answers: the code, item by item (Block R, 2026-10-23)

**Nothing is submitted, and nothing will be from here.** The form is the owner's. What Block R did was make the code
true first, so each answer can be given honestly. **Every test below runs against the recorded fake, never Intuit.**

**What the owner's research found about the questionnaire** (*reported*; the transcription is not in this repository):
- It was found verbatim: Codat's transcription, and nine screenshots of the live form that agree with it.
- It is a self-assessment attestation of about 30 to 40 minutes.
- It does NOT ask for SOC 2, a penetration test, a subprocessor list, breach procedures or a data-retention policy.
  One widely shared guide (Apideck, on dev.to) says it asks for SOC 2 and retention; both verbatim sources and the
  screenshots contradict it. Nothing is prepared for those.
- **There is a lighter branch in the same form.** App-information Q4 asks: "Are you building a private app for your
  team or business?", with the option "We're building a private app."
- **The security scan is not part of this questionnaire.** It applies only to apps listed on the App Store or with
  more than 500 connections (Intuit, via Synopsys, 2021). So the path is: questionnaire → production keys. No code
  review, no penetration test.
- **The parts and what each asks are in §Q below**, in our own words, with our answers. Nothing is copied from either
  source (the owner, 2026-10-23).

**The twelve items** (ALREADY TRUE / FIXED IN THIS PR / NOT POSSIBLE YET):

| # | Item | State | Where |
|---|---|---|---|
| 1 | Refresh token AND realmID encrypted at rest, AES, key from the environment | **FIXED.** The refresh token was already sealed (AES-256-GCM, `CREDENTIAL_KEY`). The realmID sat in the connection's settings in the clear; it is now sealed with the grant, and the settings hold only the company's name. | `src/security/credentials.ts:18–20`; `src/books/connectors/quickbooks.ts:176` (`QboGrant`); `src/api/web/app.ts:3534` (callback) |
| 2 | Access tokens refreshed only on expiry, not per call | **FIXED.** Every read and every write-back refreshed. Now the access token is kept (sealed) with its end time and used until five minutes before it ends. | `quickbooks.ts:191` (`qboAccess`) |
| 3 | Expired access token, expired refresh token, invalid_grant, CSRF — a test each | **FIXED** (CSRF already true). An expired access token is refreshed once and retried; an expired refresh token and invalid_grant ask the owner to connect again; the state parameter is checked against a signed, one-time cookie. | `tests/books-connectors/quickbooks.test.ts` "R4 · the sign-in Intuit assesses"; `tests/integration/books-quickbooks.test.ts` "CONNECT" |
| 4 | Failed auth retried; on auth failure the user is prompted to reconnect | **FIXED** (the prompt was already true). A 401 on a reused access token is refreshed once and the work retried once (write-backs are safe to retry: each carries a `requestid`). A refused refresh marks the connection "connect again" on the books' page. | `quickbooks.ts:206` (`qboWithAccess`); `src/books/readIn.ts`, `src/books/writeBack.ts` |
| 5 | `intuit_tid` captured into the logs | **FIXED.** Read from each answer's headers and logged with the call. | `quickbooks.ts:91` |
| 6 | Errors logged with tid and error code, never the payload, credentials or QuickBooks data | **FIXED** (request logs were already path-only). Each call is logged as `{ op, status, error, tid }` and nothing else, at debug when it went well and warn when not; a test checks no token, realm, secret or company data appears. | `quickbooks.ts:65` (`QboCall`); `app.ts:3521`; `src/main.ts` (morning read); `src/api/requestLog.ts:17` |
| 7 | OAuth endpoints from Intuit's discovery document | **FIXED.** The authorize, token and revocation endpoints come from `developer.api.intuit.com/.well-known/openid_configuration`, kept a day, accepted only on an https host of intuit.com. If it does not answer, nothing is sent. | `quickbooks.ts:50`, `:129` |
| 8 | No shipping path gets tokens from the OAuth playground | **ALREADY TRUE.** Tokens come only from the authorization-code exchange and refreshes. | `quickbooks.ts` (`tokens`) |
| 9 | HTTPS, TLS 1.2, no-store on sensitive pages, Secure+HttpOnly cookies, TRACE disabled, a token in a URL parameter answered with a 302 | **PARTLY FIXED.** Already true: Secure+HttpOnly cookies (`app.ts`, `writeCookie`); TRACE has no route; OAuth callbacks redirect. Fixed: every answer without its own cache-control is `no-store`; HSTS where the deployment is HTTPS; the Meta and WhatsApp pickers, the two callbacks that draw a page after the code is spent, send no Referer. **By design, not changed (the owner, 2026-10-23):** Intuit's rule is about an endpoint that receives an INTUIT token in its URL; every such endpoint answers 302. Nomi's own links, `/login/set-password?t=` and `/u?t=`, carry Nomi's own tokens, and answer with a page sent `no-referrer` and `no-store`, which closes the same Referer leak. Changing them would break the sign-in link and the customers' unsubscribe flow. The sign-in link is single-use (saving spends it and closes every other open link) and expires (72 hours from `tools/add-login.mjs`, 60 minutes from "forgot password"); opening it spends nothing, so a mail preview cannot use it up. **The unsubscribe link `/u?t=` is neither single-use nor expiring, deliberately — do not "fix" it (the owner, 2026-10-24):** A link that expires fails the law it exists to satisfy: an unsubscribe must work whenever the customer uses it. It is signed with its own key, derived for that purpose alone. Its entire power is removing one address from one business's list. TLS 1.2 is Railway's edge: check it with an SSL test on deploy day. | `app.ts:788` (onSend); `app.ts:6936`; `tests/parity/transport-hygiene.test.ts` |
| 10 | A disconnect route exists and is reachable | **FIXED** (the POST was already true). Added Intuit's Disconnect URL, `GET /app/books/quickbooks/disconnected`: it says what disconnecting there means and changes nothing here, because a link anyone can open must not disconnect anybody. The next read sees the grant refused. | `app.ts:3565` (POST), `app.ts:3580` (GET) |
| 11 | Client ID and secret never hardcoded, never in browser console logs | **ALREADY TRUE.** Both come from the environment (`QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`). The secret is used only server-side in the Basic header to Intuit's token endpoint. The client ID appears in the authorize redirect, as OAuth requires. | `src/main.ts:1010`; `quickbooks.ts` (`basic`) |
| 12 | Connect → disconnect → reconnect tested against the QBO sandbox, evidence kept | **NOT POSSIBLE YET — the one remaining blocker, the owner's.** It needs an Intuit developer account (free; the owner's to create). The same round trip passes against Nomi's fake, and that is NOT an answer to this question: Intuit rejects on this answer, so it must be true against Intuit's sandbox. Until then the form's answer is No. | `tests/integration/books-quickbooks.test.ts` "R4 (items 10, 12)" |

**The four known rejection triggers** (*reported*: Codat says Intuit REJECTS an app whose answer to the first is No):
1. Disconnect and reconnect not tested — the sandbox run (item 12).
2. A dead privacy-policy, EULA, launch or disconnect URL. The disconnect URL exists now. The privacy page must name
   Intuit first (§6.1). The EULA and launch URLs are the owner's.
3. Relying on the OAuth playground — never (item 8).
4. The four errors unhandled — handled and tested (item 3).

**The owner's answers, none of which the code can give:**
- the EULA URL; the privacy-policy URL (after it names Intuit);
- the host domain (app.nomidoes.com?); the hosting location (Railway, us-east4, per the deployment);
- the sanctions answer; the in-app support route;
- private or public app (Q4 above);
- which QuickBooks editions to claim;
- whether multi-currency and non-US sales tax were really tested.

**Only tick an edition or a feature actually tested.** Today nothing has been tested against Intuit, only against
the fake. The fake covers multi-currency entries (one `CurrencyRef` an entry) and the US/non-US tax split
(`GlobalTaxCalculation`). That is a fake, not a QuickBooks company: no edition, and neither feature, can be claimed
yet. A false tick is what a later review catches.

**The read budget, at today's cadence.** Builder gives uncapped Core (writes), but 500,000 CorePlus calls (reads,
queries, reports) a month. Above that, calls are BLOCKED at HTTP 429, not billed. One read of a company is at least 6
CorePlus calls (preferences, companyinfo, and one query each for Account, Customer, Vendor, JournalEntry), plus one
for every further 1,000 rows. A write-back reads the same 6 first. At one morning read a day (`books_connections_due`)
plus the owner's buttons, a company costs about 180 to 300 CorePlus calls a month. That is roughly 1,600 to 2,700
connected companies before the cap, if the cap is per app. Intuit's Change Data Capture (`/cdc`, one call for every
entity changed since a time) or webhooks would cut each read to about 3 calls; the connector does not use them yet.
Any new polling loop needs a budget first.

## Q · The questionnaire, part by part — our own words, our answers (read 2026-10-24)

**Sources, and how they are used.** Codat's public guide to the questionnaire
(docs.codat.io, "QBO app assessment questionnaire") was read in full. Merchanter's help page holds nine screenshots
of the live form; this session could read none of their text, so the two could not be compared for disagreements,
and none is recorded. Neither source is reproduced here: they are a third party's copy of Intuit's form. Below is what
each part asks ABOUT, in our words; our answer where the code settles it; and the file that settles it. Codat's own
suggested answers are for apps built on Codat. Nomi is not; it calls Intuit directly. They are not taken as ours.

The form has two halves: **App details** (six items) and **Compliance**, in eight parts (general, lending, app
information, authorization, API usage, the Accounting API, error handling, security).

**App details**
| Asks about | Our answer | Settled by |
|---|---|---|
| The developer profile and e-mail | **The owner's** (an Intuit account, not yet made) | — |
| The EULA and privacy policy | **The owner's** URLs. The privacy page must name Intuit first (§6.1) | `src/core/legal/recipients.ts` (`intuit`, not named yet) |
| Host domain, launch URL, disconnect URL | Host: **the owner's** (app.nomidoes.com?). Launch: `/app/books/quickbooks/start`. Disconnect: `/app/books/quickbooks/disconnected` | `src/api/web/app.ts` |
| Categories | **The owner's** | — |
| Regulated industries | **The owner's** (Nomi is not a lender) | — |
| Hosting locations | Railway, us-east4 (the deployment's region); confirm on the day | the Railway service |

**Compliance — general and lending:** the business's own answers, **the owner's**. The lending part appears only
for a lender; Nomi is not one.

**Compliance — app information**
| Asks about | Our answer | Settled by |
|---|---|---|
| How the app was built (from scratch, on a platform, as a platform, …) | Built from scratch: Nomi codes its own calls to Intuit's API | `src/books/connectors/quickbooks.ts` |
| Which platforms make the calls | Nomi's server (Node.js on Railway); no browser or mobile client calls Intuit | `quickbooks.ts`, `src/main.ts` |
| How it uses QuickBooks data | Reads accounts, customers, vendors and journal entries into the shop's books as drafts; writes the shop's posted entries back as journal entries | `quickbooks.ts` (`readQbo`, `sendEntriesToQbo`) |
| Private app or public | **The owner's** (Q4: "a private app for your team or business") | — |
| Which QuickBooks users may connect | Nomi does not restrict it (any user Intuit lets authorise); **the owner** chooses what to claim | — |
| Other integrations | Yes: Google Sheets, Odoo, Xero, the workbook; WhatsApp, Instagram, Messenger, e-mail | `src/books/connectors/`, `src/channels/` |

**Compliance — authorization and authentication**
| Asks about | Our answer | Settled by |
|---|---|---|
| Connect, disconnect and reconnect tested in a sandbox | **NO, NOT YET — the one blocker.** It must be true against Intuit's sandbox (an account the owner makes). The fake's round trip is NOT this answer, and must never be given as it. Intuit rejects an app that answers No. | §R item 12 |
| How often the access token is refreshed | Only when it is about to expire (5 minutes left), or once on a 401 | `quickbooks.ts` `qboAccess` |
| Failed auth requests retried | Yes: once, after a refresh | `qboWithAccess` |
| The user prompted to reconnect after an auth error | Yes: "connect again" on the books' page | `src/books/readIn.ts`, `src/api/web/books.ts` |
| Endpoints from the discovery document | Yes | `quickbooks.ts` `endpoints` |
| Expired access token, expired refresh token, invalid_grant, CSRF handled | Yes, each tested (against the fake; the sandbox run confirms it) | `tests/books-connectors/quickbooks.test.ts`, `tests/integration/books-quickbooks.test.ts` |
| Tokens from the OAuth playground or another offline tool | No | §R item 8 |

**Compliance — API usage**
| Asks about | Our answer | Settled by |
|---|---|---|
| Which APIs | Accounting only; not Payments, not Payroll | `quickbooks.ts` (one scope) |
| How often it calls, per customer | One read each morning plus the owner's buttons: at least 6 read calls a read, about 180–300 a month a company (§R, the read budget) | `src/main.ts` (`booksRead`), `quickbooks.ts` `readQbo` |

**Compliance — the Accounting API**
| Asks about | Our answer | Settled by |
|---|---|---|
| Which QuickBooks editions customers use | **None may be ticked yet**: none has been tested against a real QuickBooks company | — |
| Users gaining or losing an edition's features | Not handled specially: a refused call is said by its Fault code. **Say No** until a sandbox run shows otherwise | `quickbooks.ts` `refusalOf` |
| Features used and tested (multi-currency, US sales tax, non-US sales tax) | **None may be ticked yet.** The fake covers one currency an entry and the US/non-US tax split; that is not a tested feature | `tests/books-connectors/quickbooks.test.ts` |
| Webhooks | No | — |
| Change Data Capture | No: it queries each entity by `LastUpdatedTime`. Moving to CDC would cut reads (§R) | `quickbooks.ts` `readQbo` |

**Compliance — error handling**
| Asks about | Our answer | Settled by |
|---|---|---|
| API errors tested (syntax, validation) | Yes, against the fake's recorded Faults (6000, 6140, 2500, 2020, 6190, 3200); confirm on the sandbox | `tests/books-connectors/quickbooks.test.ts` |
| `intuit_tid` captured | Yes | §R item 5 |
| Errors logged in a form that can be shared for troubleshooting | Yes: `{ op, status, error, tid }`, nothing else | §R item 6 |
| Support from inside the app | **The owner's**: the in-app route to support | `src/api/web/help.ts` |

**Compliance — security**
| Asks about | Our answer | Settled by |
|---|---|---|
| A breach that needed notifying | **The owner's** | — |
| A team that assesses vulnerabilities | **The owner's** | — |
| Client ID and secret stored safely, never hardcoded or in the browser | Yes | §R item 11 |
| Multi-factor sign-in | Partly: a password, and an e-mailed code on a browser not confirmed before. No authenticator app. **The owner** decides how to answer | `src/api/web/app.ts` (`isKnownDevice`, `otpOn`), `src/db/otp.ts` |
| CAPTCHA on sign-in | A bot check on sign-up where one is configured; sign-in is throttled, with no CAPTCHA. **Say what is true** | `src/api/web/botCheck.ts`, `app.ts` (`loginThrottle`) |
| WebSockets | No: the one live line polls | `src/api/web/live.ts` |
| One customer's Intuit data shown to anyone else | No: each workspace's books are its own, by row security; within a workspace, only its owner and the accountant they add | `migrations/0200_*`, `0201_*` |

## 0. How this was read, and what was NOT seen

- **The questionnaire itself is behind Intuit's sign-in.** `help.developer.intuit.com/s/questionnaire` redirects to
  Intuit's login, and nobody signed in. *(Since Block R: the owner's research found it verbatim; see §R above.)* So its exact questions are **not known** here. What follows is what Intuit's own
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
2. ~~**A disconnect page** at the "disconnect URL"~~ **Done (Block R, item 10):** `GET /app/books/quickbooks/disconnected`. It
   says what disconnecting in QuickBooks means and marks nothing here, because a link anyone can open must not
   disconnect anybody. The next read sees the grant refused and asks to connect again.
3. **A written security and incident policy** (Developer Terms §13.1), including the 24-hour notice to Intuit (§13.4).
4. ~~**`intuit_tid` kept** with each QuickBooks error~~ **Done (Block R, items 5–6).**
5. **The owner's answers:** the contact; the business disclosures (complaints, lawsuits, government requests,
   breaches); sanctions; categories; accepted countries; the 24/7 99.95% support commitment; the annual assessment.
6. ~~**Decide, then say:** refresh only on expiry; seal the realm ID~~ **Done (Block R, items 1–2).**
7. **Costs, before anything is live** (App Partner Program; Intuit's partner FAQ, "Last updated: 2026-10-02"):
   - "Only the Builder tier is not charged." Apps are enrolled at Builder automatically.
   - On Builder, reads are capped: "the Builder tier will be limited to 500,000 CorePlus API credits per month", and
     calls above that are "blocked entirely" (the cap "resets on the 1st of each new month"). Reads are CorePlus;
     writes ("Core") are "unmetered and uncharged".
   - Fees "apply to all partners with production apps, whether or not your app is published". Silver is US$300 a month.
   - So Nomi on Builder costs nothing and is blocked, never billed, above the cap. Moving off Builder is spending,
     and is the owner's to decide.

None of the above is done by this file. Nothing was sent to Intuit.
