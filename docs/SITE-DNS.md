# nomidoes.com — putting the site live

The site is served by the app that already runs on Railway (service `nomi`,
`src/api/web/site.ts`). Nothing new is deployed: a host name is pointed at the
same service, and one variable tells the app which host names are the site.

Read the page first, as it will look: **https://app.nomidoes.com/site** (marked
noindex, so search engines ignore the preview).

Order matters: Railway first (it tells you the DNS target), then GoDaddy, then
the variable. About 20 minutes of clicking, then up to an hour for DNS and the
certificate.

## What must NOT change

These records carry the mail and the app. Leave every one of them exactly as
it is:

- **MX** records (Google Workspace — the `@nomidoes.com` mailboxes)
- **TXT** records: SPF (`v=spf1 …`), `google-site-verification=…`, and any DMARC (`_dmarc`)
- **DKIM**: the `google._domainkey` TXT (or CNAME) record
- **CNAME `app`** → Railway (the app itself, `app.nomidoes.com`)

If a step below seems to need touching one of these, stop.

## 1 · Railway (≈5 min)

1. Railway dashboard → project → service **nomi** → **Settings** → **Networking**
   → **Custom Domain** → add `www.nomidoes.com`.
2. Railway shows the record to create. Write both values down:
   - a **CNAME**: name `www`, value `________________.up.railway.app`
     ← fill in from Railway's dashboard
   - if shown, a **TXT** for verification: name `_railway-verify.www`
     (Railway shows the exact name), value `railway-verify=________________`
     ← fill in from Railway's dashboard
3. Do not set the variable yet (step 3). Until it is set, `www.nomidoes.com`
   would show the sign-in door — harmless, but not the site.

## 2 · GoDaddy DNS (≈10 min)

GoDaddy → **My Products** → `nomidoes.com` → **DNS** → **DNS Records**.

1. **Delete the two parked A records on `@`:**
   - `A  @  3.33.130.190`
   - `A  @  15.197.148.33`
2. **Delete any existing `www` record** (usually `CNAME www → @` or
   `nomidoes.com`). There can be only one `www` record.
3. **Add the CNAME** from Railway:
   Type `CNAME` · Name `www` · Value `<the …up.railway.app target from step 1.2>`
   · TTL 1 hour (default).
4. **Add the TXT** from Railway, if it showed one:
   Type `TXT` · Name `<as Railway shows, e.g. _railway-verify.www>` · Value
   `<railway-verify=… from step 1.2>`.
5. **Forward the bare domain to www:** on the same domain page → **Forwarding**
   → **Domain** → **Add forwarding**:
   - Forward to: `https://` `www.nomidoes.com`
   - Forward type: **Permanent (301)**
   - Settings: **Forward only** (not "with masking")
   - Save. GoDaddy re-adds its own `A @` records for the forwarder — that is
     expected; do not delete those.

## 3 · The variable (≈2 min)

Railway → service **nomi** → **Variables** → add:

```
SITE_HOSTS=nomidoes.com,www.nomidoes.com
```

Railway redeploys the service. `PUBLIC_BASE_URL` must stay
`https://app.nomidoes.com` — it is where the site sends `/app`, `/login`,
`/signup` and `/verify`. (Listing `app.nomidoes.com` in `SITE_HOSTS` by mistake
is ignored: the app's own host is never the site.)

## 4 · Check it (≈5 min, after DNS has spread)

```bash
dig +short www.nomidoes.com CNAME        # → the …up.railway.app target
dig +short nomidoes.com MX               # → still Google (aspmx.l.google.com …)
dig +short app.nomidoes.com CNAME        # → still the app's Railway target

curl -sI https://nomidoes.com | grep -i -e '^HTTP' -e '^location'
#   HTTP/… 301   location: https://www.nomidoes.com/
curl -s https://www.nomidoes.com/ | grep -o 'data-surface="site"'
#   data-surface="site"
curl -sI https://www.nomidoes.com/app | grep -i -e '^HTTP' -e '^location'
#   HTTP/… 301   location: https://app.nomidoes.com/app
curl -s -o /dev/null -w '%{http_code}\n' https://www.nomidoes.com/privacy
#   200
curl -s https://app.nomidoes.com/health
#   {"ok":true,…} — the app is untouched
```

Then send yourself one e-mail to an `@nomidoes.com` address to confirm mail
still arrives.

If `www` shows a certificate warning, wait: Railway issues the certificate
only after it sees the CNAME, usually within minutes, sometimes an hour.

The bare domain is answered by GoDaddy's forwarder, not by Railway. If
`https://nomidoes.com` fails while `http://nomidoes.com` forwards, GoDaddy has
not issued the forwarder's certificate yet; it can take up to a day. `nomidoes.com`
is in `SITE_HOSTS` anyway, so the site still answers if the apex is later
pointed at Railway directly.

## Taking it back

Remove `SITE_HOSTS` in Railway: `www.nomidoes.com` then shows the sign-in door,
nothing else changes. To take the domain down entirely, remove the GoDaddy
forwarding and the `www` CNAME; MX, TXT, DKIM and `app` are untouched either
way.
