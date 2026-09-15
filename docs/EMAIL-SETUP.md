# E-mail setup — from nothing to her first follow-up

For whoever runs the installation, with the owner beside them for the steps
marked **Owner**. About an hour of dashboard work, plus however long her domain
host takes to publish DNS records.

What you end up with: first e-mails and follow-ups that leave from **her own
Google Workspace or Microsoft 365 address**, on her own domain, signed and
authorised by that domain. Nothing here reads her mailbox.

> **Not yet exercised against Google or Microsoft from this repository.** Every
> step on this side of the wire is tested. The first real connection is the
> first live test, so do it yourself before the owner relies on it, and read
> the connection result on `/app/channels` rather than assuming.

## 0 · What must already be true

- **A mailbox on her own domain.** Google Workspace or Microsoft 365, e.g.
  `sales@yourfactory.com`. A `@gmail.com` or `@outlook.com` address cannot be
  used: the mailbox must be on the domain she verifies in step 3, or nothing is
  sent from it (the page says so).
- **`PUBLIC_BASE_URL`** is set to the installation's https address. The
  providers redirect back to it, and every mail's unsubscribe link is built on it.
- **`WHATSAPP_PROVIDER` is not `disabled`.** The outbound worker and the
  follow-up schedule only run when messaging is on. In deployment mode the write
  page says messaging is not switched on, and nothing is sent.
- **`CREDENTIAL_KEY`** is set. The connected mailbox's refresh token is stored
  encrypted with it.
- Migrations are applied through **0051**. The app refuses to boot on an older
  schema.

Do **one** of section 1 (Google) or section 2 (Microsoft), whichever hosts her
mailbox.

## 1 · Google Workspace

Create this **inside her Workspace organisation**, signed in as a Workspace
admin. An app owned by the organisation can be *Internal*, which needs no Google
verification and whose refresh tokens do not expire after 7 days.

1. **console.cloud.google.com → Select a project → New project.** Pick her
   organisation as the location. Any name.
2. **APIs & Services → Library → Gmail API → Enable.** Without it, connecting
   works and every send fails.
3. **APIs & Services → OAuth consent screen** (or *Google Auth Platform →
   Branding / Audience*):
   - User type **Internal**. If Internal is not offered, the project is not in
     her organisation. Go back to step 1.
   - App name: the factory's name. This is what she sees when she connects.
   - Support and developer e-mail: her own.
4. **Data access / Scopes:** add `openid`, `.../auth/userinfo.email` and
   `https://www.googleapis.com/auth/gmail.send`. Nothing else. The product never
   asks for more, and a test holds it to that.
5. **Credentials → Create credentials → OAuth client ID:**
   - Application type **Web application**.
   - Authorised redirect URI: `<PUBLIC_BASE_URL>/app/connect/google/callback`,
     character for character. No trailing slash, and https.
6. Copy the two values into the host's environment and restart:

   | Google shows | Set |
   |---|---|
   | Client ID | `GOOGLE_OAUTH_CLIENT_ID` |
   | Client secret | `GOOGLE_OAUTH_CLIENT_SECRET` |

**If you use an External app instead** (the project is not in her
organisation): while its publishing status is *Testing*, add her address as a
test user, and expect **her connection to die after 7 days**. The page then asks
her to connect again. `gmail.send` is a sensitive scope, so publishing an
External app means Google's verification (M52 #9).

## 2 · Microsoft 365

1. **entra.microsoft.com → Identity → Applications → App registrations → New
   registration.**
   - Name: the factory's name.
   - Supported account types: **Accounts in this organizational directory only**
     is right for one factory. Then set `MICROSOFT_OAUTH_TENANT` in step 5.
     Microsoft refuses a single-tenant app at the shared `/common` address.
   - Redirect URI: platform **Web**,
     `<PUBLIC_BASE_URL>/app/connect/microsoft/callback`.
2. **API permissions → Add a permission → Microsoft Graph → Delegated:**
   `Mail.Send`, `offline_access`, `openid`, `email`. If her tenant requires
   admin consent for users, press **Grant admin consent**.
3. **Certificates & secrets → New client secret.** Copy the **Value** now. It
   is shown once, and the *Secret ID* beside it is not the secret. **Write down
   the expiry date.** When it passes, every send fails until a new secret is set.
4. **Overview:** note the *Application (client) ID* and *Directory (tenant) ID*.
5. Set, then restart:

   | Entra shows | Set |
   |---|---|
   | Application (client) ID | `MICROSOFT_OAUTH_CLIENT_ID` |
   | Client secret **Value** | `MICROSOFT_OAUTH_CLIENT_SECRET` |
   | Directory (tenant) ID | `MICROSOFT_OAUTH_TENANT` (single-tenant apps) |

The mailbox needs an Exchange Online licence. Sending uses Microsoft Graph, not
SMTP, so SMTP AUTH can stay off.

## 3 · Her domain's three records

**Owner, with whoever holds her domain.** On `/app/channels`, under the domain
card, enter the domain her mailbox is on and **the name on your signature**
(the DKIM selector), then Save. The page then lists exactly which host each
record goes on.

