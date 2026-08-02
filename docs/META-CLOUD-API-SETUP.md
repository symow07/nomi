# Meta WhatsApp Cloud API Setup (Gate A pilot)

Direct Cloud API, no BSP, no business verification, free tier. ~20 minutes of
dashboard clicking; every value lands in `.env`. 360dialog stays in the code
for the production migration later — this changes configuration, not behavior.

## 1 · Create the app
1. developers.facebook.com → **My Apps → Create App** → type **Business**.
   Name it anything (e.g. `yiwuflow-pilot`); it is never shown to buyers.
2. On the app dashboard → **Add product → WhatsApp → Set up**. Accept the
   auto-created (or select an existing) Meta Business Account.

## 2 · Collect the five values (WhatsApp → API Setup page)
| Dashboard item | .env variable |
|---|---|
| **Temporary access token** (top of API Setup) | `META_WHATSAPP_ACCESS_TOKEN` |
| **Phone number ID** (under the test number) | `META_WHATSAPP_PHONE_NUMBER_ID` |
| **WhatsApp Business Account ID** (same panel) | `META_WHATSAPP_BUSINESS_ACCOUNT_ID` |
| App **Settings → Basic → App Secret** (Show) | `META_APP_SECRET` |
| Graph version shown in the curl example (e.g. v23.0) | `META_GRAPH_API_VERSION` |

Also set `WHATSAPP_PROVIDER=meta`. `WEBHOOK_VERIFY_TOKEN` is **generated
automatically** on first start — you never invent it; read it from `.env`
when the dashboard asks (below).

## 3 · Allow your pilot phone
API Setup → **To** field → **Manage phone number list → Add phone number** →
enter the pilot phone (the "buyer"/owner phone), enter the WhatsApp
verification code it receives. The test number can message only allowlisted
recipients (up to 5) — exactly right for a one-owner pilot.

## 4 · Send the dashboard's first test message
Use the API Setup page's **Send message** button (the hello_world template)
to the phone you just added. Seeing it arrive proves token + number work
before any Nomi step. Reply anything from the phone — that opens the
24-hour window so free-form replies work during verification.

## 5 · Webhook (after `npm start` + tunnel are up)
App dashboard → WhatsApp → **Configuration → Webhook → Edit**:
- **Callback URL**: `https://<your-tunnel-or-railway-host>/webhook/whatsapp`
- **Verify token**: the `WEBHOOK_VERIFY_TOKEN` value from `.env`
- Save — Meta fires the GET challenge; our ingress answers it.
- Then **Manage → messages → Subscribe** (the `messages` field carries
  inbound messages AND sent/delivered/read statuses).

Signature note: Meta signs every POST with **App Secret** via
`X-Hub-Signature-256` — already what the ingress verifies (timing-safe, raw
body). No extra configuration.

## 6 · Token lifetimes — read this before the pilot week
- The **temporary token expires in ~24 hours.** Fine for first verification,
  useless for a week-long pilot.
- For the pilot: Business Settings (business.facebook.com) → **Users →
  System users → Add** (Admin) → assign the app with full control →
  **Generate token** selecting `whatsapp_business_messaging` +
  `whatsapp_business_management`, expiry **never**. Paste that as
  `META_WHATSAPP_ACCESS_TOKEN` instead.
- Production migration later: registered business + either this same Cloud
  API with a verified business or the 360dialog BSP path (adapter already
  in the codebase; flip `WHATSAPP_PROVIDER=360dialog`).

## 7 · Nomi-side wiring (done by the deploy flow, listed for transparency)
- `channel_credentials` row: `channel='whatsapp'`,
  `external_ref=<META_WHATSAPP_PHONE_NUMBER_ID>` for the pilot business —
  this is tenant resolution; without it inbound events are acked and dropped.
- Limits to know: test-number recipients capped at 5; free conversation tier
  is far above pilot volume; media URLs from Graph expire in ~5 minutes
  (we download immediately, two-step, Bearer-authenticated).
