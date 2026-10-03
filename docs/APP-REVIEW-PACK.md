# Meta App Review — the pack (M3)

Everything Meta's App Review asks for, ready to paste: one paragraph per
permission, the screencast each needs and what it must show, the reviewer's
instructions and login, and the data-handling answers. Two Meta apps, three
submissions:

| Submission | App | Permissions | When |
|---|---|---|---|
| 1 · Instagram and Messenger | **nomi-social** | `pages_show_list`, `pages_messaging`, `pages_read_engagement`, `pages_manage_metadata`, `instagram_basic`, `instagram_manage_messages`, `business_management` | First — the day Business Verification passes |
| 2 · WhatsApp (Tech Provider) | **nomi** | `whatsapp_business_management`, `whatsapp_business_messaging`, `business_management` | With the Tech Provider application (TP) |
| 3 · Shared posts (CH7) | **nomi-social** | `instagram_basic` used to read the shop's own post caption | Its own later submission (decision 6) |

The paragraphs below are written for Meta's reviewer. Paste them as written.
Replace nothing in them except the bracketed reviewer details, which are
never committed here.

---

## What Nomi is (the app description field)

Nomi is a web app for small businesses — shops, brands and makers — that
answers their customers' messages on Instagram, Messenger and WhatsApp. For
each incoming message Nomi drafts a reply from the business's own product
list and policies. The business owner reads the draft in Nomi, edits it if
needed, and approves it; only then is it sent. An owner may later let Nomi send
some kinds of reply without approval, under rules the owner sets in the app.
Nomi never writes first on Instagram or Messenger, sends nothing outside
Meta's 24-hour window except an approved WhatsApp template, and hands any
customer who asks for a person, or asks for their data to be deleted, to the
owner with no automatic reply.

---

## Submission 1 · Instagram and Messenger (app nomi-social)

### `pages_show_list`
Nomi lists the Facebook Pages the business owner manages, once, while the
owner connects their business: the owner picks the Page whose Messenger and
linked Instagram account Nomi should answer. Nomi reads nothing else from the
list and keeps only the chosen Page's id and name.

### `pages_messaging`
Nomi receives the messages customers send to the business's Facebook Page and
sends the replies the business owner approves (or has allowed Nomi to send),
within Meta's 24-hour messaging window. Nomi never starts a conversation.

### `pages_manage_metadata`
When the owner connects a Page, Nomi subscribes its app to that Page's
`messages`, `messaging_postbacks` and `message_echoes` webhooks so that
customer messages reach Nomi and replies the owner types in Meta's own inbox
are recorded as the owner's. When the owner disconnects, Nomi unsubscribes.

### `pages_read_engagement`
Nomi reads the connected Page's name and the Instagram professional account
linked to it, to show the owner which accounts are connected and to route
each incoming message to the right business.

### `instagram_basic`
Nomi reads the connected Instagram professional account's username and the
sender's profile name of an incoming message, so the owner sees who wrote.

### `instagram_manage_messages`
Nomi receives the Instagram Direct messages customers send to the business's
professional account and sends the replies the owner approves (or has allowed
Nomi to send), within the 24-hour window. Story replies and shared posts are
shown to the owner, who answers them.

### `business_management`
Facebook Login for Business returns the Pages and Instagram accounts the owner
manages through their business portfolio; this permission lets Nomi read the
Page and account the owner chose when they are held in a portfolio.

### Screencast 1 (one recording, about 4 minutes)

Record in a browser at desktop width, English interface. Show the URL bar.

1. `https://app.nomidoes.com/login` — sign in as the reviewer workspace.
2. **Where customers reach you** (left rail) → **Connect your Facebook Page
   and Instagram**.
3. Meta's dialog: show the permissions screen in full, choose the test Page
   and its Instagram account, continue.
4. Back in Nomi: **Your accounts** shows the Page, the Instagram account,
   each permission granted, and the Page's webhook subscription.
5. On a phone (or a second browser) logged in as a different Instagram
   account, send the business: *"Do you have the canvas tote in green?"*
6. In Nomi: **Customers** shows the new conversation. Open it: the customer's
   message, and Nomi's draft reply under it.
7. Edit one word of the draft, press **Send**.
8. On the phone: the reply arrives in Instagram.
9. Repeat 5–8 on Messenger, from a different Facebook account.
10. In Meta Business Suite's inbox, type a reply to the Messenger customer.
    In Nomi the conversation shows it as the owner's own reply.
11. From the customer account, send *"Can I speak to a person?"*. In Nomi the
    conversation moves to **Needs you** with no reply sent.
12. Open `https://app.nomidoes.com/data-deletion` and `/privacy`.
13. **Where customers reach you** → **Disconnect**: the Page's subscription is removed.

