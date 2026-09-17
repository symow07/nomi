# Instagram and Messenger on Meta — the checklist that actually delivered

What it took, on 2026-09-17/18, to get a Page message and an Instagram DM
from Meta into `/app/inbox` on production. Written because the dashboard
shows green ticks long before anything arrives, and two of the gates below
are invisible from it.

## Ids and variables

| What | Where |
|---|---|
| Meta app **nomi-social** (Instagram + Messenger) | App ID 4070579106584338; secret → `META_SOCIAL_APP_SECRET` |
| Facebook Page **Nomi does** | `META_PAGE_ID=1243117518895652` |
| Instagram professional account **@nomidoes_** | `META_IG_ACCOUNT_ID=17841438850350135` |
| Page access token (long-lived, Instagram scopes) | `META_PAGE_ACCESS_TOKEN` |
| Webhook verify token | `WEBHOOK_VERIFY_TOKEN` (one value for every route) |

`WHATSAPP_PROVIDER=disabled` is fine: with these set, the service runs
"social-only" (`channels=["messenger","instagram"]` in the boot log).

## In order

1. **Page ↔ Instagram linked**, from the Instagram app (Settings → Sharing
   across profiles → Facebook → the Page). Business Suite's "add Page" dialog
   asks for the Instagram password and may refuse it; the app path does not.
2. **Business Suite → Home → Alerts → "Confirm Instagram message access"**,
   and in the Instagram app Settings → Messages → Message requests →
   *Connected tools → Allow access to messages* on.
3. **Webhooks**: Messenger settings → callback `/webhook/messenger`, verify,
   subscribe the Page to `messages`; Webhooks → *Instagram* object → callback
   `/webhook/instagram`, verify, subscribe `messages`.
4. **Permissions on the app**: Use cases → Instagram API → *API setup with
   Facebook login* → **Add required messaging permissions**. Messenger's
   `pages_messaging` is added by the use case; Instagram's
   `instagram_manage_messages` is not, and without it Meta forwards nothing.
5. **Publish** the app (App settings → Basic needs `/privacy`,
   `/data-deletion`, `/terms` and a category — all served by this product).
   Instagram delivers only to a published app; Messenger works in
   development mode.
6. **A Page token that carries the Instagram scopes.** TRAP: the *Generate*
   button in Messenger settings mints a token with `pages_messaging` only;
   with it the app cannot read the Instagram account (error 33) and gets no
   Instagram webhooks, however green the dashboard is. Mint it instead:
   Graph API Explorer → host **graph.facebook.com** → app nomi-social → User
   Token → permissions `pages_show_list, pages_messaging,
   pages_read_engagement, pages_manage_metadata, instagram_basic,
   instagram_manage_messages, business_management` → Generate → choose the
   Page and the Instagram account. That is a short-lived USER token; put it in
   a temporary Railway variable and, inside `railway run --service nomi`,
   exchange it (`/oauth/access_token?grant_type=fb_exchange_token…`), read
   `/me/accounts` for the Page token (long-lived, `expires_at: 0`), `POST
   /{page}/subscribed_apps?subscribed_fields=messages,messaging_postbacks`,
   write `META_PAGE_ACCESS_TOKEN` from the process, delete the temporary
   variable, redeploy. No token ever passes through a chat or a shell line.
   Check with `/debug_token`: the scopes must list `instagram_manage_messages`.
7. **Who may write in.** With *standard* access on a published app, Meta hands
   the app data only from people who hold a role on the app. Your own
   Facebook profile (the admin) reaches Messenger; a personal Instagram
   account does not until it is added as an **Instagram Tester** (App roles →
   Roles) and accepts the invite in Instagram. For strangers — real buyers —
   that gate is lifted only by **App Review** granting advanced access to
   `instagram_manage_messages` and `pages_messaging`. This is the next Meta
   milestone, and it needs a screencast of the flow above.

## A business connecting its own Page (C10)

Everything above is the HOST's account, set in the environment. A business
that signs up connects its own through **Connect your Facebook Page and
Instagram** on `/app/channels`, which opens Meta's login dialog; nomi keeps the
Page's own token encrypted (`meta_accounts`, 0054) and answers as that Page.
What the operator sets up once, in the app dashboard:

1. **Facebook Login for Business → Settings → Valid OAuth Redirect URIs**:
   `https://app.nomidoes.com/app/connect/meta/callback`.
2. **Facebook Login for Business → Configurations → Create**: login variation
   *General*; assets *Pages* and *Instagram accounts*; permissions the seven
   from § 6; token type *User access token*. Copy the **Configuration ID**.
3. Railway: `META_SOCIAL_APP_ID=4070579106584338`, `META_LOGIN_CONFIG_ID=<that
   id>`; redeploy. The button appears; the environment's own account stays the
   answer for a business that connected nothing.

Until App Review, the dialog grants the scopes only to accounts with a role on
the app — enough to connect this installation's own Page through it and to
record the screencast the review wants.

## How to tell which gate you are behind

- No `POST /webhook/instagram` in the logs at all → gates 4–7 (Meta never
  sent it). `GET /{page}/conversations?platform=instagram` with the Page token
  returning `[]` while `platform=messenger` lists your own thread is gate 7.
- A POST and `[inbound failed] 401/400` from Anthropic → the reply, not Meta:
  `ANTHROPIC_API_KEY` invalid, or the account has no credits.
- A POST with `received: 0` → the credential row: press Connect on
  `/app/channels` for that channel.