| Record | Host | Google Workspace | Microsoft 365 |
|---|---|---|---|
| Who may send as you (SPF) | `yourfactory.com` TXT | `v=spf1 include:_spf.google.com ~all` | `v=spf1 include:spf.protection.outlook.com ~all` |
| Your signature (DKIM) | `<selector>._domainkey.yourfactory.com` | Admin console → Apps → Google Workspace → Gmail → **Authenticate email** → Generate new record → publish the TXT → **Start authentication**. Selector: `google` unless changed there. | Defender portal → Email & collaboration → Policies & rules → Threat policies → **Email authentication settings → DKIM** → publish the two CNAMEs → enable. Selector: `selector1`. |
| What to do if they disagree (DMARC) | `_dmarc.yourfactory.com` TXT | `v=DMARC1; p=none; rua=mailto:dmarc@yourfactory.com` | same |

- **One SPF record only.** If her domain already has one, add the `include:` to
  it. Do not publish a second record: two SPF records fail both.
- Any DMARC policy passes the check, `p=none` included. Tightening it later is
  her decision.
- The SPF check requires her **connected mailbox's** include. Until step 4 is
  done it reads *"there — it can be checked once the mail account exists"*.
  That is expected, not an error. An operator sending through another service
  sets `SENDING_SPF_INCLUDE` to that service's include instead.
- **Look again** checks at once. After that, the installation looks again by
  itself every day while the records pass, and every hour while they do not. A
  check older than a week never counts as passing.

## 4 · Connect the mailbox

**Owner, signed in with the owner code** (staff cannot connect accounts).

1. `/app/channels` → **Your accounts** → Gmail or Outlook → **Connect**. If it
   says *"Not set up here yet"*, the section 1 or 2 variables are not set, or
   the app was not restarted.
2. Sign in **as the mailbox she sends from**, and allow sending.
3. Back on the page: *"Your e-mail now leaves as sales@yourfactory.com."* If it
   warns that the address is not on her domain, the mailbox and the domain in
   step 3 differ, and nothing is sent until they match.
4. Press **Look again** on the domain card. All three records should read
   *done*, and the card *Ready to send from*.

If the page later shows **Needs you** ("stopped letting us send"), her grant was
revoked or expired: an External app in Testing after 7 days, a password reset
with sign-out, or an admin removing the app. She presses **Connect again**.
Nothing is lost.

**An expired or mistyped app secret is different.** Microsoft secrets always
expire. The provider then refuses the installation, not her, and connecting
again cannot help. Her mailbox is not marked *Needs you*. Connecting says
*"Google or Microsoft refused this installation, not you…"*, and each refused
mail says its *client secret may have expired*. Set a new secret (section 1
step 6, or section 2 steps 3 and 5) and restart. Sending resumes without her
doing anything.

## 5 · Writing first, and follow-ups

**Owner.**

1. `/app/channels` → **Writing first** → e-mail → **Let her write first**. Set
   her daily limit beside it. The installation never goes above 50 a day,
   whatever she sets.
2. `/app/contacts` → add each person, and record why she may write to them.
   Without that record, nothing is sent to them.
3. One e-mail: **Write to them** on the contact. Follow-ups: `/app/sequences` →
   write them → **Approve**. Only the owner can approve, and approved words
   cannot change.

### Follow-ups wait for someone to look in her inbox

A buyer's reply goes to **her own mailbox**, not into this product, because
nothing here reads her mail. So the product cannot know he answered, and a
follow-up does not go by itself. When one is due, the sequence page marks it
**Waiting for you**, and Today counts it. Someone looks in her inbox first:

- he answered → **Stop for them**;
- he did not → **No answer yet — send it** (recorded with their name).

If nobody does either within a week, it stops for that person
(*"Nobody said to send the next e-mail for a week"*). The first e-mail never
waits: nobody can have answered a mail that has not gone.

Replies can flow into the product only if mail is sent through an e-mail service
whose inbound webhook is configured (`EMAIL_WEBHOOK_SECRET`,
`/hooks/email/inbound`). That service is not wired as a transport today, so
follow-ups always wait.

## 6 · When something does not send

The contact's page and the write page give the reason before anything is queued.
Anything refused after that is shown on the conversation.

| What she sees | Cause | Fix |
|---|---|---|
| *Messaging is not switched on here yet…* | `WHATSAPP_PROVIDER=disabled` | Section 0 |
| Gmail / Outlook: *Not set up here yet* | OAuth variables missing | Section 1 or 2, then restart |
| Gmail / Outlook: *Needs you* | Her grant revoked or expired | Section 4, *Needs you* |
| *…refused this installation, not you…*, or a mail failed with *client secret may have expired* | The app secret expired or is wrong | Section 4, expired secret |
| *That way of reaching buyers does not allow a first message — or does not allow one yet.* | A domain record is missing, wrong or unchecked | Section 3 |
| *This address is not on {domain}…* | Mailbox and domain differ | Section 4, step 3 |
| *You have not said she may write first on this one.* | Writing first is off | Section 5, step 1 |
| *There is nothing on file saying you may.* | No consent recorded | Section 5, step 2 |
| *You set how many she may start in a day, and it is spent.* | Her limit, or the ceiling of 50 | Wait for the next day (Shanghai time) |

The ops kill switch (`docs/INCIDENT-PLAYBOOK.md`) holds every scheduled
follow-up at once. A first e-mail she typed herself is not held.