---

## Submission 2 · WhatsApp, as a Tech Provider (app nomi)

### `whatsapp_business_management`
Through Embedded Signup, a business connects its own WhatsApp Business Account
and phone number to Nomi. Nomi reads the account's phone numbers (to let the
owner choose one and to show its display name and Meta's review of it),
subscribes its app to the account's webhooks, registers the number for the
Cloud API, and asks Meta to approve one message template — "a reply is
waiting; answer this message to see it" — reading back its review status.

### `whatsapp_business_messaging`
Nomi receives the WhatsApp messages customers send to the business's number
and sends the replies the business owner approves (or has allowed Nomi to
send) within the 24-hour customer service window. After 24 hours it sends
only the approved template, and only for a reply the owner approved.

### `business_management`
Embedded Signup creates or selects the business portfolio that holds the
WhatsApp Business Account; Nomi reads which account the owner shared.

### Screencast 2 (about 4 minutes)

1. Sign in as the reviewer workspace → **Where customers reach you** →
   **Connect your WhatsApp number**.
2. Meta's Embedded Signup: business portfolio, a new WhatsApp Business
   Account, the test number, its display name, the verification code.
3. Back in Nomi: the WhatsApp card shows the number, the display name and
   Meta's review status.
4. **My business** → add the reviewer's phone to the list → **Let your
   assistant start**.
5. From the reviewer's phone, WhatsApp the number: *"Do you ship to Madrid?"*
6. In Nomi: the draft; approve it; it arrives on the phone.
7. **Where customers reach you** → **Ask Meta to approve it** (the template)
   → **Check with Meta**: its status per language.
8. **Disconnect this number**.

---

## Submission 3 · Shared posts (CH7, app nomi-social)

### `instagram_basic` (reading media)
When a customer shares one of the business's own Instagram posts or reels
into a Direct conversation, or replies to its story, Nomi reads that post's
caption with the connected account's token, to find which of the business's
products the customer means. Nomi reads only the business's own media, only
when a customer refers to it, and keeps only the matched product's name.

### Screencast 3 (about 2 minutes)

1. The business's Instagram account has a post whose caption names a product
   in Nomi (e.g. *"Our canvas tote, now in green"*).
2. From a customer account, share that post to the business in Direct.
3. In Nomi: the conversation shows "A shared post · Your product: Canvas
   tote", and the draft answers about the canvas tote.

---

## Reviewer instructions (paste into each submission's "notes")

- URL: `https://app.nomidoes.com/login`
- Sign in with: [reviewer e-mail] / [password] — sent separately in the form's
  credentials field, never here.
- The workspace is a test business with a product list already in place.
- Instagram/Messenger: use the test Page [name] and its Instagram account
  [handle]; the reviewer's own accounts can send the customer messages.
- WhatsApp: use the test number [number]; the reviewer's phone receives the
  replies once added on **My business**.
- Every reply in this workspace waits for the reviewer's approval (nothing is
  sent alone); on WhatsApp it also answers only the numbers on its list.

### Making the reviewer's login (the owner, by hand — never committed)

1. Mint one invitation: `railway run --service nomi -- node
   tools/invite-factory.mjs "Meta App Review"` — it prints the sign-up link.
   (While sign-up is open, `/signup` needs no invitation.)
2. Open the link and sign up a test business ("Nomi Review Shop") with the
   reviewer e-mail and a password you choose. The workspace is made like any
   other; nobody copies an id.
3. In that workspace, import a few products (Products → Teach your assistant
   your products) so drafts have something to say, and confirm the assistant's
   name on Getting ready.
4. Paste the e-mail and password into Meta's credentials field for each
   submission. For a lost password, "Forgot your password?" on the sign-in
   page mails a one-time link to the reviewer address; `tools/add-login.mjs
   <business-id> <e-mail> --reset` prints one if that mail does not arrive.

---

## Data handling (Meta's data-use questions)

- **What is stored:** the messages exchanged with the business's customers,
  the customer's name as Meta gives it and their channel id, the drafts and
  replies, and the business's own product list and policies.
- **Why:** to draft and send the business's replies and show the owner their
  conversations. Nothing is sold or shared for advertising.
- **Processors:** the drafting model provider and Railway (hosting), named on
  `/privacy`.
- **Deletion:** a customer asks the business (in chat or at the address on
  `/data-deletion`); the business records the request and it is carried out
  within 30 days. Removing Nomi from Meta's settings stops new messages.
- **Security:** Page and WhatsApp tokens are encrypted at rest (AES-256-GCM)
  with a key held outside the database; every business's data is isolated by
  row-level security.
